import { Router } from 'express';
import crypto from 'node:crypto';
import { db, getSettings, setSetting } from '../db.js';
import { requireAdmin, hashPassword, publicUser } from '../auth.js';
import { ensureUpcomingEvents } from '../events.js';
import { replayGame } from '../stats.js';
import { bad, notFound, str, int, normalisePhone, EMAIL_RE } from '../util.js';
import { LEVELS } from '../night.js';
import { emailConfigured, sendEmail, publicUrl } from '../notify.js';
import { ffmpegAvailable } from '../video.js';
import { recapHtml, sendRecap } from '../recap.js';
import { emitEvent } from '../bus.js';

const r = Router();
r.use(requireAdmin);

const EDITABLE = ['app_name', 'tagline', 'accent', 'join_code', 'event_weekday', 'event_time', 'event_title', 'location', 'tables',
  'auto_events', 'table_levels', 'max_per_table', 'phone_country_code', 'media_moderation', 'transcode_videos',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure', 'public_url', 'recap_email', 'reminder_hours'];
const FLAGS = ['auto_events', 'media_moderation', 'transcode_videos', 'smtp_secure', 'recap_email'];

function safeSettings() {
  const s = getSettings();
  delete s.vapid_private;
  s.smtp_pass = s.smtp_pass ? '********' : '';
  return { settings: s, email_ready: emailConfigured(), ffmpeg: ffmpegAvailable() };
}

r.get('/settings', (req, res) => res.json(safeSettings()));

r.patch('/settings', (req, res) => {
  for (const key of EDITABLE) {
    if (req.body[key] === undefined) continue;
    let v = String(req.body[key] ?? '').trim().slice(0, 200);
    if (key === 'app_name' && !v) throw bad('The club needs a name.');
    if (key === 'accent' && !/^#[0-9a-f]{6}$/i.test(v)) throw bad('Accent must be a colour like #7c5cff.');
    if (key === 'event_weekday' && !/^[0-6]$/.test(v)) throw bad('Pick a weekday.');
    if (key === 'event_time' && !/^\d{2}:\d{2}$/.test(v)) throw bad('Time should look like 19:00.');
    if (FLAGS.includes(key)) v = v === '1' || v === 'true' ? '1' : '0';
    if (key === 'smtp_pass' && v === '********') continue;
    if (key === 'tables' && !(Number(v) >= 1 && Number(v) <= 20)) throw bad('Tables must be between 1 and 20.');
    if (key === 'max_per_table' && !(Number(v) >= 0 && Number(v) <= 50)) throw bad('Max players per table must be 0-50.');
    if (key === 'table_levels' && v.split(',').some((l) => !LEVELS.includes(l.trim()))) throw bad('Table levels must be beginner, intermediate or advanced.');
    if (key === 'public_url' && v && !/^https?:\/\/[^\s]+$/.test(v)) throw bad('Public address should start with https://');
    setSetting(key, v);
  }
  ensureUpcomingEvents();
  emitEvent(null);
  res.json(safeSettings());
});

r.get('/users', (req, res) => {
  const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM matches m WHERE u.id IN (m.p1_id, m.p2_id, m.p3_id, m.p4_id)) AS played
    FROM users u ORDER BY u.created_at DESC`).all();
  res.json({ users: rows.map((u) => ({ ...publicUser(u), email: u.email, phone: u.phone, played: u.played })) });
});

// Quick account for a walk-in on the night (name required; phone/email optional).
r.post('/users', (req, res) => {
  const name = str(req.body.name, 60);
  if (!name) throw bad('Enter a name.');
  const email = str(req.body.email, 200)?.toLowerCase() || null;
  const phone = req.body.phone ? normalisePhone(req.body.phone, getSettings().phone_country_code) : null;
  if (phone === undefined) throw bad('That phone number does not look right.');
  if (email && !EMAIL_RE.test(email)) throw bad('That email does not look right.');
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('A member already has that email.');
  if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw bad('A member already has that number.');
  const skill = LEVELS.includes(req.body.skill) ? req.body.skill : 'intermediate';
  const temp = crypto.randomBytes(4).toString('hex');
  const info = db.prepare('INSERT INTO users (name, email, phone, password_hash, skill) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, phone, hashPassword(temp), skill);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)), temporary_password: temp });
});

r.patch('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(int(req.params.id));
  if (!u) throw notFound('Member not found.');
  if (req.body.role !== undefined) {
    const role = req.body.role === 'admin' ? 'admin' : 'member';
    if (role === 'member' && u.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n <= 1) {
      throw bad('There must always be at least one admin.');
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, u.id);
  }
  if (req.body.skill !== undefined) {
    if (!LEVELS.includes(req.body.skill)) throw bad('Pick a skill level.');
    db.prepare('UPDATE users SET skill = ? WHERE id = ?').run(req.body.skill, u.id);
  }
  if (req.body.doubles_keen !== undefined) db.prepare('UPDATE users SET doubles_keen = ? WHERE id = ?').run(req.body.doubles_keen ? 1 : 0, u.id);
  if (req.body.name !== undefined) {
    const name = str(req.body.name, 60);
    if (!name) throw bad('Name cannot be empty.');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

// No email server needed: an admin hands the member a temporary password on the night.
r.post('/users/:id/reset-password', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(int(req.params.id));
  if (!u) throw notFound('Member not found.');
  const temp = crypto.randomBytes(5).toString('hex');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(temp), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ temporary_password: temp });
});

r.delete('/users/:id', (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) throw bad('You cannot delete your own account here.');
  const games = db.prepare('SELECT DISTINCT game_id FROM matches WHERE p1_id = ?1 OR p2_id = ?1').all(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  for (const g of games) replayGame(g.game_id);
  res.json({ ok: true });
});

r.get('/games', (req, res) => res.json({ games: db.prepare('SELECT * FROM games ORDER BY sort, id').all() }));

r.post('/games', (req, res) => {
  const name = str(req.body.name, 40);
  if (!name) throw bad('Name the game.');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `game-${Date.now()}`;
  if (db.prepare('SELECT 1 FROM games WHERE slug = ?').get(slug)) throw bad('That game already exists.');
  const sort = (db.prepare('SELECT MAX(sort) AS s FROM games').get().s || 0) + 1;
  db.prepare('INSERT INTO games (slug, name, emoji, score_label, sort) VALUES (?, ?, ?, ?, ?)')
    .run(slug, name, str(req.body.emoji, 8) || '🎮', str(req.body.score_label, 20) || 'Games', sort);
  res.status(201).json({ games: db.prepare('SELECT * FROM games ORDER BY sort, id').all() });
});

r.patch('/games/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(int(req.params.id));
  if (!g) throw notFound('Game not found.');
  db.prepare('UPDATE games SET name = ?, emoji = ?, score_label = ?, active = ? WHERE id = ?').run(
    str(req.body.name, 40) || g.name,
    req.body.emoji !== undefined ? str(req.body.emoji, 8) : g.emoji,
    str(req.body.score_label, 20) || g.score_label,
    req.body.active !== undefined ? (req.body.active ? 1 : 0) : g.active,
    g.id,
  );
  res.json({ games: db.prepare('SELECT * FROM games ORDER BY sort, id').all() });
});

// ---------- Seasons ----------
r.get('/seasons', (req, res) => res.json({ seasons: db.prepare('SELECT * FROM seasons ORDER BY start_date DESC').all() }));

r.post('/seasons', (req, res) => {
  const name = str(req.body.name, 60);
  const start = str(req.body.start_date, 10);
  const end = str(req.body.end_date, 10);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) throw bad('Give the season a name, start and end date.');
  if (end < start) throw bad('The season must end after it starts.');
  db.prepare('INSERT INTO seasons (name, start_date, end_date) VALUES (?, ?, ?)').run(name, start, end);
  res.status(201).json({ seasons: db.prepare('SELECT * FROM seasons ORDER BY start_date DESC').all() });
});

r.delete('/seasons/:id', (req, res) => {
  db.prepare('DELETE FROM seasons WHERE id = ?').run(int(req.params.id));
  res.json({ seasons: db.prepare('SELECT * FROM seasons ORDER BY start_date DESC').all() });
});

// ---------- Invites & MeetUp import ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const inviteView = (i, base) => ({
  ...i, link: `${base}/#/join/${i.code}`,
  used_by_user: i.used_by ? publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(i.used_by)) : null,
});

