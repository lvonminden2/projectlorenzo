'use strict';
// Project Lorenzo outreach client. All rendering uses textContent (never
// innerHTML) so client-entered data cannot inject markup.

const $ = (sel) => document.querySelector(sel);
const state = { user: null, intakeLoc: null, encLoc: null, personId: null };

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    state.user = null;
    show('login');
  }
  if (!res.ok) {
    const details = data.details ? ' ' + Object.values(data.details).flat().join(' ') : '';
    throw new Error((data.error || 'Request failed') + details);
  }
  return data;
}

function flash(msg, kind = 'ok') {
  const el = $('#flash');
  el.textContent = msg;
  el.className = kind;
  el.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const clearFlash = () => ($('#flash').hidden = true);

function show(view) {
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== 'view-' + view));
  const loggedIn = !!state.user && !state.user.mustChangePassword;
  $('#nav').hidden = !loggedIn;
  document.querySelectorAll('[data-admin]').forEach((b) => (b.hidden = state.user?.role !== 'admin'));
  if (view === 'users') loadUsers();
}

const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const fmt = (d) => (d ? new Date(d).toLocaleString() : '');
const displayName = (p) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') ||
  p.preferredName ||
  (p.physicalDescription ? 'Unnamed: ' + p.physicalDescription.slice(0, 40) : 'Unnamed');

function captureLocation(statusEl, key) {
  const status = $(statusEl);
  if (!('geolocation' in navigator)) {
    status.textContent = 'This device cannot provide a location';
    return;
  }
  status.textContent = 'Getting location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state[key] = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: Math.round(pos.coords.accuracy),
        source: 'device_gps',
      };
      status.textContent = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${Math.round(pos.coords.accuracy)} m)`;
    },
    (err) => {
      state[key] = null;
      status.textContent = 'Location unavailable: ' + err.message;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

function formValues(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

// ---------- auth ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  try {
    const { user } = await api('POST', '/auth/login', formValues(e.target));
    e.target.reset();
    state.user = user;
    afterLogin();
  } catch (err) {
    flash(err.message, 'error');
  }
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  try {
    await api('POST', '/auth/change-password', formValues(e.target));
    e.target.reset();
    state.user.mustChangePassword = false;
    flash('Password updated.');
    afterLogin();
  } catch (err) {
    flash(err.message, 'error');
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/auth/logout', {}).catch(() => {});
  state.user = null;
  show('login');
});

function afterLogin() {
  if (state.user.mustChangePassword) return show('password');
  show('intake');
  captureLocation('#loc-status', 'intakeLoc');
}

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    clearFlash();
    show(b.dataset.view);
    if (b.dataset.view === 'intake' && !state.intakeLoc) captureLocation('#loc-status', 'intakeLoc');
  }),
);

// ---------- intake ----------
$('#loc-btn').addEventListener('click', () => captureLocation('#loc-status', 'intakeLoc'));

$('#intake-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  const v = formValues(e.target);
  const body = {
    firstName: v.firstName,
    lastName: v.lastName,
    preferredName: v.preferredName,
    dateOfBirth: v.dateOfBirth || null,
    approximateAge: v.approximateAge ? Number(v.approximateAge) : null,
    gender: v.gender,
    phone: v.phone,
    veteranStatus: v.veteranStatus || null,
    physicalDescription: v.physicalDescription,
    needs: list(v.needs),
    notes: v.notes,
    consentGiven: e.target.consentGiven.checked,
    encounter: {
      location: state.intakeLoc,
      locationDescription: v.locationDescription,
      servicesProvided: list(v.servicesProvided),
    },
  };
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { individual } = await api('POST', '/individuals', body);
    e.target.reset();
    flash(`Saved ${displayName(individual)}${state.intakeLoc ? ' with location' : ' (no location)'}.`);
  } catch (err) {
    flash(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- search & person ----------
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  const q = new FormData(e.target).get('q').trim();
  try {
    const { individuals, total } = await api('GET', '/individuals?q=' + encodeURIComponent(q));
    const ul = $('#results');
    ul.replaceChildren();
    if (!individuals.length) ul.append(el('li', 'No matches', 'muted'));
    for (const p of individuals) {
      const li = el('li');
      li.append(el('strong', displayName(p)));
      if (p.preferredName && (p.firstName || p.lastName)) li.append(el('span', ` “${p.preferredName}”`));
      li.append(el('div', `Last seen ${fmt(p.lastSeenAt) || 'never'} · ${p.encounterCount} contact(s)`, 'muted'));
      const btn = el('button', 'Open', 'secondary');
      btn.addEventListener('click', () => openPerson(p.id));
      li.append(btn);
      ul.append(li);
    }
    if (total > individuals.length) ul.append(el('li', `Showing ${individuals.length} of ${total}. Refine your search.`, 'muted'));
  } catch (err) {
    flash(err.message, 'error');
  }
});

async function openPerson(id) {
  clearFlash();
  try {
    const { individual: p, encounters } = await api('GET', '/individuals/' + id);
    state.personId = id;
    state.encLoc = null;
    $('#enc-loc-status').textContent = 'Not captured yet';
    $('#person-name').textContent = displayName(p);
    const dl = $('#person-details');
    dl.replaceChildren();
    const rows = [
      ['Preferred name', p.preferredName],
      ['Date of birth', p.dateOfBirth],
      ['Approx. age', p.approximateAge],
      ['Gender', p.gender],
      ['Phone', p.phone],
      ['Veteran', p.veteranStatus],
      ['Description', p.physicalDescription],
      ['Needs', p.needs.join(', ')],
      ['Notes', p.notes],
      ['Consent recorded', p.consentGiven ? 'Yes' : 'No'],
      ['First entered', `${fmt(p.createdAt)} by ${p.createdByName || 'unknown'}`],
    ];
    for (const [k, v] of rows) {
      if (v === null || v === undefined || v === '') continue;
      dl.append(el('dt', k), el('dd', String(v)));
    }
    const ul = $('#encounters');
    ul.replaceChildren();
    for (const enc of encounters) {
      const li = el('li');
      li.append(el('strong', fmt(enc.occurredAt)));
      li.append(el('div', `Recorded by ${enc.recordedByName || 'unknown'}`, 'muted'));
      if (enc.location) {
        const a = el('a', `${enc.location.latitude.toFixed(5)}, ${enc.location.longitude.toFixed(5)}`);
        a.href = `https://www.openstreetmap.org/?mlat=${enc.location.latitude}&mlon=${enc.location.longitude}#map=17/${enc.location.latitude}/${enc.location.longitude}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        const d = el('div');
        d.append('📍 ', a);
        if (enc.location.accuracyMeters) d.append(` (±${Math.round(enc.location.accuracyMeters)} m)`);
        li.append(d);
      } else {
        li.append(el('div', 'No GPS location', 'muted'));
      }
      if (enc.locationDescription) li.append(el('div', enc.locationDescription));
      if (enc.servicesProvided.length) li.append(el('div', 'Services: ' + enc.servicesProvided.join(', ')));
      if (enc.notes) li.append(el('div', enc.notes));
      ul.append(li);
    }
    show('person');
    captureLocation('#enc-loc-status', 'encLoc');
  } catch (err) {
    flash(err.message, 'error');
  }
}

