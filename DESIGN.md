# Monday Night Club — Design & Architecture (v2)

> Working name: **Monday Night Club**. The name, tagline, colours, tables and schedule live in
> the database settings and can be changed from the Admin screen without touching code.

## 1. Goals

The club has ~6,000 members on MeetUp and 25–30 players every Monday on three table tennis
tables, with darts and pool on the side. The app should:

1. Make **signing up effortless**: mobile number, email, or both.
2. **Organise the night**: put every player on a table that matches their level
   (beginner / intermediate / advanced) when they RSVP or check in, and give each table a
   **round-robin** set of fixtures (everyone plays everyone) that updates itself when a new
   player joins, without touching games already played.
3. Show **live per-table standings** as results come in, plus the night's podium
   (Gold / Silver / Bronze per game).
4. Keep players engaged between nights: Elo ratings, monthly and seasonal ladders, knockout
   tournaments, rivalries, player of the month, rating charts and lifetime badges.
5. Support **doubles**: a pool of players who are keen, balanced pairing on the night, doubles
   fixtures, ratings and standings. Plus **team nights**.
6. Host the **best photos and videos** each week, with optional moderation and automatic video
   conversion.
7. Reduce dependence on MeetUp: own the events, RSVPs, invites (MeetUp CSV import), reminders
   and weekly recap emails.
8. Run on **one PC** today, be reachable by everyone through a browser, and be ready to become
   an installable mobile app (it is already a PWA with push notifications).

## 2. Users and roles

| Role | Can do |
|---|---|
| Visitor | Landing page, upcoming nights, leaderboards, gallery, tournaments, doubles pool. |
| Member | Profile, RSVP / check in (→ table + fixtures), enter results for their own matches, join tournaments and the doubles pool, upload media, like media, notifications. |
| Admin | Everything, plus nights, tables & levels, moving players between tables, walk-in accounts, pairing doubles, team nights, tournaments, seasons, invites/import, moderation, email/notification settings, members and roles. |

The **first account created becomes the admin**. An optional **club join code** can be required
at sign-up (personal invite links skip it).

## 3. Core concepts

### Accounts
- Sign up with **mobile number, email or both** (at least one). Sign in with either.
- Phone numbers are normalised to international format using the club's country code
  (Admin → Club, default `+44`), so `07700 900123` and `+44 7700 900123` are the same person.
- Each member picks a **level** at sign-up (Beginner / Intermediate / Advanced); admins can adjust.
- Optional: "I'm keen on doubles", "I'm here tonight — put me on a table".
- Forgotten password: reset link by email (when SMTP is configured) or an admin-issued
  temporary password (works for phone-only members).

### Nights, tables and round-robin fixtures
- **Event (Night)** — the server keeps the next four nights created (configurable weekday/time).
  Status `upcoming → live → finalised` (or `cancelled`).
- **Tables** — Admin sets the number of tables and a level per table (default: Table 1
  Advanced, Table 2 Intermediate, Table 3 Beginner) and an optional max players per table.
- **Assignment** — on RSVP or check-in a player goes to the least-full table of their level.
  If the level has no table, or its tables are full, the nearest level with room is used.
  Admins can move a player (select on the table card) or add a walk-in.
- **Fixtures** — when a player joins a table, a fixture is created against every player already
  there. Played fixtures are never changed. Leaving a table removes only that player's unplayed
  fixtures.
- **Order of play** — unplayed fixtures are re-sequenced after every change: the pairing whose
  players have played the fewest games goes next, and nobody plays twice in a row if avoidable.
  The first fixture is "Now playing", the rest are "Up next".
- **Entering results** — either player (or an admin) taps **Enter result** on the fixture. A
  result logged through the general "Log a match" sheet is automatically matched to the pair's
  open fixture. Deleting a result puts the fixture back in the queue.
- **Per-table standings** — wins, then score difference, then fewest losses. Updated live.

### Doubles and team nights
- **Doubles pool** — members flag themselves as keen; the pool page shows everyone keen and
  who is coming to the next night.
- **Pairing** — on the night, keen attendees are paired strongest-with-weakest (by doubles
  rating once they have 3+ doubles games, otherwise singles rating). "Pair up" pairs only new
  arrivals and adds their fixtures against existing pairs; "Reshuffle" (admin) re-pairs everyone
  who hasn't played doubles yet. Admins can also pick pairs by hand.
- **Doubles matches** — a separate game (`TT Doubles`) with its own Elo: each player's change is
  based on the two teams' average ratings. Pairs play a round robin with live pair standings.
