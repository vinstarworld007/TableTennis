import { api } from '../api.js';
import { state, navigate, requireLogin } from '../app.js';
import { html, ico, $, $$, avatar, displayName, skeleton, empty, toast, openModal, closeModal, niceDate, live } from '../ui.js';
import { openScoreEntry } from './shared.js';

const STATUS = { open: ['Entries open', 'chip-live'], running: ['In progress', 'chip-gold'], done: ['Finished', 'chip'] };

export async function renderList({ el, isCurrent }) {
  el.innerHTML = skeleton(4).s;
  const { tournaments } = await api.get('/tournaments');
  if (!isCurrent()) return;
  const isAdmin = state.me?.role === 'admin';
  el.innerHTML = html`
    <a class="back-link" href="#/leaderboard">${ico('back', 18)} Leaderboard</a>
    <div class="page-head"><h1>Tournaments</h1>${isAdmin ? html`<button class="btn btn-sm" id="new-t">${ico('plus', 18)} New</button>` : ''}</div>
    <div class="card list">${tournaments.length ? tournaments.map((t) => {
      const [label, cls] = STATUS[t.status];
      return html`<a class="list-row" href="#/tournaments/${t.id}">
        <span class="big-emoji">${t.status === 'done' ? '🏆' : t.game.emoji}</span>
        <div class="grow"><b>${t.name}</b><small>${t.game.name} · ${t.entrants} players${t.event ? ` · ${niceDate(t.event.date, { day: 'numeric', month: 'short' })}` : ''}${t.winner ? ` · Winner: ${displayName(t.winner)}` : ''}</small></div>
        <span class="chip ${cls}">${label}</span>${ico('chevron', 18)}</a>`;
    }) : empty('🏆', 'No tournaments yet', isAdmin ? 'Create a knockout cup for a club night.' : 'Organisers will announce knockout cups here.')}</div>`.s;
  $('#new-t', el)?.addEventListener('click', openCreate);
}

