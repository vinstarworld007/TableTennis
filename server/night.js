// Club-night organisation: skill-based tables, round-robin fixtures, doubles pairs and team nights.
import { db, tx, getSettings } from './db.js';
import { liteUser, START_RATING } from './stats.js';
import { push, once } from './notify.js';
import { emitEvent } from './bus.js';
import { grant } from './achievements.js';

export const LEVELS = ['beginner', 'intermediate', 'advanced'];
const levelIndex = (l) => Math.max(0, LEVELS.indexOf(l));
const gameId = (slug) => db.prepare('SELECT id FROM games WHERE slug = ?').get(slug)?.id;
export const singlesGameId = () => gameId('table-tennis');
export const doublesGameId = () => gameId('doubles');

export function tableConfig() {
  const s = getSettings();
  const count = Math.max(1, Math.min(20, Number(s.tables) || 3));
  const raw = (s.table_levels || '').split(',').map((x) => x.trim()).filter((x) => LEVELS.includes(x));
  const levels = Array.from({ length: count }, (_, i) => raw.length ? raw[i % raw.length] : LEVELS[2 - (i % 3)]);
  return { count, levels, max: Math.max(0, Number(s.max_per_table) || 0) };
}

const tablePlayers = (eventId, tableNo) =>
  db.prepare('SELECT user_id FROM event_tables WHERE event_id = ? AND table_no = ? ORDER BY assigned_at, user_id').all(eventId, tableNo).map((r) => r.user_id);

// Pick a table: one for the player's level with the fewest players, else the nearest level with room.
function chooseTable(eventId, skill) {
  const { count, levels, max } = tableConfig();
  const counts = new Map(db.prepare('SELECT table_no, COUNT(*) AS n FROM event_tables WHERE event_id = ? GROUP BY table_no').all(eventId)
    .map((r) => [r.table_no, r.n]));
  const tables = Array.from({ length: count }, (_, i) => ({ no: i + 1, level: levels[i], n: counts.get(i + 1) || 0 }));
  const want = levelIndex(skill);
  const ranked = tables.sort((a, b) =>
    Math.abs(levelIndex(a.level) - want) - Math.abs(levelIndex(b.level) - want) || a.n - b.n || a.no - b.no);
  return (max ? ranked.find((t) => t.n < max) : null)?.no ?? ranked[0].no;
}

// Round robin: the newcomer gets a fixture against everyone already on the table.
// Fixtures already played are never touched.
function addFixturesFor(eventId, tableNo, userId) {
  const ins = db.prepare('INSERT INTO fixtures (event_id, table_no, p1_id, p2_id) VALUES (?, ?, ?, ?)');
  const exists = db.prepare(`SELECT 1 FROM fixtures WHERE event_id = ? AND table_no = ? AND p3_id IS NULL
    AND ((p1_id = ? AND p2_id = ?) OR (p1_id = ? AND p2_id = ?))`);
  for (const other of tablePlayers(eventId, tableNo)) {
    if (other === userId || exists.get(eventId, tableNo, userId, other, other, userId)) continue;
    ins.run(eventId, tableNo, other, userId);
  }
}

export function assignPlayer(eventId, userId, tableNo = null) {
  const current = db.prepare('SELECT table_no FROM event_tables WHERE event_id = ? AND user_id = ?').get(eventId, userId);
  if (current && (!tableNo || current.table_no === tableNo)) return current.table_no;
  const user = db.prepare('SELECT skill FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const table = tx(() => {
    if (current) dropPending(eventId, userId, current.table_no);
    const t = tableNo || chooseTable(eventId, user.skill);
    db.prepare(`INSERT INTO event_tables (event_id, user_id, table_no) VALUES (?, ?, ?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET table_no = excluded.table_no, assigned_at = datetime('now')`).run(eventId, userId, t);
    addFixturesFor(eventId, t, userId);
    return t;
  });
  if (current) resequence(eventId, current.table_no);
  resequence(eventId, table);
  addToTeamIfNeeded(eventId, userId);
  emitEvent(eventId);
  return table;
}

