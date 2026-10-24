import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 60;
export const COOKIE = 'mnc_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [, saltB64, hashB64] = String(stored).split('$');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, expires);
  return { token, expires };
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function setSessionCookie(req, res, token, expires) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires: new Date(expires),
    path: '/',
  });
}

function readToken(req) {
  const auth = req.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookies = req.get('cookie') || '';
  for (const part of cookies.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

const userBySession = db.prepare(`
  SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND s.expires_at > ?`);

export function loadUser(req, _res, next) {
  const token = readToken(req);
  req.token = token;
  req.user = token ? userBySession.get(sha(token), new Date().toISOString()) || null : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

// Block cross-site form posts: if the browser sends an Origin, it must match our host.
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin || req.get('authorization')) return next();
  try {
    const hosts = [req.get('host'), req.get('x-forwarded-host')].filter(Boolean);
    if (hosts.includes(new URL(origin).host)) return next();
  } catch {}
  res.status(403).json({ error: 'Cross-site request blocked.' });
}

// Small in-memory limiter for login/sign-up attempts.
const attempts = new Map();
// A whole club on one venue Wi-Fi shares an IP, so login is limited per IP *and* account.
export function rateLimit(max, windowMs, keyOf = () => '') {
  return (req, res, next) => {
    const key = `${req.path}|${req.ip}|${keyOf(req)}`;
    const now = Date.now();
    const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Too many attempts, try again in a few minutes.' });
    list.push(now);
    attempts.set(key, list);
    next();
  };
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    nickname: u.nickname,
    bio: u.bio,
    avatar: u.avatar ? `/uploads/${u.avatar}` : null,
    favourite_game_id: u.favourite_game_id,
    role: u.role,
    skill: u.skill,
    doubles_keen: !!u.doubles_keen,
    created_at: u.created_at,
  };
}

// The signed-in member's own view of their account, including contact details.
export function selfUser(u) {
  return u ? { ...publicUser(u), email: u.email, phone: u.phone, email_opt_in: !!u.email_opt_in } : null;
}
