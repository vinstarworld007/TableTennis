import { Router } from 'express';
import { db } from '../db.js';
import { requireUser } from '../auth.js';
import { createMatch, deleteMatch, matchView } from '../matchService.js';
import { notFound, int } from '../util.js';

const r = Router();

r.get('/', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.event) { where.push('event_id = ?'); args.push(int(req.query.event)); }
  if (req.query.game) { where.push('game_id = ?'); args.push(int(req.query.game)); }
  if (req.query.user) { where.push('? IN (p1_id, p2_id, p3_id, p4_id)'); args.push(int(req.query.user)); }
  const limit = Math.min(int(req.query.limit) || 100, 300);
  const rows = db.prepare(`SELECT * FROM matches ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, id DESC LIMIT ${limit}`).all(...args);
  res.json({ matches: rows.map(matchView) });
});

r.post('/', requireUser, (req, res) => {
  const { match, earned } = createMatch(req.user, req.body);
  res.status(201).json({ match: matchView(match), new_achievements: earned[req.user.id] || [] });
});

r.delete('/:id', requireUser, (req, res) => {
  if (!deleteMatch(req.user, int(req.params.id))) throw notFound('Match not found.');
  res.json({ ok: true });
});

export default r;
