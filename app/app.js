'use strict';
// Project Lorenzo outreach client. This file is only served to signed-in
// users. All rendering uses textContent (never innerHTML) so client-entered
// data cannot inject markup.

const $ = (sel) => document.querySelector(sel);
const state = { user: null, config: null, personId: null, person: null, recordsOffset: 0 };
const PAGE = 25;
const RANK = { volunteer: 1, staff: 2, admin: 3 };
const atLeast = (role) => RANK[state.user?.role] >= RANK[role];

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/change-password') {
    window.location.replace('/login');
    throw new Error('Signed out');
  }
  if (!res.ok) {
    const details = data.details ? ' ' + Object.values(data.details).flat().join(' ') : '';
    throw new Error((data.error || 'Request failed') + details);
  }
  return data;
}

function flash(msg, kind = 'ok') {
  const box = $('#flash');
  box.textContent = msg;
  box.className = kind;
  box.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const clearFlash = () => ($('#flash').hidden = true);

function show(view) {
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== 'view-' + view));
  $('#nav').hidden = !state.user || state.user.mustChangePassword;
  document.querySelectorAll('[data-admin]').forEach((b) => (b.hidden = !atLeast('admin')));
  document.querySelectorAll('[data-staff]').forEach((b) => (b.hidden = !atLeast('staff')));
  if (view === 'users') loadUsers();
  if (view === 'records') loadRecords();
  if (view === 'map') loadMap();
  if (view === 'intake') intakePicker.autoCapture();
}

const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString([], { dateStyle: 'medium' }) : '');
const coords = (l) => `${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`;
const displayName = (p) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') ||
  p.preferredName ||
  (p.physicalDescription ? 'Unnamed: ' + p.physicalDescription.slice(0, 40) : 'Unnamed');