function dropPending(eventId, userId, tableNo) {
  db.prepare(`DELETE FROM fixtures WHERE event_id = ? AND table_no = ? AND status = 'pending'
    AND ? IN (p1_id, p2_id, p3_id, p4_id)`).run(eventId, tableNo, userId);
}

export function removePlayer(eventId, userId) {
  const current = db.prepare('SELECT table_no FROM event_tables WHERE event_id = ? AND user_id = ?').get(eventId, userId);
  tx(() => {
    db.prepare('DELETE FROM event_tables WHERE event_id = ? AND user_id = ?').run(eventId, userId);
    if (current) dropPending(eventId, userId, current.table_no);
    // Leaving the night also breaks up their doubles pair (played doubles fixtures stay).
    const pair = db.prepare('SELECT * FROM doubles_pairs WHERE event_id = ? AND (user1_id = ? OR user2_id = ?)').get(eventId, userId, userId);
    if (pair) removePairRow(pair);
  });
  if (current) resequence(eventId, current.table_no);
  emitEvent(eventId);
}

// Order the remaining fixtures so nobody waits too long or plays twice in a row:
// players with the fewest games so far go first.
export function resequence(eventId, tableNo) {
  const all = db.prepare(`SELECT f.*, m.created_at AS played_at FROM fixtures f LEFT JOIN matches m ON m.id = f.match_id
    WHERE f.event_id = ? AND f.table_no = ?`).all(eventId, tableNo);
  const playersOf = (f) => [f.p1_id, f.p2_id, f.p3_id, f.p4_id].filter(Boolean);
  const played = new Map();
  let last = [];
  for (const f of all.filter((x) => x.status === 'done').sort((a, b) => (a.played_at || '').localeCompare(b.played_at || '') || a.id - b.id)) {
    for (const p of playersOf(f)) played.set(p, (played.get(p) || 0) + 1);
    last = playersOf(f);
  }
  const pending = all.filter((x) => x.status === 'pending').sort((a, b) => a.id - b.id);
  const upd = db.prepare('UPDATE fixtures SET seq = ? WHERE id = ?');
  let seq = 0;
  tx(() => {
    while (pending.length) {
      let best = 0;
      let bestScore = Infinity;
      pending.forEach((f, i) => {
        const ps = playersOf(f);
        const rest = ps.some((p) => last.includes(p)) ? 1000 : 0;
        const score = rest + ps.reduce((s, p) => s + (played.get(p) || 0), 0) * 10 + Math.max(...ps.map((p) => played.get(p) || 0));
        if (score < bestScore) { bestScore = score; best = i; }
      });
      const [f] = pending.splice(best, 1);
      upd.run(++seq, f.id);
      for (const p of playersOf(f)) played.set(p, (played.get(p) || 0) + 1);
      last = playersOf(f);
    }
  });
  notifyUpNext(eventId, tableNo);
}

function notifyUpNext(eventId, tableNo) {
  const ev = db.prepare("SELECT * FROM events WHERE id = ? AND status = 'live'").get(eventId);
  if (!ev) return;
  const next = db.prepare("SELECT * FROM fixtures WHERE event_id = ? AND table_no = ? AND status = 'pending' ORDER BY seq LIMIT 2")
    .all(eventId, tableNo);
  const where = tableNo ? `Table ${tableNo}` : 'the doubles table';
  next.forEach((f, i) => {
    if (!once(`up:${f.id}:${i}`)) return;
    const name = (id) => { const u = liteUser(id); return u ? u.nickname || u.name : '?'; };
    const sideA = [f.p1_id, f.p3_id].filter(Boolean);
    const sideB = [f.p2_id, f.p4_id].filter(Boolean);
    for (const [mine, theirs] of [[sideA, sideB], [sideB, sideA]]) {
      push(mine, {
        title: i === 0 ? `You're up on ${where}!` : `You're next on ${where}`,
        body: `vs ${theirs.map(name).join(' & ')}`,
        url: `/#/events/${eventId}`, tag: `fixture-${eventId}`,
      }).catch(() => {});
    }
  });
}

