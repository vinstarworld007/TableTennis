import { api } from '../api.js';
import { state, requireLogin } from '../app.js';
import {
  html, raw, ico, $, $$, avatar, displayName, playerLink, timeAgo, medalEmoji,
  openModal, closeModal, toast, confetti, esc,
} from '../ui.js';

const sideOf = (m, team) => (team === 'a' ? [m.p1, m.p3] : [m.p2, m.p4]).filter(Boolean);

export function matchItem(m, { showGame = true, onDelete } = {}) {
  const me = state.me;
  const aWon = m.winner_id === m.p1.id;
  const everyone = [m.p1, m.p2, m.p3, m.p4].filter(Boolean);
  const canDelete = me && (me.role === 'admin' || everyone.some((u) => u.id === me.id));
  const delta = (d) => (d == null ? '' : html`<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</span>`);
  const side = (team, right) => {
    const ps = sideOf(m, team);
    if (ps.length === 1) {
      const d = team === 'a' ? m.p1_delta : m.p2_delta;
      return right ? html`${delta(d)}${playerLink(ps[0], { size: 28 })}` : html`${playerLink(ps[0], { size: 28 })}${delta(d)}`;
    }
    return html`<span class="duo">${ps.map((u) => html`<a href="#/players/${u.id}" class="player-link">${avatar(u, 22)}<span>${displayName(u)}</span></a>`)}</span>`;
  };
  return html`<li class="match ${m.p3 ? 'doubles' : ''}" data-match="${m.id}">
    ${showGame ? html`<span class="match-game" title="${m.game.name}">${m.game.emoji}</span>` : ''}
    <div class="match-side ${aWon ? 'won' : ''}">${side('a', false)}</div>
    <div class="match-score"><b class="${aWon ? 'w' : ''}">${m.p1_score}</b><i>–</i><b class="${aWon ? '' : 'w'}">${m.p2_score}</b></div>
    <div class="match-side right ${aWon ? '' : 'won'}">${side('b', true)}</div>
    <div class="match-meta">
      ${m.detail ? html`<span>${m.detail}</span>` : ''}<span>${timeAgo(m.created_at)}</span>
      ${canDelete && onDelete ? html`<button class="link-btn danger" data-del-match="${m.id}">Remove</button>` : ''}
    </div>
  </li>`;
}

export function bindMatchDeletes(root, onDone) {
  $$('[data-del-match]', root).forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Remove this result? Ratings and fixtures will be recalculated.')) return;
    try {
      await api.del(`/matches/${btn.dataset.delMatch}`);
      toast('Result removed');
      onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  }));
}

// Score sheet for a known pairing (table fixture, doubles fixture or tournament match).
export function openScoreEntry({ title, a, b, label = 'Games', onSubmit }) {
  if (!requireLogin('Sign in to enter results.')) return;
  const s = { s1: 0, s2: 0, detail: '' };
  const body = openModal('<div id="se"></div>');
  const root = $('#se', body);
  const names = (side) => side.map((u) => (u.id === state.me.id ? 'You' : displayName(u))).join(' & ');
  const draw = () => {
    const ready = s.s1 !== s.s2;
    root.innerHTML = html`<h2 class="sheet-title">${title}</h2>
      <div class="score-board">
        ${[[a, 's1'], [b, 's2']].map(([side, k]) => html`<div class="score-col">
          <div class="score-player static"><span class="avatar-stack">${side.map((u) => avatar(u, side.length > 1 ? 44 : 56))}</span><span>${names(side)}</span></div>
          <div class="stepper">
            <button data-step="${k}" data-d="-1" aria-label="minus">${ico('minus')}</button>
            <output>${s[k]}</output>
            <button data-step="${k}" data-d="1" aria-label="plus">${ico('plus')}</button>
          </div>
        </div>`)}
      </div>
      <p class="hint center">${label} won</p>
      <label class="field"><span>Game scores (optional)</span><input id="se-detail" placeholder="e.g. 11-7, 9-11, 11-5" value="${s.detail}" maxlength="120"></label>
      <button class="btn btn-block btn-lg" id="se-save" ${ready ? '' : 'disabled'}>${ready ? 'Save result' : 'Enter the score'}</button>`.s;
    $$('[data-step]', root).forEach((btn) => btn.onclick = () => {
      s[btn.dataset.step] = Math.max(0, Math.min(99, s[btn.dataset.step] + Number(btn.dataset.d)));
      draw();
    });
    $('#se-detail', root).oninput = (e) => { s.detail = e.target.value; };
    $('#se-save', root).onclick = async (e) => {
      e.target.disabled = true;
      try {
        const res = await onSubmit(s.s1, s.s2, s.detail);
        closeModal();
        toast('Result saved', 'success');
        showNewBadges(res?.new_achievements);
      } catch (err) {
        toast(err.message, 'error');
        e.target.disabled = false;
      }
    };
  };
  draw();
}