function ageOf(p) {
  if (p.dateOfBirth) {
    const b = new Date(p.dateOfBirth + 'T00:00');
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
    return String(a);
  }
  return p.approximateAge !== null && p.approximateAge !== undefined ? '~' + p.approximateAge : '';
}
function formValues(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

// ---------- maps ----------
function makeMap(container) {
  const v = state.config.map.defaultView;
  const map = L.map(container, { attributionControl: true }).setView([v.latitude, v.longitude], v.zoom);
  L.tileLayer(state.config.map.tileUrl, {
    maxZoom: 19,
    attribution: state.config.map.attribution,
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  return map;
}
let lastCenter = null; // most recent location seen this session, used to centre the pin-drop map
const DOT = { radius: 8, color: '#1f5fbf', weight: 2, fillColor: '#1f5fbf', fillOpacity: 0.55 };
const PIN = { radius: 10, color: '#b42318', weight: 3, fillColor: '#b42318', fillOpacity: 0.6 };

function popupFor(enc, { withName }) {
  const box = el('div');
  if (withName) {
    const b = el('button', enc.individualName || 'Unnamed', 'linklike');
    b.addEventListener('click', () => openPerson(enc.individualId));
    box.append(b, el('br'));
  }
  box.append(el('strong', fmt(enc.occurredAt)));
  if (enc.locationDescription) box.append(el('div', enc.locationDescription));
  if (enc.servicesProvided?.length) box.append(el('div', 'Services: ' + enc.servicesProvided.join(', ')));
  box.append(el('div', `${enc.location.source === 'manual' ? 'Set manually' : 'GPS'} · by ${enc.recordedByName || 'unknown'}`, 'muted'));
  return box;
}

function plot(map, layer, encounters, opts) {
  layer.clearLayers();
  const pts = [];
  const markers = new Map();
  for (const enc of encounters) {
    if (!enc.location) continue;
    const ll = [enc.location.latitude, enc.location.longitude];
    pts.push(ll);
    markers.set(enc.id, L.circleMarker(ll, DOT).bindPopup(() => popupFor(enc, opts)).addTo(layer));
  }
  map.invalidateSize();
  if (pts.length) {
    map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
    lastCenter ??= pts[0];
  }
  return markers;
}

/**
 * Location control used for intake, new contacts and corrections. The
 * location can come from the device's GPS, or be set by hand: tap the map to
 * drop a pin, or type coordinates.
 */
function createLocationPicker(container) {
  let value = null;
  let map = null;
  let pin = null;
  let touched = false;
  const root = typeof container === 'string' ? $(container) : container;
  root.classList.add('picker');
  const status = el('span', 'No location set');
  const gpsBtn = el('button', 'Use my location', 'secondary');
  const manualBtn = el('button', 'Set on map', 'secondary');
  const clearBtn = el('button', 'Clear', 'secondary');
  for (const b of [gpsBtn, manualBtn, clearBtn]) b.type = 'button';
  const bar = el('div', null, 'bar');
  bar.append(el('strong', 'Location:'), status, gpsBtn, manualBtn, clearBtn);
  const manual = el('div', null, 'manual');
  manual.hidden = true;
  const lat = el('input');
  const lng = el('input');
  for (const [i, name] of [[lat, 'Latitude'], [lng, 'Longitude']]) {
    i.type = 'number';
    i.step = 'any';
    i.placeholder = name;
    i.setAttribute('aria-label', name);
  }
  const row = el('div', null, 'row');
  row.append(lat, lng);
  const mapEl = el('div', null, 'map');
  manual.append(el('div', 'Tap the map to drop a pin, or type coordinates.', 'muted'), mapEl, row);
  root.replaceChildren(bar, manual);

  function render() {
    if (value) lastCenter = [value.latitude, value.longitude];
    if (!value) status.textContent = 'No location set';
    else if (value.source === 'manual') status.textContent = `${coords(value)} (set manually)`;
    else status.textContent = `${coords(value)} (GPS ±${value.accuracyMeters ?? '?'} m)`;
    if (map) {
      if (pin) pin.remove();
      pin = value ? L.circleMarker([value.latitude, value.longitude], PIN).addTo(map) : null;
    }
  }
  function setManual(la, lo, recenter) {
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return;
    touched = true;
    value = { latitude: la, longitude: lo, source: 'manual' };
    lat.value = la.toFixed(6);
    lng.value = lo.toFixed(6);
    render();
    if (recenter && map) map.setView([la, lo], Math.max(map.getZoom(), 15));
  }
  function openManual() {
    manual.hidden = false;
    if (!map) {
      map = makeMap(mapEl);
      map.on('click', (e) => setManual(e.latlng.lat, e.latlng.lng, false));
    }
    map.invalidateSize();
    if (value) {
      map.setView([value.latitude, value.longitude], 16);
    } else if (lastCenter) {
      // Start near where the team has been working rather than a whole-country view.
      map.setView(lastCenter, 14);
    } else if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => !value && map.setView([pos.coords.latitude, pos.coords.longitude], 15),
        () => {},
        { timeout: 8000, maximumAge: 300000 },
      );
    }
    render();
  }
  function gps(silent) {
    if (!('geolocation' in navigator)) {
      if (!silent) status.textContent = 'This device cannot provide a location. Set it on the map instead.';
      return;
    }
    status.textContent = 'Getting location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (silent && touched) return render();
        value = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: Math.round(pos.coords.accuracy),
          source: 'device_gps',
        };
        render();
        if (map) map.setView([value.latitude, value.longitude], 16);
      },
      (err) => {
        render();
        if (!value) status.textContent = `Location unavailable (${err.message}). Set it on the map instead.`;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }
  gpsBtn.addEventListener('click', () => {
    touched = true;
    gps(false);
  });
  manualBtn.addEventListener('click', () => (manual.hidden ? openManual() : (manual.hidden = true)));
  clearBtn.addEventListener('click', () => {
    touched = true;
    value = null;
    lat.value = lng.value = '';
    render();
  });
  const typed = () => setManual(parseFloat(lat.value), parseFloat(lng.value), true);
  lat.addEventListener('change', typed);
  lng.addEventListener('change', typed);

  return {
    get: () => value,
    set(v) {
      value = v ? { ...v } : null;
      render();
    },
    reset() {
      value = null;
      touched = false;
      lat.value = lng.value = '';
      manual.hidden = true;
      render();
    },
    // Try GPS without overriding a location the user has already chosen.
    autoCapture() {
      if (!value && !touched) gps(true);
    },
    openManual,
  };
}

