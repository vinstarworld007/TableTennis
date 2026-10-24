import { Router } from 'express';
import { db } from '../db.js';
import { requireUser, publicUser, selfUser } from '../auth.js';
import { userAchievements } from '../achievements.js';
import { uploader, describe, removeUpload } from '../upload.js';
import { matchView } from '../matchService.js';
import { ratingHistory, rivals, SIDES } from '../stats.js';
import { LEVELS } from '../night.js';
import { readContact } from './auth.js';
import { bad, notFound, str, int } from '../util.js';

const r = Router();

r.get('/', (req, res) => {
  const q = str(req.query.q, 60);
  const rows = q
    ? db.prepare('SELECT * FROM users WHERE name LIKE ? OR nickname LIKE ? ORDER BY name LIMIT 50').all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY name LIMIT 2000').all();
  res.json({ users: rows.map(publicUser) });
});

r.patch('/me', requireUser, (req, res) => {
  const b = req.body;
  const u = req.user;
  const name = b.name !== undefined ? str(b.name, 60) : u.name;
  if (!name) throw bad('Name cannot be empty.');
  let { email, phone } = u;
  if (b.email !== undefined || b.phone !== undefined) {
    ({ email, phone } = readContact({ email: b.email ?? u.email, phone: b.phone ?? u.phone }));
    if (email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, u.id)) throw bad('Another member already uses that email.');
    if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ? AND id != ?').get(phone, u.id)) throw bad('Another member already uses that number.');
  }
  if (b.skill !== undefined && !LEVELS.includes(b.skill)) throw bad('Pick a skill level.');
  const skill = b.skill ?? u.skill;
  db.prepare(`UPDATE users SET name = ?, nickname = ?, bio = ?, favourite_game_id = ?, email = ?, phone = ?, skill = ?,
      doubles_keen = ?, email_opt_in = ? WHERE id = ?`).run(
    name,
    b.nickname !== undefined ? str(b.nickname, 40) : u.nickname,
    b.bio !== undefined ? str(b.bio, 500) : u.bio,
    b.favourite_game_id !== undefined ? int(b.favourite_game_id) : u.favourite_game_id,
    email, phone, skill,
    b.doubles_keen !== undefined ? (b.doubles_keen ? 1 : 0) : u.doubles_keen,
    b.email_opt_in !== undefined ? (b.email_opt_in ? 1 : 0) : u.email_opt_in,
    u.id,
  );
  res.json({ user: selfUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

r.post('/me/avatar', requireUser, uploader({ imagesOnly: true }).single('file'), (req, res) => {
  if (!req.file) throw bad('No file received.');
  const { rel } = describe(req.file);
  removeUpload(req.user.avatar);
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(rel, req.user.id);
  res.json({ avatar: `/uploads/${rel}` });
});

const involves = 'p1_id = ?1 OR p2_id = ?1 OR p3_id = ?1 OR p4_id = ?1';

r.get('/:id', (req, res) => {
  const id = int(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw notFound('Player not found.');
  const ratings = db.prepare(`SELECT g.id AS game_id, g.name, g.emoji, r.rating, r.played, r.wins, r.losses, r.streak, r.best_streak,
      (SELECT COUNT(*) + 1 FROM ratings r2 WHERE r2.game_id = r.game_id AND r2.played > 0 AND r2.rating > r.rating) AS rank
    FROM ratings r JOIN games g ON g.id = r.game_id WHERE r.user_id = ? AND r.played > 0 ORDER BY g.sort`).all(id)
    .map((x) => ({ ...x, rating: Math.round(x.rating) }));
  const medals = db.prepare(`SELECT m.place, m.game_id, g.emoji, g.name AS game, e.id AS event_id, e.date, e.title
    FROM medals m JOIN games g ON g.id = m.game_id JOIN events e ON e.id = m.event_id
    WHERE m.user_id = ? ORDER BY e.date DESC, m.place`).all(id);
  const nights = db.prepare(`SELECT COUNT(*) AS n FROM (
      SELECT event_id FROM attendance WHERE user_id = ?1 AND status = 'here'
      UNION SELECT event_id FROM matches WHERE (${involves}) AND event_id IS NOT NULL)`).get(id).n;
  const recent = db.prepare(`SELECT * FROM matches WHERE ${involves} ORDER BY created_at DESC, id DESC LIMIT 20`).all(id).map(matchView);
  const totals = ratings.reduce((t, x) => ({ played: t.played + x.played, wins: t.wins + x.wins, losses: t.losses + x.losses }),
    { played: 0, wins: 0, losses: 0 });
  const trophies = db.prepare("SELECT id, name, created_at FROM tournaments WHERE winner_id = ? AND status = 'done' ORDER BY id DESC").all(id);
  const potm = db.prepare('SELECT month, elo_gain FROM player_of_month WHERE user_id = ? ORDER BY month DESC').all(id);
  res.json({
    user: req.user?.id === id ? selfUser(u) : publicUser(u),
    totals: { ...totals, nights },
    ratings,
    medals,
    medal_counts: { gold: medals.filter((m) => m.place === 1).length, silver: medals.filter((m) => m.place === 2).length, bronze: medals.filter((m) => m.place === 3).length },
    achievements: userAchievements(id),
    recent,
    h2h: req.user && req.user.id !== id ? headToHead(req.user.id, id) : null,
    rivals: rivals(id),
    trophies,
    potm,
  });
});

r.get('/:id/history', (req, res) => {
  res.json({ points: ratingHistory(int(req.params.id), int(req.query.game)) });
});

r.get('/:id/matches', (req, res) => {
  const id = int(req.params.id);
  const before = int(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = db.prepare(`SELECT * FROM matches WHERE (${involves}) AND id < ?2 ORDER BY id DESC LIMIT 50`).all(id, before);
  res.json({ matches: rows.map(matchView) });
});

// Singles record between two players, across all games.
export function headToHead(a, b) {
  const row = db.prepare(`WITH ${SIDES} SELECT COUNT(*) AS played, COALESCE(SUM(won), 0) AS wins FROM sides
    WHERE user_id = ? AND opp_id = ? AND partner_id IS NULL`).get(a, b);
  return { played: row.played, wins: row.wins, losses: row.played - row.wins };
}

export default r;
