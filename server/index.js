import express from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { db, getSettings, PUBLIC_DIR, UPLOAD_DIR } from './db.js';
import { loadUser, sameOrigin } from './auth.js';
import { startScheduler } from './events.js';
import { ACHIEVEMENTS } from './achievements.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import eventRoutes from './routes/events.js';
import matchRoutes from './routes/matches.js';
import leaderboardRoutes from './routes/leaderboard.js';
import mediaRoutes from './routes/media.js';
import adminRoutes from './routes/admin.js';
import tournamentRoutes from './routes/tournaments.js';
import clubRoutes from './routes/club.js';
import { tableConfig, LEVELS } from './night.js';
import { emailConfigured } from './notify.js';

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.disable('x-powered-by');
// Behind Cloudflare Tunnel / ngrok the real client IP and https come from proxy headers.
// Cloud hosts (Railway, Render, Fly) proxy from another machine, so they set TRUST_PROXY=1.
const trustProxy = process.env.TRUST_PROXY;
app.set('trust proxy', trustProxy ? (/^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy) : 'loopback');

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));

const api = express.Router();
api.use(express.json({ limit: '100kb' }));
api.use(loadUser, sameOrigin);
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

api.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    app_name: s.app_name,
    tagline: s.tagline,
    accent: s.accent,
    location: s.location,
    tables: Number(s.tables) || 3,
    join_code_required: !!s.join_code,
    games: db.prepare('SELECT id, slug, name, emoji, score_label, team_size FROM games WHERE active = 1 ORDER BY sort, id').all(),
    table_config: tableConfig(),
    levels: LEVELS,
    phone_country_code: s.phone_country_code,
    email_reset: emailConfigured(),
    moderation: s.media_moderation === '1',
    achievements: ACHIEVEMENTS,
    has_users: !!db.prepare('SELECT 1 FROM users LIMIT 1').get(),
  });
});
api.use('/auth', authRoutes);
api.use('/users', userRoutes);
api.use('/events', eventRoutes);
api.use('/matches', matchRoutes);
api.use('/leaderboard', leaderboardRoutes);
api.use('/media', mediaRoutes);
api.use('/admin', adminRoutes);
api.use('/tournaments', tournamentRoutes);
api.use('/', clubRoutes);
api.use((req, res) => res.status(404).json({ error: 'Unknown API route.' }));
app.use('/api', api);

// Dynamic manifest so the installed app picks up the club's name and colour.
app.get('/manifest.webmanifest', (req, res) => {
  const s = getSettings();
  res.type('application/manifest+json').json({
    name: s.app_name,
    short_name: s.app_name.length > 14 ? s.app_name.split(' ').map((w) => w[0]).join('') : s.app_name,
    description: s.tagline,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0f1013',
    theme_color: '#0f1013',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, file) => {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
  },
}));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.message;
  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big (videos up to 200 MB).' : 'Upload failed.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Bad request.';
  } else if (status >= 500) {
    console.error(err);
    message = 'Something went wrong on the server.';
  }
  res.status(status).json({ error: message });
});

startScheduler();

app.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  ${getSettings().app_name} is running!\n`);
  console.log(`  On this PC:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  On your Wi-Fi:     http://${ip}:${PORT}`);
  console.log('\n  To share it on the internet, see README.md (Cloudflare Tunnel).\n');
});
