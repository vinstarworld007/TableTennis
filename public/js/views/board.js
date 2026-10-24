// Tonight's tables: skill-based table assignment, round-robin fixtures, live per-table standings,
// doubles pairs and team scores. Shared by the Tonight page and the night page.
import { api } from '../api.js';
import { state, requireLogin } from '../app.js';
import { html, ico, $, $$, avatar, displayName, toast, levelChip, LEVEL_LABEL, openModal, closeModal } from '../ui.js';
import { openScoreEntry, invalidatePlayers } from './shared.js';

const PREF = 'mnc_table_tab';

const names = (side) => side.map((u) => displayName(u)).join(' & ');
const involves = (f, id) => [...f.a, ...f.b].some((u) => u?.id === id);

function fixtureRow(f, { n, canEnter, big = false }) {
  const done = f.status === 'done';
  const side = (ps, won) => html`<span class="fx-side ${won ? 'won' : ''}">${ps.length > 1 ? html`<span class="avatar-stack">${ps.map((u) => avatar(u, big ? 34 : 24))}</span>` : avatar(ps[0], big ? 40 : 26)}<span class="fx-name">${names(ps)}</span></span>`;
  return html`<li class="fx ${big ? 'fx-now' : ''} ${state.me && involves(f, state.me.id) ? 'mine' : ''}">
    ${n != null ? html`<span class="fx-n">${n}</span>` : ''}
    ${side(f.a, done && f.a_won)}
    ${done ? html`<span class="fx-score"><b class="${f.a_won ? 'w' : ''}">${f.s1}</b>–<b class="${f.a_won ? '' : 'w'}">${f.s2}</b></span>` : html`<span class="fx-vs">vs</span>`}
    ${side(f.b, done && !f.a_won)}
    ${canEnter && !done ? html`<button class="btn btn-sm ${big ? '' : 'ghost'}" data-enter="${f.id}">${big ? 'Enter result' : 'Score'}</button>` : ''}
  </li>`;
}

function standingsTable(rows, { pairs = false } = {}) {
  if (!rows.length) return '';
  return html`<table class="mini-standings">
    <thead><tr><th>#</th><th>${pairs ? 'Pair' : 'Player'}</th><th>P</th><th>W</th><th>L</th><th>+/-</th>${pairs ? '' : html`<th>Left</th>`}</tr></thead>
    <tbody>${rows.map((r) => html`<tr class="${state.me && (pairs ? r.players.some((u) => u?.id === state.me.id) : r.user.id === state.me.id) ? 'me' : ''}">
      <td>${r.rank}</td>
      <td class="who">${pairs ? names(r.players) : html`<a href="#/players/${r.user.id}">${displayName(r.user)}</a>`}</td>
      <td>${r.played}</td><td><b>${r.wins}</b></td><td>${r.losses}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td>${pairs ? '' : html`<td>${r.left}</td>`}
    </tr>`)}</tbody>
  </table>`;
}

