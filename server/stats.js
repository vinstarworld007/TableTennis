import { db, tx } from './db.js';

export const START_RATING = 1000;
const kFactor = (played) => (played < 20 ? 32 : 24);

const getRating = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND game_id = ?');
const insertRating = db.prepare('INSERT OR IGNORE INTO ratings (user_id, game_id, rating) VALUES (?, ?, ?)');
const saveRating = db.prepare(`UPDATE ratings SET rating = ?, played = ?, wins = ?, losses = ?, streak = ?, best_streak = ?
  WHERE user_id = ? AND game_id = ?`);
const saveMatchElo = db.prepare(`UPDATE matches SET p1_rating_before = ?, p1_delta = ?, p2_rating_before = ?, p2_delta = ?,
  p3_rating_before = ?, p3_delta = ?, p4_rating_before = ?, p4_delta = ? WHERE id = ?`);

function ratingRow(userId, gameId) {
  insertRating.run(userId, gameId, START_RATING);
  return getRating.get(userId, gameId);
}

// Apply one match to the rating cache and record each player's Elo change on the match row.
// Doubles: p1+p3 play p2+p4; the team rating is the average of the two partners.
export function applyMatch(m) {
  const teamA = [m.p1_id, m.p3_id].filter(Boolean).map((id) => ratingRow(id, m.game_id));
  const teamB = [m.p2_id, m.p4_id].filter(Boolean).map((id) => ratingRow(id, m.game_id));
  const avg = (t) => t.reduce((s, r) => s + r.rating, 0) / t.length;
  const expA = 1 / (1 + 10 ** ((avg(teamB) - avg(teamA)) / 400));
  const aWon = m.winner_id === m.p1_id;
  const deltas = new Map();
  for (const [team, exp, won] of [[teamA, expA, aWon], [teamB, 1 - expA, !aWon]]) {
    for (const r of team) {
      const d = kFactor(r.played) * ((won ? 1 : 0) - exp);
      deltas.set(r.user_id, [r.rating, d]);
      const streak = won ? r.streak + 1 : 0;
      saveRating.run(r.rating + d, r.played + 1, r.wins + (won ? 1 : 0), r.losses + (won ? 0 : 1),
        streak, Math.max(r.best_streak, streak), r.user_id, m.game_id);
    }
  }
  const get = (id) => (id ? deltas.get(id) : [null, null]);
  saveMatchElo.run(...get(m.p1_id), ...get(m.p2_id), ...get(m.p3_id), ...get(m.p4_id), m.id);
}

// Rebuild every rating for a game from scratch, in match order (used after deletes).
export function replayGame(gameId) {
  tx(() => {
    db.prepare('DELETE FROM ratings WHERE game_id = ?').run(gameId);
    const all = db.prepare('SELECT * FROM matches WHERE game_id = ? ORDER BY created_at, id').all(gameId);
    for (const m of all) applyMatch(m);
  });
}

// One row per player per match, singles or doubles. Use as `WITH ${SIDES} SELECT ... FROM sides`.
export const SIDES = `sides AS (
    SELECT id, game_id, event_id, created_at, p1_id AS user_id, p2_id AS opp_id, p3_id AS partner_id, p1_score AS f, p2_score AS a,
           (winner_id = p1_id) AS won, COALESCE(p1_delta, 0) AS delta, p1_rating_before AS rb,
           CASE WHEN p4_id IS NULL THEN p2_rating_before ELSE (p2_rating_before + p4_rating_before) / 2 END AS opp_rb FROM matches
    UNION ALL
    SELECT id, game_id, event_id, created_at, p2_id, p1_id, p4_id, p2_score, p1_score,
           (winner_id = p2_id), COALESCE(p2_delta, 0), p2_rating_before,
           CASE WHEN p3_id IS NULL THEN p1_rating_before ELSE (p1_rating_before + p3_rating_before) / 2 END FROM matches
    UNION ALL
    SELECT id, game_id, event_id, created_at, p3_id, p2_id, p1_id, p1_score, p2_score,
           (winner_id = p1_id), COALESCE(p3_delta, 0), p3_rating_before, (p2_rating_before + p4_rating_before) / 2
    FROM matches WHERE p3_id IS NOT NULL
    UNION ALL
    SELECT id, game_id, event_id, created_at, p4_id, p1_id, p2_id, p2_score, p1_score,
           (winner_id = p2_id), COALESCE(p4_delta, 0), p4_rating_before, (p1_rating_before + p3_rating_before) / 2
    FROM matches WHERE p4_id IS NOT NULL
  )`;

