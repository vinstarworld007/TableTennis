import { api } from '../api.js';
import { state, requireLogin } from '../app.js';
import { html, ico, $, avatar, displayName, skeleton, empty, toast, levelChip } from '../ui.js';

// Everyone keen on doubles, so players know who to ask and organisers can pair them on the night.
export async function render({ el, isCurrent }) {
  el.innerHTML = skeleton(4).s;
  const load = async () => {
    const cur = (await api.get('/events/current')).event;
    const { pool } = await api.get(`/doubles/pool${cur ? `?event=${cur.id}` : ''}`);
    if (!isCurrent()) return;
    const me = state.me;
    const keen = !!me?.doubles_keen;
    const coming = pool.filter((p) => p.status);
    el.innerHTML = html`
      <div class="page-head"><h1>Doubles pool</h1></div>
      <div class="card doubles-intro">
        <p>Keen on doubles? Join the pool. On club night, keen players who are there get paired up with a balanced partner
        (strongest with least experienced), and every pair plays every other pair.</p>
        <button class="btn ${keen ? 'btn-on' : ''}" id="toggle">${keen ? html`${ico('check', 18)} You're in the pool` : "I'm keen — add me"}</button>
      </div>
      ${cur ? html`<h2 class="section-title">Coming ${cur.is_today ? 'tonight' : 'next night'} <small>${coming.length}</small></h2>
        <div class="card list">${coming.length ? coming.map((p) => row(p)) : empty('👥', 'Nobody keen has RSVP\'d yet')}</div>
        ${cur.is_today ? html`<a class="more-link" href="#/events/${cur.id}">See tonight's doubles pairs ${ico('chevron', 16)}</a>` : ''}` : ''}
      <h2 class="section-title">Everyone in the pool <small>${pool.length}</small></h2>
      <div class="card list">${pool.length ? pool.map((p) => row(p)) : empty('👥', 'The pool is empty', 'Be the first to say you\'re keen.')}</div>
    `.s;
    $('#toggle', el).onclick = async () => {
      if (!requireLogin('Sign in to join the doubles pool.')) return;
      try {
        await api.patch('/users/me', { doubles_keen: !keen });
        state.me.doubles_keen = !keen;
        toast(!keen ? "You're in the doubles pool 👥" : 'Removed from the pool');
        load();
      } catch (e) { toast(e.message, 'error'); }
    };
  };
  const row = (p) => html`<a class="list-row" href="#/players/${p.user.id}">${avatar(p.user, 38)}
    <div class="grow"><b>${displayName(p.user)}</b><small>Doubles ${p.doubles_rating} · Singles ${p.singles_rating}${p.status ? ` · ${p.status === 'here' ? 'here now' : 'going'}` : ''}</small></div>
    ${levelChip(p.user.skill)}</a>`;
  await load();
}