// ---------- auth ----------
$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  try {
    await api('POST', '/auth/change-password', formValues(e.target));
    e.target.reset();
    state.user.mustChangePassword = false;
    state.config = await api('GET', '/config');
    show('intake');
    flash('Password updated.');
  } catch (err) {
    flash(err.message, 'error');
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/auth/logout', {}).catch(() => {});
  window.location.replace('/login');
});

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    clearFlash();
    show(b.dataset.view);
  }),
);

// ---------- intake ----------
const intakePicker = createLocationPicker('#intake-location');

function personBody(form) {
  const v = formValues(form);
  return {
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
    consentGiven: form.consentGiven.checked,
  };
}

$('#intake-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  const v = formValues(e.target);
  const { notes, ...person } = personBody(e.target);
  const loc = intakePicker.get();
  const body = {
    ...person,
    notes,
    encounter: {
      location: loc,
      locationDescription: v.locationDescription,
      servicesProvided: list(v.servicesProvided),
    },
  };
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { individual } = await api('POST', '/individuals', body);
    e.target.reset();
    intakePicker.reset();
    intakePicker.autoCapture();
    flash(`Saved ${displayName(individual)}${loc ? ' with location' : ' (no location)'}.`);
  } catch (err) {
    flash(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- records ----------
async function loadRecords() {
  try {
    const f = formValues($('#records-form'));
    const qs = new URLSearchParams({ limit: PAGE, offset: state.recordsOffset, sort: f.sort });
    for (const k of ['q', 'need', 'veteranStatus', 'hasLocation']) if (f[k]) qs.set(k, f[k]);
    const [{ individuals, total }, stats] = await Promise.all([api('GET', '/individuals?' + qs), api('GET', '/stats')]);

    const tiles = [
      [stats.individuals, 'People on record'],
      [stats.newIndividuals30d, 'New in 30 days'],
      [stats.encounters, 'Total contacts'],
      [stats.encounters7d, 'Contacts in 7 days'],
      [stats.encounters30d, 'Contacts in 30 days'],
      [stats.encountersWithoutLocation, 'Entries with no location'],
    ];
    $('#stats').replaceChildren(
      ...tiles.map(([n, label]) => {
        const d = el('div', null, 'stat');
        d.append(el('b', String(n)), el('span', label, 'muted'));
        return d;
      }),
    );

    const tbody = $('#records-table tbody');
    tbody.replaceChildren();
    for (const p of individuals) {
      const tr = el('tr', null, 'clickable');
      tr.tabIndex = 0;
      const name = el('td');
      name.append(el('strong', displayName(p)));
      if (p.preferredName && (p.firstName || p.lastName)) name.append(el('div', `“${p.preferredName}”`, 'muted'));
      const where = p.lastLocation
        ? (p.lastLocationDescription ? p.lastLocationDescription + ' · ' : '') + coords(p.lastLocation)
        : p.lastLocationDescription || '—';
      tr.append(
        name,
        el('td', ageOf(p)),
        el('td', p.gender || ''),
        el('td', p.veteranStatus || ''),
        el('td', p.phone || '', 'nowrap'),
        el('td', p.needs.join(', ')),
        el('td', String(p.encounterCount)),
        el('td', fmt(p.lastSeenAt), 'nowrap'),
        el('td', where),
        el('td', `${fmtDay(p.createdAt)}${p.createdByName ? ' by ' + p.createdByName : ''}`),
        el('td', p.consentGiven ? 'Yes' : 'No'),
      );
      const open = () => openPerson(p.id);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (ev) => ev.key === 'Enter' && open());
      tbody.append(tr);
    }
    if (!individuals.length) {
      const td = el('td', 'No records match.', 'muted');
      td.colSpan = 11;
      const tr = el('tr');
      tr.append(td);
      tbody.append(tr);
    }
    const from = total ? state.recordsOffset + 1 : 0;
    $('#records-count').textContent = `${from}–${state.recordsOffset + individuals.length} of ${total}`;
    $('#records-prev').disabled = state.recordsOffset === 0;
    $('#records-next').disabled = state.recordsOffset + individuals.length >= total;
  } catch (err) {
    flash(err.message, 'error');
  }
}
$('#records-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.recordsOffset = 0;
  loadRecords();
});
$('#records-prev').addEventListener('click', () => {
  state.recordsOffset = Math.max(0, state.recordsOffset - PAGE);
  loadRecords();
});
$('#records-next').addEventListener('click', () => {
  state.recordsOffset += PAGE;
  loadRecords();
});