export const matchesOfUser = `(p1_id = ?1 OR p2_id = ?1 OR p3_id = ?1 OR p4_id = ?1)`;

const perPlayerSql = (where) => `
  WITH ${SIDES}
  SELECT user_id, COUNT(*) AS played, SUM(won) AS wins, COUNT(*) - SUM(won) AS losses,
         SUM(f) - SUM(a) AS diff, SUM(delta) AS elo_change
  FROM sides WHERE ${where} GROUP BY user_id`;

const rankCmp = (x, y) =>
  y.wins - x.wins ||
  y.wins / y.played - x.wins / x.played ||
  y.diff - x.diff ||
  y.elo_change - x.elo_change;

// Nightly standings for one game: most wins, then win %, then score difference, then Elo gained.
export function eventStandings(eventId, gameId) {
  const rows = db.prepare(perPlayerSql('event_id = ? AND game_id = ?')).all(eventId, gameId);
  return attachUsers(rows.sort(rankCmp));
}

export function podium(eventId) {
  const games = db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort, id').all();
  const ev = db.prepare('SELECT status FROM events WHERE id = ?').get(eventId);
  const out = [];
  for (const g of games) {
    let places;
    if (ev?.status === 'finalised') {
      places = attachUsers(db.prepare('SELECT user_id, place, wins, played FROM medals WHERE event_id = ? AND game_id = ? ORDER BY place')
        .all(eventId, g.id));
    } else {
      places = eventStandings(eventId, g.id).slice(0, 3).map((r, i) => ({ ...r, place: i + 1 }));
    }
    if (places.length) out.push({ game: g, final: ev?.status === 'finalised', places });
  }
  return out;
}

export function finaliseEvent(eventId) {
  const games = db.prepare('SELECT id FROM games').all();
  tx(() => {
    db.prepare('DELETE FROM medals WHERE event_id = ?').run(eventId);
    const ins = db.prepare('INSERT INTO medals (event_id, game_id, user_id, place, wins, played) VALUES (?, ?, ?, ?, ?, ?)');
    for (const g of games) {
      eventStandings(eventId, g.id).slice(0, 3)
        .forEach((r, i) => ins.run(eventId, g.id, r.user_id, i + 1, r.wins, r.played));
    }
    db.prepare("UPDATE events SET status = 'finalised' WHERE id = ?").run(eventId);
  });
}

const monthStart = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

// Date range for a leaderboard period, as [from, to) strings comparable with created_at.
export function periodRange(period, seasonId) {
  const now = new Date();
  if (period === 'year') return [`${now.getFullYear()}-01-01`, '9999'];
  if (period === 'month') return [monthStart(now), '9999'];
  if (period === 'season') {
    const s = seasonId
      ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId)
      : currentSeason();
    if (s) return [s.start_date, `${s.end_date} 99`];
  }
  return null;
}

export function currentSeason() {
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare('SELECT * FROM seasons WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1').get(today, today)
    || db.prepare('SELECT * FROM seasons WHERE end_date < ? ORDER BY end_date DESC LIMIT 1').get(today)
    || null;
}

export function leaderboard({ gameId, period = 'all', eventId, seasonId, sort = 'rating', limit = 200 }) {
  let rows;
  const range = period === 'event' ? null : periodRange(period, seasonId);
  if (period === 'event') {
    rows = db.prepare(perPlayerSql('game_id = ? AND event_id = ?')).all(gameId, Number(eventId));
  } else if (range) {
    rows = db.prepare(perPlayerSql('game_id = ? AND created_at >= ? AND created_at < ?')).all(gameId, range[0], range[1]);
  } else {
    rows = db.prepare(`SELECT user_id, rating, played, wins, losses, streak, best_streak FROM ratings
      WHERE game_id = ? AND played > 0`).all(gameId);
  }
  if (period !== 'all' && rows.length) {
    const ratings = new Map(db.prepare('SELECT user_id, rating, streak FROM ratings WHERE game_id = ?').all(gameId)
      .map((r) => [r.user_id, r]));
    for (const r of rows) {
      r.rating = ratings.get(r.user_id)?.rating ?? START_RATING;
      r.streak = ratings.get(r.user_id)?.streak ?? 0;
    }
  }
  // Ladders (month/season) rank by Elo gained in the period; all-time by rating.
  const ladder = period === 'month' || period === 'season';
  if (sort === 'wins') rows.sort((x, y) => y.wins - x.wins || x.losses - y.losses || y.rating - x.rating);
  else if (ladder) rows.sort((x, y) => y.elo_change - x.elo_change || y.wins - x.wins);
  else rows.sort((x, y) => y.rating - x.rating || y.wins - x.wins);
  return attachUsers(rows.slice(0, limit)).map((r, i) => ({
    ...r, rank: i + 1, rating: Math.round(r.rating), elo_change: r.elo_change == null ? null : Math.round(r.elo_change),
  }));
}