// When a result is logged, tick off the matching fixture (if the players had one tonight).
export function linkFixture(match, fixtureId) {
  if (!match.event_id) return;
  const doubles = match.game_id === doublesGameId();
  if (!doubles && match.game_id !== singlesGameId()) return;
  let f = fixtureId ? db.prepare("SELECT * FROM fixtures WHERE id = ? AND event_id = ? AND status = 'pending'").get(fixtureId, match.event_id) : null;
  const sameSides = (fx) => {
    const a = new Set([fx.p1_id, fx.p3_id].filter(Boolean));
    const b = new Set([fx.p2_id, fx.p4_id].filter(Boolean));
    const ma = [match.p1_id, match.p3_id].filter(Boolean);
    const mb = [match.p2_id, match.p4_id].filter(Boolean);
    const eq = (s, arr) => s.size === arr.length && arr.every((x) => s.has(x));
    return (eq(a, ma) && eq(b, mb)) || (eq(a, mb) && eq(b, ma));
  };
  if (f && !sameSides(f)) f = null;
  if (!f) {
    f = db.prepare(`SELECT * FROM fixtures WHERE event_id = ? AND status = 'pending' AND ${doubles ? 'table_no = 0' : 'table_no > 0'}
      ORDER BY seq`).all(match.event_id).find(sameSides);
  }
  if (!f) return;
  db.prepare("UPDATE fixtures SET status = 'done', match_id = ? WHERE id = ?").run(match.id, f.id);
  resequence(match.event_id, f.table_no);
}

export function unlinkFixture(matchId) {
  const f = db.prepare('SELECT * FROM fixtures WHERE match_id = ?').get(matchId);
  if (!f) return;
  db.prepare("UPDATE fixtures SET status = 'pending', match_id = NULL WHERE id = ?").run(f.id);
  resequence(f.event_id, f.table_no);
}

function ratingOf(userId, gameIdValue) {
  return db.prepare('SELECT rating FROM ratings WHERE user_id = ? AND game_id = ?').get(userId, gameIdValue)?.rating ?? START_RATING;
}

function fixtureView(f) {
  const m = f.match_id ? db.prepare('SELECT p1_id, p1_score, p2_score, winner_id FROM matches WHERE id = ?').get(f.match_id) : null;
  // Show the score from the fixture's point of view even if the match was logged the other way round.
  let s1 = null, s2 = null, aWon = null;
  if (m) {
    const flipped = m.p1_id !== f.p1_id && m.p1_id !== f.p3_id;
    [s1, s2] = flipped ? [m.p2_score, m.p1_score] : [m.p1_score, m.p2_score];
    aWon = s1 > s2;
  }
  return {
    id: f.id, table_no: f.table_no, seq: f.seq, status: f.status, match_id: f.match_id,
    a: [f.p1_id, f.p3_id].filter(Boolean).map(liteUser),
    b: [f.p2_id, f.p4_id].filter(Boolean).map(liteUser),
    s1, s2, a_won: aWon,
  };
}

function standings(fixtures, players) {
  const row = new Map(players.map((id) => [id, { user_id: id, played: 0, wins: 0, losses: 0, diff: 0, left: 0 }]));
  const get = (id) => row.get(id) || row.set(id, { user_id: id, played: 0, wins: 0, losses: 0, diff: 0, left: 0 }).get(id);
  for (const f of fixtures) {
    const sideA = f.a.map((u) => u?.id).filter(Boolean);
    const sideB = f.b.map((u) => u?.id).filter(Boolean);
    if (f.status === 'pending') { [...sideA, ...sideB].forEach((id) => get(id).left++); continue; }
    if (f.s1 == null) continue;
    for (const [ids, won, d] of [[sideA, f.a_won, f.s1 - f.s2], [sideB, !f.a_won, f.s2 - f.s1]]) {
      for (const id of ids) {
        const r = get(id);
        r.played++; r.diff += d;
        if (won) r.wins++; else r.losses++;
      }
    }
  }
  return [...row.values()]
    .sort((x, y) => y.wins - x.wins || y.diff - x.diff || x.losses - y.losses || x.user_id - y.user_id)
    .map((r, i) => ({ ...r, rank: i + 1, user: liteUser(r.user_id) }))
    .filter((r) => r.user);
}

