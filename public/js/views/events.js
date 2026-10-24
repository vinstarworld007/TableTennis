import { api } from '../api.js';
import { state, requireLogin, navigate } from '../app.js';
import {
  html, ico, $, $$, avatar, live, displayName, niceDate, niceTime, skeleton, empty, toast, openModal, closeModal,
} from '../ui.js';
import { matchItem, bindMatchDeletes, podiumBlock, openLogMatch, shareLink } from './shared.js';
import { mediaGrid, bindMediaGrid, openUpload } from './gallery.js';
import { renderBoard } from './board.js';

const STATUS = {
  upcoming: ['Upcoming', 'chip'],
  live: ['Tonight', 'chip-live'],
  finalised: ['Results final', 'chip-gold'],
  cancelled: ['Cancelled', 'chip-danger'],
};

export function eventHero(ev, { link = false } = {}) {
  const [y, m, d] = ev.date.split('-').map(Number);
  const month = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' });
  const [label, cls] = STATUS[ev.status] || STATUS.upcoming;
  const isPast = ev.status === 'finalised';
  const canAct = ev.status !== 'cancelled' && !isPast;
  const going = ev.my_status === 'going';
  const here = ev.my_status === 'here';
  return html`<section class="hero card">
    <div class="hero-top">
      <div class="date-block"><span>${month}</span><b>${d}</b></div>
      <div class="hero-info">
        <span class="chip ${cls}">${ev.is_today && ev.status !== 'cancelled' ? html`<i class="pulse"></i>` : ''}${label}</span>
        ${link ? html`<a href="#/events/${ev.id}"><h1>${ev.title}</h1></a>` : html`<h1>${ev.title}</h1>`}
        <div class="hero-meta">
          <span>${ico('calendar', 16)} ${niceDate(ev.date)}</span>
          ${ev.start_time ? html`<span>${ico('clock', 16)} ${niceTime(ev.start_time)}</span>` : ''}
          ${ev.location ? html`<span>${ico('pin', 16)} ${ev.location}</span>` : ''}
        </div>
      </div>
    </div>
    ${ev.description ? html`<p class="hero-desc">${ev.description}</p>` : ''}
    <div class="hero-stats">
      <div><b>${ev.here}</b><span>here</span></div>
      <div><b>${ev.going}</b><span>going</span></div>
      <div><b>${ev.matches}</b><span>matches</span></div>
      <div><b>${ev.media}</b><span>photos</span></div>
    </div>
    <div class="hero-actions">
      ${canAct && ev.is_today ? html`<button class="btn ${here ? 'btn-on' : ''}" data-rsvp="${here ? 'none' : 'here'}">${here ? html`${ico('check', 18)} You're checked in` : "I'm here — check in"}</button>` : ''}
      ${canAct && !ev.is_today ? html`<button class="btn ${going ? 'btn-on' : ''}" data-rsvp="${going ? 'none' : 'going'}">${going ? html`${ico('check', 18)} You're going` : "I'm going"}</button>` : ''}
      <button class="icon-btn ghost" data-share title="Share">${ico('share')}</button>
      <a class="icon-btn ghost" href="/api/events/${ev.id}/calendar.ics" title="Add to calendar">${ico('calendar')}</a>
    </div>
  </section>`;
}

export function bindHero(root, ev, onChange) {
  $$('[data-rsvp]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!requireLogin('Sign in to RSVP.')) return;
    b.disabled = true;
    try {
      if (b.dataset.rsvp === 'none') await api.del(`/events/${ev.id}/attendance`);
      else await api.post(`/events/${ev.id}/attendance`, { status: b.dataset.rsvp });
      toast(b.dataset.rsvp === 'here' ? 'Checked in. Good luck tonight!' : b.dataset.rsvp === 'going' ? 'See you there!' : 'Updated');
      onChange?.();
    } catch (e) {
      toast(e.message, 'error');
      b.disabled = false;
    }
  }));
  $('[data-share]', root)?.addEventListener('click', () =>
    shareLink(`${location.origin}/#/events/${ev.id}`, `${ev.title} — ${niceDate(ev.date)}`));
}

