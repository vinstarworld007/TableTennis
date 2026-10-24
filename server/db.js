import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PUBLIC_DIR = path.join(root, 'public');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'club.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  nickname TEXT,
  bio TEXT,
  avatar TEXT,
  favourite_game_id INTEGER,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  emoji TEXT,
  score_label TEXT NOT NULL DEFAULT 'Games',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  location TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_date ON events(date);
CREATE TABLE IF NOT EXISTS attendance (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  game_id INTEGER NOT NULL REFERENCES games(id),
  p1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p1_score INTEGER NOT NULL,
  p2_score INTEGER NOT NULL,
  winner_id INTEGER NOT NULL,
  detail TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  p1_rating_before REAL, p1_delta REAL,
  p2_rating_before REAL, p2_delta REAL
);
CREATE INDEX IF NOT EXISTS matches_event ON matches(event_id);
CREATE INDEX IF NOT EXISTS matches_p1 ON matches(p1_id);
CREATE INDEX IF NOT EXISTS matches_p2 ON matches(p2_id);
CREATE TABLE IF NOT EXISTS ratings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  rating REAL NOT NULL DEFAULT 1000,
  played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS medals (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  played INTEGER NOT NULL,
  PRIMARY KEY (event_id, game_id, place)
);
CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  event_id INTEGER,
  PRIMARY KEY (user_id, code)
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  file TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  caption TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS media_event ON media(event_id);
CREATE TABLE IF NOT EXISTS media_likes (
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, user_id)
);
`;
db.exec(SCHEMA);

// Versioned migrations on top of the v1 schema. PRAGMA user_version records the last one applied.
const MIGRATIONS = [
  // v2: phone sign-up, skill levels, tables & fixtures, doubles, teams, seasons, tournaments,
  // notifications, invites, moderation and video processing.
  () => {
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE COLLATE NOCASE,
        phone TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        nickname TEXT,
        bio TEXT,
        avatar TEXT,
        favourite_game_id INTEGER,
        role TEXT NOT NULL DEFAULT 'member',
        skill TEXT NOT NULL DEFAULT 'intermediate',
        doubles_keen INTEGER NOT NULL DEFAULT 0,
        email_opt_in INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, password_hash, name, nickname, bio, avatar, favourite_game_id, role, created_at)
        SELECT id, email, password_hash, name, nickname, bio, avatar, favourite_game_id, role, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      ALTER TABLE games ADD COLUMN team_size INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE matches ADD COLUMN p3_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE matches ADD COLUMN p4_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE matches ADD COLUMN p3_rating_before REAL;
      ALTER TABLE matches ADD COLUMN p3_delta REAL;
      ALTER TABLE matches ADD COLUMN p4_rating_before REAL;
      ALTER TABLE matches ADD COLUMN p4_delta REAL;
      ALTER TABLE media ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
      ALTER TABLE media ADD COLUMN poster TEXT;
      ALTER TABLE media ADD COLUMN processing INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS event_tables (
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        table_no INTEGER NOT NULL,
        assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (event_id, user_id)
      );
      -- Round-robin fixtures. table_no 0 = the doubles fixtures for the night.
      CREATE TABLE IF NOT EXISTS fixtures (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        table_no INTEGER NOT NULL,
        p1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p3_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        p4_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS fixtures_event ON fixtures(event_id, table_no);
      CREATE TABLE IF NOT EXISTS doubles_pairs (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_teams (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_team_members (
        team_id INTEGER NOT NULL REFERENCES event_teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS seasons (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tournaments (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        game_id INTEGER NOT NULL REFERENCES games(id),
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'open',
        winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS tournament_entries (
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seed INTEGER,
        PRIMARY KEY (tournament_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS tournament_matches (
        id INTEGER PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        p1_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        p2_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
        UNIQUE (tournament_id, round, slot)
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT,
        email TEXT,
        phone TEXT,
        source TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sent_notifications (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS player_of_month (
        month TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        elo_gain REAL,
        wins INTEGER,
        played INTEGER
      );
    `);
  },
  // v3: new default look. Only clubs still on an old default accent are moved over.
  () => {
    db.prepare("UPDATE settings SET value = '#7c5cff' WHERE key = 'accent' AND lower(value) = '#ff7a1a'").run();
  },
  // v4: same for the short-lived blue default.
  () => {
    db.prepare("UPDATE settings SET value = '#7c5cff' WHERE key = 'accent' AND lower(value) = '#4c6ef5'").run();
  },
];

function migrate() {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  for (; version < MIGRATIONS.length; version++) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      MIGRATIONS[version]();
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
migrate();

const DEFAULT_SETTINGS = {
  app_name: 'Monday Night Club',
  tagline: 'Table tennis, darts & pool every Monday',
  accent: '#7c5cff',
  join_code: '',
  event_weekday: '1', // 0 = Sunday, 1 = Monday ...
  event_time: '19:00',
  event_title: 'Monday Night Club',
  location: '',
  tables: '3',
  auto_events: '1',
  // Skill level per table, in table order. More tables than levels: levels repeat across tables.
  table_levels: 'advanced,intermediate,beginner',
  max_per_table: '0', // 0 = no limit
  phone_country_code: '+44',
  doubles_table: '0', // which table plays the doubles fixtures (0 = whichever is free)
  media_moderation: '0',
  transcode_videos: '1',
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '', smtp_secure: '0',
  public_url: '',
  recap_email: '1',
  reminder_hours: '2',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

const DEFAULT_GAMES = [
  ['table-tennis', 'Table Tennis', '🏓', 'Games', 1],
  ['darts', 'Darts', '🎯', 'Legs', 2],
  ['pool', 'Pool', '🎱', 'Frames', 3],
  ['doubles', 'TT Doubles', '👥', 'Games', 4, 2],
];
const insertGame = db.prepare('INSERT OR IGNORE INTO games (slug, name, emoji, score_label, sort, team_size) VALUES (?, ?, ?, ?, ?, ?)');
for (const [slug, name, emoji, label, sort, size = 1] of DEFAULT_GAMES) insertGame.run(slug, name, emoji, label, sort, size);

export function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value ?? ''));
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
