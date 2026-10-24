import { db, tx } from './db.js';
import { applyMatch, replayGame, liteUser } from './stats.js';
import { checkAchievements } from './achievements.js';
import { localDate } from './events.js';
import { linkFixture, unlinkFixture } from './night.js';
import { onTournamentMatchDeleted } from './tournaments.js';
import { push } from './notify.js';
import { emitEvent } from './bus.js';
import { bad, forbidden, str, int } from './util.js';

const gameById = db.prepare('SELECT id, name, emoji, score_label, team_size FROM games WHERE id = ?');

export function matchView(m) {
  const d = (v) => (v == null ? null : Math.round(v));
  return {
    id: m.id,
    event_id: m.event_id,
    game: gameById.get(m.game_id),
    p1: liteUser(m.p1_id),
    p2: liteUser(m.p2_id),
    p3: m.p3_id ? liteUser(m.p3_id) : null,
    p4: m.p4_id ? liteUser(m.p4_id) : null,
    p1_score: m.p1_score,
    p2_score: m.p2_score,
    winner_id: m.winner_id,
    detail: m.detail,
    recorded_by: m.recorded_by,
    created_at: m.created_at,
    p1_delta: d(m.p1_delta),
    p2_delta: d(m.p2_delta),
    p3_delta: d(m.p3_delta),
    p4_delta: d(m.p4_delta),
  };
}

const topOf = (gameId) => db.prepare('SELECT user_id FROM ratings WHERE game_id = ? AND played > 0 ORDER BY rating DESC LIMIT 1').get(gameId)?.user_id;

// Validate and record one result. Used by quick logging, table fixtures and tournaments.
export function createMatch(me, b, { allowFinalised = false, skipFixtureLink = false } = {}) {
  const isAdmin = me.role === 'admin';
  const game = gameById.get(int(b.game_id));
  if (!game) throw bad('Pick a game.');
  const doubles = game.team_size === 2;
  const p1 = int(b.p1_id) ?? me.id;
  const p2 = int(b.p2_id);
  const p3 = doubles ? int(b.p3_id) : null;
  const p4 = doubles ? int(b.p4_id) : null;
  const s1 = int(b.p1_score);
  const s2 = int(b.p2_score);
  const ids = [p1, p2, p3, p4].filter(Boolean);
  if (!p2 || ids.some((id) => !liteUser(id))) throw bad('Pick your opponent.');
  if (doubles && (!p3 || !p4)) throw bad('Doubles needs two players on each side.');
  if (new Set(ids).size !== ids.length) throw bad('Each player can only appear once in a match.');
  if (!isAdmin && !ids.includes(me.id)) throw forbidden('You can only log matches you played in.');
  if (s1 == null || s2 == null || s1 < 0 || s2 < 0 || s1 > 99 || s2 > 99) throw bad('Enter both scores.');
  if (s1 === s2) throw bad('Scores cannot be level — someone has to win.');

  let eventId = b.event_id === undefined || b.event_id === '' ? undefined : b.event_id === null ? null : int(b.event_id) || null;
  if (eventId === undefined) {
    eventId = db.prepare("SELECT id FROM events WHERE date = ? AND status != 'cancelled' ORDER BY id LIMIT 1").get(localDate())?.id ?? null;
  }
  if (eventId) {
    const ev = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
    if (!ev) throw bad('That night does not exist.');
    if (ev.status === 'finalised' && !isAdmin && !allowFinalised) throw bad('That night has been finalised. Ask an admin to add the result.');
  }

  const topBefore = topOf(game.id);
  const match = tx(() => {
    const info = db.prepare(`INSERT INTO matches (event_id, game_id, p1_id, p2_id, p3_id, p4_id, p1_score, p2_score, winner_id, detail, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, game.id, p1, p2, p3, p4, s1, s2, s1 > s2 ? p1 : p2, str(b.detail, 120), me.id);
    const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(info.lastInsertRowid);
    applyMatch(m);
    if (eventId) {
      // Players who log a result on the night are obviously there.
      const here = db.prepare(`INSERT INTO attendance (event_id, user_id, status) VALUES (?, ?, 'here')
        ON CONFLICT(event_id, user_id) DO UPDATE SET status = 'here', updated_at = datetime('now')`);
      for (const id of ids) here.run(eventId, id);
    }
    return db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id);
  });
  if (eventId && !skipFixtureLink) linkFixture(match, int(b.fixture_id));

  const earned = {};
  for (const uid of ids) earned[uid] = checkAchievements(uid, eventId);

  const topAfter = topOf(game.id);
  if (topBefore && topAfter && topBefore !== topAfter) {
    const u = liteUser(topAfter);
    push([topBefore], {
      title: `You've lost the top spot in ${game.name}`,
      body: `${u.nickname || u.name} is now #1. Time for a rematch?`,
      url: '/#/leaderboard', tag: `top-${game.id}`,
    }).catch(() => {});
  }
  emitEvent(eventId);
  return { match, earned };
}

export function deleteMatch(me, id) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!m) return null;
  const players = [m.p1_id, m.p2_id, m.p3_id, m.p4_id].filter(Boolean);
  if (me.role !== 'admin') {
    if (!players.includes(me.id)) throw forbidden('Only the players or an admin can remove a match.');
    const ev = m.event_id && db.prepare('SELECT status FROM events WHERE id = ?').get(m.event_id);
    if (ev?.status === 'finalised') throw forbidden('That night is finalised. Ask an admin to fix it.');
    if (Date.now() - Date.parse(m.created_at.replace(' ', 'T') + 'Z') > 48 * 3600e3) {
      throw forbidden('Matches can only be removed by players within 48 hours. Ask an admin.');
    }
  }
  onTournamentMatchDeleted(m.id);
  unlinkFixture(m.id);
  db.prepare('DELETE FROM matches WHERE id = ?').run(m.id);
  replayGame(m.game_id);
  emitEvent(m.event_id);
  return m;
}
