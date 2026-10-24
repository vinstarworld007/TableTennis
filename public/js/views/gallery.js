import { api } from '../api.js';
import { state, requireLogin } from '../app.js';
import {
  html, ico, $, $$, avatar, displayName, niceDate, timeAgo, skeleton, empty, toast, openModal, closeModal, shrinkImage,
} from '../ui.js';
import { showNewBadges } from './shared.js';

export function mediaGrid(items) {
  return html`<div class="media-grid">${items.map((m, i) => html`<button class="media-tile" data-media="${i}">
    ${m.kind === 'video'
      ? html`${m.poster ? html`<img src="${m.poster}" alt="" loading="lazy">` : html`<video src="${m.url}#t=0.5" preload="metadata" muted playsinline></video>`}<span class="media-play">${ico('play', 26)}</span>`
      : html`<img src="${m.url}" alt="${m.caption || ''}" loading="lazy">`}
    ${m.featured ? html`<span class="media-star" title="Best of">${ico('star', 16)}</span>` : ''}
    ${m.status === 'pending' ? html`<span class="media-flag">Awaiting approval</span>` : m.processing ? html`<span class="media-flag">Processing…</span>` : ''}
    ${m.likes ? html`<span class="media-likes">${ico('heart', 14)} ${m.likes}</span>` : ''}
  </button>`)}</div>`;
}

export function bindMediaGrid(root, items, onChange) {
  $$('[data-media]', root).forEach((tile) => tile.addEventListener('click', () => openViewer(items, Number(tile.dataset.media), onChange)));
}

function openViewer(items, index, onChange) {
  let i = index;
  const body = openModal('<div id="viewer"></div>', { wide: true, onClose: () => changed && onChange?.() });
  let changed = false;
  const root = $('#viewer', body);
  const draw = () => {
    const m = items[i];
    const me = state.me;
    const canDelete = me && (me.role === 'admin' || me.id === m.user?.id);
    root.innerHTML = html`
      <div class="viewer-stage">
        ${m.kind === 'video' ? html`<video src="${m.url}" ${m.poster ? html`poster="${m.poster}"` : ''} controls playsinline autoplay></video>` : html`<img src="${m.url}" alt="${m.caption || ''}">`}
        ${items.length > 1 ? html`<button class="viewer-nav prev" data-nav="-1" aria-label="Previous">${ico('back')}</button>
          <button class="viewer-nav next" data-nav="1" aria-label="Next">${ico('chevron')}</button>` : ''}
      </div>
      <div class="viewer-info">
        <div class="viewer-who">
          ${m.user ? html`<a href="#/players/${m.user.id}" class="player-link">${avatar(m.user, 32)}<span>${displayName(m.user)}</span></a>` : ''}
          <small>${m.event_date ? html`<a href="#/events/${m.event_id}">${niceDate(m.event_date, { day: 'numeric', month: 'short' })}</a> · ` : ''}${timeAgo(m.created_at)}</small>
        </div>
        ${m.caption ? html`<p>${m.caption}</p>` : ''}
        <div class="viewer-actions">
          <button class="btn btn-sm ${m.liked ? 'btn-on' : 'ghost'}" data-like>${ico('heart', 18)} ${m.likes || ''}</button>
          ${me?.role === 'admin' ? html`<button class="btn btn-sm ${m.featured ? 'btn-on' : 'ghost'}" data-feature>${ico('star', 18)} ${m.featured ? 'Best of' : 'Feature'}</button>` : ''}
          <a class="btn btn-sm ghost" href="${m.url}" download>Save</a>
          ${canDelete ? html`<button class="btn btn-sm ghost danger" data-delete>${ico('trash', 18)}</button>` : ''}
        </div>
      </div>`.s;
    $$('[data-nav]', root).forEach((b) => b.onclick = () => { i = (i + Number(b.dataset.nav) + items.length) % items.length; draw(); });
    $('[data-like]', root).onclick = async () => {
      if (!requireLogin('Sign in to like photos.')) return;
      try {
        const res = m.liked ? await api.del(`/media/${m.id}/like`) : await api.post(`/media/${m.id}/like`);
        items[i] = res.media;
        changed = true;
        draw();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('[data-feature]', root)?.addEventListener('click', async () => {
      try {
        items[i] = (await api.patch(`/media/${m.id}`, { featured: !m.featured })).media;
        changed = true;
        draw();
      } catch (e) { toast(e.message, 'error'); }
    });
    $('[data-delete]', root)?.addEventListener('click', async () => {
      if (!confirm('Delete this for everyone?')) return;
      try {
        await api.del(`/media/${m.id}`);
        changed = true;
        closeModal();
        toast('Deleted');
      } catch (e) { toast(e.message, 'error'); }
    });
  };
  // Swipe left/right on phones.
  let x0 = null;
  root.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (x0 === null || items.length < 2) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) { i = (i + (dx < 0 ? 1 : -1) + items.length) % items.length; draw(); }
    x0 = null;
  });
  draw();
}

