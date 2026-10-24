import { db, getSettings } from './db.js';
import { finaliseEvent, playerOfMonth } from './stats.js';
import { checkAchievements, grant } from './achievements.js';
import { awardTableBadges } from './night.js';
import { pushAll, push, once } from './notify.js';
import { sendRecap } from './recap.js';

// Dates are the PC's local calendar dates, as YYYY-MM-DD strings.
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Keep the next four club nights in the calendar so members can always RSVP.
export function ensureUpcomingEvents(count = 4) {
  const s = getSettings();
  if (s.auto_events !== '1') return;
  const weekday = Number(s.event_weekday ?? 1);
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  const exists = db.prepare('SELECT 1 FROM events WHERE date = ?');
  const ins = db.prepare('INSERT INTO events (title, date, start_time, location) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < count; i++) {
    const date = localDate(d);
    if (!exists.get(date)) ins.run(s.event_title || s.app_name, date, s.event_time, s.location);
    d.setDate(d.getDate() + 7);
  }
}

// Today's nights go live; past nights are finalised and medals handed out.
export function updateEventStatuses() {
  const today = localDate();
  db.prepare("UPDATE events SET status = 'live' WHERE date = ? AND status = 'upcoming'").run(today);
  const past = db.prepare("SELECT id FROM events WHERE date < ? AND status IN ('upcoming', 'live')").all(today);
  for (const e of past) {
    finaliseEvent(e.id);
    awardForEvent(e.id);
  }
}

export function awardForEvent(eventId) {
  awardTableBadges(eventId);
  const users = db.prepare('SELECT DISTINCT user_id FROM medals WHERE event_id = ?').all(eventId);
  for (const u of users) checkAchievements(u.user_id, eventId);
  const medallists = db.prepare('SELECT DISTINCT user_id FROM medals WHERE event_id = ?').all(eventId).map((r) => r.user_id);
  if (once(`medals:${eventId}`)) {
    push(medallists, { title: 'You won a medal! 🏅', body: 'The podium for the night is in. See your medal.', url: `/#/events/${eventId}` }).catch(() => {});
  }
  if (once(`recap:${eventId}`)) sendRecap(eventId).catch((e) => console.warn('Recap email failed:', e.message));
}

// "Club night tonight" push, a few hours before the start time.
function sendReminders() {
  const s = getSettings();
  const ev = db.prepare("SELECT * FROM events WHERE date = ? AND status IN ('upcoming', 'live') ORDER BY id LIMIT 1").get(localDate());
  if (!ev) return;
  const [h, m] = (ev.start_time || s.event_time || '19:00').split(':').map(Number);
  const start = new Date();
  start.setHours(h, m, 0, 0);
  const lead = (Number(s.reminder_hours) || 2) * 3600e3;
  if (Date.now() >= start - lead && Date.now() < start && once(`remind:${ev.id}`)) {
    pushAll({ title: `${ev.title} tonight`, body: `Starts at ${ev.start_time || s.event_time}. Tap to check your table and fixtures.`, url: `/#/events/${ev.id}`, tag: `night-${ev.id}` }).catch(() => {});
  }
}

// On the first tick of a new month, crown last month's player of the month.
function crownPlayerOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (db.prepare('SELECT 1 FROM player_of_month WHERE month = ?').get(month)) return;
  const p = playerOfMonth(month);
  db.prepare('INSERT INTO player_of_month (month, user_id, elo_gain, wins, played) VALUES (?, ?, ?, ?, ?)')
    .run(month, p?.user_id ?? null, p?.elo_gain ?? null, p?.wins ?? null, p?.played ?? null);
  if (p) {
    grant(p.user_id, 'potm');
    push([p.user_id], { title: "🌟 You're Player of the Month!", body: `+${p.elo_gain} rating points last month. Legend.`, url: `/#/players/${p.user_id}` }).catch(() => {});
  }
}

export function startScheduler() {
  const tick = () => {
    for (const job of [updateEventStatuses, ensureUpcomingEvents, sendReminders, crownPlayerOfMonth]) {
      try { job(); } catch (e) { console.error('Scheduler error:', e); }
    }
  };
  tick();
  setInterval(tick, 5 * 60 * 1000).unref();
}

export function eventIcs(ev, url) {
  const s = getSettings();
  const [h, m] = (ev.start_time || '19:00').split(':').map(Number);
  const stamp = (date, hh, mm) => `${date.replaceAll('-', '')}T${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00`;
  const esc = (t) => String(t || '').replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${esc(s.app_name)}//EN`, 'BEGIN:VEVENT',
    `UID:event-${ev.id}@monday-night-club`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${stamp(ev.date, h, m)}`,
    `DTEND:${stamp(ev.date, Math.min(h + 3, 23), m)}`,
    `SUMMARY:${esc(ev.title)}`,
    `LOCATION:${esc(ev.location)}`,
    `DESCRIPTION:${esc((ev.description ? ev.description + '\n\n' : '') + url)}`,
    `URL:${url}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}