export async function renderList({ el, isCurrent }) {
  el.innerHTML = skeleton(4).s;
  const [up, past] = await Promise.all([api.get('/events?when=upcoming'), api.get('/events?when=past')]);
  if (!isCurrent()) return;
  const isAdmin = state.me?.role === 'admin';
  const row = (e) => {
    const [label, cls] = STATUS[e.status] || STATUS.upcoming;
    const [y, m, d] = e.date.split('-').map(Number);
    return html`<a class="list-row event-row" href="#/events/${e.id}">
      <div class="date-block small"><span>${new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short' })}</span><b>${d}</b></div>
      <div class="grow"><b>${e.title}</b><small>${niceDate(e.date, { weekday: 'long' })}${e.start_time ? ` · ${niceTime(e.start_time)}` : ''} · ${e.status === 'finalised' ? `${e.matches} matches` : `${e.going + e.here} going`}</small></div>
      ${e.my_status ? html`<span class="chip chip-live">${e.my_status === 'here' ? 'Attended' : 'Going'}</span>` : html`<span class="chip ${cls}">${label}</span>`}
      ${ico('chevron', 18)}
    </a>`;
  };
  el.innerHTML = html`
    <div class="page-head"><h1>Club nights</h1>${isAdmin ? html`<button class="btn btn-sm" id="new-ev">${ico('plus', 18)} New night</button>` : ''}</div>
    <h2 class="section-title">Coming up</h2>
    <div class="card list">${up.events.length ? up.events.map(row) : empty('📅', 'No nights scheduled yet')}</div>
    <h2 class="section-title">Past nights</h2>
    <div class="card list">${past.events.length ? past.events.map(row) : empty('🕰️', 'No past nights yet', 'Results and podiums will appear here after each night.')}</div>
  `.s;
  $('#new-ev')?.addEventListener('click', () => openEventForm());
}

export function openEventForm(ev = null, onSaved) {
  const c = state.config;
  const body = openModal(html`<h2 class="sheet-title">${ev ? 'Edit night' : 'New night'}</h2>
    <form id="ev-form" class="form">
      <label class="field"><span>Title</span><input name="title" required maxlength="100" value="${ev?.title || c.app_name}"></label>
      <div class="row2">
        <label class="field"><span>Date</span><input name="date" type="date" required value="${ev?.date || ''}"></label>
        <label class="field"><span>Start time</span><input name="start_time" type="time" value="${ev?.start_time || '19:00'}"></label>
      </div>
      <label class="field"><span>Location</span><input name="location" maxlength="200" value="${ev?.location ?? c.location ?? ''}"></label>
      <label class="field"><span>Details</span><textarea name="description" rows="3" maxlength="2000">${ev?.description || ''}</textarea></label>
      <button class="btn btn-block">${ev ? 'Save changes' : 'Create night'}</button>
    </form>`.s);
  $('#ev-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      const res = ev ? await api.patch(`/events/${ev.id}`, data) : await api.post('/events', data);
      closeModal();
      toast('Saved', 'success');
      if (onSaved) onSaved(res.event);
      else navigate(`/events/${res.event.id}`);
    } catch (err) { toast(err.message, 'error'); }
  });
}

