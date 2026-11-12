'use strict';
// Day / night theme: follow the device unless a choice was saved in the app.
(() => {
  let pref = 'system';
  try {
    pref = localStorage.getItem('pl-theme') || 'system';
  } catch {
    /* storage blocked: follow the device */
  }
  if (pref === 'light' || pref === 'dark') document.documentElement.dataset.theme = pref;
})();

const form = document.querySelector('#login-form');
const flash = document.querySelector('#flash');

function showError(title, text) {
  document.querySelector('#flash-title').textContent = title;
  document.querySelector('#flash-text').textContent = text;
  flash.hidden = false;
  form.email.setAttribute('aria-invalid', 'true');
  form.password.setAttribute('aria-invalid', 'true');
}

form.addEventListener('click', (e) => {
  const t = e.target.closest('.pl-pw__toggle');
  if (!t) return;
  const showing = form.password.type === 'text';
  form.password.type = showing ? 'password' : 'text';
  t.textContent = showing ? 'Show' : 'Hide';
  t.setAttribute('aria-pressed', String(!showing));
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  flash.hidden = true;
  if (!form.email.value.trim() || !form.password.value) {
    showError('Enter your email and password', 'Both are needed to sign in.');
    return;
  }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    let res;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }),
      });
    } catch {
      throw Object.assign(new Error('Check your signal and try again.'), { title: 'No connection' });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const bad = res.status === 401 || res.status === 400;
      throw Object.assign(
        new Error(bad ? 'Check for typos, or ask an admin to reset your password.' : data.error || 'Please try again in a moment.'),
        { title: bad ? 'That email and password don’t match' : data.error || 'Couldn’t sign you in' },
      );
    }
    window.location.replace('/');
  } catch (err) {
    showError(err.title || 'Couldn’t sign you in', err.message);
    form.password.value = '';
    form.password.focus();
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
});
