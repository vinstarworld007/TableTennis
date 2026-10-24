import { api } from '../api.js';
import { state, navigate, refreshMe } from '../app.js';
import {
  html, ico, $, $$, avatar, displayName, skeleton, empty, toast, medalEmoji, niceDate, shrinkImage, parseUtc,
  levelChip, lineChart, LEVEL_LABEL,
} from '../ui.js';
import { pushSupported, pushEnabled, enablePush, disablePush } from '../push.js';
import { matchItem, bindMatchDeletes, invalidatePlayers } from './shared.js';

export async function renderList({ el, isCurrent }) {
  el.innerHTML = skeleton(5).s;
  const { users } = await api.get('/users');
  if (!isCurrent()) return;
  const draw = (q = '') => {
    const list = users.filter((u) => `${u.name} ${u.nickname || ''}`.toLowerCase().includes(q.toLowerCase()));
    $('#plist', el).innerHTML = list.length
      ? list.map((u) => html`<a class="list-row" href="#/players/${u.id}">${avatar(u, 40)}
          <div class="grow"><b>${displayName(u)}</b>${u.nickname ? html`<small>${u.name}</small>` : ''}</div>
          ${u.role === 'admin' ? html`<span class="chip">Organiser</span>` : ''}${ico('chevron', 18)}</a>`).join('')
      : empty('🔍', 'No players found').s;
  };
  el.innerHTML = html`
    <a class="back-link" href="#/leaderboard">${ico('back', 18)} Leaderboard</a>
    <div class="page-head"><h1>Players <small>${users.length}</small></h1></div>
    <div class="search big">${ico('search', 18)}<input id="pq" placeholder="Search by name" autocomplete="off"></div>
    <div class="card list" id="plist"></div>`.s;
  $('#pq', el).addEventListener('input', (e) => draw(e.target.value));
  draw();
}

export async function renderMe(ctx) {
  if (!state.me) {
    navigate('/login');
    return;
  }
  return renderProfile({ ...ctx, params: [String(state.me.id)], own: true });
}