export function openUpload({ eventId, onDone } = {}) {
  if (!requireLogin('Sign in to share photos and videos.')) return;
  const body = openModal(html`<h2 class="sheet-title">Share a photo or video</h2>
    <form id="up-form" class="form">
      <label class="dropzone" id="drop">
        <input type="file" name="file" accept="image/*,video/mp4,video/quicktime,video/webm" required hidden>
        <div class="drop-inner">${ico('upload', 32)}<b>Tap to choose</b><small>Photos up to 15 MB · videos up to 200 MB</small></div>
      </label>
      <label class="field"><span>Caption</span><input name="caption" maxlength="200" placeholder="What happened?"></label>
      <div class="progress" hidden><i></i></div>
      <button class="btn btn-block" disabled>Upload</button>
    </form>`.s);
  const form = $('#up-form', body);
  const input = $('input[type=file]', form);
  const btn = $('button', form);
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    $('.drop-inner', form).innerHTML = f.type.startsWith('video')
      ? html`<video src="${url}" muted playsinline class="preview"></video>`.s
      : html`<img src="${url}" class="preview" alt="">`.s;
    btn.disabled = false;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let file = input.files[0];
    if (!file) return;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    file = await shrinkImage(file);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('caption', form.caption.value);
    if (eventId) fd.append('event_id', eventId);
    const bar = $('.progress', form);
    bar.hidden = false;
    btn.textContent = 'Uploading…';
    try {
      const res = await api.upload('/media', fd, (p) => { $('i', bar).style.width = `${Math.round(p * 100)}%`; });
      closeModal();
      toast(res.pending ? 'Thanks! An organiser will approve it shortly.' : 'Shared with the club!', 'success');
      showNewBadges(res.new_achievements);
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Upload';
    }
  });
}

export async function render({ el, isCurrent }) {
  let filter = sessionStorage.getItem('mnc_gallery') || 'latest';
  const load = async () => {
    const q = filter === 'best' ? '?featured=1' : filter === 'top' ? '?sort=top' : '';
    const { media } = await api.get(`/media${q}`);
    if (!isCurrent()) return;
    el.innerHTML = html`
      <div class="page-head"><h1>Gallery</h1>${state.me ? html`<button class="btn btn-sm" id="up">${ico('upload', 18)} Share</button>` : ''}</div>
      <div class="segmented">
        ${[['latest', 'Latest'], ['top', 'Most liked'], ['best', 'Best of']].map(([k, l]) => html`<button class="${filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`)}
      </div>
      ${media.length ? mediaGrid(media) : html`<div class="card">${empty('📸', filter === 'best' ? 'No "Best of" picks yet' : 'No photos yet', filter === 'best' ? 'Admins can star the best shots each week.' : 'Be the first to share a moment from the club.')}</div>`}
    `.s;
    $$('[data-f]', el).forEach((b) => b.onclick = () => { filter = b.dataset.f; sessionStorage.setItem('mnc_gallery', filter); load(); });
    $('#up', el)?.addEventListener('click', () => openUpload({ onDone: load }));
    bindMediaGrid(el, media, load);
  };
  el.innerHTML = skeleton(4).s;
  await load();
}
