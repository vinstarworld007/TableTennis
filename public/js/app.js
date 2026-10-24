import { api } from './api.js';
import { $, html, icon, ico, toast, closeModal, avatar } from './ui.js';
import * as tonight from './views/tonight.js';
import * as leaderboard from './views/leaderboard.js';
import * as events from './views/events.js';
import * as gallery from './views/gallery.js';
import * as players from './views/players.js';
import * as auth from './views/auth.js';
import * as admin from './views/admin.js';
import * as tournaments from './views/tournaments.js';
import * as doubles from './views/doubles.js';

export const state = { config: null, me: null };

const ROUTES = [
  [/^\/?$/, tonight.render, 'tonight'],
  [/^\/leaderboard$/, leaderboard.render, 'leaderboard'],
  [/^\/events$/, events.renderList, 'events'],
  [/^\/events\/(\d+)$/, events.renderDetail, 'events'],
  [/^\/gallery$/, gallery.render, 'gallery'],
  [/^\/players$/, players.renderList, 'leaderboard'],
  [/^\/players\/(\d+)$/, players.renderProfile, 'me'],
  [/^\/me$/, players.renderMe, 'me'],
  [/^\/me\/edit$/, players.renderEdit, 'me'],
  [/^\/login$/, auth.renderLogin, 'me'],
  [/^\/signup$/, auth.renderSignup, 'me'],
  [/^\/join\/([\w-]+)$/, auth.renderSignup, 'me'],
  [/^\/forgot$/, auth.renderForgot, 'me'],
  [/^\/reset\/([\w-]+)$/, auth.renderReset, 'me'],
  [/^\/tournaments$/, tournaments.renderList, 'leaderboard'],
  [/^\/tournaments\/(\d+)$/, tournaments.renderDetail, 'leaderboard'],
  [/^\/doubles$/, doubles.render, 'tonight'],
  [/^\/admin$/, admin.render, 'me'],
];

const TABS = [
  ['tonight', '#/', 'home', 'Tonight'],
  ['leaderboard', '#/leaderboard', 'trophy', 'Ranks'],
  ['events', '#/events', 'calendar', 'Nights'],
  ['gallery', '#/gallery', 'image', 'Gallery'],
  ['me', '#/me', 'user', 'Me'],
];

export const navigate = (path) => { location.hash = `#${path}`; };
export const currentPath = () => location.hash.replace(/^#/, '') || '/';

export function requireLogin(message = 'Sign in to do that.') {
  if (state.me) return true;
  toast(message);
  sessionStorage.setItem('mnc_after_login', currentPath());
  navigate('/login');
  return false;
}

export async function refreshMe() {
  state.me = (await api.get('/auth/me')).user;
  renderChrome();
}

export async function refreshConfig() {
  state.config = await api.get('/config');
  applyBranding();
  renderChrome();
}

function applyBranding() {
  const c = state.config;
  document.documentElement.style.setProperty('--accent', c.accent || '#7c5cff');
  document.title = c.app_name;
  $('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', c.app_name);
}

let activeTab = null;
function renderChrome() {
  if (!state.config) return;
  const me = state.me;
  $('#brand').innerHTML = html`<span class="brand-ball"></span><span class="brand-name">${state.config.app_name}</span>`.s;
  const tabs = TABS.map(([key, href, ic, label]) => {
    const inner = key === 'me' && me
      ? html`${avatar(me, 24)}<span>${label}</span>`
      : html`<span class="tab-ico">${ico(ic)}</span><span>${label}</span>`;
    return `<a href="${href}" class="tab${activeTab === key ? ' active' : ''}" data-tab="${key}">${inner}</a>`;
  }).join('');
  $('#tabbar').innerHTML = tabs;
  $('#topnav').innerHTML = tabs;
  $('#top-actions').innerHTML = me
    ? (me.role === 'admin' ? `<a class="icon-btn" href="#/admin" title="Admin">${icon('settings')}</a>` : '')
    : `<a class="btn btn-sm" href="#/login">Sign in</a>`;
}

let cleanup = null;
let renderSeq = 0;
async function route() {
  closeModal();
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const path = currentPath().split('?')[0];
  const found = ROUTES.find(([re]) => re.test(path));
  const view = $('#view');
  const seq = ++renderSeq;
  if (!found) {
    view.innerHTML = '<div class="empty"><div class="empty-emoji">🤷</div><h3>Page not found</h3><a class="btn" href="#/">Go home</a></div>';
    return;
  }
  const [re, fn, tab] = found;
  activeTab = tab;
  renderChrome();
  window.scrollTo(0, 0);
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
  try {
    const result = await fn({ el: view, params: path.match(re).slice(1), isCurrent: () => seq === renderSeq });
    if (seq === renderSeq) cleanup = result;
    else if (typeof result === 'function') result();
  } catch (e) {
    if (seq !== renderSeq) return;
    console.error(e);
    view.innerHTML = html`<div class="empty"><div class="empty-emoji">😵</div><h3>Couldn't load this page</h3><p>${e.message}</p><button class="btn" onclick="location.reload()">Try again</button></div>`.s;
  }
}

async function boot() {
  try {
    [state.config, state.me] = await Promise.all([api.get('/config'), api.get('/auth/me').then((r) => r.user)]);
  } catch (e) {
    $('#view').innerHTML = html`<div class="empty"><div class="empty-emoji">📡</div><h3>Can't reach the club server</h3><p>${e.message}</p><button class="btn" onclick="location.reload()">Retry</button></div>`.s;
    return;
  }
  applyBranding();
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