- **Team nights** — admin splits attendees into 2–6 teams (snake draft by rating, so teams are
  even). Every win by a team member in any game scores a point; late arrivals join the
  smallest team.

### Ratings, ladders and records
- **Elo** per player per game (start 1000, K=32 for the first 20 games, then 24). Each match
  stores before/after so ratings can be replayed if a result is removed.
- **Leaderboards**: All-time (rating), This year, This month and Season ladders (ranked by
  rating points gained in the period), Most wins, Medal table.
- **Seasons** — admin-defined date ranges.
- **Player of the month** — most rating gained in a month (min 5 matches). A live race is shown
  during the month; the winner is crowned automatically on the 1st and earns a badge.
- **Rivalries** — rival (most-played opponent), nemesis (best record against you),
  favourite opponent; head-to-head on every profile.
- **Rating history** chart per game on each profile.

### Nightly podium
For each game: most wins → best win % → score difference → Elo gained. Live as "standings",
locked in as medals when an admin finalises the night or automatically the next morning.
End-of-night badges for topping your table and completing your round robin.

### Knockout tournaments
Admin creates a cup for a game (optionally tied to a night, optionally entering everyone checked
in). Members join until the draw. The draw seeds by rating into a standard bracket (1 and 2 can
only meet in the final) with byes for top seeds. Players or admins enter results; winners advance
automatically; the champion gets a trophy on their profile and a badge.

### Achievements (lifetime badges)
Off the Mark, First Blood, Winner/Veteran/Centurion, Regular/Ironman, On Fire/Unstoppable,
Monday Regular/Club Legend, Champion of the Night, Dynasty, Podium Fixture, Giant Killer,
All-Rounder, Club Photographer, **Dynamic Duo** (5 doubles wins), **Table Topper**,
**Played Them All** (complete your round robin), **Tournament Champion**, **Player of the Month**.

### Media
Photos (resized on the phone before upload) and videos. Optional **moderation**: members'
uploads wait for admin approval. Optional **video conversion** when ffmpeg is installed on the
PC: phone videos (e.g. iPhone HEVC `.mov`) become 720p H.264 MP4 with a poster image, so they
play everywhere.

### Notifications
- **Push** (Web Push, VAPID keys generated on first run): night reminder N hours before start,
  "You're up on Table 2" / "You're next", lost the #1 spot, medals, tournament round ready,
  tournament champion, photo approved, player of the month. Members switch it on from their
  profile. Works on Android/desktop, and on iPhone once the app is added to the Home Screen.
  Requires the https address.
- **Email** (any SMTP, e.g. Gmail app password): weekly recap after each night (podiums,
  numbers, best photos, next night), invite emails, password reset. Members can opt out.

### Invites & MeetUp
- Club sign-up link (includes the join code) to post in MeetUp/WhatsApp.
- **MeetUp CSV import**: upload the member or attendee export; each row becomes a personal
  invite link (`/#/join/<code>`) that pre-fills name/contact and skips the join code.
  Duplicates and existing members are skipped. Send by WhatsApp link, copy, bulk email,
  or download all links as CSV. The list shows who has joined.

## 4. Screens (mobile first)

Bottom tab bar on phones (Tonight · Ranks · Nights · Gallery · Me), top bar on desktop.

