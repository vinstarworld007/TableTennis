# Monday Night Club

A web app for your weekly club night: members sign up, log their table tennis / darts / pool
results, climb Elo leaderboards, win Gold/Silver/Bronze each night, collect lifetime badges and
share the best photos and videos. It runs on your own PC and works great on phones
(members can "Add to Home Screen" to get an app icon).

See **[DESIGN.md](DESIGN.md)** for the full design and architecture.

## 1. Run it on your PC (5 minutes)

1. Install **Node.js 22 LTS** (or newer) from <https://nodejs.org>.
2. Put this folder somewhere permanent, e.g. `C:\MondayNightClub`.
3. **Windows:** double-click `start-windows.bat`.
   **Mac/Linux:** run `./start.sh` in a terminal.
   (Or by hand: `npm install` once, then `npm start`.)
4. Open <http://localhost:3000> and **create your account first** — the first account
   becomes the club admin.

The console window shows a second address like `http://192.168.1.20:3000`. Anyone on the
same Wi-Fi can open that on their phone.

### Want to try it with fake data first?

```
npm run seed-demo
npm start
```

Sign in as Vin (`admin@demo.club` / `demo1234`), or try a phone login: `07700900002` / `demo1234`.
The demo has a live night today with 18 players on 3 tables. When you're done, stop the server and delete the
`data` folder to start fresh for real.

## 2. Share it with the whole club (internet access)

### Option A: cloud hosting on Railway (always online, recommended)

The repo includes a `Dockerfile` and `railway.json`, so Railway can build it straight from GitHub.
It costs about $5/month (Hobby plan) and stays online when your PC is off.

1. Sign in at <https://railway.com> with your GitHub account and pick the Hobby plan.
2. **New Project → Deploy from GitHub repo →** choose `TableTennis`. Railway builds and starts it.
3. In the service, **add a Volume** (right-click the service → Attach volume) with mount path
   `/data`. This is where the database, photos and videos live. Without it, everything is wiped
   on each deploy.
4. **Settings → Networking → Generate Domain** to get a link like `https://tabletennis-production.up.railway.app`.
   You can add your own domain there later.
5. Open the link and sign up straight away: the first account becomes the admin.
6. In Admin → Settings, set the public URL to that link so emails and reminders point to it.

Every push to `main` redeploys automatically. Back up the volume from Railway's Volume tab.

### Option B: from your PC with Cloudflare Tunnel

The easiest safe option is a **Cloudflare Tunnel**: no router changes, your home IP stays hidden,
and you get https automatically.

**Quick test link (changes every time):**
1. Install `cloudflared`: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
   (Windows: `winget install --id Cloudflare.cloudflared`)
2. With the app running, open another terminal and run:
   `cloudflared tunnel --url http://localhost:3000`
3. It prints a link like `https://random-words.trycloudflare.com` — share it.

**Permanent address (recommended for the club):** create a free Cloudflare account, add a domain
(about £8/year, e.g. `mondaynightclub.co.uk`), then follow
<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/>
to point `club.yourdomain` at `http://localhost:3000`. Install it as a Windows service so it
starts automatically.

Alternatives: Tailscale Funnel, ngrok, or router port-forwarding with a dynamic DNS name.

## 3. Keep it running

- The PC must be on and awake for people to use the app (Windows: Settings → System → Power →
  Sleep = Never while plugged in).
- To restart automatically after reboots, install pm2:
  `npm install -g pm2 pm2-windows-startup`, then `pm2 start server/index.js --name club --node-args="--no-warnings"`,
  `pm2 save`, `pm2-startup install`.

## 4. Backups

Everything (members, results, photos) is in the **`data`** folder. Copy it somewhere safe
(OneDrive, Google Drive, USB stick) regularly — weekly after club night is ideal. To restore,
stop the server and put the folder back.

## 5. Running the club night

**Signing up:** members can use a phone number, an email, or both. Phone numbers without a
country code are treated as UK (+44); change this under Admin → Club → Phone country code.
Each member picks a level (Beginner / Intermediate / Advanced) and can tick "Keen on doubles".

**Tables and fixtures:** under Admin → Tables, set how many tables you have, which level plays on
each (default: table 1 Advanced, 2 Intermediate, 3 Beginner) and the maximum players per table.
When someone RSVPs or checks in, they are placed on the least-full table for their level, and a
round-robin is built so everyone on that table plays everyone else. A late arrival gets new
fixtures added; games already played are never changed. Round robins get long with big tables
(10 players = 45 games), so keep the max per table around 6–8. Admins can move players between
tables from the night page.

**Live boards:** each table shows now playing, up next and its own standings, which update on
everyone's phone as results come in.

**Doubles:** members who are keen go into the Doubles pool (menu → Doubles). On the night an
admin can press **Pair up** to match keen players by rating, or pick pairs by hand.


- The next four Monday nights are created automatically (change the day/time under **Admin**).
- On the night, players tap **I'm here** and **Log a match** after each game. Either player can
  log it; the opponent can remove it if it's wrong.
- The **Tonight** page shows live standings. The podium is locked in automatically the next
  morning, or press **Finalise & award medals** on the night page to hand them out at the end of
  the evening.
- Admins can star the best photos as **Best of**, which puts them on the home page.
- Forgotten password: Admin → Members → ⋯ → Reset password gives a temporary one.
- Want to restrict sign-ups to real members? Set a **Club join code** in Admin and announce it
  on the night or in the MeetUp group.

## 6. Email, notifications and videos (all optional)

- **Email** (password resets, weekly recap, invites): Admin → Email & alerts. For Gmail, turn on
  2-step verification, create an *App password* at <https://myaccount.google.com/apppasswords>,
  and use host `smtp.gmail.com`, port `465`, your Gmail address and that app password.
  Set **Public URL** to your Cloudflare address so links in emails work.
- **Push notifications** ("you're up next", medals, night reminders) need the https address from
  a Cloudflare Tunnel; they don't work on the plain `http://192.168…` address. On iPhone, members
  must first add the app to their Home Screen (Share → Add to Home Screen).
- **Videos:** install ffmpeg (Windows: `winget install ffmpeg`, then restart the app) and uploaded
  videos are converted to small phone-friendly MP4s with a preview picture. Without ffmpeg,
  videos are kept as uploaded.
- **Photo approval:** turn on moderation in Admin → Photos to approve uploads before they appear.

## 7. Moving off MeetUp

Admin → Invites → **Import CSV**: export your member list from MeetUp (Manage group → Members →
Download) and upload it. Name, email and phone columns are detected automatically and duplicates
are skipped. Each person gets a personal invite link (email them all with one button, or copy
links into MeetUp messages). Invite links skip the join code.

## 8. Seasons, tournaments and awards

- **Seasons** (Admin → Seasons) give the leaderboard a Season ladder; there are also monthly ladders.
- **Tournaments** (Leaderboard → Cups): knockout cups seeded by rating, with byes for top seeds.
- **Player of the month** is crowned automatically on the 1st.

## 9. Change the name and look

Admin → Club settings: app name, tagline, accent colour, venue, weekly schedule, and extra
games (e.g. Foosball). No code changes needed.

## Configuration

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `./data` | Where the database and uploads are stored |
| `TRUST_PROXY` | `loopback` | Which proxies to trust for https and client IPs; the Dockerfile sets `1` for cloud hosts |

## Mobile app later

The site is already an installable PWA. To publish to the App Store / Google Play, wrap the
`public/` folder with Capacitor and point it at your public URL — see DESIGN.md §10.
