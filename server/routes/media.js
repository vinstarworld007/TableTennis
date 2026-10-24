import { Router } from 'express';
import { db } from '../db.js';
import { requireUser, requireAdmin } from '../auth.js';
import { uploader, describe, removeUpload } from '../upload.js';
import { checkAchievements } from '../achievements.js';
import { liteUser } from '../stats.js';
import { localDate } from '../events.js';
import { getSettings } from '../db.js';
import { queueVideo } from '../video.js';
import { push } from '../notify.js';
import { bad, notFound, forbidden, str, int } from '../util.js';

const r = Router();

function view(m, user) {
  return {
    id: m.id,
    event_id: m.event_id,
    event_date: m.event_date ?? null,
    url: `/uploads/${m.file}`,
    poster: m.poster ? `/uploads/${m.poster}` : null,
    kind: m.kind,
    status: m.status,
    processing: !!m.processing,
    caption: m.caption,
    featured: !!m.featured,
    created_at: m.created_at,
    user: m.user_id ? liteUser(m.user_id) : null,
    likes: m.likes ?? 0,
    liked: user ? !!db.prepare('SELECT 1 FROM media_likes WHERE media_id = ? AND user_id = ?').get(m.id, user.id) : false,
  };
}

const SELECT = `SELECT m.*, e.date AS event_date, (SELECT COUNT(*) FROM media_likes l WHERE l.media_id = m.id) AS likes
  FROM media m LEFT JOIN events e ON e.id = m.event_id`;
const one = (id) => db.prepare(`${SELECT} WHERE m.id = ?`).get(id);

r.get('/', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.event) { where.push('m.event_id = ?'); args.push(int(req.query.event)); }
  if (req.query.user) { where.push('m.user_id = ?'); args.push(int(req.query.user)); }
  if (req.query.featured === '1') where.push('m.featured = 1');
  if (req.query.before) { where.push('m.id < ?'); args.push(int(req.query.before)); }
  // Moderation: everyone sees approved items; uploaders also see their own pending ones; admins can list the queue.
  const isAdmin = req.user?.role === 'admin';
  if (req.query.status === 'pending' && isAdmin) where.push("m.status = 'pending'");
  else if (req.user) { where.push("(m.status = 'approved' OR (m.status = 'pending' AND m.user_id = ?))"); args.push(req.user.id); }
  else where.push("m.status = 'approved'");
  const order = req.query.sort === 'top' ? 'likes DESC, m.id DESC' : 'm.id DESC';
  const rows = db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 60`).all(...args);
  res.json({ media: rows.map((m) => view(m, req.user)) });
});

r.post('/', requireUser, uploader().single('file'), (req, res) => {
  if (!req.file) throw bad('No file received.');
  const { kind, rel } = describe(req.file);
  let eventId = req.body.event_id ? int(req.body.event_id) : null;
  if (!eventId) eventId = db.prepare('SELECT id FROM events WHERE date = ? LIMIT 1').get(localDate())?.id ?? null;
  if (eventId && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) eventId = null;
  const status = getSettings().media_moderation === '1' && req.user.role !== 'admin' ? 'pending' : 'approved';
  const info = db.prepare('INSERT INTO media (event_id, user_id, file, kind, mime, size, caption, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(eventId, req.user.id, rel, kind, req.file.mimetype, req.file.size, str(req.body.caption, 200), status);
  const id = Number(info.lastInsertRowid);
  if (kind === 'video') queueVideo(id);
  if (status === 'pending') {
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((u) => u.id);
    push(admins, { title: 'New photo waiting for approval', body: `From ${req.user.nickname || req.user.name}`, url: '/#/admin' }).catch(() => {});
  }
  const earned = status === 'approved' ? checkAchievements(req.user.id, eventId) : [];
  res.status(201).json({ media: view(one(id), req.user), new_achievements: earned, pending: status === 'pending' });
});

r.patch('/:id', requireAdmin, (req, res) => {
  const m = one(int(req.params.id));
  if (!m) throw notFound('Not found.');
  if (req.body.status === 'rejected') {
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    removeUpload(m.file);
    removeUpload(m.poster);
    return res.json({ media: null });
  }
  if (req.body.status === 'approved' && m.status !== 'approved') {
    db.prepare("UPDATE media SET status = 'approved' WHERE id = ?").run(m.id);
    if (m.user_id) {
      checkAchievements(m.user_id, m.event_id);
      push([m.user_id], { title: 'Your photo is live 📸', body: 'An organiser approved it for the gallery.', url: '/#/gallery' }).catch(() => {});
    }
  }
  db.prepare('UPDATE media SET featured = ?, caption = ? WHERE id = ?').run(
    req.body.featured !== undefined ? (req.body.featured ? 1 : 0) : m.featured,
    req.body.caption !== undefined ? str(req.body.caption, 200) : m.caption,
    m.id,
  );
  res.json({ media: view(one(m.id), req.user) });
});

r.delete('/:id', requireUser, (req, res) => {
  const m = one(int(req.params.id));
  if (!m) throw notFound('Not found.');
  if (req.user.role !== 'admin' && req.user.id !== m.user_id) throw forbidden('You can only delete your own uploads.');
  db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  removeUpload(m.file);
  removeUpload(m.poster);
  res.json({ ok: true });
});

r.post('/:id/like', requireUser, (req, res) => {
  const id = int(req.params.id);
  if (!one(id)) throw notFound('Not found.');
  db.prepare('INSERT OR IGNORE INTO media_likes (media_id, user_id) VALUES (?, ?)').run(id, req.user.id);
  res.json({ media: view(one(id), req.user) });
});

r.delete('/:id/like', requireUser, (req, res) => {
  const id = int(req.params.id);
  db.prepare('DELETE FROM media_likes WHERE media_id = ? AND user_id = ?').run(id, req.user.id);
  const m = one(id);
  res.json({ media: m ? view(m, req.user) : null });
});

export default r;