export function podiumBlock(entry, { compact = false } = {}) {
  const order = [2, 1, 3];
  const byPlace = Object.fromEntries(entry.places.map((p) => [p.place, p]));
  return html`<div class="podium-card ${compact ? 'compact' : ''}">
    <div class="podium-head"><span>${entry.game.emoji} ${entry.game.name}</span>
      <span class="chip ${entry.final ? 'chip-gold' : 'chip-live'}">${entry.final ? 'Final' : 'Live standings'}</span></div>
    <div class="podium">
      ${order.map((place) => {
        const p = byPlace[place];
        return html`<div class="podium-spot p${place}">
          ${p ? html`<a href="#/players/${p.user.id}" class="podium-player">
            <div class="podium-avatar">${avatar(p.user, place === 1 ? 64 : 52)}<span class="podium-medal">${medalEmoji(place)}</span></div>
            <div class="podium-name">${displayName(p.user)}</div>
            <div class="podium-sub">${p.wins}W · ${p.played - p.wins}L</div>
          </a>` : html`<div class="podium-player muted"><div class="podium-avatar"><span class="avatar avatar-empty" style="width:52px;height:52px"></span></div><div class="podium-name">—</div></div>`}
          <div class="podium-block">${place}</div>
        </div>`;
      })}
    </div>
  </div>`;
}

export function showNewBadges(list) {
  if (!list?.length) return;
  confetti();
  openModal(html`<div class="badge-pop">
    <h2>New badge${list.length > 1 ? 's' : ''} unlocked!</h2>
    <div class="badge-grid">${list.map((a) => html`<div class="badge earned"><div class="badge-emoji">${a.emoji}</div><b>${a.name}</b><small>${a.desc}</small></div>`)}</div>
    <button class="btn btn-block" data-close>Nice!</button>
  </div>`.s);
}

let playerCache = null;
async function loadPlayers() {
  if (!playerCache) playerCache = (await api.get('/users')).users;
  return playerCache;
}
export const invalidatePlayers = () => { playerCache = null; };

