// Tiny view helpers: escaped HTML templates, toasts, modals and formatting.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s);

const part = (v) => {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
};

// html`<p>${userText}</p>` escapes values; nested html`` results and arrays are kept as-is.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

let modalClose = null;
export function openModal(content, { onClose, wide = false } = {}) {
  closeModal();
  const root = $('#modal');
  root.innerHTML = `<div class="modal-backdrop" data-close></div>
    <div class="modal-sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <button class="icon-btn modal-x" data-close aria-label="Close">${icon('x')}</button>
      <div class="modal-body">${content}</div>
    </div>`;
  root.hidden = false;
  document.body.classList.add('modal-open');
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKey);
  root.onclick = (e) => { if (e.target.closest('[data-close]')) closeModal(); };
  modalClose = () => {
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  return $('.modal-body', root);
}

export function closeModal() {
  const root = $('#modal');
  if (!root || root.hidden) return;
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  const fn = modalClose;
  modalClose = null;
  fn?.();
}

export function avatar(user, size = 40) {
  if (!user) return '';
  const name = user.nickname || user.name || '?';
  if (user.avatar) {
    return html`<img class="avatar" style="width:${size}px;height:${size}px" src="${user.avatar}" alt="" loading="lazy">`;
  }
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return html`<span class="avatar avatar-initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;--h:${h}">${initials}</span>`;
}

export const displayName = (u) => (u ? u.nickname || u.name : 'Unknown');

export function playerLink(u, { size = 32, showName = true } = {}) {
  if (!u) return '';
  return html`<a class="player-link" href="#/players/${u.id}">${avatar(u, size)}${showName ? html`<span>${displayName(u)}</span>` : ''}</a>`;
}

// SQLite datetimes are UTC without a zone marker.
export const parseUtc = (s) => new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');

export function timeAgo(s) {
  const secs = (Date.now() - parseUtc(s).getTime()) / 1000;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
  return parseUtc(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function niceDate(ymd, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function niceTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export const medalEmoji = (place) => ['', '🥇', '🥈', '🥉'][place] || '';

export function skeleton(lines = 3) {
  return html`<div class="card">${Array.from({ length: lines }, () => html`<div class="skeleton"></div>`)}</div>`;
}

export function empty(emoji, title, text = '', action = '') {
  return html`<div class="empty"><div class="empty-emoji">${emoji}</div><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}

// Shrink big phone photos before upload: saves data on the night and disk space on the PC.
export async function shrinkImage(file, maxSide = 2048, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export function confetti() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c5cff';
  const colors = [accent, '#ff5d8f', '#ffc43d', '#22c3a6', '#ffb020'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    p.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3500);
}

const ICONS = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z"/>',
  share: '<path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 3v13M7 8l5-5 5 5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>',
  check: '<path d="M5 12l5 5 9-11"/>',
};
export const icon = (name, size = 22) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
export const ico = (name, size) => raw(icon(name, size));

// Live updates over Server-Sent Events, coalesced and paused while a sheet is open.
export function live(url, onChange) {
  if (!('EventSource' in window)) return () => {};
  let timer = null;
  let dirty = false;
  const fire = () => {
    if (document.body.classList.contains('modal-open') || document.visibilityState !== 'visible') { dirty = true; return; }
    dirty = false;
    onChange();
  };
  const src = new EventSource(url);
  src.addEventListener('changed', () => { clearTimeout(timer); timer = setTimeout(fire, 300); });
  const onVis = () => { if (dirty && document.visibilityState === 'visible') fire(); };
  document.addEventListener('visibilitychange', onVis);
  const iv = setInterval(() => dirty && fire(), 2000);
  return () => { src.close(); clearTimeout(timer); clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
}

export const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
export const levelChip = (l) => (l ? html`<span class="chip level-${l}">${LEVEL_LABEL[l] || l}</span>` : '');

// Small dependency-free SVG line chart for rating history.
export function lineChart(points, { height = 160 } = {}) {
  if (points.length < 2) return html`<p class="hint">Play a few more matches to see your rating chart.</p>`;
  const w = 600, h = height, pad = 12;
  const ys = points.map((p) => p.r);
  const min = Math.min(...ys) - 10, max = Math.max(...ys) + 10;
  const x = (i) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  const area = `${d}L${x(points.length - 1).toFixed(1)},${h - pad}L${pad},${h - pad}Z`;
  const last = points[points.length - 1];
  const peak = Math.max(...ys);
  // Labels sit outside the SVG: it stretches to fit, which would distort text.
  return raw(`<div class="chart-labels"><span>Peak ${peak}</span><span>Now <b>${last.r}</b></span></div>
  <svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Rating history">
    <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".16"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <line x1="${pad}" x2="${w - pad}" y1="${y(1000)}" y2="${y(1000)}" class="chart-base"/>
    <path d="${area}" fill="url(#cg)"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`);
}