export function medalTable(gameId) {
  const rows = db.prepare(`SELECT user_id,
      SUM(place = 1) AS gold, SUM(place = 2) AS silver, SUM(place = 3) AS bronze, COUNT(*) AS total
    FROM medals ${gameId ? 'WHERE game_id = ?' : ''} GROUP BY user_id
    ORDER BY gold DESC, silver DESC, bronze DESC`).all(...(gameId ? [gameId] : []));
  return attachUsers(rows).map((r, i) => ({ ...r, rank: i + 1 }));
}

// Player of the month: most Elo gained across all games in a calendar month (at least 5 matches).
export function playerOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const rows = db.prepare(`WITH ${SIDES} SELECT user_id, SUM(delta) AS elo_gain, SUM(won) AS wins, COUNT(*) AS played
    FROM sides WHERE created_at >= ? AND created_at < ? GROUP BY user_id HAVING COUNT(*) >= 5
    ORDER BY elo_gain DESC, wins DESC LIMIT 1`).all(from, to);
  const r = rows[0];
  return r ? { ...r, elo_gain: Math.round(r.elo_gain), user: liteUser(r.user_id), month } : null;
}

// Each player's rating after every match, for the profile chart.
export function ratingHistory(userId, gameId) {
  return db.prepare(`WITH ${SIDES} SELECT created_at, rb + delta AS rating, won FROM sides
    WHERE user_id = ? AND game_id = ? AND rb IS NOT NULL ORDER BY created_at, id`).all(userId, gameId)
    .map((r) => ({ t: r.created_at, r: Math.round(r.rating), won: !!r.won }));
}

// Rival = the opponent you've played most; nemesis = the one with the best record against you (3+ games).
export function rivals(userId) {
  const rows = db.prepare(`WITH ${SIDES} SELECT opp_id, COUNT(*) AS played, SUM(won) AS wins FROM sides
    WHERE user_id = ? AND partner_id IS NULL GROUP BY opp_id`).all(userId);
  if (!rows.length) return { rival: null, nemesis: null, victim: null };
  const pack = (r) => (r ? { user: liteUser(r.opp_id), played: r.played, wins: r.wins, losses: r.played - r.wins } : null);
  const rival = [...rows].sort((a, b) => b.played - a.played || a.opp_id - b.opp_id)[0];
  const qualified = rows.filter((r) => r.played >= 3);
  const nemesis = [...qualified].sort((a, b) => a.wins / a.played - b.wins / b.played || b.played - a.played)[0];
  const victim = [...qualified].sort((a, b) => b.wins / b.played - a.wins / a.played || b.played - a.played)[0];
  return {
    rival: rival.played >= 2 ? pack(rival) : null,
    nemesis: nemesis && nemesis.wins / nemesis.played < 0.5 ? pack(nemesis) : null,
    victim: victim && victim.wins / victim.played > 0.5 ? pack(victim) : null,
  };
}

const userLite = db.prepare('SELECT id, name, nickname, avatar, skill FROM users WHERE id = ?');
export function liteUser(id) {
  const u = id && userLite.get(id);
  return u ? { id: u.id, name: u.name, nickname: u.nickname, skill: u.skill, avatar: u.avatar ? `/uploads/${u.avatar}` : null } : null;
}

export function attachUsers(rows) {
  return rows.map((r) => ({ ...r, user: liteUser(r.user_id) })).filter((r) => r.user);
}