// The "Log a match" sheet: game → opponent(s) → score. Doubles games get a partner slot on each side.
export async function openLogMatch({ eventId, here = [], onDone } = {}) {
  if (!requireLogin('Sign in to log your matches.')) return;
  const me = state.me;
  const games = state.config.games;
  const s = { game: games[0], p1: me, p2: null, p3: null, p4: null, s1: 0, s2: 0, detail: '', picking: 'p2', query: '' };
  const players = await loadPlayers();
  const hereIds = new Set(here.map((u) => u.id));
  const body = openModal('<div id="lm"></div>');
  const root = $('#lm', body);
  const doubles = () => s.game.team_size === 2;
  const slots = () => (doubles() ? ['p1', 'p3', 'p2', 'p4'] : ['p1', 'p2']);

  const pickerList = () => {
    const q = s.query.trim().toLowerCase();
    const taken = new Set(slots().filter((k) => k !== s.picking).map((k) => s[k]?.id).filter(Boolean));
    let list = players.filter((u) => !taken.has(u.id));
    if (q) list = list.filter((u) => `${u.name} ${u.nickname || ''}`.toLowerCase().includes(q));
    list.sort((a, b) => (hereIds.has(b.id) - hereIds.has(a.id)) || a.name.localeCompare(b.name));
    return list.slice(0, 40);
  };
  const slotLabel = { p1: 'You', p2: 'Opponent', p3: 'Your partner', p4: 'Their partner' };

  const draw = () => {
    const label = s.game.score_label || 'Games';
    const filled = slots().every((k) => s[k]);
    const ready = filled && s.s1 !== s.s2;
    const slotBtn = (k) => {
      const u = s[k];
      const canPick = k !== 'p1' || me.role === 'admin';
      return html`<button class="score-player ${s.picking === k ? 'picking' : ''}" data-pick="${k}" ${canPick ? '' : 'disabled'}>
        ${u ? avatar(u, doubles() ? 44 : 56) : html`<span class="avatar avatar-empty" style="width:${doubles() ? 44 : 56}px;height:${doubles() ? 44 : 56}px">?</span>`}
        <span>${u ? (u.id === me.id ? 'You' : displayName(u)) : `Pick ${slotLabel[k].toLowerCase()}`}</span>
      </button>`;
    };
    const list = s.picking ? pickerList() : [];
    root.innerHTML = html`
      <h2 class="sheet-title">Log a match</h2>
      <div class="chips scroll-x" role="tablist">
        ${games.map((g) => html`<button class="chip-btn ${g.id === s.game.id ? 'active' : ''}" data-game="${g.id}">${g.emoji} ${g.name}</button>`)}
      </div>
      <div class="score-board">
        ${[['p1', 'p3', 's1'], ['p2', 'p4', 's2']].map(([a, b, sk]) => html`<div class="score-col ${[a, b].includes(s.picking) ? 'picking' : ''}">
          <div class="slot-row">${slotBtn(a)}${doubles() ? slotBtn(b) : ''}</div>
          <div class="stepper">
            <button data-step="${sk}" data-d="-1" aria-label="minus">${ico('minus')}</button>
            <output>${s[sk]}</output>
            <button data-step="${sk}" data-d="1" aria-label="plus">${ico('plus')}</button>
          </div>
        </div>`)}
      </div>
      <p class="hint center">${label} won</p>
      ${s.picking ? html`<div class="picker">
        <div class="search">${ico('search', 18)}<input id="lm-q" placeholder="Search players" value="${s.query}" autocomplete="off"></div>
        <div class="picker-list">
          ${list.map((u) => html`<button class="picker-item" data-user="${u.id}">${avatar(u, 36)}<span>${displayName(u)}</span>${hereIds.has(u.id) ? html`<small class="chip chip-live">here</small>` : ''}</button>`)}
          ${list.length ? '' : html`<p class="hint">No players match. They need to sign up first.</p>`}
        </div>
      </div>` : ''}
      <label class="field"><span>Game scores (optional)</span>
        <input id="lm-detail" placeholder="e.g. 11-7, 9-11, 11-5" value="${s.detail}" maxlength="120"></label>
      <button class="btn btn-block btn-lg" id="lm-save" ${ready ? '' : 'disabled'}>${ready ? 'Save result' : filled ? 'Enter the score' : 'Pick the players'}</button>
    `.s;

    $$('[data-game]', root).forEach((b) => b.onclick = () => {
      s.game = games.find((g) => g.id === +b.dataset.game);
      if (!doubles()) { s.p3 = null; s.p4 = null; }
      s.picking = slots().find((k) => !s[k]) || null;
      draw();
    });
    $$('[data-pick]', root).forEach((b) => b.onclick = () => { s.picking = s.picking === b.dataset.pick ? null : b.dataset.pick; s.query = ''; draw(); });
    $$('[data-step]', root).forEach((b) => b.onclick = () => {
      s[b.dataset.step] = Math.max(0, Math.min(99, s[b.dataset.step] + Number(b.dataset.d)));
      draw();
    });
    $$('[data-user]', root).forEach((b) => b.onclick = () => {
      s[s.picking] = players.find((u) => u.id === +b.dataset.user);
      s.picking = slots().find((k) => !s[k]) || null;
      s.query = '';
      draw();
    });
    const q = $('#lm-q', root);
    if (q) q.oninput = () => {
      s.query = q.value;
      const pos = q.selectionStart;
      draw();
      const nq = $('#lm-q', root);
      nq.focus();
      nq.setSelectionRange(pos, pos);
    };
    $('#lm-detail', root).oninput = (e) => { s.detail = e.target.value; };
    $('#lm-save', root).onclick = save;
  };

  async function save() {
    const btn = $('#lm-save', root);
    btn.disabled = true;
    try {
      const payload = { game_id: s.game.id, p1_id: s.p1.id, p2_id: s.p2.id, p1_score: s.s1, p2_score: s.s2, detail: s.detail };
      if (doubles()) Object.assign(payload, { p3_id: s.p3.id, p4_id: s.p4.id });
      if (eventId) payload.event_id = eventId;
      const res = await api.post('/matches', payload);
      closeModal();
      const m = res.match;
      const mine = [['p1', m.p1_delta], ['p2', m.p2_delta], ['p3', m.p3_delta], ['p4', m.p4_delta]].find(([k]) => m[k]?.id === me.id);
      const won = mine && ((['p1', 'p3'].includes(mine[0])) === (m.winner_id === m.p1.id));
      toast(!mine ? 'Result logged.' : won ? `Win logged! ${m.game.emoji} +${mine[1]}` : 'Result logged. Next time!', 'success');
      showNewBadges(res.new_achievements);
      onDone?.(m);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  }

  draw();
}

export function shareLink(url, title) {
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => prompt('Copy this link:', url));
  }
}

export { esc, raw };
