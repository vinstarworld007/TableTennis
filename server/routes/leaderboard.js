import { Router } from 'express';
import { db } from '../db.js';
import { leaderboard, medalTable, playerOfMonth, currentSeason } from '../stats.js';
import { liteUser } from '../stats.js';
import { int } from '../util.js';

const r = Router();
const firstGame = () => db.prepare('SELECT id FROM games WHERE active = 1 ORDER BY sort, id LIMIT 1').get()?.id;
const PERIODS = ['all', 'year', 'month', 'season', 'event'];

r.get('/', (req, res) => {
  const period = PERIODS.includes(req.query.period) ? req.query.period : 'all';
  const sort = req.query.sort === 'wins' ? 'wins' : 'rating';
  const gameId = int(req.query.game) || firstGame();
  const seasonId = int(req.query.season);
  const season = period === 'season' ? (seasonId ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId) : currentSeason()) : null;
  res.json({
    game_id: gameId, period, sort, season,
    rows: period === 'season' && !season ? [] : leaderboard({ gameId, period, sort, eventId: int(req.query.event), seasonId: season?.id }),
  });
});

r.get('/medals', (req, res) => res.json({ rows: medalTable(int(req.query.game) || null) }));

r.get('/seasons', (req, res) => {
  res.json({ seasons: db.prepare('SELECT * FROM seasons ORDER BY start_date DESC').all(), current: currentSeason() });
});

// This month's race (live) plus the previous winners.
r.get('/potm', (req, res) => {
  const d = new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const past = db.prepare('SELECT * FROM player_of_month WHERE user_id IS NOT NULL ORDER BY month DESC LIMIT 12').all()
    .map((p) => ({ ...p, elo_gain: Math.round(p.elo_gain), user: liteUser(p.user_id) }));
  res.json({ current: playerOfMonth(month), past });
});

export default r;
