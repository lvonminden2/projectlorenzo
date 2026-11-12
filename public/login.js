'use strict';
const form = document.querySelector('#login-form');
const flash = document.querySelector('#flash');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  flash.hidden = true;
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign-in failed');
    window.location.replace('/');
  } catch (err) {
    flash.textContent = err.message;
    flash.className = 'error';
    flash.hidden = false;
    form.password.value = '';
    btn.disabled = false;
  }
});
