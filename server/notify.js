import webpush from 'web-push';
import nodemailer from 'nodemailer';
import { db, getSettings, setSetting } from './db.js';

// ---------- Web push ----------
function vapid() {
  let s = getSettings();
  if (!s.vapid_public || !s.vapid_private) {
    const keys = webpush.generateVAPIDKeys();
    setSetting('vapid_public', keys.publicKey);
    setSetting('vapid_private', keys.privateKey);
    s = getSettings();
  }
  return { publicKey: s.vapid_public, privateKey: s.vapid_private, subject: s.smtp_from?.includes('@') ? `mailto:${s.smtp_from.replace(/.*</, '').replace(/>.*/, '')}` : 'mailto:club@example.com' };
}

export const vapidPublicKey = () => vapid().publicKey;

export function saveSubscription(userId, sub) {
  db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth);
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

// payload: { title, body, url, tag }
export async function push(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (!subs.length) return 0;
  const v = vapid();
  const body = JSON.stringify({ ...payload, app: getSettings().app_name });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        vapidDetails: v, TTL: 3600,
      });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(s.endpoint);
      else console.warn('Push failed:', e.statusCode || e.message);
    }
  }));
  return sent;
}

export async function pushAll(payload) {
  const ids = db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all().map((r) => r.user_id);
  return push(ids, payload);
}

// Send a notification at most once per key (e.g. "remind:event:12").
export function once(key) {
  return db.prepare('INSERT OR IGNORE INTO sent_notifications (key) VALUES (?)').run(key).changes === 1;
}

// ---------- Email ----------
export function emailConfigured() {
  const s = getSettings();
  return !!(s.smtp_host && s.smtp_from);
}

function transport() {
  const s = getSettings();
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: s.smtp_secure === '1',
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
  });
}

export async function sendEmail(to, subject, html, text) {
  if (!emailConfigured()) throw new Error('Email is not set up. Add SMTP details in Admin → Notifications.');
  const s = getSettings();
  await transport().sendMail({ from: s.smtp_from, to, subject, html, text: text || html.replace(/<[^>]+>/g, ' ') });
}

export function publicUrl(req) {
  const s = getSettings();
  if (s.public_url) return s.public_url.replace(/\/$/, '');
  return req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000';
}