export async function renderBoard(el, ev, { onChange } = {}) {
  const b = await api.get(`/events/${ev.id}/board`);
  const me = state.me;
  const isAdmin = me?.role === 'admin';
  const open = ev.status !== 'finalised' && ev.status !== 'cancelled';
  const anyPlayers = b.tables.some((t) => t.players.length);
  let tab = Number(sessionStorage.getItem(PREF)) || b.mine?.table || b.tables.find((t) => t.players.length)?.no || 1;
  if (!b.tables.find((t) => t.no === tab)) tab = 1;
  const keen = !!me?.doubles_keen;
  const d = b.doubles;
  const showDoubles = d.pairs.length || d.waiting.length || (open && keen && ev.my_status);

  const canEnter = (f) => !!me && (isAdmin || involves(f, me.id));

  const myBanner = () => {
    if (!b.mine) {
      if (!me || !open) return '';
      return html`<div class="card my-table empty-mine"><div><b>Get on a table</b><small>RSVP or check in and you'll be placed on a ${LEVEL_LABEL[me.skill]?.toLowerCase() || ''} table with a full set of fixtures.</small></div></div>`;
    }
    const m = b.mine;
    const up = m.position === 0;
    const opp = m.next ? names(m.next.a.some((u) => u.id === me.id) ? m.next.b : m.next.a) : null;
    return html`<div class="card my-table ${up ? 'up' : ''}">
      <div class="my-table-no"><span>Table</span><b>${m.table}</b></div>
      <div class="grow">
        ${levelChip(m.level)}
        ${m.next ? html`<b>${up ? `You're up now vs ${opp}!` : `Next: vs ${opp}`}</b>
          <small>${up ? 'Head to the table and enter the score when you finish.' : `${m.position} match${m.position === 1 ? '' : 'es'} before yours · ${m.left} left tonight`}</small>`
          : html`<b>All your fixtures are done 🎉</b><small>Check the standings below.</small>`}
      </div>
      ${up && m.next ? html`<button class="btn btn-sm" data-enter="${m.next.id}">Score</button>` : ''}
    </div>`;
  };

  const tableCard = (t) => html`<div class="card table-card">
    <div class="table-head">
      <h3>Table ${t.no}</h3>${levelChip(t.level)}
      <span class="muted small">${t.players.length} player${t.players.length === 1 ? '' : 's'}${t.max ? ` / ${t.max}` : ''} · ${t.done.length}/${t.total} played</span>
    </div>
    ${t.now ? html`<h4 class="mini-title">Now playing</h4><ul class="fx-list">${fixtureRow(t.now, { canEnter: canEnter(t.now), big: true })}</ul>` : ''}
    ${t.queue.length ? html`<h4 class="mini-title">Up next</h4><ul class="fx-list">${t.queue.slice(0, 4).map((f, i) => fixtureRow(f, { n: i + 1, canEnter: canEnter(f) }))}</ul>
      ${t.queue.length > 4 ? html`<details class="more"><summary>${t.queue.length - 4} more fixtures</summary><ul class="fx-list">${t.queue.slice(4).map((f, i) => fixtureRow(f, { n: i + 5, canEnter: canEnter(f) }))}</ul></details>` : ''}` : ''}
    ${!t.now && t.players.length > 1 ? html`<p class="hint">Every fixture on this table has been played. 👏</p>` : ''}
    ${t.players.length < 2 ? html`<p class="hint">${t.players.length ? 'Waiting for another player to join this table…' : 'No one on this table yet.'}</p>` : ''}
    ${t.standings.length > 1 ? html`<h4 class="mini-title">Table standings <span class="chip chip-live"><i class="pulse"></i>Live</span></h4>${standingsTable(t.standings)}` : ''}
    ${t.done.length ? html`<details class="more"><summary>Results (${t.done.length})</summary><ul class="fx-list">${t.done.map((f) => fixtureRow(f, {}))}</ul></details>` : ''}
    <h4 class="mini-title">Players</h4>
    <div class="table-players">${t.players.map((u) => html`<span class="tp">
      <a href="#/players/${u.id}" class="player-link">${avatar(u, 26)}<span>${displayName(u)}</span></a>
      ${isAdmin && open ? html`<select data-move="${u.id}" aria-label="Move ${displayName(u)}">
        ${b.tables.map((x) => html`<option value="${x.no}" ${x.no === t.no ? 'selected' : ''}>T${x.no}</option>`)}<option value="0">Remove</option></select>` : ''}
    </span>`)}</div>
  </div>`;

  const doublesBlock = () => html`<div class="section-title-row"><h2 class="section-title">👥 Doubles</h2>
      ${me && open ? html`<button class="btn btn-sm ghost" id="keen">${keen ? html`${ico('check', 16)} In the doubles pool` : 'Join doubles pool'}</button>` : ''}</div>
    <div class="card">
      ${d.pairs.length ? html`<div class="pairs">${d.pairs.map((p) => html`<span class="pair">${p.players.map((u) => avatar(u, 26))}<span>${names(p.players)}</span>
        ${isAdmin && open ? html`<button class="link-btn danger" data-unpair="${p.id}" aria-label="Split pair">${ico('x', 14)}</button>` : ''}</span>`)}</div>` : html`<p class="hint">No pairs yet tonight.</p>`}
      ${d.waiting.length ? html`<p class="hint">Keen and waiting for a partner: ${d.waiting.map((u) => displayName(u)).join(', ')}</p>` : ''}
      ${open && me ? html`<div class="row-actions">
        ${d.waiting.length >= 2 ? html`<button class="btn btn-sm" data-pair="add">Pair up ${d.waiting.length} waiting player${d.waiting.length === 1 ? '' : 's'}</button>` : ''}
        ${isAdmin && d.pairs.length ? html`<button class="btn btn-sm ghost" data-pair="reshuffle">Reshuffle pairs</button>` : ''}
        ${isAdmin ? html`<button class="btn btn-sm ghost" id="add-pair">Pick a pair</button>` : ''}
      </div>` : ''}
      ${d.now ? html`<h4 class="mini-title">Now playing${b.config?.doubles_table ? '' : ''}</h4><ul class="fx-list">${fixtureRow(d.now, { canEnter: canEnter(d.now), big: true })}</ul>` : ''}
      ${d.queue.length ? html`<h4 class="mini-title">Up next</h4><ul class="fx-list">${d.queue.map((f, i) => fixtureRow(f, { n: i + 1, canEnter: canEnter(f) }))}</ul>` : ''}
      ${d.standings.some((r) => r.played) ? html`<h4 class="mini-title">Pair standings</h4>${standingsTable(d.standings, { pairs: true })}` : ''}
      ${d.done.length ? html`<details class="more"><summary>Results (${d.done.length})</summary><ul class="fx-list">${d.done.map((f) => fixtureRow(f, {}))}</ul></details>` : ''}
    </div>`;

  const teamsBlock = () => {
    const max = Math.max(1, ...b.teams.map((t) => t.points));
    return html`<h2 class="section-title">🚩 Team battle</h2>
      <div class="card teams">${b.teams.map((t, i) => html`<div class="team">
        <div class="team-head"><b style="color:${t.color}">${i === 0 && t.points ? '👑 ' : ''}${t.name}</b><span class="team-pts">${t.points}</span></div>
        <div class="team-bar"><i style="width:${(t.points / max) * 100}%;background:${t.color}"></i></div>
        <small>${t.members.map((u) => displayName(u)).join(', ')}</small>
      </div>`)}
      <p class="hint">Every win by a team member, in any game, scores a point.</p>
      ${isAdmin && open ? html`<button class="link-btn danger" id="clear-teams">Remove teams</button>` : ''}</div>`;
  };

  const adminTools = () => html`<div class="admin-bar">
    <span>Tables</span>
    <button class="btn btn-sm ghost" id="walkin">${ico('plus', 16)} Add a player</button>
    ${!b.teams.length ? html`<button class="btn btn-sm ghost" id="mk-teams">Team night</button>` : ''}
  </div>`;

  const current = b.tables.find((t) => t.no === tab);
  el.innerHTML = html`
    ${myBanner()}
    ${anyPlayers || isAdmin ? html`
      <div class="section-title-row"><h2 class="section-title">Tables & fixtures</h2><span class="chip chip-live"><i class="pulse"></i>Live</span></div>
      <div class="chips scroll-x">${b.tables.map((t) => html`<button class="chip-btn ${t.no === tab ? 'active' : ''}" data-tab="${t.no}">
        Table ${t.no}${b.mine?.table === t.no ? ' ★' : ''} <small>${t.players.length}</small></button>`)}</div>
      ${current ? tableCard(current) : ''}
      ${b.orphans.length ? html`<p class="hint">Not on a table: ${b.orphans.map((u) => displayName(u)).join(', ')} (an admin can move them).</p>` : ''}
      ${isAdmin && open ? adminTools() : ''}` : ''}
    ${b.teams.length ? teamsBlock() : ''}
    ${showDoubles ? doublesBlock() : ''}
  `.s;

  $$('[data-tab]', el).forEach((btn) => btn.onclick = () => {
    sessionStorage.setItem(PREF, btn.dataset.tab);
    renderBoard(el, ev, { onChange });
  });
  const allFixtures = [...b.tables.flatMap((t) => [t.now, ...t.queue]), d.now, ...d.queue].filter(Boolean);
  $$('[data-enter]', el).forEach((btn) => btn.onclick = () => {
    const f = allFixtures.find((x) => x.id === Number(btn.dataset.enter));
    if (!f) return;
    openScoreEntry({
      title: f.table_no ? `Table ${f.table_no}` : 'Doubles',
      a: f.a, b: f.b,
      onSubmit: async (s1, s2, detail) => {
        const res = await api.post(`/events/${ev.id}/fixtures/${f.id}/result`, { s1, s2, detail });
        onChange?.();
        return res;
      },
    });
  });
  $$('[data-move]', el).forEach((sel) => sel.onchange = async () => {
    try {
      const to = Number(sel.value);
      if (to === 0) {
        if (!confirm('Remove this player from tonight? Their unplayed fixtures are dropped; results stay.')) return renderBoard(el, ev, { onChange });
        await api.del(`/events/${ev.id}/tables/${sel.dataset.move}`);
      } else await api.post(`/events/${ev.id}/tables/assign`, { user_id: Number(sel.dataset.move), table_no: to });
      toast('Tables updated');
      onChange?.();
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#keen', el)?.addEventListener('click', async () => {
    try {
      await api.patch('/users/me', { doubles_keen: !keen });
      state.me.doubles_keen = !keen;
      toast(!keen ? "You're in the doubles pool 👥" : 'Left the doubles pool');
      onChange?.();
    } catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-pair]', el).forEach((btn) => btn.onclick = async () => {
    if (btn.dataset.pair === 'reshuffle' && !confirm('Re-pair everyone who has not played doubles yet?')) return;
    try {
      await api.post(`/events/${ev.id}/doubles/pair`, { mode: btn.dataset.pair });
      toast('Pairs made — fixtures updated');
      onChange?.();
    } catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-unpair]', el).forEach((btn) => btn.onclick = async () => {
    try { await api.del(`/events/${ev.id}/doubles/pairs/${btn.dataset.unpair}`); onChange?.(); } catch (e) { toast(e.message, 'error'); }
  });
  $('#add-pair', el)?.addEventListener('click', () => pickPair(ev, onChange));
  $('#walkin', el)?.addEventListener('click', () => openWalkIn(ev, b, onChange));
  $('#mk-teams', el)?.addEventListener('click', async () => {
    const n = Number(prompt('How many teams?', '2'));
    if (!n) return;
    try { await api.post(`/events/${ev.id}/teams`, { count: n }); toast('Teams picked — balanced by rating'); onChange?.(); } catch (e) { toast(e.message, 'error'); }
  });
  $('#clear-teams', el)?.addEventListener('click', async () => {
    if (!confirm('Remove the teams for tonight?')) return;
    try { await api.del(`/events/${ev.id}/teams`); onChange?.(); } catch (e) { toast(e.message, 'error'); }
  });
  return b;
}

