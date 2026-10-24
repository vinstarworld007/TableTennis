import { Router } from 'express';
import { db } from '../db.js';
import { requireUser, requireAdmin } from '../auth.js';
import { podium, finaliseEvent, liteUser } from '../stats.js';
import { localDate, eventIcs, awardForEvent } from '../events.js';
import { matchView, createMatch } from '../matchService.js';
import {
  assignPlayer, removePlayer, board, pairUp, addPair, removePair, makeTeams, clearTeams, singlesGameId, doublesGameId, tableConfig,
} from '../night.js';
import { subscribe, emitEvent } from '../bus.js';
import { bad, notFound, str, int } from '../util.js';

const r = Router();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const counts = db.prepare(`SELECT
  (SELECT COUNT(*) FROM attendance WHERE event_id = ?1 AND status = 'going') AS going,
  (SELECT COUNT(*) FROM attendance WHERE event_id = ?1 AND status = 'here') AS here,
  (SELECT COUNT(*) FROM matches WHERE event_id = ?1) AS matches,
  (SELECT COUNT(*) FROM media WHERE event_id = ?1) AS media`);

function summary(ev, user) {
  if (!ev) return null;
  const mine = user && db.prepare('SELECT status FROM attendance WHERE event_id = ? AND user_id = ?').get(ev.id, user.id);
  return { ...ev, ...counts.get(ev.id), my_status: mine?.status || null, is_today: ev.date === localDate() };
}

r.get('/', (req, res) => {
  const today = localDate();
  const past = req.query.when === 'past';
  const rows = past
    ? db.prepare('SELECT * FROM events WHERE date < ? ORDER BY date DESC LIMIT 100').all(today)
    : db.prepare('SELECT * FROM events WHERE date >= ? ORDER BY date LIMIT 50').all(today);
  res.json({ events: rows.map((e) => summary(e, req.user)) });
});

r.get('/current', (req, res) => {
  const today = localDate();
  const ev = db.prepare('SELECT * FROM events WHERE date = ? ORDER BY id LIMIT 1').get(today)
    || db.prepare('SELECT * FROM events WHERE date > ? ORDER BY date LIMIT 1').get(today)
    || db.prepare('SELECT * FROM events ORDER BY date DESC LIMIT 1').get();
  const last = db.prepare("SELECT * FROM events WHERE date < ? AND status = 'finalised' ORDER BY date DESC LIMIT 1").get(today);
  res.json({ event: summary(ev, req.user), last: last ? { ...summary(last, req.user), podium: podium(last.id) } : null });
});

r.get('/:id', (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(int(req.params.id));
  if (!ev) throw notFound('Night not found.');
  const people = db.prepare('SELECT user_id, status FROM attendance WHERE event_id = ? ORDER BY updated_at').all(ev.id)
    .map((a) => ({ status: a.status, user: liteUser(a.user_id) })).filter((a) => a.user);
  const matches = db.prepare('SELECT * FROM matches WHERE event_id = ? ORDER BY created_at DESC, id DESC').all(ev.id).map(matchView);
  res.json({ event: summary(ev, req.user), people, matches, podium: podium(ev.id) });
});

r.get('/:id/podium', (req, res) => res.json({ podium: podium(int(req.params.id)) }));

r.get('/:id/calendar.ics', (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(int(req.params.id));
  if (!ev) throw notFound('Night not found.');
  const url = `${req.protocol}://${req.get('host')}/#/events/${ev.id}`;
  res.type('text/calendar').set('Content-Disposition', `attachment; filename="night-${ev.date}.ics"`).send(eventIcs(ev, url));
});