1. **Tonight** — night card with RSVP/check-in; **"Your table" banner** (table number, level,
   next opponent, matches before yours, glows when you're up); **Tables & fixtures** with a tab
   per table: Now playing (Enter result), Up next, live table standings, results, players
   (admins can move/remove); team battle; doubles pairs, queue and standings; tonight's podium;
   latest results; player of the month; last week's champions; best photos; quick links.
2. **Ranks** — game chips; Rating / Most wins / Medal table; All-time / Season / Month / Year;
   player of the month; links to Tournaments and Players.
3. **Nights** — upcoming and past nights; night page has the same table board plus admin tools
   (edit, finalise, cancel, add player / walk-in, team night, pairs), results and gallery.
4. **Gallery** — Latest / Most liked / Best of, full-screen viewer with swipe, likes, feature.
5. **Profile** — level, doubles keen, trophies, POTM; stats; rivalries; rating chart; medal
   cabinet; ratings; badges; recent matches; notification toggle; edit (contact details, level,
   doubles, recap emails).
6. **Tournaments** — list, bracket view with Enter result.
7. **Doubles pool** — join/leave, who's keen and coming.
8. **Admin** — tabs: Club, Tables, Members, Invites, Photos, Seasons, Email & alerts.

Design language: clean layout with personality. Headings in Bricolage Grotesque, body text in
Geist (both fall back to the system font), sentence case. Neutral surfaces with a lively palette:
violet accent (default #7c5cff, changeable in Admin) blending into pink for primary buttons,
teal / amber / pink for Beginner / Intermediate / Advanced, gold / silver / bronze for medals,
green and red for rating up/down, colourful initials avatars. Flat cards with thin borders and
only soft tints behind highlights. Large tap targets, one-handed use, no horizontal scrolling at 360px, dark and light
mode follow the system.

## 5. Architecture

```
 Phones / laptops (browser or installed PWA)
              │  HTTPS (+ Server-Sent Events for live updates, Web Push)
              ▼
 ┌─────────────────────────────── Your PC ───────────────────────────────┐
 │  Cloudflare Tunnel (public https URL, no router changes)              │
 │              │                                                        │
 │  Node.js server (Express)                                             │
 │   ├─ /              static front end (HTML/CSS/JS, PWA manifest, SW)  │
 │   ├─ /api/*         JSON REST API (cookie or Bearer token auth)       │
 │   ├─ /api/…/stream  live updates per night (SSE)                      │
 │   ├─ /uploads/*     photos, videos, posters, avatars                  │
 │   ├─ scheduler      every 5 min: go live, finalise, reminders, POTM   │
 │   └─ video queue    ffmpeg conversion (optional)                      │
 │              │                                                        │
 │  data/  club.db (SQLite, built into Node) · uploads/                  │
 └───────────────────────────────────────────────────────────────────────┘
        │ SMTP (optional)            │ Web Push services (Google/Apple/Mozilla)
```

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22.13+ | One install on Windows/Mac/Linux. |
| Database | SQLite via built-in `node:sqlite` | Zero setup, one file, easy backup. Versioned migrations (`PRAGMA user_version`). |
| Server | Express 5, Multer, web-push, nodemailer | Small, well-known, all pure JavaScript. |
| Live updates | Server-Sent Events | Works through Cloudflare Tunnel, no extra service. |
| Front end | Plain HTML/CSS/JS modules, no build step | Edit and refresh; fast on cheap phones. |
| Auth | scrypt passwords, random session tokens (hashed), httpOnly cookie or Bearer token | Mobile-app ready. |
| Mobile | PWA + Web Push now; Capacitor later | Same code becomes store apps. |

### Folder layout

```
server/
  index.js          app setup, config endpoint, manifest, errors
  db.js             schema, migrations, settings, seeds
  auth.js           hashing, sessions, rate limits, CSRF origin check
  stats.js          Elo (singles & doubles), replay, standings, ladders, POTM, rivals, history
  night.js          tables, assignment, round-robin fixtures, sequencing, doubles pairs, teams
  tournaments.js    seeding, brackets, byes, advancement
  matchService.js   create/delete results (shared by quick log, fixtures, tournaments)
  achievements.js   badge rules
  events.js         weekly nights, statuses, scheduler (reminders, POTM, finalise), ICS
  notify.js         Web Push + SMTP email
  recap.js          weekly recap email
  video.js          ffmpeg conversion queue
  bus.js            in-process pub/sub for SSE
  routes/           auth, users, events, matches, leaderboard, media, admin, tournaments, club
public/
  index.html, sw.js (offline shell + push), css/app.css, icons/
  js/app.js (router), api.js, ui.js, push.js
  js/views/         tonight, board, events, leaderboard, players, gallery, tournaments, doubles, auth, admin
scripts/seed-demo.js   demo players, six past nights and a live night with tables
```

## 6. Data model (SQLite)

```
users(id, email UNIQUE NULL, phone UNIQUE NULL, password_hash, name, nickname, bio, avatar,
      favourite_game_id, role, skill[beginner|intermediate|advanced], doubles_keen, email_opt_in, created_at)
sessions(token_hash, user_id, expires_at)      password_resets(token_hash, user_id, expires_at)
settings(key, value)        games(id, slug, name, emoji, score_label, team_size, sort, active)
events(id, title, date, start_time, location, description, status, …)
attendance(event_id, user_id, status[going|here])
event_tables(event_id, user_id, table_no)
fixtures(id, event_id, table_no[0 = doubles], p1_id, p2_id, p3_id, p4_id, seq, status[pending|done], match_id)
doubles_pairs(id, event_id, user1_id, user2_id)
event_teams(id, event_id, name, color)          event_team_members(team_id, user_id)
matches(id, event_id, game_id, p1_id, p2_id, p3_id, p4_id, p1_score, p2_score, winner_id, detail,
        recorded_by, created_at, pN_rating_before, pN_delta)      -- side A = p1+p3, side B = p2+p4
ratings(user_id, game_id, rating, played, wins, losses, streak, best_streak)
medals(event_id, game_id, user_id, place, wins, played)
achievements(user_id, code, earned_at, event_id)
seasons(id, name, start_date, end_date)          player_of_month(month, user_id, elo_gain, wins, played)
tournaments(id, name, game_id, event_id, status[open|running|done], winner_id, …)
tournament_entries(tournament_id, user_id, seed)
tournament_matches(id, tournament_id, round, slot, p1_id, p2_id, winner_id, match_id)
media(id, event_id, user_id, file, kind, mime, size, caption, featured, status[approved|pending], poster, processing)
media_likes(media_id, user_id)
push_subscriptions(endpoint, user_id, p256dh, auth)
invites(id, code, name, email, phone, source, used_by, used_at)
sent_notifications(key)                           -- "send once" ledger
```

## 7. API (JSON, prefix `/api`)

| Area | Endpoints |
|---|---|
| Config | `GET /config` |
| Auth | `POST /auth/signup` (email/phone, skill, doubles_keen, checkin, invite) · `POST /auth/login` (identifier = email or phone) · `POST /auth/logout` · `GET /auth/me` · `POST /auth/password` · `POST /auth/forgot` · `POST /auth/reset` · `GET /auth/invite/:code` |
| Members | `GET /users` · `GET /users/:id` (stats, rivals, trophies) · `GET /users/:id/history?game=` · `PATCH /users/me` · `POST /users/me/avatar` |
| Nights | `GET /events` · `GET /events/current` · `GET /events/:id` · `POST/PATCH/DELETE /events…` · `POST/DELETE /events/:id/attendance` · `POST /events/:id/finalise` · `POST /events/:id/cancel` · `GET /events/:id/calendar.ics` |
| Tables | `GET /events/:id/board` · `GET /events/:id/stream` (SSE) · `POST /events/:id/fixtures/:fid/result` · `POST /events/:id/tables/assign` · `DELETE /events/:id/tables/:uid` |
| Doubles & teams | `GET /doubles/pool` · `POST /events/:id/doubles/pair` · `POST/DELETE /events/:id/doubles/pairs` · `POST/DELETE /events/:id/teams` |
| Results | `GET /matches` · `POST /matches` (singles or doubles) · `DELETE /matches/:id` |
| Rankings | `GET /leaderboard?game=&period=all|year|month|season|event&sort=` · `GET /leaderboard/medals` · `GET /leaderboard/seasons` · `GET /leaderboard/potm` |
| Tournaments | `GET /tournaments` · `GET /tournaments/:id` · `POST /tournaments` · `POST /tournaments/:id/join|leave|start` · `POST /tournaments/:id/matches/:mid/result` · `DELETE /tournaments/:id` |
| Media | `GET /media?event=&featured=&sort=&status=pending` · `POST /media` · `PATCH /media/:id` (feature, approve, reject) · `DELETE /media/:id` · likes |
| Push | `GET /push/key` · `POST /push/subscribe|unsubscribe|test` · `GET /stream` |
| Admin | settings, games, members (incl. walk-in `POST /admin/users`, skill), seasons, invites (+ import, email), email test, recap preview/send |

## 8. Security & privacy

- scrypt password hashing; 256-bit session tokens stored hashed; httpOnly SameSite=Lax cookies.
- Origin check on all writes (CSRF); login rate-limited per IP **and** account (a whole club on
  one venue Wi-Fi shares an IP); sign-up limited per IP.
- Uploads: type allow-list, size caps, random names, `nosniff`; optional moderation.
- Emails and phone numbers are visible only to the member and admins. SMTP password is never
  sent back to the browser.
- Everything lives in `data/`; back it up by copying the folder.

## 9. Hosting on your PC

See README: install Node.js, `start-windows.bat`, Cloudflare Tunnel for a public https address
(needed for push notifications), pm2 for auto-restart, optional ffmpeg and SMTP.

## 10. Path to a mobile app

1. **Now — PWA** with offline shell, Home Screen icon and push notifications.
2. **Next — Capacitor**: wrap `public/` for the App Store / Google Play, pointing at the public
   URL; the API already accepts `Authorization: Bearer` tokens. Swap Web Push for native push.
3. **Then — native extras**: camera upload, offline result queue, QR check-in at the venue.

## 11. Ideas for later

- QR code at the venue for one-tap check-in.
- SMS invites/reminders for phone-only members (needs a paid SMS provider such as Twilio).
- League divisions with promotion/relegation between table levels.
- Payments for subs and nights.