export function board(eventId) {
  const { count, levels, max } = tableConfig();
  const allFixtures = db.prepare("SELECT * FROM fixtures WHERE event_id = ? AND status != 'void' ORDER BY status = 'done' DESC, seq, id")
    .all(eventId).map(fixtureView);
  const tables = [];
  for (let no = 1; no <= count; no++) {
    const players = tablePlayers(eventId, no);
    const fx = allFixtures.filter((f) => f.table_no === no);
    const pending = fx.filter((f) => f.status === 'pending').sort((a, b) => a.seq - b.seq);
    tables.push({
      no, level: levels[no - 1], max,
      players: players.map(liteUser).filter(Boolean),
      now: pending[0] || null,
      queue: pending.slice(1),
      done: fx.filter((f) => f.status === 'done').reverse(),
      total: fx.length,
      standings: standings(fx, players),
    });
  }
  // Players assigned to a table that no longer exists (admin reduced the table count).
  const orphans = db.prepare('SELECT user_id FROM event_tables WHERE event_id = ? AND table_no > ?').all(eventId, count)
    .map((r) => liteUser(r.user_id)).filter(Boolean);

  const pairs = db.prepare('SELECT * FROM doubles_pairs WHERE event_id = ? ORDER BY id').all(eventId)
    .map((p) => ({ id: p.id, players: [liteUser(p.user1_id), liteUser(p.user2_id)] }));
  const dfx = allFixtures.filter((f) => f.table_no === 0);
  const dPending = dfx.filter((f) => f.status === 'pending').sort((a, b) => a.seq - b.seq);
  const pairedIds = new Set(pairs.flatMap((p) => p.players.map((u) => u?.id)));
  const keenWaiting = keenAttendees(eventId).filter((id) => !pairedIds.has(id)).map(liteUser).filter(Boolean);

  return {
    tables,
    orphans,
    doubles: {
      pairs, now: dPending[0] || null, queue: dPending.slice(1), done: dfx.filter((f) => f.status === 'done').reverse(),
      standings: pairStandings(pairs, dfx), waiting: keenWaiting,
    },
    teams: teamStandings(eventId),
  };
}

// ---------- Doubles ----------
function keenAttendees(eventId) {
  return db.prepare(`SELECT a.user_id FROM attendance a JOIN users u ON u.id = a.user_id
    WHERE a.event_id = ? AND u.doubles_keen = 1 ORDER BY a.status = 'here' DESC, a.updated_at`).all(eventId).map((r) => r.user_id);
}

export function doublesPool(eventId) {
  const dg = doublesGameId();
  const tt = singlesGameId();
  const status = eventId
    ? new Map(db.prepare('SELECT user_id, status FROM attendance WHERE event_id = ?').all(eventId).map((r) => [r.user_id, r.status]))
    : new Map();
  return db.prepare('SELECT id FROM users WHERE doubles_keen = 1 ORDER BY name').all().map((r) => ({
    user: liteUser(r.id),
    doubles_rating: Math.round(ratingOf(r.id, dg)),
    singles_rating: Math.round(ratingOf(r.id, tt)),
    status: status.get(r.id) || null,
  }));
}

function pairStrength(id) {
  const d = db.prepare('SELECT rating, played FROM ratings WHERE user_id = ? AND game_id = ?').get(id, doublesGameId());
  return d && d.played >= 3 ? d.rating : ratingOf(id, singlesGameId());
}

function addPairFixtures(eventId, pairId) {
  const me = db.prepare('SELECT * FROM doubles_pairs WHERE id = ?').get(pairId);
  const ins = db.prepare('INSERT INTO fixtures (event_id, table_no, p1_id, p3_id, p2_id, p4_id) VALUES (?, 0, ?, ?, ?, ?)');
  for (const other of db.prepare('SELECT * FROM doubles_pairs WHERE event_id = ? AND id != ?').all(eventId, pairId)) {
    ins.run(eventId, other.user1_id, other.user2_id, me.user1_id, me.user2_id);
  }
}

