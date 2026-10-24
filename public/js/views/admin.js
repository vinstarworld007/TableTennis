import { api } from '../api.js';
import { state, navigate, refreshConfig } from '../app.js';
import { html, ico, $, $$, avatar, displayName, skeleton, toast, timeAgo, LEVEL_LABEL, levelChip, empty } from '../ui.js';
import { openEventForm } from './events.js';
import { invalidatePlayers, shareLink } from './shared.js';
import { mediaGrid } from './gallery.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TABS = [['club', 'Club'], ['tables', 'Tables'], ['members', 'Members'], ['invites', 'Invites'], ['photos', 'Photos'], ['seasons', 'Seasons'], ['notify', 'Email & alerts']];
const PREF = 'mnc_admin_tab';

async function saveSettings(form, extra = {}) {
  const data = { ...Object.fromEntries(new FormData(form)), ...extra };
  $$('input[type=checkbox][name]', form).forEach((c) => { data[c.name] = c.checked ? '1' : '0'; });
  await api.patch('/admin/settings', data);
  await refreshConfig();
  toast('Saved', 'success');
}

export async function render({ el, isCurrent }) {
  if (state.me?.role !== 'admin') return navigate('/');
  let tab = sessionStorage.getItem(PREF) || 'club';
  el.innerHTML = skeleton(6).s;

  const load = async () => {
    const { settings: s, email_ready: emailReady, ffmpeg } = await api.get('/admin/settings');
    let body = '';
    let after = () => {};
    if (tab === 'club') {
      body = html`<div class="card"><form id="sf" class="form">
        <label class="field"><span>App name</span><input name="app_name" required maxlength="60" value="${s.app_name}"></label>
        <label class="field"><span>Tagline</span><input name="tagline" maxlength="120" value="${s.tagline}"></label>
        <div class="row2">
          <label class="field"><span>Accent colour</span><input name="accent" type="color" value="${s.accent}"></label>
          <label class="field"><span>Phone country code</span><input name="phone_country_code" maxlength="5" value="${s.phone_country_code}" placeholder="+44"></label>
        </div>
        <label class="field"><span>Venue / location</span><input name="location" maxlength="200" value="${s.location}"></label>
        <label class="field"><span>Club join code <em>(blank = anyone can sign up)</em></span><input name="join_code" maxlength="40" value="${s.join_code}" autocomplete="off"></label>
        <fieldset class="fieldset">
          <legend>Weekly nights</legend>
          <label class="check"><input type="checkbox" name="auto_events" ${s.auto_events === '1' ? 'checked' : ''}> Create the next 4 nights automatically</label>
          <div class="row2">
            <label class="field"><span>Day</span><select name="event_weekday">${DAYS.map((d, i) => html`<option value="${i}" ${String(i) === s.event_weekday ? 'selected' : ''}>${d}</option>`)}</select></label>
            <label class="field"><span>Start time</span><input name="event_time" type="time" value="${s.event_time}"></label>
          </div>
          <label class="field"><span>Night title</span><input name="event_title" maxlength="100" value="${s.event_title}"></label>
        </fieldset>
        <button class="btn btn-block">Save</button>
      </form></div>
      <h2 class="section-title">Games</h2>
      <div class="card list" id="games"></div>`;
      after = async () => {
        $('#sf', el).onsubmit = async (e) => { e.preventDefault(); try { await saveSettings(e.target); } catch (err) { toast(err.message, 'error'); } };
        const { games } = await api.get('/admin/games');
        $('#games', el).innerHTML = html`${games.map((g) => html`<div class="list-row">
            <span class="big-emoji">${g.emoji}</span>
            <div class="grow"><b>${g.name}</b><small>${g.team_size === 2 ? 'Doubles · ' : ''}Score counted in ${g.score_label.toLowerCase()}</small></div>
            <button class="btn btn-sm ghost" data-toggle-game="${g.id}" data-active="${g.active}">${g.active ? 'Hide' : 'Show'}</button>
          </div>`)}
          <form id="gf" class="inline-form">
            <input name="emoji" placeholder="🎳" maxlength="8" class="emoji-input">
            <input name="name" placeholder="Add a game (e.g. Foosball)" required maxlength="40">
            <input name="score_label" placeholder="Games" maxlength="20" class="short">
            <button class="btn btn-sm">Add</button>
          </form>`.s;
        $('#gf', el).onsubmit = async (e) => {
          e.preventDefault();
          try { await api.post('/admin/games', Object.fromEntries(new FormData(e.target))); await refreshConfig(); load(); } catch (err) { toast(err.message, 'error'); }
        };
        $$('[data-toggle-game]', el).forEach((b) => b.onclick = async () => {
          try { await api.patch(`/admin/games/${b.dataset.toggleGame}`, { active: b.dataset.active !== '1' }); await refreshConfig(); load(); } catch (err) { toast(err.message, 'error'); }
        });
      };
    }

    if (tab === 'tables') {
      const count = Number(s.tables) || 3;
      const levels = (s.table_levels || '').split(',');
      body = html`<div class="card"><form id="tf" class="form">
        <p class="hint">Players are placed on a table that matches their level when they RSVP or check in. Everyone on a table plays everyone else (round robin); when someone new joins a table, fixtures against them are added and results already played stay as they are.</p>
        <div class="row2">
          <label class="field"><span>Number of tables</span><input name="tables" type="number" min="1" max="20" value="${count}" id="tcount"></label>
          <label class="field"><span>Max players per table <em>(0 = no limit)</em></span><input name="max_per_table" type="number" min="0" max="50" value="${s.max_per_table}"></label>
        </div>
        <div id="tlevels" class="table-levels">${Array.from({ length: count }, (_, i) => html`<label class="field"><span>Table ${i + 1}</span>
          <select data-level>${state.config.levels.map((l) => html`<option value="${l}" ${(levels[i % levels.length] || 'intermediate') === l ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`)}</select></label>`)}</div>
        <p class="hint small">With a limit set, a full table overflows to the nearest level. Round robin with 8 players is 28 matches, so a limit of 6–8 keeps nights moving.</p>
        <button class="btn btn-block">Save tables</button>
      </form></div>`;
      after = () => {
        $('#tcount', el).onchange = (e) => {
          const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
          const cur = $$('[data-level]', el).map((x) => x.value);
          $('#tlevels', el).innerHTML = Array.from({ length: n }, (_, i) => html`<label class="field"><span>Table ${i + 1}</span>
            <select data-level>${state.config.levels.map((l) => html`<option value="${l}" ${(cur[i] || cur[cur.length - 1] || 'intermediate') === l ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`)}</select></label>`).join('');
        };
        $('#tf', el).onsubmit = async (e) => {
          e.preventDefault();
          try { await saveSettings(e.target, { table_levels: $$('[data-level]', el).map((x) => x.value).join(',') }); } catch (err) { toast(err.message, 'error'); }
        };
      };
    }

    if (tab === 'members') {
      const { users } = await api.get('/admin/users');
      body = html`<div class="search">${ico('search', 18)}<input id="uq" placeholder="Search members"></div>
        <div class="card list">${users.map((u) => html`<div class="list-row" data-user-row="${`${u.name} ${u.nickname || ''} ${u.email || ''} ${u.phone || ''}`.toLowerCase()}">
          ${avatar(u, 36)}
          <div class="grow"><a href="#/players/${u.id}"><b>${displayName(u)}</b></a><small>${[u.email, u.phone].filter(Boolean).join(' · ') || 'no contact'} · ${u.played} matches · joined ${timeAgo(u.created_at)}</small></div>
          ${u.role === 'admin' ? html`<span class="chip chip-gold">Admin</span>` : ''}
          <select data-skill="${u.id}" class="compact-select" aria-label="Level">${state.config.levels.map((l) => html`<option value="${l}" ${u.skill === l ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`)}</select>
          <details class="menu"><summary class="icon-btn ghost" aria-label="Actions">⋯</summary>
            <div class="menu-pop">
              <button data-role="${u.id}" data-to="${u.role === 'admin' ? 'member' : 'admin'}">${u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
              <button data-reset="${u.id}">Reset password</button>
              ${u.id !== state.me.id ? html`<button class="danger" data-remove="${u.id}">Delete member</button>` : ''}
            </div>
          </details>
        </div>`)}</div>`;
      after = () => {
        $('#uq', el).oninput = (e) => $$('[data-user-row]', el).forEach((r) => { r.hidden = !r.dataset.userRow.includes(e.target.value.toLowerCase()); });
        $$('[data-skill]', el).forEach((sel) => sel.onchange = async () => {
          try { await api.patch(`/admin/users/${sel.dataset.skill}`, { skill: sel.value }); invalidatePlayers(); toast('Level updated'); } catch (err) { toast(err.message, 'error'); }
        });
        $$('[data-role]', el).forEach((b) => b.onclick = async () => {
          try { await api.patch(`/admin/users/${b.dataset.role}`, { role: b.dataset.to }); toast('Role updated'); load(); } catch (err) { toast(err.message, 'error'); }
        });
        $$('[data-reset]', el).forEach((b) => b.onclick = async () => {
          if (!confirm("Reset this member's password? They will be signed out everywhere.")) return;
          try {
            const { temporary_password } = await api.post(`/admin/users/${b.dataset.reset}/reset-password`);
            prompt('Give the member this temporary password. They can change it under Edit profile.', temporary_password);
          } catch (err) { toast(err.message, 'error'); }
        });
        $$('[data-remove]', el).forEach((b) => b.onclick = async () => {
          if (!confirm('Delete this member and all their results? This cannot be undone.')) return;
          try { await api.del(`/admin/users/${b.dataset.remove}`); invalidatePlayers(); toast('Member deleted'); load(); } catch (err) { toast(err.message, 'error'); }
        });
      };
    }

    if (tab === 'invites') {
      const { invites } = await api.get('/admin/invites');
      const general = `${location.origin}/#/signup${s.join_code ? `?code=${encodeURIComponent(s.join_code)}` : ''}`;
      const joined = invites.filter((i) => i.used_by).length;
      body = html`<div class="card">
          <h3 class="mini-title">Club sign-up link</h3>
          <p class="hint">Post this in your MeetUp group or WhatsApp. ${s.join_code ? 'It includes your join code.' : ''}</p>
          <div class="copy-row"><input readonly value="${general}" id="glink"><button class="btn btn-sm" id="gshare">${ico('share', 16)} Share</button></div>
        </div>
        <h2 class="section-title">Import from MeetUp</h2>
        <div class="card form">
          <p class="hint">In MeetUp: your group → Members → <b>Export</b> (or an event's attendee list → Download). Upload the CSV here and everyone gets a personal invite link. Rows with an email can be emailed in one go.</p>
          <label class="dropzone small"><input type="file" accept=".csv,.tsv,.txt,text/csv" id="csv" hidden><div class="drop-inner">${ico('upload', 24)}<b>Choose the CSV file</b></div></label>
          <form id="inv1" class="inline-form wrap">
            <input name="name" placeholder="Name" maxlength="60" required>
            <input name="phone" placeholder="Mobile" type="tel">
            <input name="email" placeholder="Email" type="email">
            <button class="btn btn-sm">Add invite</button>
          </form>
        </div>
        <div class="section-title-row"><h2 class="section-title">Invites <small>${joined}/${invites.length} joined</small></h2>
          ${invites.length ? html`<div class="row-actions">${emailReady ? html`<button class="btn btn-sm ghost" id="mail-all">Email invites</button>` : ''}<button class="btn btn-sm ghost" id="dl">Download CSV</button></div>` : ''}</div>
        <div class="search">${ico('search', 18)}<input id="iq" placeholder="Search invites"></div>
        <div class="card list">${invites.length ? invites.slice(0, 400).map((i) => html`<div class="list-row" data-inv-row="${`${i.name || ''} ${i.email || ''} ${i.phone || ''}`.toLowerCase()}">
          <div class="grow"><b>${i.name || i.email || i.phone}</b><small>${[i.email, i.phone].filter(Boolean).join(' · ') || 'no contact'} · ${i.source}</small></div>
          ${i.used_by ? html`<span class="chip chip-live">Joined</span>` : html`
            ${i.phone ? html`<a class="icon-btn ghost" title="Send on WhatsApp" target="_blank" rel="noopener" href="https://wa.me/${i.phone.replace('+', '')}?text=${encodeURIComponent(`Join ${s.app_name}: ${i.link}`)}">💬</a>` : ''}
            <button class="icon-btn ghost" title="Copy link" data-copy="${i.link}">${ico('share', 18)}</button>
            <button class="icon-btn ghost" title="Delete" data-del-inv="${i.id}">${ico('trash', 18)}</button>`}
        </div>`) : empty('✉️', 'No invites yet', 'Import your MeetUp list or add people one by one.')}</div>`;
      after = () => {
        $('#gshare', el).onclick = () => shareLink(general, `Join ${s.app_name}`);
        $('#csv', el).onchange = async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            const r = await api.post('/admin/invites/import', { csv: await f.text() });
            toast(`Added ${r.added} invites${r.skipped ? `, skipped ${r.skipped} (already members or duplicates)` : ''}`, 'success');
            load();
          } catch (err) { toast(err.message, 'error'); }
        };
        $('#inv1', el).onsubmit = async (e) => {
          e.preventDefault();
          try { await api.post('/admin/invites', Object.fromEntries(new FormData(e.target))); load(); } catch (err) { toast(err.message, 'error'); }
        };
        $('#iq', el).oninput = (e) => $$('[data-inv-row]', el).forEach((r) => { r.hidden = !r.dataset.invRow.includes(e.target.value.toLowerCase()); });
        $$('[data-copy]', el).forEach((b) => b.onclick = () => shareLink(b.dataset.copy, `Join ${s.app_name}`));
        $$('[data-del-inv]', el).forEach((b) => b.onclick = async () => { await api.del(`/admin/invites/${b.dataset.delInv}`); load(); });
        $('#mail-all', el)?.addEventListener('click', async () => {
          if (!confirm('Email an invite to everyone with an email address who has not joined yet?')) return;
          try { const r = await api.post('/admin/invites/email'); toast(`Sent ${r.sent} invite emails`, 'success'); } catch (err) { toast(err.message, 'error'); }
        });
        $('#dl', el)?.addEventListener('click', () => {
          const rows = [['Name', 'Email', 'Phone', 'Link', 'Joined'], ...invites.map((i) => [i.name, i.email, i.phone, i.link, i.used_by ? 'yes' : 'no'])];
          const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
          const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'invites.csv' });
          a.click();
        });
      };
    }

    if (tab === 'photos') {
      const { media } = await api.get('/media?status=pending');
      body = html`<div class="card"><form id="mf" class="form">
          <label class="check"><input type="checkbox" name="media_moderation" ${s.media_moderation === '1' ? 'checked' : ''}> Approve members' photos and videos before they appear</label>
          <label class="check"><input type="checkbox" name="transcode_videos" ${s.transcode_videos === '1' ? 'checked' : ''}> Convert videos for smooth playback on every phone</label>
          <p class="hint small">${ffmpeg ? 'ffmpeg found on this PC — videos are converted to 720p MP4 with a preview image.' : 'ffmpeg is not installed on this PC, so videos are kept as uploaded. Install it (see README) to enable conversion.'}</p>
          <button class="btn btn-sm">Save</button>
        </form></div>
        <h2 class="section-title">Waiting for approval <small>${media.length}</small></h2>
        ${media.length ? html`<div class="mod-list">${media.map((m) => html`<div class="card mod-item">
            ${mediaGrid([m])}
            <div><b>${m.user ? displayName(m.user) : ''}</b><small class="muted"> ${timeAgo(m.created_at)}</small>${m.caption ? html`<p>${m.caption}</p>` : ''}
            <div class="row-actions"><button class="btn btn-sm" data-approve="${m.id}">Approve</button><button class="btn btn-sm ghost danger" data-reject="${m.id}">Reject</button></div></div>
          </div>`)}</div>` : html`<div class="card">${empty('✅', 'Nothing to review')}</div>`}`;
      after = () => {
        $('#mf', el).onsubmit = async (e) => { e.preventDefault(); try { await saveSettings(e.target); } catch (err) { toast(err.message, 'error'); } };
        $$('[data-approve]', el).forEach((b) => b.onclick = async () => { await api.patch(`/media/${b.dataset.approve}`, { status: 'approved' }); toast('Approved'); load(); });
        $$('[data-reject]', el).forEach((b) => b.onclick = async () => {
          if (!confirm('Reject and delete this upload?')) return;
          await api.patch(`/media/${b.dataset.reject}`, { status: 'rejected' }); load();
        });
      };
    }

    if (tab === 'seasons') {
      const { seasons } = await api.get('/admin/seasons');
      body = html`<div class="card"><p class="hint">Seasons give the leaderboard a fresh ladder (ranked by rating points gained) while all-time ratings carry on.</p>
        <form id="snf" class="form">
          <label class="field"><span>Name</span><input name="name" required placeholder="e.g. Autumn 2026" maxlength="60"></label>
          <div class="row2"><label class="field"><span>Starts</span><input name="start_date" type="date" required></label>
          <label class="field"><span>Ends</span><input name="end_date" type="date" required></label></div>
          <button class="btn btn-block">Add season</button>
        </form></div>
        <div class="card list">${seasons.length ? seasons.map((x) => html`<div class="list-row"><div class="grow"><b>${x.name}</b><small>${x.start_date} → ${x.end_date}</small></div>
          <button class="icon-btn ghost" data-del-season="${x.id}">${ico('trash', 18)}</button></div>`) : empty('📆', 'No seasons yet')}</div>`;
      after = () => {
        $('#snf', el).onsubmit = async (e) => {
          e.preventDefault();
          try { await api.post('/admin/seasons', Object.fromEntries(new FormData(e.target))); toast('Season added', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
        };
        $$('[data-del-season]', el).forEach((b) => b.onclick = async () => { if (confirm('Delete this season? Results are kept.')) { await api.del(`/admin/seasons/${b.dataset.delSeason}`); load(); } });
      };
    }

    if (tab === 'notify') {
      body = html`<div class="card"><form id="nf" class="form">
        <h3 class="mini-title">Push notifications</h3>
        <p class="hint">Members turn these on from their profile. They get: a reminder before each night, "you're up next on Table 2", a heads-up when someone takes their #1 spot, medals and tournament news. Needs the https address (Cloudflare Tunnel).</p>
        <label class="field"><span>Night reminder, hours before start</span><input name="reminder_hours" type="number" min="1" max="24" value="${s.reminder_hours}"></label>
        <h3 class="mini-title">Email (for weekly recaps, invites and password resets)</h3>
        <p class="hint small">Use any SMTP service. Gmail: smtp.gmail.com, port 465 with secure on, your address and an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">app password</a>.</p>
        <div class="row2">
          <label class="field"><span>SMTP host</span><input name="smtp_host" value="${s.smtp_host}" placeholder="smtp.gmail.com"></label>
          <label class="field"><span>Port</span><input name="smtp_port" type="number" value="${s.smtp_port}"></label>
        </div>
        <div class="row2">
          <label class="field"><span>Username</span><input name="smtp_user" value="${s.smtp_user}" autocomplete="off"></label>
          <label class="field"><span>Password</span><input name="smtp_pass" type="password" value="${s.smtp_pass}" autocomplete="new-password"></label>
        </div>
        <label class="field"><span>From</span><input name="smtp_from" value="${s.smtp_from}" placeholder="Monday Night Club <you@gmail.com>"></label>
        <label class="check"><input type="checkbox" name="smtp_secure" ${s.smtp_secure === '1' ? 'checked' : ''}> Secure connection (port 465)</label>
        <label class="check"><input type="checkbox" name="recap_email" ${s.recap_email === '1' ? 'checked' : ''}> Email everyone the results after each night</label>
        <label class="field"><span>Public address of the app <em>(used in emails)</em></span><input name="public_url" value="${s.public_url}" placeholder="https://club.yourdomain.com"></label>
        <button class="btn btn-block">Save</button>
      </form>
      <div class="row-actions" style="margin-top:12px">
        <span class="chip ${emailReady ? 'chip-live' : ''}">${emailReady ? 'Email ready' : 'Email not set up'}</span>
        ${emailReady ? html`<button class="btn btn-sm ghost" id="test-mail">Send test email</button>` : ''}
      </div></div>`;
      after = () => {
        $('#nf', el).onsubmit = async (e) => { e.preventDefault(); try { await saveSettings(e.target); load(); } catch (err) { toast(err.message, 'error'); } };
        $('#test-mail', el)?.addEventListener('click', async () => {
          const to = prompt('Send a test email to:', state.me.email || '');
          if (!to) return;
          try { await api.post('/admin/email/test', { to }); toast('Test email sent', 'success'); } catch (err) { toast(err.message, 'error'); }
        });
      };
    }

    if (!isCurrent()) return;
    el.innerHTML = html`
      <div class="page-head"><h1>Admin</h1><button class="btn btn-sm" id="new-ev">${ico('plus', 18)} New night</button></div>
      <div class="chips scroll-x">${TABS.map(([k, l]) => html`<button class="chip-btn ${tab === k ? 'active' : ''}" data-atab="${k}">${l}</button>`)}</div>
      ${body}`.s;
    $('#new-ev', el).onclick = () => openEventForm();
    $$('[data-atab]', el).forEach((b) => b.onclick = () => { tab = b.dataset.atab; sessionStorage.setItem(PREF, tab); load(); });
    await after();
  };
  await load();
}