r.post('/:id/attendance', requireUser, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(int(req.params.id));
  if (!ev) throw notFound('Night not found.');
  const status = req.body.status === 'here' ? 'here' : 'going';
  if (status === 'here' && ev.date !== localDate() && req.user.role !== 'admin') throw bad('You can only check in on the night.');
  db.prepare(`INSERT INTO attendance (event_id, user_id, status) VALUES (?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`)
    .run(ev.id, req.user.id, status);
  const table = ev.status === 'cancelled' || ev.status === 'finalised' ? null : assignPlayer(ev.id, req.user.id);
  emitEvent(ev.id);
  res.json({ event: summary(ev, req.user), table });
});

r.delete('/:id/attendance', requireUser, (req, res) => {
  const id = int(req.params.id);
  const ev = db.prepare('SELECT status FROM events WHERE id = ?').get(id);
  db.prepare('DELETE FROM attendance WHERE event_id = ? AND user_id = ?').run(id, req.user.id);
  if (ev && ev.status !== 'finalised') removePlayer(id, req.user.id);
  emitEvent(id);
  res.json({ ok: true });
});

function readEvent(b, existing = {}) {
  const ev = {
    title: b.title !== undefined ? str(b.title, 100) : existing.title ?? null,
    date: b.date !== undefined ? str(b.date, 10) : existing.date ?? null,
    start_time: b.start_time !== undefined ? str(b.start_time, 5) : existing.start_time ?? null,
    location: b.location !== undefined ? str(b.location, 200) : existing.location ?? null,
    description: b.description !== undefined ? str(b.description, 2000) : existing.description ?? null,
  };
  if (!ev.title) throw bad('Give the night a title.');
  if (!ev.date || !DATE.test(ev.date)) throw bad('Pick a date.');
  if (ev.start_time && !TIME.test(ev.start_time)) throw bad('Time should look like 19:00.');
  return ev;
}

r.post('/', requireAdmin, (req, res) => {
  const ev = readEvent(req.body);
  const status = ev.date === localDate() ? 'live' : 'upcoming';
  const info = db.prepare('INSERT INTO events (title, date, start_time, location, description, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ev.title, ev.date, ev.start_time, ev.location, ev.description, status, req.user.id);
  res.status(201).json({ event: summary(db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid), req.user) });
});

r.patch('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(int(req.params.id));
  if (!existing) throw notFound('Night not found.');
  const ev = readEvent(req.body, existing);
  db.prepare('UPDATE events SET title = ?, date = ?, start_time = ?, location = ?, description = ? WHERE id = ?')
    .run(ev.title, ev.date, ev.start_time, ev.location, ev.description, existing.id);
  res.json({ event: summary(db.prepare('SELECT * FROM events WHERE id = ?').get(existing.id), req.user) });
});

r.delete('/:id', requireAdmin, (req, res) => {
  if (db.prepare('SELECT 1 FROM matches WHERE event_id = ?').get(int(req.params.id))) {
    throw bad('This night has results. Cancel it instead of deleting it.');
  }
  db.prepare('DELETE FROM events WHERE id = ?').run(int(req.params.id));
  res.json({ ok: true });
});

r.post('/:id/finalise', requireAdmin, (req, res) => {
  const id = int(req.params.id);
  if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id)) throw notFound('Night not found.');
  finaliseEvent(id);
  awardForEvent(id);
  res.json({ podium: podium(id) });
});

// Cancelling keeps the date taken so the weekly auto-scheduler does not recreate it.
r.post('/:id/cancel', requireAdmin, (req, res) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(int(req.params.id));
  if (!ev) throw notFound('Night not found.');
  const cancel = req.body.cancel !== false;
  if (!cancel && ev.status !== 'cancelled') throw bad('That night is not cancelled.');
  if (cancel && ev.status === 'finalised') throw bad('That night has already happened.');
  const status = cancel ? 'cancelled' : ev.date === localDate() ? 'live' : 'upcoming';
  db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, ev.id);
  res.json({ event: summary(db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id), req.user) });
});

// ---------- Tables, fixtures, doubles and teams ----------
const getEvent = (id) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(int(id));
  if (!ev) throw notFound('Night not found.');
  return ev;
};