export async function renderDetail({ el, params, isCurrent }) {
  const id = Number(params[0]);
  el.innerHTML = skeleton(5).s;
  let stopLive = null;

  const load = async () => {
    const [data, media] = await Promise.all([api.get(`/events/${id}`), api.get(`/media?event=${id}`)]);
    if (!isCurrent()) return;
    const { event: ev, people, matches, podium } = data;
    const isAdmin = state.me?.role === 'admin';
    const here = people.filter((p) => p.status === 'here');
    const going = people.filter((p) => p.status === 'going');
    const canLog = ev.status !== 'cancelled' && (ev.status !== 'finalised' || isAdmin);
    el.innerHTML = html`
      <a class="back-link" href="#/events">${ico('back', 18)} All nights</a>
      ${eventHero(ev)}
      ${canLog && (ev.is_today || isAdmin) ? html`<button class="btn btn-block btn-lg cta" id="log">${ico('plus')} Log a match</button>` : ''}
      ${isAdmin ? html`<div class="admin-bar">
        <span>Admin</span>
        <button class="btn btn-sm ghost" id="ev-edit">Edit</button>
        ${ev.status !== 'cancelled' && matches.length ? html`<button class="btn btn-sm ghost" id="ev-final">${ev.status === 'finalised' ? 'Recalculate medals' : 'Finalise & award medals'}</button>` : ''}
        ${ev.status !== 'finalised' ? html`<button class="btn btn-sm ghost" id="ev-cancel">${ev.status === 'cancelled' ? 'Restore night' : 'Cancel night'}</button>` : ''}
      </div>` : ''}
      ${ev.status !== 'cancelled' ? html`<div id="board"></div>` : ''}
      ${podium.length ? html`<h2 class="section-title">${ev.status === 'finalised' ? 'Podium' : 'Standings so far'}</h2>
        <div class="podium-grid">${podium.map((p) => podiumBlock(p))}</div>` : ''}
      <h2 class="section-title">Results <small>${matches.length}</small></h2>
      ${matches.length ? html`<ul class="card match-list">${matches.map((m) => matchItem(m, { onDelete: true }))}</ul>`
        : html`<div class="card">${empty('🏓', 'No results yet', ev.is_today ? 'Played a match? Log it and climb the standings.' : 'Results logged on the night show up here.')}</div>`}
      <h2 class="section-title">Players <small>${here.length + going.length}</small></h2>
      <div class="card">
        ${here.length ? html`<h3 class="mini-title">Here${ev.status === 'finalised' ? '' : ' now'}</h3><div class="people">${here.map((p) => html`<a href="#/players/${p.user.id}" class="person">${avatar(p.user, 44)}<span>${displayName(p.user)}</span></a>`)}</div>` : ''}
        ${going.length ? html`<h3 class="mini-title">Going</h3><div class="people">${going.map((p) => html`<a href="#/players/${p.user.id}" class="person">${avatar(p.user, 44)}<span>${displayName(p.user)}</span></a>`)}</div>` : ''}
        ${!here.length && !going.length ? html`<p class="hint">Nobody yet. Be the first!</p>` : ''}
      </div>
      <div class="section-title-row"><h2 class="section-title">Photos & videos <small>${media.media.length}</small></h2>
        ${state.me ? html`<button class="btn btn-sm ghost" id="ev-upload">${ico('upload', 18)} Add</button>` : ''}</div>
      ${media.media.length ? mediaGrid(media.media) : html`<div class="card">${empty('📸', 'No photos yet', 'Share the best moments from this night.')}</div>`}
    `.s;
    bindHero(el, ev, load);
    bindMatchDeletes(el, load);
    bindMediaGrid(el, media.media, load);
    $('#log', el)?.addEventListener('click', () => openLogMatch({ eventId: ev.id, here: here.map((p) => p.user), onDone: load }));
    $('#ev-upload', el)?.addEventListener('click', () => openUpload({ eventId: ev.id, onDone: load }));
    $('#ev-edit', el)?.addEventListener('click', () => openEventForm(ev, load));
    $('#ev-final', el)?.addEventListener('click', async () => {
      if (!confirm('Lock in tonight\'s podium and award medals?')) return;
      try {
        await api.post(`/events/${ev.id}/finalise`);
        toast('Medals awarded! 🥇🥈🥉', 'success');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
    $('#ev-cancel', el)?.addEventListener('click', async () => {
      const cancel = ev.status !== 'cancelled';
      if (cancel && !confirm('Cancel this night? Members will see it as cancelled.')) return;
      try {
        await api.post(`/events/${ev.id}/cancel`, { cancel });
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
    const boardEl = $('#board', el);
    if (boardEl) await renderBoard(boardEl, ev, { onChange: load });
    if (!stopLive && ev.status !== 'finalised') stopLive = live(`/api/events/${ev.id}/stream`, () => isCurrent() && load().catch(() => {}));
  };
  await load();
  return () => stopLive?.();
}

