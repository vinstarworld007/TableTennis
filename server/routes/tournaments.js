import { Router } from 'express';
import { db } from '../db.js';
import { requireUser, requireAdmin } from '../auth.js';
import { startTournament, tournamentView, recordTournamentResult } from '../tournaments.js';
import { createMatch, matchView } from '../matchService.js';
import { liteUser } from '../stats.js';
import { emitEvent } from '../bus.js';
import { bad, notFound, forbidden, str, int } from '../util.js';

const r = Router();

r.get('/', (req, res) => {
  const rows = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants
    FROM tournaments t ORDER BY t.status = 'done', t.id DESC LIMIT 100`).all();
  res.json({
    tournaments: rows.map((t) => ({
      ...t,
      game: db.prepare('SELECT id, name, emoji FROM games WHERE id = ?').get(t.game_id),
      winner: t.winner_id ? liteUser(t.winner_id) : null,
      event: t.event_id ? db.prepare('SELECT id, date, title FROM events WHERE id = ?').get(t.event_id) : null,
    })),
  });
});

r.get('/:id', (req, res) => {
  const t = tournamentView(int(req.params.id), req.user?.id);
  if (!t) throw notFound('Tournament not found.');
  res.json({ tournament: t });
});

r.post('/', requireAdmin, (req, res) => {
  const name = str(req.body.name, 80);
  const game = db.prepare('SELECT id FROM games WHERE id = ? AND team_size = 1').get(int(req.body.game_id));
  if (!name) throw bad('Name the tournament.');
  if (!game) throw bad('Pick a singles game.');
  const eventId = int(req.body.event_id) || null;
  const info = db.prepare('INSERT INTO tournaments (name, game_id, event_id, created_by) VALUES (?, ?, ?, ?)')
    .run(name, game.id, eventId, req.user.id);
  const id = Number(info.lastInsertRowid);
  // Optionally enter everyone checked in on the night.
  if (eventId && req.body.add_attendees) {
    db.prepare(`INSERT OR IGNORE INTO tournament_entries (tournament_id, user_id)
      SELECT ?, user_id FROM attendance WHERE event_id = ? AND status = 'here'`).run(id, eventId);
  }
  emitEvent(eventId);
  res.status(201).json({ tournament: tournamentView(id, req.user.id) });
});

const openTournament = (id) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!t) throw notFound('Tournament not found.');
  if (t.status !== 'open') throw bad('Entries are closed — the draw has been made.');
  return t;
};

r.post('/:id/join', requireUser, (req, res) => {
  const t = openTournament(int(req.params.id));
  const userId = req.user.role === 'admin' && req.body.user_id ? int(req.body.user_id) : req.user.id;
  if (!liteUser(userId)) throw bad('Pick a player.');
  db.prepare('INSERT OR IGNORE INTO tournament_entries (tournament_id, user_id) VALUES (?, ?)').run(t.id, userId);
  emitEvent(t.event_id);
  res.json({ tournament: tournamentView(t.id, req.user.id) });
});

r.post('/:id/leave', requireUser, (req, res) => {
  const t = openTournament(int(req.params.id));
  const userId = req.user.role === 'admin' && req.body.user_id ? int(req.body.user_id) : req.user.id;
  db.prepare('DELETE FROM tournament_entries WHERE tournament_id = ? AND user_id = ?').run(t.id, userId);
  res.json({ tournament: tournamentView(t.id, req.user.id) });
});

r.post('/:id/start', requireAdmin, (req, res) => {
  startTournament(int(req.params.id));
  res.json({ tournament: tournamentView(int(req.params.id), req.user.id) });
});

r.post('/:id/matches/:mid/result', requireUser, (req, res) => {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(int(req.params.id));
  const m = db.prepare('SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?').get(int(req.params.mid), t?.id);
  if (!t || !m) throw notFound('Match not found.');
  if (t.status !== 'running') throw bad('This tournament is not running.');
  if (!m.p1_id || !m.p2_id || m.winner_id) throw bad('This match is not ready to be played.');
  if (req.user.role !== 'admin' && ![m.p1_id, m.p2_id].includes(req.user.id)) throw forbidden('Only the two players or an admin can enter this result.');
  const { match, earned } = createMatch(req.user, {
    game_id: t.game_id, event_id: t.event_id ?? undefined, p1_id: m.p1_id, p2_id: m.p2_id,
    p1_score: req.body.s1, p2_score: req.body.s2, detail: req.body.detail,
  }, { allowFinalised: true });
  recordTournamentResult(m.id, match);
  res.status(201).json({ match: matchView(match), tournament: tournamentView(t.id, req.user.id), new_achievements: earned[req.user.id] || [] });
});

r.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tournaments WHERE id = ?').run(int(req.params.id));
  res.json({ ok: true });
});

export default r;