$('#enc-loc-btn').addEventListener('click', () => captureLocation('#enc-loc-status', 'encLoc'));

$('#encounter-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = formValues(e.target);
  try {
    await api('POST', `/individuals/${state.personId}/encounters`, {
      location: state.encLoc,
      locationDescription: v.locationDescription,
      servicesProvided: list(v.servicesProvided),
      notes: v.notes,
    });
    e.target.reset();
    await openPerson(state.personId);
    flash('Contact saved.');
  } catch (err) {
    flash(err.message, 'error');
  }
});

// ---------- admin: users ----------
async function loadUsers() {
  try {
    const { users } = await api('GET', '/users');
    const ul = $('#users');
    ul.replaceChildren();
    for (const u of users) {
      const li = el('li');
      li.append(el('strong', `${u.fullName} (${u.role})`));
      li.append(el('div', `${u.email} · ${u.isActive ? 'active' : 'DEACTIVATED'} · last login ${fmt(u.lastLoginAt) || 'never'}`, 'muted'));
      if (u.id !== state.user.id) {
        const toggle = el('button', u.isActive ? 'Deactivate' : 'Reactivate', 'secondary');
        toggle.addEventListener('click', async () => {
          try {
            await api('PATCH', '/users/' + u.id, { isActive: !u.isActive });
            loadUsers();
          } catch (err) {
            flash(err.message, 'error');
          }
        });
        const reset = el('button', 'Reset password', 'secondary');
        reset.addEventListener('click', async () => {
          if (!confirm(`Reset password for ${u.fullName}? They will be signed out everywhere.`)) return;
          try {
            const { temporaryPassword } = await api('POST', `/users/${u.id}/reset-password`, {});
            showTempPassword(u.email, temporaryPassword);
          } catch (err) {
            flash(err.message, 'error');
          }
        });
        li.append(toggle, ' ', reset);
      }
      ul.append(li);
    }
  } catch (err) {
    flash(err.message, 'error');
  }
}

function showTempPassword(email, pw) {
  const box = $('#flash');
  box.replaceChildren(
    `Temporary password for ${email} (shown once, give it to them privately): `,
    el('code', pw),
  );
  box.className = 'ok';
  box.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  try {
    const { user, temporaryPassword } = await api('POST', '/users', formValues(e.target));
    e.target.reset();
    showTempPassword(user.email, temporaryPassword);
    loadUsers();
  } catch (err) {
    flash(err.message, 'error');
  }
});

// ---------- boot ----------
api('GET', '/auth/me')
  .then(({ user }) => {
    state.user = user;
    afterLogin();
  })
  .catch(() => show('login'));
