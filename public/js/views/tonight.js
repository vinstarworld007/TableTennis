import { api } from '../api.js';
import { state } from '../app.js';
import { html, ico, $, avatar, displayName, skeleton, empty, niceDate, live } from '../ui.js';
import { matchItem, bindMatchDeletes, podiumBlock, openLogMatch, shareLink } from './shared.js';
import { eventHero, bindHero } from './events.js';
import { mediaGrid, bindMediaGrid, openUpload } from './gallery.js';
import { renderBoard } from './board.js';

export function potmCard(potm) {
  const cur = potm?.current;
  const last = potm?.past?.[0];
  if (!cur && !last) return '';
  const monthName = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long' });
  return html`<a class="card potm" href="#/players/${(cur || last).user.id}">
    <span class="potm-star">🌟</span>
    <div class="grow">
      <small>${cur ? `Player of the month race · ${monthName(cur.month)}` : `Player of the month · ${monthName(last.month)}`}</small>
      <b>${displayName((cur || last).user)}</b>
      <small>${cur ? `+${cur.elo_gain} rating this month · ${cur.wins}W from ${cur.played}` : `+${last.elo_gain} rating`}</small>
    </div>
    ${avatar((cur || last).user, 48)}
  </a>`;
}

export async function render({ el, isCurrent }) {
  el.innerHTML = skeleton(5).s;
  let stopLive = null;
  let liveFor = null;

  const load = async () => {
    const cur = await api.get('/events/current');
    const ev = cur.event;
    const [detail, featured, potm] = await Promise.all([
      ev ? api.get(`/events/${ev.id}`) : null,
      api.get('/media?featured=1'),
      api.get('/leaderboard/potm'),
    ]);
    if (!isCurrent()) return;
    const c = state.config;
    const me = state.me;
    const here = detail ? detail.people.filter((p) => p.status === 'here') : [];
    const live_ = ev?.is_today && ev.status !== 'cancelled';
    const upcoming = ev && ev.status === 'upcoming';

    el.innerHTML = html`
      ${!me ? html`<section class="welcome card">
        <div class="welcome-ball"></div>
        <h1>${c.app_name}</h1>
        <p>${c.tagline}</p>
        <p class="hint">Get your table and fixtures on the night, track your wins and collect medals every week.</p>
        <div class="row-actions"><a class="btn" href="#/signup">Join the club</a><a class="btn ghost" href="#/login">Sign in</a></div>
      </section>` : html`<div class="greeting"><h1>Hey ${displayName(me)} 👋</h1><p>${live_ ? "It's club night. Go get 'em!" : ev ? `Next up: ${niceDate(ev.date)}` : c.tagline}</p></div>`}

      ${ev ? eventHero(ev, { link: true }) : html`<div class="card">${empty('📅', 'No nights scheduled', 'An admin can add the next club night.')}</div>`}

      ${live_ ? html`<button class="btn btn-block btn-lg cta" id="log">${ico('plus')} Log a match</button>` : ''}

      ${ev && (live_ || upcoming) ? html`<div id="board"></div>` : ''}

      ${live_ && detail.podium.length ? html`<h2 class="section-title">Tonight's standings</h2>
        <div class="podium-grid">${detail.podium.map((p) => podiumBlock(p, { compact: true }))}</div>` : ''}

      ${live_ && here.length ? html`<h2 class="section-title">Here tonight <small>${here.length}</small></h2>
        <div class="card"><div class="people scroll-x">${here.map((p) => html`<a href="#/players/${p.user.id}" class="person">${avatar(p.user, 44)}<span>${displayName(p.user)}</span></a>`)}</div></div>` : ''}

      ${live_ ? html`<h2 class="section-title">Latest results</h2>
        ${detail.matches.length ? html`<ul class="card match-list">${detail.matches.slice(0, 10).map((m) => matchItem(m, { onDelete: true }))}</ul>
          ${detail.matches.length > 10 ? html`<a class="more-link" href="#/events/${ev.id}">See all ${detail.matches.length} results ${ico('chevron', 16)}</a>` : ''}`
        : html`<div class="card">${empty('🏓', 'No results yet tonight', 'Finished a match? Enter the score on your table or log it above.')}</div>`}` : ''}

      ${potmCard(potm)}

      ${cur.last?.podium?.length ? html`<div class="section-title-row"><h2 class="section-title">Last week's champions</h2>
          <a class="more-link" href="#/events/${cur.last.id}">${niceDate(cur.last.date, { day: 'numeric', month: 'short' })} ${ico('chevron', 16)}</a></div>
        <div class="podium-grid">${cur.last.podium.map((p) => podiumBlock(p, { compact: true }))}</div>` : ''}

      ${featured.media.length ? html`<div class="section-title-row"><h2 class="section-title">Best of the club</h2><a class="more-link" href="#/gallery">Gallery ${ico('chevron', 16)}</a></div>
        ${mediaGrid(featured.media.slice(0, 6))}` : ''}

      <div class="row-actions quick-links">
        <a class="btn ghost btn-sm" href="#/tournaments">🏆 Tournaments</a>
        <a class="btn ghost btn-sm" href="#/doubles">👥 Doubles pool</a>
        ${me ? html`<button class="btn ghost btn-sm" id="invite">${ico('share', 16)} Invite a friend</button>` : ''}
        ${live_ && me ? html`<button class="btn ghost btn-sm" id="share-photo">${ico('upload', 16)} Share a photo</button>` : ''}
      </div>
    `.s;

    if (ev) bindHero(el, ev, load);
    bindMatchDeletes(el, load);
    bindMediaGrid(el, featured.media.slice(0, 6), load);
    const boardEl = $('#board', el);
    if (boardEl) await renderBoard(boardEl, ev, { onChange: load });
    $('#log', el)?.addEventListener('click', () => openLogMatch({ eventId: ev.id, here: here.map((p) => p.user), onDone: load }));
    $('#share-photo', el)?.addEventListener('click', () => openUpload({ eventId: ev.id, onDone: load }));
    $('#invite', el)?.addEventListener('click', () => shareLink(`${location.origin}/#/signup`, `Join ${c.app_name}`));

    if (ev && liveFor !== ev.id) {
      stopLive?.();
      liveFor = ev.id;
      stopLive = live(`/api/events/${ev.id}/stream`, () => isCurrent() && load().catch(() => {}));
    }
  };

  await load();
  return () => stopLive?.();
}