function removePairRow(pair) {
  db.prepare(`DELETE FROM fixtures WHERE event_id = ? AND table_no = 0 AND status = 'pending'
    AND (p1_id IN (?, ?) OR p2_id IN (?, ?))`).run(pair.event_id, pair.user1_id, pair.user2_id, pair.user1_id, pair.user2_id);
  db.prepare('DELETE FROM doubles_pairs WHERE id = ?').run(pair.id);
}

// Balanced pairing: strongest available player with the weakest, and so on.
// mode 'add' keeps existing pairs and only pairs up newcomers; 'reshuffle' re-pairs everyone without played doubles.
export function pairUp(eventId, mode = 'add') {
  tx(() => {
    if (mode === 'reshuffle') {
      for (const p of db.prepare('SELECT * FROM doubles_pairs WHERE event_id = ?').all(eventId)) {
        const played = db.prepare(`SELECT 1 FROM fixtures WHERE event_id = ? AND table_no = 0 AND status = 'done'
          AND (p1_id IN (?, ?) OR p2_id IN (?, ?))`).get(eventId, p.user1_id, p.user2_id, p.user1_id, p.user2_id);
        if (!played) removePairRow(p);
      }
    }
    const paired = new Set(db.prepare('SELECT user1_id, user2_id FROM doubles_pairs WHERE event_id = ?').all(eventId)
      .flatMap((p) => [p.user1_id, p.user2_id]));
    const free = keenAttendees(eventId).filter((id) => !paired.has(id))
      .map((id) => ({ id, r: pairStrength(id) })).sort((a, b) => b.r - a.r);
    while (free.length >= 2) {
      const a = free.shift();
      const b = free.pop();
      const info = db.prepare('INSERT INTO doubles_pairs (event_id, user1_id, user2_id) VALUES (?, ?, ?)').run(eventId, a.id, b.id);
      addPairFixtures(eventId, info.lastInsertRowid);
    }
  });
  resequence(eventId, 0);
  emitEvent(eventId);
}

export function addPair(eventId, u1, u2) {
  tx(() => {
    const taken = db.prepare('SELECT 1 FROM doubles_pairs WHERE event_id = ? AND ? IN (user1_id, user2_id)');
    if (u1 === u2 || taken.get(eventId, u1) || taken.get(eventId, u2)) throw Object.assign(new Error('Those players are already paired.'), { status: 400 });
    const info = db.prepare('INSERT INTO doubles_pairs (event_id, user1_id, user2_id) VALUES (?, ?, ?)').run(eventId, u1, u2);
    addPairFixtures(eventId, info.lastInsertRowid);
  });
  resequence(eventId, 0);
  emitEvent(eventId);
}

export function removePair(pairId) {
  const p = db.prepare('SELECT * FROM doubles_pairs WHERE id = ?').get(pairId);
  if (!p) return;
  tx(() => removePairRow(p));
  resequence(p.event_id, 0);
  emitEvent(p.event_id);
}