function createInvite(name, email, phone, source) {
  const code = crypto.randomBytes(6).toString('base64url');
  db.prepare('INSERT INTO invites (code, name, email, phone, source) VALUES (?, ?, ?, ?, ?)').run(code, name, email, phone, source);
  return code;
}

r.get('/invites', (req, res) => {
  const base = publicUrl(req);
  res.json({ invites: db.prepare('SELECT * FROM invites ORDER BY id DESC LIMIT 5000').all().map((i) => inviteView(i, base)) });
});

r.post('/invites', (req, res) => {
  const name = str(req.body.name, 60);
  const email = str(req.body.email, 200)?.toLowerCase() || null;
  const phone = normalisePhone(req.body.phone, getSettings().phone_country_code) || null;
  if (!name && !email && !phone) throw bad('Add at least a name.');
  if (email && !EMAIL_RE.test(email)) throw bad('That email does not look right.');
  const code = createInvite(name, email, phone, 'manual');
  res.status(201).json({ invite: inviteView(db.prepare('SELECT * FROM invites WHERE code = ?').get(code), publicUrl(req)) });
});

// Accepts a MeetUp member/attendee export (CSV or tab-separated). Picks up Name, Email and Phone columns if present.
r.post('/invites/import', (req, res) => {
  const rows = parseCsv(req.body.csv || '');
  if (rows.length < 2) throw bad('That file has no rows. Export the member list from MeetUp as CSV and try again.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const ni = col('name', 'full name');
  const ei = col('email', 'e-mail');
  const pi = col('phone', 'mobile');
  if (ni < 0 && ei < 0 && pi < 0) throw bad('Could not find a Name, Email or Phone column in the first row.');
  const cc = getSettings().phone_country_code;
  let added = 0, skipped = 0;
  const existsUser = db.prepare('SELECT 1 FROM users WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?)');
  const existsInvite = db.prepare("SELECT 1 FROM invites WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?) OR (email IS NULL AND phone IS NULL AND name = ? AND source = 'meetup')");
  for (const row of rows.slice(1)) {
    const name = ni >= 0 ? str(row[ni], 60) : null;
    const email = ei >= 0 ? str(row[ei], 200)?.toLowerCase() : null;
    const phone = pi >= 0 ? normalisePhone(row[pi], cc) || null : null;
    const validEmail = email && EMAIL_RE.test(email) ? email : null;
    if (!name && !validEmail && !phone) { skipped++; continue; }
    if (existsUser.get(validEmail, phone) || existsInvite.get(validEmail, phone, name)) { skipped++; continue; }
    createInvite(name, validEmail, phone, 'meetup');
    added++;
  }
  res.json({ added, skipped });
});

r.delete('/invites/:id', (req, res) => {
  db.prepare('DELETE FROM invites WHERE id = ?').run(int(req.params.id));
  res.json({ ok: true });
});

// Email invites to everyone imported with an email address who hasn't joined yet.
r.post('/invites/email', async (req, res) => {
  if (!emailConfigured()) throw bad('Set up email first (Notifications section).');
  const { app_name, tagline } = getSettings();
  const base = publicUrl(req);
  const list = db.prepare("SELECT * FROM invites WHERE used_by IS NULL AND email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sent_notifications WHERE key = 'invite:' || invites.id)").all();
  let sent = 0;
  for (const i of list) {
    const link = `${base}/#/join/${i.code}`;
    try {
      await sendEmail(i.email, `You're invited to ${app_name}`,
        `<p>Hi ${String(i.name || 'there').replace(/</g, '')},</p><p>${app_name} now has its own app: ${tagline}. Track your wins, see your table and fixtures on the night, and collect medals.</p><p><a href="${link}">Join in 30 seconds</a></p>`);
      db.prepare('INSERT OR IGNORE INTO sent_notifications (key) VALUES (?)').run(`invite:${i.id}`);
      sent++;
    } catch (e) { console.warn('Invite email failed:', e.message); }
  }
  res.json({ sent, remaining: list.length - sent });
});

// ---------- Email ----------
r.post('/email/test', async (req, res) => {
  const to = str(req.body.to, 200) || req.user.email;
  if (!to) throw bad('Enter an address to send the test to.');
  try {
    await sendEmail(to, 'Test email from your club app', '<p>It works! Recap emails and password resets can now be sent.</p>');
  } catch (e) {
    throw bad(`Sending failed: ${e.message}`);
  }
  res.json({ ok: true });
});

r.get('/recap/:eventId', (req, res) => res.type('html').send(recapHtml(int(req.params.eventId))));

r.post('/recap/:eventId/send', async (req, res) => {
  res.json({ sent: await sendRecap(int(req.params.eventId)) });
});

export default r;