r.get('/:id/board', (req, res) => {
  const ev = getEvent(req.params.id);
  const b = board(ev.id);
  const me = req.user?.id;
  let mine = null;
  if (me) {
    const t = b.tables.find((x) => x.players.some((p) => p.id === me));
    if (t) {
      const all = [t.now, ...t.queue].filter(Boolean);
      const idx = all.findIndex((f) => [...f.a, ...f.b].some((p) => p?.id === me));
      mine = { table: t.no, level: t.level, next: idx >= 0 ? all[idx] : null, position: idx, left: all.filter((f) => [...f.a, ...f.b].some((p) => p?.id === me)).length };
    }
  }
  res.json({ ...b, mine, config: tableConfig() });
});

// Live updates for a night page (Server-Sent Events).
r.get('/:id/stream', (req, res) => {
  const id = int(req.params.id);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const off = subscribe(`event:${id}`, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); off(); });
});

r.post('/:id/fixtures/:fid/result', requireUser, (req, res) => {
  const ev = getEvent(req.params.id);
  const f = db.prepare("SELECT * FROM fixtures WHERE id = ? AND event_id = ?").get(int(req.params.fid), ev.id);
  if (!f) throw notFound('Fixture not found.');
  if (f.status !== 'pending') throw bad('That fixture already has a result.');
  const doubles = !!f.p3_id;
  const { match, earned } = createMatch(req.user, {
    game_id: doubles ? doublesGameId() : singlesGameId(),
    event_id: ev.id, fixture_id: f.id,
    p1_id: f.p1_id, p2_id: f.p2_id, p3_id: f.p3_id, p4_id: f.p4_id,
    p1_score: req.body.s1, p2_score: req.body.s2, detail: req.body.detail,
  });
  res.status(201).json({ match: matchView(match), new_achievements: earned[req.user.id] || [] });
});

r.post('/:id/tables/assign', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  const userId = int(req.body.user_id);
  const tableNo = int(req.body.table_no);
  if (!liteUser(userId)) throw bad('Pick a player.');
  if (tableNo && (tableNo < 1 || tableNo > tableConfig().count)) throw bad('That table does not exist.');
  db.prepare(`INSERT INTO attendance (event_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT(event_id, user_id) DO NOTHING`)
    .run(ev.id, userId, ev.date === localDate() ? 'here' : 'going');
  res.json({ table: assignPlayer(ev.id, userId, tableNo || null) });
});

r.delete('/:id/tables/:uid', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  removePlayer(ev.id, int(req.params.uid));
  db.prepare('DELETE FROM attendance WHERE event_id = ? AND user_id = ?').run(ev.id, int(req.params.uid));
  res.json({ ok: true });
});

r.post('/:id/doubles/pair', requireUser, (req, res) => {
  const ev = getEvent(req.params.id);
  const mode = req.body.mode === 'reshuffle' ? 'reshuffle' : 'add';
  if (mode === 'reshuffle' && req.user.role !== 'admin') throw bad('Only admins can reshuffle the pairs.');
  pairUp(ev.id, mode);
  res.json({ ok: true });
});

r.post('/:id/doubles/pairs', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  const a = int(req.body.user1_id);
  const b = int(req.body.user2_id);
  if (!liteUser(a) || !liteUser(b)) throw bad('Pick two players.');
  addPair(ev.id, a, b);
  res.json({ ok: true });
});

r.delete('/:id/doubles/pairs/:pid', requireAdmin, (req, res) => {
  removePair(int(req.params.pid));
  res.json({ ok: true });
});

r.post('/:id/teams', requireAdmin, (req, res) => {
  const ev = getEvent(req.params.id);
  makeTeams(ev.id, int(req.body.count) || 2);
  res.json({ ok: true });
});

r.delete('/:id/teams', requireAdmin, (req, res) => {
  clearTeams(getEvent(req.params.id).id);
  res.json({ ok: true });
});

export default r;