// ---------- map of all entries (staff and above) ----------
let bigMap = null;
let bigLayer = null;
async function loadMap() {
  try {
    const f = formValues($('#map-form'));
    const qs = new URLSearchParams({ limit: 2000 });
    if (f.from) qs.set('from', new Date(f.from + 'T00:00:00').toISOString());
    if (f.to) qs.set('to', new Date(f.to + 'T23:59:59.999').toISOString());
    const { encounters } = await api('GET', '/encounters?' + qs);
    if (!bigMap) {
      bigMap = makeMap($('#map'));
      bigLayer = L.layerGroup().addTo(bigMap);
    }
    const markers = plot(bigMap, bigLayer, encounters, { withName: true });
    $('#map-count').textContent = `${encounters.length} entries, ${markers.size} on the map`;

    const tbody = $('#log-table tbody');
    tbody.replaceChildren();
    for (const enc of encounters) {
      const tr = el('tr');
      const person = el('td');
      const b = el('button', enc.individualName || 'Unnamed', 'linklike');
      b.addEventListener('click', () => openPerson(enc.individualId));
      person.append(b);
      const loc = el('td', null, 'nowrap');
      if (enc.location) {
        const s = el('button', coords(enc.location), 'linklike');
        s.title = 'Show on map';
        s.addEventListener('click', () => {
          $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
          bigMap.setView([enc.location.latitude, enc.location.longitude], 17);
          markers.get(enc.id).openPopup();
        });
        loc.append(s, el('span', enc.location.source === 'manual' ? ' (manual)' : '', 'muted'));
      } else {
        loc.append(el('span', 'No location', 'muted'));
      }
      tr.append(
        el('td', fmt(enc.occurredAt), 'nowrap'),
        person,
        loc,
        el('td', enc.locationDescription || ''),
        el('td', enc.servicesProvided.join(', ')),
        el('td', enc.recordedByName || ''),
      );
      tbody.append(tr);
    }
  } catch (err) {
    flash(err.message, 'error');
  }
}
$('#map-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadMap();
});

// ---------- person ----------
const encounterPicker = createLocationPicker('#encounter-location');
let personMap = null;
let personLayer = null;

