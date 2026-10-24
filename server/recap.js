// Weekly recap email after each night is finalised: podiums, numbers and the best photos.
import { db, getSettings } from './db.js';
import { podium } from './stats.js';
import { emailConfigured, sendEmail, publicUrl } from './notify.js';

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function recapHtml(eventId) {
  const s = getSettings();
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  const url = publicUrl();
  const stats = db.prepare(`SELECT (SELECT COUNT(*) FROM matches WHERE event_id = ?1) AS matches,
    (SELECT COUNT(*) FROM attendance WHERE event_id = ?1 AND status = 'here') AS players`).get(eventId);
  const photos = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM media_likes l WHERE l.media_id = m.id) AS likes FROM media m
    WHERE m.event_id = ? AND m.status = 'approved' ORDER BY m.featured DESC, likes DESC, m.id DESC LIMIT 4`).all(eventId);
  const next = db.prepare("SELECT * FROM events WHERE date > ? AND status != 'cancelled' ORDER BY date LIMIT 1").get(ev.date);
  const medal = ['', '🥇', '🥈', '🥉'];
  const accent = s.accent || '#7c5cff';
  const blocks = podium(eventId).map((p) => `
    <tr><td style="padding:12px 0 4px;font-weight:600;font-size:16px">${esc(p.game.emoji)} ${esc(p.game.name)}</td></tr>
    ${p.places.map((x) => `<tr><td style="padding:2px 0;font-size:15px">${medal[x.place]} ${esc(x.user.nickname || x.user.name)} <span style="color:#888">· ${x.wins} wins</span></td></tr>`).join('')}`).join('');
  const pics = photos.map((m) => `<td style="padding:4px"><a href="${url}/#/events/${eventId}"><img src="${url}/uploads/${esc(m.poster || m.file)}" width="130" height="130" style="object-fit:cover;border-radius:8px;display:block" alt=""></a></td>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17181c">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e6e6e9;border-radius:12px;overflow:hidden">
    <tr><td style="border-top:4px solid ${accent};padding:22px 24px 8px">
      <div style="font-size:13px;color:#6b6d76">${esc(s.app_name)}</div>
      <div style="font-size:22px;font-weight:600;margin-top:4px">${esc(ev.title)} — the results</div>
      <div style="font-size:14px;color:#6b6d76;margin-top:4px">${esc(ev.date)} · ${stats.players} players · ${stats.matches} matches</div>
    </td></tr>
    <tr><td style="padding:8px 24px 16px"><table width="100%">${blocks || '<tr><td style="padding:12px 0">No results were logged this week.</td></tr>'}</table></td></tr>
    ${pics ? `<tr><td style="padding:0 20px 16px"><div style="font-weight:600;margin:0 4px 6px">Best moments</div><table><tr>${pics}</tr></table></td></tr>` : ''}
    <tr><td style="padding:0 24px 24px">
      ${next ? `<p style="margin:0 0 14px">Next night: <b>${esc(next.date)}</b>${next.start_time ? ` at ${esc(next.start_time)}` : ''}.</p>` : ''}
      <a href="${url}/#/events/${eventId}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">See the full results</a>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f6f6f7;font-size:12px;color:#888">You get this because you're a member. Turn recap emails off in your profile.</td></tr>
  </table></td></tr></table></body></html>`;
}

export async function sendRecap(eventId) {
  const s = getSettings();
  if (s.recap_email !== '1' || !emailConfigured()) return 0;
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!db.prepare('SELECT 1 FROM matches WHERE event_id = ?').get(eventId)) return 0;
  const html = recapHtml(eventId);
  const to = db.prepare("SELECT email FROM users WHERE email IS NOT NULL AND email_opt_in = 1").all().map((r) => r.email);
  let sent = 0;
  for (const email of to) {
    try {
      await sendEmail(email, `${s.app_name}: results from ${ev.date}`, html);
      sent++;
    } catch (e) {
      console.warn('Recap email to', email, 'failed:', e.message);
    }
  }
  return sent;
}
