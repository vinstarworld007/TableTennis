import { api } from '../api.js';
import { state } from '../app.js';
import { html, ico, $, $$, avatar, displayName, skeleton, empty } from '../ui.js';
import { potmCard } from './tonight.js';

const PREF = 'mnc_lb';
const PERIODS = [['all', 'All-time'], ['season', 'Season'], ['month', 'Month'], ['year', 'Year']];

export async function render({ el, isCurrent }) {
  const games = state.config.games;
  let prefs = {};
  try { prefs = JSON.parse(sessionStorage.getItem(PREF)) || {}; } catch {}
  const s = { game: prefs.game || games[0]?.id, view: prefs.view || 'rating', period: prefs.period || 'all', season: prefs.season || null };
  if (!games.some((g) => g.id === s.game)) s.game = games[0]?.id;
  const [{ seasons }, potm] = await Promise.all([api.get('/leaderboard/seasons'), api.get('/leaderboard/potm')]);

  const load = async () => {
    sessionStorage.setItem(PREF, JSON.stringify(s));
    const data = s.view === 'medals'
      ? await api.get(`/leaderboard/medals?game=${s.game}`)
      : await api.get(`/leaderboard?game=${s.game}&sort=${s.view}&period=${s.period}${s.season ? `&season=${s.season}` : ''}`);
    if (!isCurrent()) return;
    const meId = state.me?.id;
    const rows = data.rows;
    const ladder = s.view === 'rating' && (s.period === 'month' || s.period === 'season');
    const scoreHead = s.view === 'wins' ? 'Wins' : ladder ? 'Gained' : 'Rating';
    const score = (r) => (s.view === 'wins' ? r.wins : ladder ? `${r.elo_change >= 0 ? '+' : ''}${r.elo_change}` : r.rating);
    const emptyMsg = s.period === 'season' && !data.season
      ? empty('📆', 'No season set up', state.me?.role === 'admin' ? 'Create seasons in Admin → Seasons.' : 'Organisers can create seasons.')
      : empty(s.view === 'medals' ? '🏅' : '🏆', s.view === 'medals' ? 'No medals awarded yet' : 'No matches in this period', s.view === 'medals' ? 'Medals are handed out at the end of each club night.' : 'Log a match to get on the board.');
    const body = !rows.length ? emptyMsg
      : s.view === 'medals'
        ? html`<div class="lb-head medals"><span>#</span><span>Player</span><span>🥇</span><span>🥈</span><span>🥉</span></div>
          ${rows.map((r) => html`<a class="lb-row medals ${r.user.id === meId ? 'me' : ''}" href="#/players/${r.user.id}">
            <span class="lb-rank">${r.rank}</span>
            <span class="lb-player">${avatar(r.user, 36)}<b>${displayName(r.user)}</b></span>
            <span class="lb-num gold">${r.gold}</span><span class="lb-num">${r.silver}</span><span class="lb-num">${r.bronze}</span>
          </a>`)}`
        : html`<div class="lb-head"><span>#</span><span>Player</span><span>W–L</span><span>${scoreHead}</span></div>
          ${rows.map((r) => html`<a class="lb-row ${r.rank <= 3 ? `top top${r.rank}` : ''} ${r.user.id === meId ? 'me' : ''}" href="#/players/${r.user.id}">
            <span class="lb-rank">${r.rank}</span>
            <span class="lb-player">${avatar(r.user, 36)}<span><b>${displayName(r.user)}</b>
              <small>${r.played} played · ${Math.round((r.wins / r.played) * 100)}%${r.streak >= 3 ? ` · 🔥${r.streak}` : ''}${ladder ? ` · ${r.rating}` : ''}</small></span></span>
            <span class="lb-wl">${r.wins}–${r.losses}</span>
            <span class="lb-score ${ladder ? (r.elo_change >= 0 ? 'up' : 'down') : ''}">${score(r)}</span>
          </a>`)}`;

    el.innerHTML = html`
      <div class="page-head"><h1>Leaderboard</h1>
        <div class="row-actions"><a class="btn btn-sm ghost" href="#/tournaments">🏆 Cups</a><a class="btn btn-sm ghost" href="#/players">${ico('users', 18)}</a></div></div>
      ${potmCard(potm)}
      <div class="chips scroll-x">${games.map((g) => html`<button class="chip-btn ${g.id === s.game ? 'active' : ''}" data-game="${g.id}">${g.emoji} ${g.name}</button>`)}</div>
      <div class="segmented">
        ${[['rating', 'Rating'], ['wins', 'Most wins'], ['medals', 'Medal table']].map(([k, l]) => html`<button class="${s.view === k ? 'active' : ''}" data-view="${k}">${l}</button>`)}
      </div>
      ${s.view !== 'medals' ? html`<div class="period-row">
        <div class="segmented small">${PERIODS.map(([k, l]) => html`<button class="${s.period === k ? 'active' : ''}" data-period="${k}">${l}</button>`)}</div>
        ${s.period === 'season' && seasons.length ? html`<select id="season" class="compact-select">${seasons.map((x) => html`<option value="${x.id}" ${x.id === (s.season || data.season?.id) ? 'selected' : ''}>${x.name}</option>`)}</select>` : ''}
      </div>` : ''}
      ${data.season && s.period === 'season' ? html`<p class="hint">${data.season.name}: ${data.season.start_date} → ${data.season.end_date}</p>` : ''}
      <div class="card lb">${body}</div>
      <p class="hint center">${ladder ? 'Ladder: ranked by rating points gained in this period.' : 'Elo rating: everyone starts at 1000. Beating a higher-rated player earns more points.'}</p>
    `.s;
    $$('[data-game]', el).forEach((b) => b.onclick = () => { s.game = Number(b.dataset.game); load(); });
    $$('[data-view]', el).forEach((b) => b.onclick = () => { s.view = b.dataset.view; load(); });
    $$('[data-period]', el).forEach((b) => b.onclick = () => { s.period = b.dataset.period; load(); });
    $('#season', el)?.addEventListener('change', (e) => { s.season = Number(e.target.value); load(); });
  };
  el.innerHTML = skeleton(6).s;
  if (!games.length) {
    el.innerHTML = empty('🎮', 'No games set up').s;
    return;
  }
  await load();
}

