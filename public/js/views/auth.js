import { api } from '../api.js';
import { state, navigate, refreshMe, currentPath } from '../app.js';
import { html, $, toast, LEVEL_LABEL } from '../ui.js';
import { invalidatePlayers } from './shared.js';

function afterLogin() {
  invalidatePlayers();
  const next = sessionStorage.getItem('mnc_after_login');
  sessionStorage.removeItem('mnc_after_login');
  navigate(next && !/^\/(login|signup|join|reset|forgot)/.test(next) ? next : '/');
}

function shell(sub, form, foot) {
  return html`<div class="auth">
    <div class="auth-brand"><span class="brand-ball big"></span><h1>${state.config.app_name}</h1><p>${sub}</p></div>
    <div class="card">${form}</div>
    <p class="center hint">${foot}</p>
  </div>`.s;
}

const query = () => new URLSearchParams(currentPath().split('?')[1] || '');

async function submitWith(form, fn) {
  const btn = $('button[type=submit], button:not([type])', form);
  btn.disabled = true;
  try {
    await fn(Object.fromEntries(new FormData(form)));
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

export function renderLogin({ el }) {
  if (state.me) return navigate('/me');
  el.innerHTML = shell('Welcome back! Sign in to see your table and log matches.', html`
    <form id="f" class="form">
      <label class="field"><span>Email or mobile number</span><input name="identifier" required autocomplete="username" placeholder="you@example.com or 07…"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn btn-block btn-lg">Sign in</button>
    </form>
    <p class="hint small">${state.config.email_reset ? html`<a href="#/forgot">Forgot your password?</a>` : 'Forgot your password? Ask an organiser on club night to reset it.'}</p>`,
  html`New here? <a href="#/signup">Create your account</a>`);
  $('#f', el).addEventListener('submit', (e) => {
    e.preventDefault();
    submitWith(e.target, async (data) => {
      await api.post('/auth/login', data);
      await refreshMe();
      toast(`Welcome back, ${state.me.nickname || state.me.name}!`, 'success');
      afterLogin();
    });
  });
}

export async function renderSignup({ el, params }) {
  if (state.me) return navigate('/me');
  const c = state.config;
  const code = params?.[0] || null;
  let invite = null;
  if (code) {
    try { invite = (await api.get(`/auth/invite/${code}`)).invite; } catch (e) { toast(e.message, 'error'); }
    if (invite?.used) { toast('That invite has already been used. Sign in instead.'); return navigate('/login'); }
  }
  const tonight = (await api.get('/events/current').catch(() => ({}))).event;
  const liveTonight = tonight?.is_today && tonight.status !== 'cancelled';
  const joinCode = query().get('code') || '';
  el.innerHTML = shell(invite ? `You're invited${invite.name ? `, ${invite.name.split(/[ ,]/)[0]}` : ''}! Create your player profile.` : c.has_users ? 'Create your player profile in 30 seconds.' : 'You are the first player! Your account will be the club admin.', html`
    <form id="f" class="form">
      <label class="field"><span>Full name</span><input name="name" required maxlength="60" autocomplete="name" value="${invite?.name || ''}"></label>
      <label class="field"><span>Nickname <em>(optional, shown on leaderboards)</em></span><input name="nickname" maxlength="40"></label>
      <div class="contact-pair">
        <label class="field"><span>Mobile number</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="07…" value="${invite?.phone || ''}"></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${invite?.email || ''}"></label>
      </div>
      <p class="hint small contact-hint">Use either one, or both. You can sign in with whichever you enter.</p>
      <label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
      <fieldset class="fieldset">
        <legend>Your level</legend>
        <div class="level-picker">
          ${c.levels.map((l) => html`<label class="level-opt"><input type="radio" name="skill" value="${l}" ${l === 'intermediate' ? 'checked' : ''}>
            <span><b>${LEVEL_LABEL[l]}</b><small>${{ beginner: 'New or casual', intermediate: 'Regular rallies', advanced: 'Spin, smash, league' }[l]}</small></span></label>`)}
        </div>
        <p class="hint small">This decides your table on club night. Organisers can adjust it.</p>
      </fieldset>
      <label class="check"><input type="checkbox" name="doubles_keen"> I'm keen on doubles — add me to the doubles pool</label>
      ${liveTonight ? html`<label class="check"><input type="checkbox" name="checkin" checked> I'm here tonight — put me on a table</label>` : ''}
      ${c.join_code_required && !invite ? html`<label class="field"><span>Club join code</span><input name="join_code" required autocomplete="off" placeholder="Ask an organiser" value="${joinCode}"></label>` : ''}
      <button class="btn btn-block btn-lg">Create account</button>
    </form>`,
  html`Already a member? <a href="#/login">Sign in</a>`);
  $('#f', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.phone.value.trim() && !form.email.value.trim()) {
      toast('Enter your mobile number, your email, or both.', 'error');
      return;
    }
    submitWith(form, async (data) => {
      data.doubles_keen = form.doubles_keen.checked;
      data.checkin = !!form.checkin?.checked;
      if (code) data.invite = code;
      const res = await api.post('/auth/signup', data);
      await refreshMe();
      state.config.has_users = true;
      toast(res.table ? `Welcome! You're on table ${res.table} tonight 🏓` : `Welcome to ${c.app_name}! 🎉`, 'success');
      afterLogin();
    });
  });
}

export function renderForgot({ el }) {
  el.innerHTML = shell('Reset your password', html`
    <form id="f" class="form">
      <label class="field"><span>Email or mobile number</span><input name="identifier" required autocomplete="username"></label>
      <button class="btn btn-block">Send reset link</button>
    </form>
    <p class="hint small">The link goes to the email on your account. No email on your account? Ask an organiser.</p>`,
  html`<a href="#/login">Back to sign in</a>`);
  $('#f', el).addEventListener('submit', (e) => {
    e.preventDefault();
    submitWith(e.target, async (data) => {
      const res = await api.post('/auth/forgot', data);
      $('.card', el).innerHTML = html`<p>${res.message}</p>`.s;
    });
  });
}

export function renderReset({ el, params }) {
  el.innerHTML = shell('Choose a new password', html`
    <form id="f" class="form">
      <label class="field"><span>New password</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn btn-block">Save and sign in</button>
    </form>`, '');
  $('#f', el).addEventListener('submit', (e) => {
    e.preventDefault();
    submitWith(e.target, async (data) => {
      await api.post('/auth/reset', { ...data, token: params[0] });
      await refreshMe();
      toast('Password updated', 'success');
      navigate('/');
    });
  });
}