async function openPerson(id, { keepFlash = false } = {}) {
  if (!keepFlash) clearFlash();
  try {
    const { individual: p, encounters } = await api('GET', '/individuals/' + id);
    state.personId = id;
    state.person = p;
    $('#person-name').textContent = displayName(p);
    $('#edit-person-form').hidden = true;
    const dl = $('#person-details');
    dl.replaceChildren();
    const rows = [
      ['Preferred name', p.preferredName],
      ['Date of birth', p.dateOfBirth],
      ['Age', ageOf(p)],
      ['Gender', p.gender],
      ['Phone', p.phone],
      ['Veteran', p.veteranStatus],
      ['Description', p.physicalDescription],
      ['Needs', p.needs.join(', ')],
      ['Notes', p.notes],
      ['Consent recorded', p.consentGiven ? 'Yes' : 'No'],
      ['Contacts', String(encounters.length)],
      ['First entered', `${fmt(p.createdAt)} by ${p.createdByName || 'unknown'}`],
      ['Last updated', fmt(p.updatedAt)],
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
        const how = enc.location.source === 'manual' ? 'set manually' : `GPS ±${Math.round(enc.location.accuracyMeters ?? 0)} m`;
        li.append(el('div', `📍 ${coords(enc.location)} (${how})`));
      } else {
        li.append(el('div', 'No location recorded', 'muted'));
      }
      if (enc.locationDescription) li.append(el('div', enc.locationDescription));
      if (enc.servicesProvided.length) li.append(el('div', 'Services: ' + enc.servicesProvided.join(', ')));
      if (enc.notes) li.append(el('div', enc.notes));
      if (atLeast('staff')) {
        const btn = el('button', enc.location ? 'Change location' : 'Add location', 'secondary');
        btn.addEventListener('click', () => {
          btn.hidden = true;
          const box = el('div');
          const save = el('button', 'Save location');
          li.append(box, save);
          const picker = createLocationPicker(box);
          picker.set(enc.location);
          picker.openManual();
          save.addEventListener('click', async () => {
            try {
              await api('PATCH', '/encounters/' + enc.id, { location: picker.get() });
              await openPerson(id, { keepFlash: true });
              flash('Location updated.');
            } catch (err) {
              flash(err.message, 'error');
            }
          });
        });
        li.append(btn);
      }
      ul.append(li);
    }

    encounterPicker.reset();
    show('person');
    if (!personMap) {
      personMap = makeMap($('#person-map'));
      personLayer = L.layerGroup().addTo(personMap);
    }
    plot(personMap, personLayer, encounters, { withName: false });
    encounterPicker.autoCapture();
    window.scrollTo({ top: 0 });
  } catch (err) {
    flash(err.message, 'error');
  }
}

$('#edit-person-btn').addEventListener('click', () => {
  const f = $('#edit-person-form');
  const p = state.person;
  for (const k of ['firstName', 'lastName', 'preferredName', 'dateOfBirth', 'approximateAge', 'gender', 'phone', 'veteranStatus', 'physicalDescription', 'notes']) {
    f.elements[k].value = p[k] ?? '';
  }
  f.elements.needs.value = p.needs.join(', ');
  f.elements.consentGiven.checked = p.consentGiven;
  f.hidden = false;
});
$('#edit-person-cancel').addEventListener('click', () => ($('#edit-person-form').hidden = true));
$('#edit-person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PATCH', '/individuals/' + state.personId, personBody(e.target));
    await openPerson(state.personId, { keepFlash: true });
    flash('Details saved.');
  } catch (err) {
    flash(err.message, 'error');
  }
});

$('#encounter-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = formValues(e.target);
  try {
    await api('POST', `/individuals/${state.personId}/encounters`, {
      location: encounterPicker.get(),
      locationDescription: v.locationDescription,
      servicesProvided: list(v.servicesProvided),
      notes: v.notes,
    });
    e.target.reset();
    await openPerson(state.personId, { keepFlash: true });
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
  box.replaceChildren(`Temporary password for ${email} (shown once, give it to them privately): `, el('code', pw));
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
(async () => {
  try {
    state.user = (await api('GET', '/auth/me')).user;
    if (state.user.mustChangePassword) return show('password');
    state.config = await api('GET', '/config');
    show('intake');
  } catch (err) {
    if (err.message !== 'Signed out') flash(err.message, 'error');
  }
})();
