import { db } from './db.js';
import { SIDES } from './stats.js';

export const ACHIEVEMENTS = [
  { code: 'first_match', name: 'Off the Mark', emoji: '🎬', desc: 'Play your first match' },
  { code: 'first_win', name: 'First Blood', emoji: '⚡', desc: 'Win your first match' },
  { code: 'wins_10', name: 'Winner', emoji: '💪', desc: 'Win 10 matches' },
  { code: 'wins_50', name: 'Veteran Winner', emoji: '🦾', desc: 'Win 50 matches' },
  { code: 'wins_100', name: 'Centurion', emoji: '💯', desc: 'Win 100 matches' },
  { code: 'matches_25', name: 'Regular', emoji: '📅', desc: 'Play 25 matches' },
  { code: 'matches_100', name: 'Ironman', emoji: '🛡️', desc: 'Play 100 matches' },
  { code: 'streak_5', name: 'On Fire', emoji: '🔥', desc: 'Win 5 in a row' },
  { code: 'streak_10', name: 'Unstoppable', emoji: '🚀', desc: 'Win 10 in a row' },
  { code: 'nights_5', name: 'Monday Regular', emoji: '🌙', desc: 'Attend 5 nights' },
  { code: 'nights_25', name: 'Club Legend', emoji: '🏛️', desc: 'Attend 25 nights' },
  { code: 'gold_1', name: 'Champion of the Night', emoji: '🥇', desc: 'Win a gold medal' },
  { code: 'gold_5', name: 'Dynasty', emoji: '👑', desc: 'Win 5 gold medals' },
  { code: 'podium_10', name: 'Podium Fixture', emoji: '🏅', desc: 'Win 10 medals of any colour' },
  { code: 'giant_killer', name: 'Giant Killer', emoji: '🗡️', desc: 'Beat someone rated 150+ above you' },
  { code: 'all_rounder', name: 'All-Rounder', emoji: '🎪', desc: 'Win in 3 different games' },
  { code: 'photographer', name: 'Club Photographer', emoji: '📸', desc: 'Upload 10 photos or videos' },
  { code: 'duo_5', name: 'Dynamic Duo', emoji: '👯', desc: 'Win 5 doubles matches' },
  { code: 'table_topper', name: 'Table Topper', emoji: '🔝', desc: 'Finish a night top of your table' },
  { code: 'round_robin', name: 'Played Them All', emoji: '🔄', desc: 'Complete every fixture on your table in a night' },
  { code: 'tournament_champ', name: 'Tournament Champion', emoji: '🏆', desc: 'Win a knockout tournament' },
  { code: 'potm', name: 'Player of the Month', emoji: '🌟', desc: 'Be named player of the month' },
];
const byCode = new Map(ACHIEVEMENTS.map((a) => [a.code, a]));

function bestWinStreak(userId) {
  const results = db.prepare(`WITH ${SIDES} SELECT won FROM sides WHERE user_id = ? ORDER BY created_at, id`).all(userId);
  let cur = 0, best = 0;
  for (const r of results) {
    cur = r.won ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

function userStats(userId) {
  const one = (sql, ...args) => Object.values(db.prepare(sql).get(...args))[0] || 0;
  const side = (expr, where = '1') => one(`WITH ${SIDES} SELECT ${expr} FROM sides WHERE user_id = ? AND ${where}`, userId);
  return {
    played: side('COUNT(*)'),
    wins: side('COALESCE(SUM(won), 0)'),
    streak: bestWinStreak(userId),
    nights: one(`SELECT COUNT(*) FROM (
        SELECT event_id FROM attendance WHERE user_id = ?1 AND status = 'here'
        UNION SELECT event_id FROM matches WHERE (p1_id = ?1 OR p2_id = ?1 OR p3_id = ?1 OR p4_id = ?1) AND event_id IS NOT NULL)`,
      userId),
    golds: one('SELECT COUNT(*) FROM medals WHERE user_id = ? AND place = 1', userId),
    medals: one('SELECT COUNT(*) FROM medals WHERE user_id = ?', userId),
    giant: side('COUNT(*)', 'won = 1 AND opp_rb - rb >= 150'),
    gamesWon: side('COUNT(DISTINCT game_id)', 'won = 1'),
    uploads: one('SELECT COUNT(*) FROM media WHERE user_id = ?', userId),
    doublesWins: side('COALESCE(SUM(won), 0)', 'partner_id IS NOT NULL'),
    tournaments: one("SELECT COUNT(*) FROM tournaments WHERE winner_id = ? AND status = 'done'", userId),
    potm: one('SELECT COUNT(*) FROM player_of_month WHERE user_id = ?', userId),
  };
}

const RULES = {
  first_match: (s) => s.played >= 1,
  first_win: (s) => s.wins >= 1,
  wins_10: (s) => s.wins >= 10,
  wins_50: (s) => s.wins >= 50,
  wins_100: (s) => s.wins >= 100,
  matches_25: (s) => s.played >= 25,
  matches_100: (s) => s.played >= 100,
  streak_5: (s) => s.streak >= 5,
  streak_10: (s) => s.streak >= 10,
  nights_5: (s) => s.nights >= 5,
  nights_25: (s) => s.nights >= 25,
  gold_1: (s) => s.golds >= 1,
  gold_5: (s) => s.golds >= 5,
  podium_10: (s) => s.medals >= 10,
  giant_killer: (s) => s.giant >= 1,
  all_rounder: (s) => s.gamesWon >= 3,
  photographer: (s) => s.uploads >= 10,
  duo_5: (s) => s.doublesWins >= 5,
  tournament_champ: (s) => s.tournaments >= 1,
  potm: (s) => s.potm >= 1,
};

// Badges earned from a finished night's table standings rather than lifetime totals.
export function grant(userId, code, eventId = null) {
  const info = db.prepare('INSERT OR IGNORE INTO achievements (user_id, code, event_id) VALUES (?, ?, ?)').run(userId, code, eventId);
  return info.changes ? byCode.get(code) : null;
}

// Award any badges the user now qualifies for. Badges are never taken away.
export function checkAchievements(userId, eventId = null) {
  const have = new Set(db.prepare('SELECT code FROM achievements WHERE user_id = ?').all(userId).map((r) => r.code));
  const stats = userStats(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO achievements (user_id, code, event_id) VALUES (?, ?, ?)');
  const earned = [];
  for (const [code, rule] of Object.entries(RULES)) {
    if (!have.has(code) && rule(stats)) {
      ins.run(userId, code, eventId);
      earned.push(byCode.get(code));
    }
  }
  return earned;
}

export function userAchievements(userId) {
  return db.prepare('SELECT code, earned_at, event_id FROM achievements WHERE user_id = ? ORDER BY earned_at').all(userId)
    .map((r) => ({ ...byCode.get(r.code), earned_at: r.earned_at, event_id: r.event_id }))
    .filter((a) => a.name);
}
