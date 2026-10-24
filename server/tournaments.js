// Single-elimination knockout tournaments with rating-based seeding and byes.
import { db, tx } from './db.js';
import { liteUser, START_RATING } from './stats.js';
import { checkAchievements } from './achievements.js';
import { push } from './notify.js';
import { emitEvent } from './bus.js';

// Standard bracket order so seeds 1 and 2 can only meet in the final: [1, 8, 4, 5, 2, 7, 3, 6] for 8.
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

const roundsFor = (size) => Math.log2(size);

export function startTournament(id) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!t || t.status !== 'open') throw Object.assign(new Error('This tournament has already started.'), { status: 400 });
  const entries = db.prepare(`SELECT e.user_id, COALESCE(r.rating, ?) AS rating FROM tournament_entries e
    LEFT JOIN ratings r ON r.user_id = e.user_id AND r.game_id = ? WHERE e.tournament_id = ? ORDER BY rating DESC, e.user_id`)
    .all(START_RATING, t.game_id, id);
  if (entries.length < 2) throw Object.assign(new Error('A tournament needs at least 2 players.'), { status: 400 });
  let size = 2;
  while (size < entries.length) size *= 2;
  const order = seedOrder(size);
  tx(() => {
    const seed = db.prepare('UPDATE tournament_entries SET seed = ? WHERE tournament_id = ? AND user_id = ?');
    entries.forEach((e, i) => seed.run(i + 1, id, e.user_id));
    const ins = db.prepare('INSERT INTO tournament_matches (tournament_id, round, slot, p1_id, p2_id) VALUES (?, ?, ?, ?, ?)');
    const rounds = roundsFor(size);
    for (let r = 1; r <= rounds; r++) {
      const slots = size / 2 ** r;
      for (let s = 0; s < slots; s++) {
        if (r === 1) {
          const a = entries[order[s * 2] - 1]?.user_id ?? null;
          const b = entries[order[s * 2 + 1] - 1]?.user_id ?? null;
          ins.run(id, 1, s, a, b);
        } else ins.run(id, r, s, null, null);
      }
    }
    db.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").run(id);
    // Byes: a lone player in round 1 goes straight through.
    for (const m of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = 1').all(id)) {
      if ((m.p1_id && !m.p2_id) || (!m.p1_id && m.p2_id)) setWinner(m, m.p1_id || m.p2_id, null);
    }
  });
  emitEvent(t.event_id);
}

function setWinner(m, winnerId, matchId) {
  db.prepare('UPDATE tournament_matches SET winner_id = ?, match_id = ? WHERE id = ?').run(winnerId, matchId, m.id);
  const next = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ? AND slot = ?')
    .get(m.tournament_id, m.round + 1, Math.floor(m.slot / 2));
  if (!next) {
    db.prepare("UPDATE tournaments SET status = 'done', winner_id = ? WHERE id = ?").run(winnerId, m.tournament_id);
    checkAchievements(winnerId);
    const t = db.prepare('SELECT name FROM tournaments WHERE id = ?').get(m.tournament_id);
    const u = liteUser(winnerId);
    const everyone = db.prepare('SELECT user_id FROM tournament_entries WHERE tournament_id = ?').all(m.tournament_id).map((r) => r.user_id);
    push(everyone, { title: `🏆 ${u.nickname || u.name} wins ${t.name}!`, body: 'Congratulations to the champion.', url: `/#/tournaments/${m.tournament_id}` }).catch(() => {});
    return;
  }
  db.prepare(`UPDATE tournament_matches SET ${m.slot % 2 === 0 ? 'p1_id' : 'p2_id'} = ? WHERE id = ?`).run(winnerId, next.id);
  const ready = db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(next.id);
  if (ready.p1_id && ready.p2_id) {
    push([ready.p1_id, ready.p2_id], { title: 'Your next tournament match is ready', body: 'Check the bracket to see who you play.', url: `/#/tournaments/${m.tournament_id}` }).catch(() => {});
  }
}

// Called after a match is recorded for a bracket slot.
export function recordTournamentResult(tmId, match) {
  const m = db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(tmId);
  tx(() => setWinner(m, match.winner_id, match.id));
  const t = db.prepare('SELECT event_id FROM tournaments WHERE id = ?').get(m.tournament_id);
  emitEvent(t?.event_id);
}

// If a bracket result is deleted, undo it — but only while the next round hasn't been played.
export function onTournamentMatchDeleted(matchId) {
  const m = db.prepare('SELECT * FROM tournament_matches WHERE match_id = ?').get(matchId);
  if (!m) return;
  const next = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ? AND slot = ?')
    .get(m.tournament_id, m.round + 1, Math.floor(m.slot / 2));
  if (next?.winner_id) {
    throw Object.assign(new Error('That result fed a later round that has been played. Remove the later result first.'), { status: 400 });
  }
  tx(() => {
    db.prepare('UPDATE tournament_matches SET winner_id = NULL, match_id = NULL WHERE id = ?').run(m.id);
    if (next) db.prepare(`UPDATE tournament_matches SET ${m.slot % 2 === 0 ? 'p1_id' : 'p2_id'} = NULL WHERE id = ?`).run(next.id);
    else db.prepare("UPDATE tournaments SET status = 'running', winner_id = NULL WHERE id = ?").run(m.tournament_id);
  });
}

export function tournamentView(id, meId) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!t) return null;
  const game = db.prepare('SELECT id, name, emoji, score_label FROM games WHERE id = ?').get(t.game_id);
  const entries = db.prepare('SELECT user_id, seed FROM tournament_entries WHERE tournament_id = ? ORDER BY seed, rowid').all(id)
    .map((e) => ({ seed: e.seed, user: liteUser(e.user_id) })).filter((e) => e.user);
  const seedOf = new Map(entries.map((e) => [e.user.id, e.seed]));
  const ms = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round, slot').all(id);
  const rounds = [];
  for (const m of ms) {
    const score = m.match_id ? db.prepare('SELECT p1_id, p1_score, p2_score FROM matches WHERE id = ?').get(m.match_id) : null;
    let s1 = null, s2 = null;
    if (score) [s1, s2] = score.p1_id === m.p1_id ? [score.p1_score, score.p2_score] : [score.p2_score, score.p1_score];
    (rounds[m.round - 1] ||= []).push({
      id: m.id, round: m.round, slot: m.slot,
      p1: m.p1_id ? { ...liteUser(m.p1_id), seed: seedOf.get(m.p1_id) } : null,
      p2: m.p2_id ? { ...liteUser(m.p2_id), seed: seedOf.get(m.p2_id) } : null,
      winner_id: m.winner_id, s1, s2, bye: m.round === 1 && (!m.p1_id || !m.p2_id),
    });
  }
  return {
    ...t, game, entries, rounds,
    winner: t.winner_id ? liteUser(t.winner_id) : null,
    joined: meId ? entries.some((e) => e.user.id === meId) : false,
  };
}
