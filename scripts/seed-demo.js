// Fills an empty database with demo players and six weeks of results so you can try the app.
// Usage: npm run seed-demo   (delete the data/ folder afterwards to start fresh for real)
import { db, tx } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { replayGame, finaliseEvent } from '../server/stats.js';
import { checkAchievements } from '../server/achievements.js';
import { localDate, ensureUpcomingEvents } from '../server/events.js';
import { assignPlayer, board, pairUp } from '../server/night.js';
import { createMatch } from '../server/matchService.js';

if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  console.log('The database already has members, so no demo data was added.');
  console.log('To try the demo, stop the server, rename or delete the data/ folder, then run this again.');
  process.exit(0);
}

// First names of real club members, kept short.
const NAMES = [
  'Bhanu', 'Chris', 'Caroline', 'Carsten', 'Chandu', 'Chi', 'Daniel', 'David', 'Dee', 'Donal',
  'Harbir', 'Pim', 'Pruthvi', 'Thomas', 'Robert', 'Rahul', 'Riccardo', 'Rob', 'Sherin', 'Sreyansh',
  'Saeed', 'Sam', 'Mihai', 'Mimi', 'Mrinalika', 'Mahmood', 'Marco', 'Martin', 'Marty', 'Matt',
  'Max', 'Melissa', 'Michael', 'Mohamed', 'Rafal', 'Enrique', 'Amro', 'Emre', 'Frank', 'Freya',
  'Gavin', 'Geetika', 'Geny', 'Gleb', 'Gosia', 'Govind', 'Greg',
];

const hash = hashPassword('demo1234');
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

tx(() => {
  // The two organisers are admins and play too.
  const insAdmin = db.prepare("INSERT INTO users (email, password_hash, name, nickname, role, bio, skill, doubles_keen) VALUES (?, ?, ?, NULL, 'admin', ?, ?, 1)");
  insAdmin.run('admin@demo.club', hash, 'Vin', 'Runs the Monday nights. Find me by table 1.', 'advanced');
  insAdmin.run('lee@demo.club', hash, 'Lee', 'Club admin. Ask me about doubles.', 'advanced');
  const LEVELS = ['advanced', 'intermediate', 'intermediate', 'beginner'];
  NAMES.forEach((name, i) => {
    // Mix of sign-up styles: email only, phone only, or both.
    const email = i % 3 === 1 ? null : `player${i + 1}@demo.club`;
    const phone = i % 3 === 2 ? null : `+4477009${String(i + 1).padStart(5, '0')}`;
    db.prepare('INSERT INTO users (email, phone, password_hash, name, nickname, favourite_game_id, skill, doubles_keen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(email, phone, hash, name, null, i % 5 === 0 ? 2 : i % 7 === 0 ? 3 : 1, LEVELS[i % 4], i % 3 === 0 ? 1 : 0);
  });
});

const players = db.prepare('SELECT id FROM users ORDER BY id').all().map((u) => u.id);
const organisers = db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((u) => u.id);
// Organisers are among the stronger players so they show up near the top.
const skill = new Map(players.map((id) => [id, organisers.includes(id) ? 1.3 + Math.random() * 0.3 : 0.6 + Math.random() * 0.9]));
const games = db.prepare('SELECT id, slug FROM games').all();
const ttId = games.find((g) => g.slug === 'table-tennis').id;

const d = new Date();
d.setHours(12, 0, 0, 0);
d.setDate(d.getDate() - ((d.getDay() + 6) % 7 || 7)); // last Monday before today
const dates = [];
for (let i = 5; i >= 0; i--) {
  const x = new Date(d);
  x.setDate(d.getDate() - i * 7);
  dates.push(localDate(x));
}

const insEvent = db.prepare("INSERT INTO events (title, date, start_time, status) VALUES ('Monday Night Club', ?, '19:00', 'live')");
const insAtt = db.prepare("INSERT OR IGNORE INTO attendance (event_id, user_id, status) VALUES (?, ?, 'here')");
const insMatch = db.prepare(`INSERT INTO matches (event_id, game_id, p1_id, p2_id, p1_score, p2_score, winner_id, recorded_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const eventIds = [];
tx(() => {
  for (const date of dates) {
    const eventId = Number(insEvent.run(date).lastInsertRowid);
    eventIds.push(eventId);
    const here = [...organisers, ...players.filter((id) => !organisers.includes(id)).sort(() => Math.random() - 0.5).slice(0, 16 + rnd(8))];
    here.forEach((p) => insAtt.run(eventId, p));
    const matchCount = 30 + rnd(15);
    for (let m = 0; m < matchCount; m++) {
      const gameId = Math.random() < 0.75 ? ttId : pick(games).id;
      const a = pick(here);
      let b = pick(here);
      while (b === a) b = pick(here);
      const aWins = Math.random() < skill.get(a) / (skill.get(a) + skill.get(b));
      const loser = rnd(gameId === ttId ? 2 : 3);
      const win = gameId === ttId ? 3 : 3 + rnd(2);
      const [s1, s2] = aWins ? [win, loser] : [loser, win];
      const mins = 19 * 60 + 5 + Math.floor((m / matchCount) * 170);
      const ts = `${date} ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`;
      insMatch.run(eventId, gameId, a, b, s1, s2, aWins ? a : b, a, ts);
    }
  }
});

for (const g of games) replayGame(g.id);
const today = localDate();
for (const id of eventIds) {
  const ev = db.prepare('SELECT date FROM events WHERE id = ?').get(id);
  if (ev.date < today) finaliseEvent(id);
}
for (const p of players) checkAchievements(p);

// A live night today so the tables, fixtures and doubles screens have something to show.
if (!db.prepare('SELECT 1 FROM events WHERE date = ?').get(today)) {
  const tonight = Number(db.prepare("INSERT INTO events (title, date, start_time, status) VALUES ('Monday Night Club', ?, '19:00', 'live')").run(today).lastInsertRowid);
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  const others = players.filter((id) => !organisers.includes(id)).sort(() => Math.random() - 0.5);
  const arrivals = [...organisers, ...others].slice(0, 18);
  for (const p of arrivals) {
    db.prepare("INSERT INTO attendance (event_id, user_id, status) VALUES (?, ?, 'here')").run(tonight, p);
    assignPlayer(tonight, p);
  }
  // Play the first few fixtures on each table.
  for (let round = 0; round < 3; round++) {
    for (const t of board(tonight).tables) {
      if (!t.now) continue;
      const [a, b] = [t.now.a[0].id, t.now.b[0].id];
      const aWins = Math.random() < skill.get(a) / (skill.get(a) + skill.get(b));
      createMatch(admin, { game_id: ttId, event_id: tonight, p1_id: a, p2_id: b, p1_score: aWins ? 3 : rnd(3), p2_score: aWins ? rnd(3) : 3, fixture_id: t.now.id });
    }
  }
  pairUp(tonight);
}
ensureUpcomingEvents();

console.log(`Demo data added: ${players.length} players, ${eventIds.length} nights.`);
console.log('Sign in as admin@demo.club (or player1@demo.club, or mobile 07700900002 …) with password demo1234.');
process.exit(0);