async function openCreate() {
  const games = state.config.games.filter((g) => g.team_size === 1);
  const { events } = await api.get('/events?when=upcoming');
  const body = openModal(html`<h2 class="sheet-title">New knockout tournament</h2>
    <form class="form" id="tf">
      <label class="field"><span>Name</span><input name="name" required maxlength="80" placeholder="e.g. Autumn Cup"></label>
      <label class="field"><span>Game</span><select name="game_id">${games.map((g) => html`<option value="${g.id}">${g.emoji} ${g.name}</option>`)}</select></label>
      <label class="field"><span>Club night (optional)</span><select name="event_id"><option value="">Not tied to a night</option>
        ${events.map((e) => html`<option value="${e.id}">${niceDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${e.title}</option>`)}</select></label>
      <label class="check"><input type="checkbox" name="add_attendees"> Enter everyone already checked in that night</label>
      <button class="btn btn-block">Create</button>
      <p class="hint small">Players join from the tournament page. When you start it, the draw is seeded by rating and top seeds get byes.</p>
    </form>`.s);
  $('#tf', body).onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.add_attendees = e.target.add_attendees.checked;
    try {
      const { tournament } = await api.post('/tournaments', d);
      closeModal();
      navigate(`/tournaments/${tournament.id}`);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function bracket(t) {
  const me = state.me;
  const isAdmin = me?.role === 'admin';
  const total = t.rounds.length;
  const roundName = (i) => (i === total - 1 ? 'Final' : i === total - 2 ? 'Semi-finals' : i === total - 3 ? 'Quarter-finals' : `Round ${i + 1}`);
  const slot = (p, s, won, m) => html`<div class="bk-player ${won ? 'won' : ''} ${p && me?.id === p.id ? 'me' : ''}">
    ${p ? html`${avatar(p, 22)}<span class="bk-name">${displayName(p)}</span>${p.seed ? html`<small>${p.seed}</small>` : ''}` : html`<span class="bk-name muted">TBC</span>`}
    <b>${m.bye && p ? html`<small>bye</small>` : s ?? ''}</b></div>`;
  return html`<div class="bracket scroll-x">${t.rounds.map((round, i) => html`<div class="bk-round">
    <h4 class="mini-title">${roundName(i)}</h4>
    <div class="bk-matches">${round.map((m) => {
      const ready = t.status === 'running' && m.p1 && m.p2 && !m.winner_id;
      const mine = me && (isAdmin || [m.p1?.id, m.p2?.id].includes(me.id));
      return html`<div class="bk-match ${ready ? 'ready' : ''} ${m.bye ? 'bye' : ''}">
        ${slot(m.p1, m.s1, m.winner_id && m.winner_id === m.p1?.id, m)}
        ${slot(m.p2, m.s2, m.winner_id && m.winner_id === m.p2?.id, m)}
        ${ready && mine ? html`<button class="btn btn-sm bk-enter" data-tm="${m.id}">Enter result</button>` : ''}
      </div>`;
    })}</div>
  </div>`)}</div>`;
}

export async function renderDetail({ el, params, isCurrent }) {
  const id = Number(params[0]);
  el.innerHTML = skeleton(5).s;
  let stop = null;
  const load = async () => {
    const { tournament: t } = await api.get(`/tournaments/${id}`);
    if (!isCurrent()) return;
    const me = state.me;
    const isAdmin = me?.role === 'admin';
    const [label, cls] = STATUS[t.status];
    el.innerHTML = html`
      <a class="back-link" href="#/tournaments">${ico('back', 18)} Tournaments</a>
      <section class="card hero">
        <span class="chip ${cls}">${label}</span>
        <h1>${t.name}</h1>
        <div class="hero-meta"><span>${t.game.emoji} ${t.game.name}</span><span>${ico('users', 16)} ${t.entries.length} players</span>
          ${t.event_id ? html`<a href="#/events/${t.event_id}">${ico('calendar', 16)} Club night</a>` : ''}</div>
        ${t.winner ? html`<div class="champion">${avatar(t.winner, 64)}<div><small>Champion</small><b>🏆 ${displayName(t.winner)}</b></div></div>` : ''}
        <div class="row-actions" style="margin-top:14px">
          ${t.status === 'open' && me ? html`<button class="btn ${t.joined ? 'btn-on' : ''}" id="join">${t.joined ? html`${ico('check', 18)} You're in` : 'Enter tournament'}</button>` : ''}
          ${t.status === 'open' && isAdmin ? html`<button class="btn ghost" id="add-p">Add players</button><button class="btn ghost" id="start" ${t.entries.length < 2 ? 'disabled' : ''}>Make the draw & start</button>` : ''}
          ${isAdmin ? html`<button class="btn ghost danger btn-sm" id="del">Delete</button>` : ''}
        </div>
      </section>
      ${t.rounds.length ? html`<h2 class="section-title">Bracket</h2>${bracket(t)}` : ''}
      <h2 class="section-title">Players <small>${t.entries.length}</small></h2>
      <div class="card">${t.entries.length ? html`<div class="people">${t.entries.map((e) => html`<a href="#/players/${e.user.id}" class="person">${avatar(e.user, 44)}<span>${e.seed ? `${e.seed}. ` : ''}${displayName(e.user)}</span></a>`)}</div>` : html`<p class="hint">No entries yet.</p>`}</div>
    `.s;
    $('#join', el)?.addEventListener('click', async () => {
      if (!requireLogin()) return;
      try { await api.post(`/tournaments/${id}/${t.joined ? 'leave' : 'join'}`); load(); } catch (e) { toast(e.message, 'error'); }
    });
    $('#start', el)?.addEventListener('click', async () => {
      if (!confirm(`Start with ${t.entries.length} players? Entries close and the draw is made.`)) return;
      try { await api.post(`/tournaments/${id}/start`); toast('The draw is made! 🎲'); load(); } catch (e) { toast(e.message, 'error'); }
    });
    $('#del', el)?.addEventListener('click', async () => {
      if (!confirm('Delete this tournament? Match results stay in players\' records.')) return;
      await api.del(`/tournaments/${id}`);
      navigate('/tournaments');
    });
    $('#add-p', el)?.addEventListener('click', async () => {
      const { users } = await api.get('/users');
      const inIds = new Set(t.entries.map((e) => e.user.id));
      const body = openModal(html`<h2 class="sheet-title">Add players</h2><div class="picker-list tall">${users.filter((u) => !inIds.has(u.id)).map((u) => html`<button class="picker-item" data-add="${u.id}">${avatar(u, 32)}<span>${displayName(u)}</span></button>`)}</div>`.s);
      $$('[data-add]', body).forEach((b) => b.onclick = async () => {
        try { await api.post(`/tournaments/${id}/join`, { user_id: Number(b.dataset.add) }); b.remove(); } catch (e) { toast(e.message, 'error'); }
      });
    });
    $$('[data-tm]', el).forEach((b) => b.onclick = () => {
      const m = t.rounds.flat().find((x) => x.id === Number(b.dataset.tm));
      openScoreEntry({
        title: t.name, a: [m.p1], b: [m.p2], label: t.game.score_label,
        onSubmit: async (s1, s2, detail) => {
          const res = await api.post(`/tournaments/${id}/matches/${m.id}/result`, { s1, s2, detail });
          load();
          return res;
        },
      });
    });
    if (!stop && t.event_id) stop = live(`/api/events/${t.event_id}/stream`, () => isCurrent() && load());
  };
  await load();
  return () => stop?.();
}