export async function renderProfile({ el, params, isCurrent, own }) {
  const id = Number(params[0]);
  el.innerHTML = skeleton(6).s;
  const load = async () => {
    const p = await api.get(`/users/${id}`);
    if (!isCurrent()) return;
    const me = state.me;
    const isMe = me?.id === id;
    const u = p.user;
    const t = p.totals;
    const earned = new Set(p.achievements.map((a) => a.code));
    const fav = state.config.games.find((g) => g.id === u.favourite_game_id);
    const joined = parseUtc(u.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    el.innerHTML = html`
      ${!own ? html`<a class="back-link" href="javascript:history.back()">${ico('back', 18)} Back</a>` : ''}
      <section class="profile-head card">
        <div class="profile-avatar">${avatar(u, 96)}</div>
        <div class="profile-id">
          <h1>${displayName(u)}</h1>
          ${u.nickname ? html`<p class="muted">${u.name}</p>` : ''}
          <p class="muted small">${u.role === 'admin' ? 'Organiser · ' : ''}Member since ${joined}${fav ? ` · ${fav.emoji} ${fav.name}` : ''}</p>
          <div class="row-actions tight">${levelChip(u.skill)}${u.doubles_keen ? html`<span class="chip">👥 Doubles keen</span>` : ''}
            ${p.trophies.map((x) => html`<span class="chip chip-gold">🏆 ${x.name}</span>`)}
            ${p.potm.map((x) => html`<span class="chip chip-gold">🌟 POTM ${new Date(`${x.month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</span>`)}</div>
        </div>
        ${u.bio ? html`<p class="profile-bio">${u.bio}</p>` : ''}
        ${isMe ? html`<div class="row-actions"><a class="btn btn-sm ghost" href="#/me/edit">Edit profile</a>
          ${me.role === 'admin' ? html`<a class="btn btn-sm ghost" href="#/admin">${ico('settings', 16)} Admin</a>` : ''}
          ${pushSupported() ? html`<button class="btn btn-sm ghost" id="push">${ico('check', 16)} <span>Notifications</span></button>` : ''}
          <button class="btn btn-sm ghost" id="logout">Sign out</button></div>` : ''}
      </section>

      <div class="stat-tiles">
        <div class="stat"><b>${t.played}</b><span>Matches</span></div>
        <div class="stat"><b>${t.wins}</b><span>Wins</span></div>
        <div class="stat"><b>${t.played ? Math.round((t.wins / t.played) * 100) : 0}%</b><span>Win rate</span></div>
        <div class="stat"><b>${t.nights}</b><span>Nights</span></div>
      </div>

      ${p.h2h && p.h2h.played ? html`<div class="card h2h">
        <span>You vs ${displayName(u)}</span>
        <b>${p.h2h.wins} – ${p.h2h.losses}</b>
        <small>${p.h2h.wins > p.h2h.losses ? 'You have the edge 💪' : p.h2h.wins < p.h2h.losses ? 'Time for revenge 😤' : 'Dead even'}</small>
      </div>` : ''}

      ${rivalBlock(p.rivals)}

      ${p.ratings.length ? html`<div class="section-title-row"><h2 class="section-title">Rating history</h2>
        ${p.ratings.length > 1 ? html`<select id="chart-game" class="compact-select">${p.ratings.map((r) => html`<option value="${r.game_id}">${r.emoji} ${r.name}</option>`)}</select>` : ''}</div>
        <div class="card chart-card" id="chart"></div>` : ''}

      <h2 class="section-title">Medal cabinet</h2>
      <div class="card medal-cabinet">
        <div class="medal-count gold"><span>🥇</span><b>${p.medal_counts.gold}</b><small>Gold</small></div>
        <div class="medal-count silver"><span>🥈</span><b>${p.medal_counts.silver}</b><small>Silver</small></div>
        <div class="medal-count bronze"><span>🥉</span><b>${p.medal_counts.bronze}</b><small>Bronze</small></div>
      </div>
      ${p.medals.length ? html`<div class="card list compact-list">${p.medals.slice(0, 8).map((m) => html`<a class="list-row" href="#/events/${m.event_id}">
        <span class="big-emoji">${medalEmoji(m.place)}</span><div class="grow"><b>${m.emoji} ${m.game}</b><small>${niceDate(m.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</small></div>${ico('chevron', 18)}</a>`)}</div>` : ''}

      ${p.ratings.length ? html`<h2 class="section-title">Ratings</h2>
        <div class="rating-cards">${p.ratings.map((r) => html`<div class="card rating-card">
          <div class="rating-game">${r.emoji} ${r.name}</div>
          <div class="rating-num">${r.rating}</div>
          <div class="rating-sub">#${r.rank} in club · ${r.wins}–${r.losses}</div>
          <div class="rating-sub">Best streak ${r.best_streak}${r.streak >= 2 ? ` · 🔥 ${r.streak} now` : ''}</div>
        </div>`)}</div>` : ''}

      <h2 class="section-title">Badges <small>${earned.size}/${state.config.achievements.length}</small></h2>
      <div class="badge-grid">${state.config.achievements.map((a) => html`<div class="badge ${earned.has(a.code) ? 'earned' : 'locked'}" title="${a.desc}">
        <div class="badge-emoji">${a.emoji}</div><b>${a.name}</b><small>${a.desc}</small></div>`)}</div>

      <h2 class="section-title">Recent matches</h2>
      ${p.recent.length ? html`<ul class="card match-list">${p.recent.map((m) => matchItem(m))}</ul>`
        : html`<div class="card">${empty('🏓', 'No matches yet', isMe ? 'Log your first match on club night.' : '')}</div>`}
    `.s;
    bindMatchDeletes(el, load);
    const drawChart = async (gameId) => {
      const box = $('#chart', el);
      if (!box) return;
      const { points } = await api.get(`/users/${id}/history?game=${gameId}`);
      box.innerHTML = lineChart(points).s;
    };
    if (p.ratings.length) drawChart(p.ratings[0].game_id);
    $('#chart-game', el)?.addEventListener('change', (e) => drawChart(e.target.value));
    const pushBtn = $('#push', el);
    if (pushBtn) {
      const paint = async () => {
        const on = await pushEnabled();
        pushBtn.classList.toggle('btn-on', on);
        $('span', pushBtn).textContent = on ? 'Notifications on' : 'Turn on notifications';
        pushBtn.querySelector('svg').style.display = on ? '' : 'none';
      };
      paint();
      pushBtn.onclick = async () => {
        try {
          if (await pushEnabled()) { await disablePush(); toast('Notifications off'); } else { await enablePush(); toast("Notifications on — we'll tell you when you're up", 'success'); }
        } catch (e) { toast(e.message, 'error'); }
        paint();
      };
    }
    $('#logout', el)?.addEventListener('click', async () => {
      await api.post('/auth/logout');
      await refreshMe();
      invalidatePlayers();
      toast('Signed out');
      navigate('/');
    });
  };
  await load();
}

function rivalBlock(r) {
  if (!r || (!r.rival && !r.nemesis && !r.victim)) return '';
  const item = (label, emoji, x) => (x ? html`<a class="rival" href="#/players/${x.user.id}">
    <small>${emoji} ${label}</small>${avatar(x.user, 40)}<b>${displayName(x.user)}</b><span>${x.wins}–${x.losses}</span></a>` : '');
  const same = r.rival && r.nemesis && r.rival.user.id === r.nemesis.user.id;
  return html`<h2 class="section-title">Rivalries</h2>
    <div class="rivals">${same ? item('Rival & nemesis', '😈', r.nemesis) : html`${item('Rival', '⚔️', r.rival)}${item('Nemesis', '😈', r.nemesis)}`}${item('Favourite opponent', '😎', r.victim)}</div>`;
}

export async function renderEdit({ el }) {
  const me = state.me;
  if (!me) return navigate('/login');
  const games = state.config.games;
  el.innerHTML = html`
    <a class="back-link" href="#/me">${ico('back', 18)} Profile</a>
    <div class="page-head"><h1>Edit profile</h1></div>
    <div class="card">
      <div class="avatar-edit">
        <div id="av">${avatar(me, 96)}</div>
        <label class="btn btn-sm ghost">Change photo<input type="file" accept="image/*" id="avf" hidden></label>
      </div>
      <form id="pf" class="form">
        <label class="field"><span>Name</span><input name="name" required maxlength="60" value="${me.name}"></label>
        <label class="field"><span>Nickname <em>(shown on leaderboards)</em></span><input name="nickname" maxlength="40" value="${me.nickname || ''}" placeholder="e.g. The Wall"></label>
        <div class="contact-pair">
          <label class="field"><span>Mobile number</span><input name="phone" type="tel" inputmode="tel" value="${me.phone || ''}"></label>
          <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" value="${me.email || ''}"></label>
        </div>
        <p class="hint small contact-hint">Keep at least one. You can sign in with either.</p>
        <label class="field"><span>Level</span><select name="skill">${state.config.levels.map((l) => html`<option value="${l}" ${l === me.skill ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`)}</select></label>
        <label class="check"><input type="checkbox" name="doubles_keen" ${me.doubles_keen ? 'checked' : ''}> I'm keen on doubles (join the doubles pool)</label>
        <label class="check"><input type="checkbox" name="email_opt_in" ${me.email_opt_in ? 'checked' : ''}> Send me the weekly results email</label>
        <label class="field"><span>About you</span><textarea name="bio" rows="3" maxlength="500" placeholder="Playing style, favourite shot, bat…">${me.bio || ''}</textarea></label>
        <label class="field"><span>Favourite game</span><select name="favourite_game_id">
          <option value="">—</option>
          ${games.map((g) => html`<option value="${g.id}" ${g.id === me.favourite_game_id ? 'selected' : ''}>${g.emoji} ${g.name}</option>`)}
        </select></label>
        <button class="btn btn-block">Save</button>
      </form>
    </div>
    <h2 class="section-title">Change password</h2>
    <div class="card">
      <form id="pw" class="form">
        <label class="field"><span>Current password</span><input name="current_password" type="password" required autocomplete="current-password"></label>
        <label class="field"><span>New password</span><input name="new_password" type="password" required minlength="8" autocomplete="new-password"></label>
        <button class="btn btn-block ghost">Update password</button>
      </form>
    </div>`.s;

  $('#avf', el).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', await shrinkImage(f, 600, 0.85));
    try {
      await api.upload('/users/me/avatar', fd);
      await refreshMe();
      invalidatePlayers();
      $('#av', el).innerHTML = avatar(state.me, 96).s;
      toast('Photo updated', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#pf', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.favourite_game_id = data.favourite_game_id ? Number(data.favourite_game_id) : null;
    data.doubles_keen = e.target.doubles_keen.checked;
    data.email_opt_in = e.target.email_opt_in.checked;
    if (!data.phone.trim() && !data.email.trim()) return toast('Keep a mobile number or an email.', 'error');
    try {
      await api.patch('/users/me', data);
      await refreshMe();
      invalidatePlayers();
      toast('Profile saved', 'success');
      navigate('/me');
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#pw', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/password', Object.fromEntries(new FormData(e.target)));
      e.target.reset();
      toast('Password updated', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}