function pairStandings(pairs, fixtures) {
  const rows = pairs.map((p) => ({ pair_id: p.id, players: p.players, played: 0, wins: 0, losses: 0, diff: 0 }));
  const find = (side) => rows.find((r) => side.every((u) => r.players.some((x) => x?.id === u?.id)));
  for (const f of fixtures) {
    if (f.status !== 'done' || f.s1 == null) continue;
    const a = find(f.a);
    const b = find(f.b);
    for (const [r, won, d] of [[a, f.a_won, f.s1 - f.s2], [b, !f.a_won, f.s2 - f.s1]]) {
      if (!r) continue;
      r.played++; r.diff += d;
      if (won) r.wins++; else r.losses++;
    }
  }
  return rows.sort((x, y) => y.wins - x.wins || y.diff - x.diff).map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------- Team nights ----------
const TEAM_COLORS = [['Red', '#ff6178'], ['Blue', '#4d8dff'], ['Green', '#2fd08a'], ['Yellow', '#ffc43d'], ['Purple', '#9b7bff'], ['Orange', '#ff9a3d']];

export function makeTeams(eventId, count) {
  const n = Math.max(2, Math.min(TEAM_COLORS.length, count || 2));
  let people = db.prepare("SELECT user_id FROM attendance WHERE event_id = ? AND status = 'here'").all(eventId).map((r) => r.user_id);
  if (people.length < n) people = db.prepare('SELECT user_id FROM attendance WHERE event_id = ?').all(eventId).map((r) => r.user_id);
  const tt = singlesGameId();
  people.sort((a, b) => ratingOf(b, tt) - ratingOf(a, tt));
  tx(() => {
    db.prepare('DELETE FROM event_teams WHERE event_id = ?').run(eventId);
    const ids = TEAM_COLORS.slice(0, n).map(([name, color]) =>
      Number(db.prepare('INSERT INTO event_teams (event_id, name, color) VALUES (?, ?, ?)').run(eventId, `Team ${name}`, color).lastInsertRowid));
    const add = db.prepare('INSERT INTO event_team_members (team_id, user_id) VALUES (?, ?)');
    // Snake draft keeps the teams even: 1-2-3-3-2-1...
    people.forEach((u, i) => {
      const round = Math.floor(i / n);
      const pos = i % n;
      add.run(ids[round % 2 ? n - 1 - pos : pos], u);
    });
  });
  emitEvent(eventId);
}

export function clearTeams(eventId) {
  db.prepare('DELETE FROM event_teams WHERE event_id = ?').run(eventId);
  emitEvent(eventId);
}

function addToTeamIfNeeded(eventId, userId) {
  const teams = db.prepare(`SELECT t.id, COUNT(m.user_id) AS n FROM event_teams t LEFT JOIN event_team_members m ON m.team_id = t.id
    WHERE t.event_id = ? GROUP BY t.id ORDER BY n, t.id`).all(eventId);
  if (!teams.length) return;
  const inTeam = db.prepare(`SELECT 1 FROM event_team_members m JOIN event_teams t ON t.id = m.team_id
    WHERE t.event_id = ? AND m.user_id = ?`).get(eventId, userId);
  if (!inTeam) db.prepare('INSERT INTO event_team_members (team_id, user_id) VALUES (?, ?)').run(teams[0].id, userId);
}

// A team's score is the total number of wins its members earn on the night, in any game.
function teamStandings(eventId) {
  const teams = db.prepare('SELECT * FROM event_teams WHERE event_id = ? ORDER BY id').all(eventId);
  if (!teams.length) return [];
  const wins = new Map(db.prepare(`SELECT user_id, SUM(won) AS w FROM (
      SELECT p1_id AS user_id, winner_id = p1_id AS won FROM matches WHERE event_id = ?1
      UNION ALL SELECT p2_id, winner_id = p2_id FROM matches WHERE event_id = ?1
      UNION ALL SELECT p3_id, winner_id = p1_id FROM matches WHERE event_id = ?1 AND p3_id IS NOT NULL
      UNION ALL SELECT p4_id, winner_id = p2_id FROM matches WHERE event_id = ?1 AND p4_id IS NOT NULL
    ) GROUP BY user_id`).all(eventId).map((r) => [r.user_id, r.w]));
  return teams.map((t) => {
    const members = db.prepare('SELECT user_id FROM event_team_members WHERE team_id = ?').all(t.id).map((r) => r.user_id);
    return {
      id: t.id, name: t.name, color: t.color,
      members: members.map(liteUser).filter(Boolean),
      points: members.reduce((s, id) => s + (wins.get(id) || 0), 0),
    };
  }).sort((a, b) => b.points - a.points);
}

// End-of-night badges from the table standings.
export function awardTableBadges(eventId) {
  const b = board(eventId);
  for (const t of b.tables) {
    const top = t.standings[0];
    if (top && top.played > 0 && (!t.standings[1] || top.wins > t.standings[1].wins || top.diff > t.standings[1].diff)) {
      grant(top.user_id, 'table_topper', eventId);
    }
    for (const s of t.standings) if (s.played >= 2 && s.left === 0) grant(s.user_id, 'round_robin', eventId);
  }
}
