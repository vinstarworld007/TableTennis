import { Router } from 'express';
import crypto from 'node:crypto';
import { db, getSettings } from '../db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, setSessionCookie,
  rateLimit, selfUser, COOKIE,
} from '../auth.js';
import { LEVELS, assignPlayer } from '../night.js';
import { emailConfigured, sendEmail, publicUrl } from '../notify.js';
import { localDate } from '../events.js';
import { bad, str, int, normalisePhone, EMAIL_RE } from '../util.js';

const r = Router();
const limiter = rateLimit(10, 10 * 60 * 1000, (req) => String(req.body?.identifier ?? req.body?.email ?? '').toLowerCase());
const signupLimiter = rateLimit(60, 10 * 60 * 1000);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function readContact(body, { required = true } = {}) {
  const email = str(body.email, 200)?.toLowerCase() || null;
  const phone = normalisePhone(body.phone, getSettings().phone_country_code);
  if (email && !EMAIL_RE.test(email)) throw bad('That email address does not look right.');
  if (phone === undefined) throw bad('That phone number does not look right.');
  if (required && !email && !phone) throw bad('Enter your email, your mobile number, or both.');
  return { email, phone };
}

function findByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  if (id.includes('@')) return db.prepare('SELECT * FROM users WHERE email = ?').get(id.toLowerCase());
  const phone = normalisePhone(id, getSettings().phone_country_code);
  return phone ? db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) : null;
}

r.post('/signup', signupLimiter, (req, res) => {
  const b = req.body;
  const { email, phone } = readContact(b);
  const name = str(b.name, 60);
  const password = String(b.password || '');
  const settings = getSettings();
  if (!name) throw bad('Please enter your name.');
  if (password.length < 8) throw bad('Password must be at least 8 characters.');
  const invite = b.invite ? db.prepare('SELECT * FROM invites WHERE code = ? AND used_by IS NULL').get(String(b.invite)) : null;
  if (settings.join_code && !invite && str(b.join_code)?.toLowerCase() !== settings.join_code.toLowerCase()) {
    throw bad('That club join code is not right. Ask an organiser on the night.');
  }
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('An account with that email already exists. Try signing in.');
  if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw bad('An account with that mobile number already exists. Try signing in.');
  const skill = LEVELS.includes(b.skill) ? b.skill : 'intermediate';
  const isFirst = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const info = db.prepare(`INSERT INTO users (email, phone, password_hash, name, nickname, role, skill, doubles_keen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(email, phone, hashPassword(password), name, str(b.nickname, 40), isFirst ? 'admin' : 'member', skill, b.doubles_keen ? 1 : 0);
  const userId = Number(info.lastInsertRowid);
  if (invite) db.prepare("UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE id = ?").run(userId, invite.id);

  // "Check me in for tonight" on the sign-up form puts them straight on a table.
  let table = null;
  if (b.checkin) {
    const ev = db.prepare("SELECT id FROM events WHERE date = ? AND status IN ('upcoming', 'live') ORDER BY id LIMIT 1").get(localDate());
    if (ev) {
      db.prepare("INSERT OR REPLACE INTO attendance (event_id, user_id, status) VALUES (?, ?, 'here')").run(ev.id, userId);
      table = assignPlayer(ev.id, userId);
    }
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const { token, expires } = createSession(user.id);
  setSessionCookie(req, res, token, expires);
  res.status(201).json({ user: selfUser(user), token, table });
});

r.post('/login', limiter, (req, res) => {
  const user = findByIdentifier(req.body.identifier ?? req.body.email ?? req.body.phone);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    throw bad('Those sign-in details are not right.');
  }
  const { token, expires } = createSession(user.id);
  setSessionCookie(req, res, token, expires);
  res.json({ user: selfUser(user), token });
});

r.post('/logout', (req, res) => {
  destroySession(req.token);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

r.get('/me', (req, res) => res.json({ user: selfUser(req.user) }));

r.get('/invite/:code', (req, res) => {
  const inv = db.prepare('SELECT name, email, phone, used_by FROM invites WHERE code = ?').get(req.params.code);
  if (!inv) throw bad('That invite link is not valid.');
  res.json({ invite: { name: inv.name, email: inv.email, phone: inv.phone, used: !!inv.used_by } });
});

r.post('/password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  const next = String(req.body.new_password || '');
  if (!verifyPassword(String(req.body.current_password || ''), req.user.password_hash)) throw bad('Current password is incorrect.');
  if (next.length < 8) throw bad('New password must be at least 8 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

// Self-service reset by email (needs SMTP set up). Phone-only members ask an organiser.
r.post('/forgot', limiter, async (req, res) => {
  if (!emailConfigured()) throw bad('Password reset by email is not set up. Ask an organiser to reset it for you.');
  const user = findByIdentifier(req.body.identifier);
  if (user?.email) {
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(sha(token), user.id, new Date(Date.now() + 3600e3).toISOString());
    const link = `${publicUrl(req)}/#/reset/${token}`;
    const { app_name } = getSettings();
    await sendEmail(user.email, `${app_name}: reset your password`,
      `<p>Hi ${user.name.replace(/</g, '')},</p><p>Tap the link below to choose a new password. It works for one hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't ask for this, you can ignore this email.</p>`);
  }
  // Same answer either way so the form can't be used to discover who is a member.
  res.json({ ok: true, message: 'If that account has an email address, a reset link is on its way.' });
});

r.post('/reset', limiter, (req, res) => {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?')
    .get(sha(String(req.body.token || '')), new Date().toISOString());
  if (!row) throw bad('That reset link has expired. Ask for a new one.');
  const password = String(req.body.password || '');
  if (password.length < 8) throw bad('Password must be at least 8 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  const { token, expires } = createSession(row.user_id);
  setSessionCookie(req, res, token, expires);
  res.json({ user: selfUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)), token });
});

export default r;