async function pickPair(ev, onChange) {
  const { pool } = await api.get(`/doubles/pool?event=${ev.id}`);
  const { users } = await api.get('/users');
  const keenIds = new Set(pool.map((p) => p.user.id));
  const sorted = [...users].sort((a, b) => keenIds.has(b.id) - keenIds.has(a.id) || a.name.localeCompare(b.name));
  const opts = sorted.map((u) => html`<option value="${u.id}">${displayName(u)}${keenIds.has(u.id) ? ' 👥' : ''}</option>`);
  const body = openModal(html`<h2 class="sheet-title">Pick a doubles pair</h2>
    <form class="form" id="pp"><label class="field"><span>Player 1</span><select name="a">${opts}</select></label>
    <label class="field"><span>Player 2</span><select name="b">${opts}</select></label>
    <button class="btn btn-block">Add pair</button></form>`.s);
  $('#pp', body).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/events/${ev.id}/doubles/pairs`, { user1_id: Number(e.target.a.value), user2_id: Number(e.target.b.value) });
      closeModal();
      onChange?.();
    } catch (err) { toast(err.message, 'error'); }
  };
}

// Organiser adds someone on the night: an existing member, or a quick new account for a walk-in.
async function openWalkIn(ev, b, onChange) {
  const { users } = await api.get('/users');
  const placed = new Set(b.tables.flatMap((t) => t.players.map((u) => u.id)));
  const free = users.filter((u) => !placed.has(u.id));
  const tables = b.tables.map((t) => html`<option value="${t.no}">Table ${t.no} (${LEVEL_LABEL[t.level]})</option>`);
  const body = openModal(html`<h2 class="sheet-title">Add a player tonight</h2>
    <form class="form" id="wi-existing">
      <label class="field"><span>Member</span><select name="user">${free.map((u) => html`<option value="${u.id}">${displayName(u)} · ${LEVEL_LABEL[u.skill] || ''}</option>`)}</select></label>
      <label class="field"><span>Table</span><select name="table"><option value="">Auto (by skill level)</option>${tables}</select></label>
      <button class="btn btn-block" ${free.length ? '' : 'disabled'}>Add to table</button>
    </form>
    <h3 class="mini-title" style="margin-top:20px">Or a new walk-in</h3>
    <form class="form" id="wi-new">
      <label class="field"><span>Name</span><input name="name" required maxlength="60"></label>
      <div class="row2">
        <label class="field"><span>Mobile (optional)</span><input name="phone" type="tel" inputmode="tel"></label>
        <label class="field"><span>Level</span><select name="skill">${state.config.levels.map((l) => html`<option value="${l}" ${l === 'intermediate' ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`)}</select></label>
      </div>
      <button class="btn btn-block ghost">Create & add</button>
      <p class="hint small">They get a temporary password you can share, and can add their email later.</p>
    </form>`.s);
  $('#wi-existing', body).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/events/${ev.id}/tables/assign`, { user_id: Number(e.target.user.value), table_no: Number(e.target.table.value) || null });
      closeModal();
      toast(`Added to table ${r.table}`);
      onChange?.();
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#wi-new', body).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(e.target));
      const { user, temporary_password } = await api.post('/admin/users', data);
      const r = await api.post(`/events/${ev.id}/tables/assign`, { user_id: user.id });
      invalidatePlayers();
      closeModal();
      onChange?.();
      alert(`${user.name} is on table ${r.table}.${data.phone ? `\n\nThey can sign in with ${data.phone} and the temporary password: ${temporary_password}` : ''}`);
    } catch (err) { toast(err.message, 'error'); }
  };
}

