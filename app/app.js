'use strict';
// Project Lorenzo outreach client. This file is only served to signed-in
// users. All rendering uses textContent (never innerHTML with data) so
// client-entered data cannot inject markup. Styles: public/styles.css, built
// from the Project Lorenzo design system (pl-* classes).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const state = { user: null, config: null, personId: null, person: null, recordsOffset: 0, view: null };
const PAGE = 25;
const RANK = { volunteer: 1, staff: 2, admin: 3 };
const atLeast = (role) => RANK[state.user?.role] >= RANK[role];
const MIN_PASSWORD = 12;
const NEEDS = ['Food', 'Shelter', 'Medical', 'ID', 'Clothing', 'Hygiene', 'Mental health', 'Transport', 'Phone'];
const SERVICES = ['Meal', 'Water', 'Hygiene kit', 'Socks', 'Blanket', 'Referral', 'Bus pass'];

// ---------- theme (day / night / follow device) ----------
const THEME_KEY = 'pl-theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    return 'system';
  }
}
function applyTheme() {
  const pref = storedTheme();
  const resolved = pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  const label = { system: 'Theme: match this device', light: 'Theme: Day', dark: 'Theme: Night' }[pref];
  if ($('#theme-label')) $('#theme-label').textContent = label;
  if ($('#theme-btn-top')) $('#theme-btn-top').textContent = { system: 'Theme: Auto', light: 'Theme: Day', dark: 'Theme: Night' }[pref];
}
function cycleTheme() {
  const next = { system: 'dark', dark: 'light', light: 'system' }[storedTheme()];
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private mode: theme just won't be remembered */
  }
  applyTheme();
}
darkQuery.addEventListener?.('change', applyTheme);
applyTheme();

// ---------- helpers ----------
async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    const err = new Error('Nothing was lost — what you entered is still here. Check your signal and try again.');
    err.title = 'No connection';
    throw err;
  }
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

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  alert: ['path:M12 3 2 20h20L12 3z', 'path:M12 10v4.5M12 17.5v.01'],
  check: ['circle:12,12,9', 'path:m8 12.5 2.8 2.7L16.5 9.5'],
  info: ['circle:12,12,9', 'path:M12 11v5.5M12 7.5v.01'],
  offline: ['path:M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0', 'circle:12,19,1', 'path:M3 3l18 18'],
  locate: ['circle:12,12,7', 'circle:12,12,2.5', 'path:M12 2v3M12 19v3M2 12h3M19 12h3'],
  pin: ['path:M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z', 'circle:12,9.5,2.5'],
  x: ['path:M6 6l12 12M18 6 6 18'],
  plus: ['path:M12 5v14M5 12h14'],
  list: ['path:M8 6h13M8 12h13M8 18h13'],
  search: ['circle:11,11,6.5', 'path:m20 20-4.2-4.2'],
  map: ['path:M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z', 'path:M9 4v14M15 6v14'],
};
function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', ('pl-icon ' + cls).trim());
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of ICONS[name]) {
    const [tag, val] = part.split(':');
    const n = document.createElementNS(SVG_NS, tag);
    if (tag === 'path') n.setAttribute('d', val);
    else {
      const [cx, cy, r] = val.split(',');
      n.setAttribute('cx', cx);
      n.setAttribute('cy', cy);
      n.setAttribute('r', r);
    }
    svg.append(n);
  }
  return svg;
}

const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
function button(label, cls, iconName) {
  const b = el('button', null, 'pl-btn ' + cls);
  b.type = 'button';
  if (iconName) b.append(icon(iconName, cls.includes('--sm') ? 'pl-icon--sm' : ''));
  b.append(label);
  return b;
}
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const coords = (l) => `${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmt(d) {
  if (!d) return '';
  const t = new Date(d);
  const now = new Date();
  const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay(t, now)) return `Today, ${time}`;
  const opts = { month: 'short', day: 'numeric' };
  if (t.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${t.toLocaleDateString([], opts)}, ${time}`;
}
function fmtDay(d) {
  if (!d) return '';
  const t = new Date(d);
  const opts = { month: 'short', day: 'numeric' };
  if (t.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return t.toLocaleDateString([], opts);
}
const fullName = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ');
const displayName = (p) => fullName(p) || p.preferredName || 'Unnamed';
/** The line under a name: their nickname in quotes, or their description if unnamed. */
function akaOf(p) {
  if (fullName(p) && p.preferredName) return `“${p.preferredName}”`;
  if (!fullName(p) && !p.preferredName && p.physicalDescription) return p.physicalDescription;
  return '';
}
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
function tags(values) {
  const wrap = el('span', null, 'pl-tags');
  for (const v of values) wrap.append(el('span', v, 'pl-tag'));
  return wrap;
}
async function busy(btn, fn) {
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
}

// ---------- banners ----------
function banner(kind, title, detail, action) {
  const box = el('div', null, `pl-banner pl-banner--${kind}`);
  box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  box.append(icon({ error: 'alert', ok: 'check', info: 'info', offline: 'offline' }[kind] || 'info'));
  const body = el('div', null, 'pl-banner__body');
  if (title) body.append(el('b', title));
  if (detail) body.append(detail);
  if (action) body.append(' ', action);
  box.append(body);
  return box;
}
function flash(msg, kind = 'ok', { title, action } = {}) {
  const box = $('#flash');
  const t = title || (kind === 'error' ? 'Something went wrong' : null);
  box.replaceChildren(banner(kind, t, msg, action));
  box.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function flashError(err) {
  if (err.message === 'Signed out') return;
  flash(err.message, 'error', { title: err.title });
}
const clearFlash = () => {
  $('#flash').hidden = true;
  $('#flash').replaceChildren();
};

// ---------- navigation ----------
function show(view) {
  state.view = view;
  const signedIn = state.user && !state.user.mustChangePassword;
  $$('main > section').forEach((s) => (s.hidden = s.id !== 'view-' + view));
  $('#main').classList.toggle('pl-main--wide', ['records', 'map', 'person', 'users'].includes(view));
  $('#main').classList.toggle('pl-main--narrow', view === 'password');
  for (const id of ['#nav', '#account', '#menu-btn', '#tabbar']) $(id).hidden = !signedIn;
  $$('[data-admin]').forEach((b) => (b.hidden = !atLeast('admin')));
  $$('[data-staff]').forEach((b) => (b.hidden = !atLeast('staff')));
  const navKey = view === 'person' ? 'records' : view;
  $$('.pl-nav a, .pl-tabbar a').forEach((a) => {
    if (a.dataset.view === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if ($('#menu').open) $('#menu').close();
  if (view === 'users') loadUsers();
  if (view === 'records') loadRecords();
  if (view === 'map') loadMap();
  if (view === 'intake') intakePicker.autoCapture();
  if (view === 'password') setupPasswordView();
}

$$('[data-view]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    clearFlash();
    if (a.dataset.view === 'password' && !state.user?.mustChangePassword) state.voluntaryPassword = true;
    show(a.dataset.view);
    window.scrollTo({ top: 0 });
  }),
);

async function signOut() {
  await api('POST', '/auth/logout', {}).catch(() => {});
  window.location.replace('/login');
}
$('#logout').addEventListener('click', signOut);
$('#logout-menu').addEventListener('click', signOut);
$('#theme-btn').addEventListener('click', cycleTheme);
$('#theme-btn-top').addEventListener('click', cycleTheme);
const openMenu = (e) => {
  e.preventDefault();
  $('#menu').showModal();
};
$('#menu-btn').addEventListener('click', openMenu);
$('#tab-more').addEventListener('click', openMenu);
$('#menu-close').addEventListener('click', () => $('#menu').close());
$('#menu').addEventListener('click', (e) => e.target === $('#menu') && $('#menu').close());

// ---------- show / hide password toggles ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('.pl-pw__toggle');
  if (!t) return;
  const input = t.parentElement.querySelector('input');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  t.textContent = showing ? 'Show' : 'Hide';
  t.setAttribute('aria-pressed', String(!showing));
});

// ---------- choice chips (needs, services) ----------
/**
 * Fills <div data-chips data-label data-add> with checkbox chips for the preset
 * values plus an "add another" field. get() returns the checked values.
 */
function createChips(container, presets) {
  const name = container.dataset.chips;
  const fs = el('fieldset', null, 'pl-fieldset');
  const legend = el('legend', null, 'pl-label');
  legend.append(container.dataset.label + ' ', el('span', '(optional)', 'pl-opt'));
  const row = el('div', null, 'pl-chips');
  const add = el('div', null, 'pl-tagadd');
  const input = el('input', null, 'pl-input');
  input.maxLength = 100;
  input.placeholder = container.dataset.add;
  input.setAttribute('aria-label', container.dataset.add);
  input.autocomplete = 'off';
  const addBtn = button('Add', 'pl-btn--secondary');
  add.append(input, addBtn);
  fs.append(legend, row, add);
  container.replaceChildren(fs);

  const chip = (value, checked) => {
    const label = el('label', null, 'pl-chip');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.name = name;
    cb.value = value;
    cb.checked = checked;
    label.append(cb, el('span', value));
    row.append(label);
    return cb;
  };
  const boxes = () => $$('input[type=checkbox]', row);
  const find = (v) => boxes().find((b) => b.value.toLowerCase() === v.toLowerCase());
  function addValue(raw, checked = true) {
    for (const v of list(raw)) {
      const existing = find(v);
      if (existing) existing.checked = checked || existing.checked;
      else chip(v, checked);
    }
  }
  function reset() {
    row.replaceChildren();
    for (const p of presets) chip(p, false);
    input.value = '';
  }
  const commit = () => {
    addValue(input.value);
    input.value = '';
    input.focus();
  };
  addBtn.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });
  reset();
  return {
    // Values still typed in the box (not yet added) are included too.
    get: () => [...new Set([...boxes().filter((b) => b.checked).map((b) => b.value), ...list(input.value)])],
    set(values) {
      reset();
      addValue((values || []).join(','));
    },
    reset,
  };
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
const markerIcon = (source) =>
  L.divIcon({
    className: 'pl-divicon',
    html: `<span class="pl-marker pl-marker--${source === 'manual' ? 'manual' : 'gps'}"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
const pinIcon = () =>
  L.divIcon({ className: 'pl-divicon', html: '<span class="pl-pin"></span>', iconSize: [32, 44], iconAnchor: [16, 42] });
const locationLabel = (l) =>
  l.source === 'manual' ? 'Set manually' : `GPS${l.accuracyMeters !== null && l.accuracyMeters !== undefined ? ` ±${Math.round(l.accuracyMeters)} m` : ''}`;

function popupFor(enc, { withName }) {
  const box = el('div', null, 'pl-popup');
  if (withName) {
    const b = el('button', enc.individualName || 'Unnamed', 'pl-linkbtn pl-popup__name');
    b.type = 'button';
    b.addEventListener('click', () => openPerson(enc.individualId));
    box.append(b);
  } else {
    box.append(el('span', fmt(enc.occurredAt), 'pl-popup__name'));
  }
  const dl = el('dl');
  const rows = [
    withName && ['When', fmt(enc.occurredAt)],
    enc.locationDescription && ['Where', enc.locationDescription],
    enc.servicesProvided?.length && ['Services', enc.servicesProvided.join(', ')],
    ['Location', locationLabel(enc.location)],
    ['Recorded by', enc.recordedByName || 'Unknown'],
  ].filter(Boolean);
  for (const [k, v] of rows) dl.append(el('dt', k), el('dd', v));
  box.append(dl);
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
    const m = L.marker(ll, { icon: markerIcon(enc.location.source), keyboard: true, title: fmt(enc.occurredAt) })
      .bindPopup(() => popupFor(enc, opts), { maxWidth: 300 })
      .addTo(layer);
    markers.set(enc.id, m);
  }
  map.invalidateSize();
  if (pts.length) {
    map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
    lastCenter ??= pts[0];
  }
  return markers;
}

/**
 * The location box used for intake, new contacts and corrections. The location
 * can come from the device's GPS, or be set by hand: tap the map to drop a pin,
 * drag it, or type coordinates.
 */
function createLocationPicker(container, { title = 'Location', headingLevel = 2, showClear = true } = {}) {
  let value = null;
  let map = null;
  let pin = null;
  let touched = false;
  let pending = false;
  let failure = null;
  const root = typeof container === 'string' ? $(container) : container;
  const uid = Math.random().toString(36).slice(2, 8);

  const box = el('section', null, 'pl-loc');
  box.setAttribute('aria-labelledby', 'loc-h-' + uid);
  const head = el('div', null, 'pl-loc__head');
  const h = el('h' + headingLevel, title, 'pl-title-3');
  h.id = 'loc-h-' + uid;
  const clearBtn = button('Clear', 'pl-btn--quiet pl-btn--sm', 'x');
  head.append(h);
  if (showClear) head.append(clearBtn);
  const status = el('div', null, 'pl-loc__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const mark = el('span', null, 'pl-loc__mark');
  mark.setAttribute('aria-hidden', 'true');
  const statusText = el('span');
  status.append(mark, statusText);
  const actions = el('div', null, 'pl-loc__actions');
  const gpsBtn = button('Use my location', 'pl-btn--secondary', 'locate');
  const manualBtn = button('Set on map', 'pl-btn--secondary', 'pin');
  manualBtn.setAttribute('aria-expanded', 'false');
  actions.append(gpsBtn, manualBtn);

  const picker = el('div', null, 'pl-loc__picker');
  picker.hidden = true;
  const mapEl = el('div', null, 'pl-map');
  mapEl.setAttribute('role', 'region');
  mapEl.setAttribute('aria-label', 'Tap the map to drop a pin');
  const coordsRow = el('div', null, 'pl-loc__coords');
  const field = (label) => {
    const l = el('label', null, 'pl-field');
    const i = el('input', null, 'pl-input');
    i.type = 'number';
    i.step = 'any';
    i.inputMode = 'decimal';
    l.append(el('span', label, 'pl-label'), i);
    coordsRow.append(l);
    return i;
  };
  const lat = field('Latitude');
  const lng = field('Longitude');
  picker.append(mapEl, coordsRow, el('p', 'Tap the map or drag the pin, or type coordinates. Saved as “set manually”.', 'pl-loc__tip'));
  box.append(head, status, actions, picker);
  root.replaceChildren(box);

  function render() {
    if (value) lastCenter = [value.latitude, value.longitude];
    const kind = pending ? 'pending' : !value ? 'none' : value.source === 'manual' ? 'manual' : 'gps';
    box.className = 'pl-loc pl-loc--' + kind;
    const line = (b, detail, mono) => {
      statusText.replaceChildren(el('b', b), el('span', detail, mono ? 'pl-mono' : 'pl-small'));
    };
    if (kind === 'pending') line('Getting location…', 'This can take up to 20 seconds with weak signal.');
    else if (kind === 'none' && failure) line('Location unavailable', failure);
    else if (kind === 'none') line('No location set', 'You can still save. Use your location, or set it on the map.');
    else if (kind === 'manual') line('Set manually', coords(value), true);
    else line('GPS location saved', `${coords(value)}${value.accuracyMeters !== undefined && value.accuracyMeters !== null ? ` ±${value.accuracyMeters} m` : ''}`, true);
    gpsBtn.toggleAttribute('aria-busy', pending);
    clearBtn.disabled = !value;
    if (map) {
      if (pin) pin.remove();
      pin = null;
      if (value) {
        pin = L.marker([value.latitude, value.longitude], { icon: pinIcon(), draggable: true, keyboard: false }).addTo(map);
        pin.on('dragend', () => {
          const p = pin.getLatLng();
          setManual(p.lat, p.lng, false);
        });
      }
    }
  }
  function setManual(la, lo, recenter) {
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return;
    touched = true;
    pending = false;
    failure = null;
    value = { latitude: la, longitude: lo, source: 'manual' };
    lat.value = la.toFixed(6);
    lng.value = lo.toFixed(6);
    render();
    if (recenter && map) map.setView([la, lo], Math.max(map.getZoom(), 15));
  }
  function openManual() {
    picker.hidden = false;
    manualBtn.setAttribute('aria-expanded', 'true');
    if (!map) {
      map = makeMap(mapEl);
      map.on('click', (e) => setManual(e.latlng.lat, e.latlng.lng, false));
    }
    map.invalidateSize();
    if (value) {
      map.setView([value.latitude, value.longitude], 16);
      lat.value = value.latitude.toFixed(6);
      lng.value = value.longitude.toFixed(6);
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
  function closeManual() {
    picker.hidden = true;
    manualBtn.setAttribute('aria-expanded', 'false');
  }
  function gps(silent) {
    if (!('geolocation' in navigator)) {
      if (!silent) {
        failure = 'This device can’t share a location. Set it on the map instead.';
        render();
      }
      return;
    }
    pending = true;
    failure = null;
    render();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pending = false;
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
        pending = false;
        if (!value) {
          failure =
            err.code === 1
              ? 'Location permission is off for this site. You can still save, or set it on the map.'
              : 'You can still save. Try again, or set it on the map.';
        }
        render();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  }
  gpsBtn.addEventListener('click', () => {
    touched = true;
    gps(false);
  });
  manualBtn.addEventListener('click', () => (picker.hidden ? openManual() : closeManual()));
  clearBtn.addEventListener('click', () => {
    touched = true;
    value = null;
    failure = null;
    lat.value = lng.value = '';
    render();
  });
  const typed = () => setManual(parseFloat(lat.value), parseFloat(lng.value), true);
  lat.addEventListener('change', typed);
  lng.addEventListener('change', typed);
  render();

  return {
    get: () => value,
    set(v) {
      value = v ? { ...v } : null;
      render();
    },
    reset() {
      value = null;
      touched = false;
      pending = false;
      failure = null;
      lat.value = lng.value = '';
      closeManual();
      render();
    },
    // Try GPS without overriding a location the user has already chosen.
    autoCapture() {
      if (!value && !touched && !pending) gps(true);
    },
    openManual,
  };
}

// ---------- set a new password ----------
const pwForm = $('#password-form');
function checkPassword() {
  const cur = pwForm.currentPassword.value;
  const next = pwForm.newPassword.value;
  const again = pwForm.confirmPassword.value;
  const left = MIN_PASSWORD - next.length;
  const reqs = {
    length: [next.length >= MIN_PASSWORD, left > 0 && next.length ? `At least ${MIN_PASSWORD} characters — ${left} more to go` : `At least ${MIN_PASSWORD} characters`],
    different: [next.length > 0 && next !== cur, 'Different from your current password'],
    match: [next.length > 0 && next === again, 'Both new passwords match'],
  };
  for (const li of $$('#pw-reqs li')) {
    const [ok, text] = reqs[li.dataset.req];
    li.textContent = text;
    li.classList.toggle('is-met', ok);
    if (ok) li.classList.remove('is-unmet');
  }
  return Object.values(reqs).every(([ok]) => ok);
}
function setupPasswordView() {
  const forced = state.user?.mustChangePassword;
  $('#password-lede').textContent = forced
    ? 'You signed in with a temporary password. Choose your own to continue.'
    : 'Choose a new password. Other devices using your old one will be signed out.';
  $('#pw-current-label').textContent = forced ? 'Current (temporary) password' : 'Current password';
  $('#password-cancel').hidden = forced;
  checkPassword();
}
pwForm.addEventListener('input', checkPassword);
$('#password-cancel').addEventListener('click', () => {
  pwForm.reset();
  show('intake');
});
pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  if (!checkPassword()) {
    $$('#pw-reqs li:not(.is-met)').forEach((li) => li.classList.add('is-unmet'));
    pwForm.newPassword.focus();
    return;
  }
  const btn = pwForm.querySelector('button[type=submit]');
  try {
    await busy(btn, () =>
      api('POST', '/auth/change-password', {
        currentPassword: pwForm.currentPassword.value,
        newPassword: pwForm.newPassword.value,
      }),
    );
    pwForm.reset();
    state.user.mustChangePassword = false;
    state.config ??= await api('GET', '/config');
    show('intake');
    flash('Use it next time you sign in.', 'ok', { title: 'Password saved' });
  } catch (err) {
    flash(err.message, 'error', { title: 'Password not changed' });
  }
});

// ---------- intake ----------
const intakePicker = createLocationPicker('#intake-location');
const intakeForm = $('#intake-form');
const intakeNeeds = createChips($('[data-chips="needs"]', intakeForm), NEEDS);
const intakeServices = createChips($('[data-chips="services"]', intakeForm), SERVICES);

function personBody(form, needsChips) {
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
    needs: needsChips.get(),
    notes: v.notes,
    consentGiven: form.consentGiven.checked,
  };
}
function setWhoError(on) {
  $('#intake-error').hidden = !on;
  const f = $('[data-who-field]', intakeForm);
  f.classList.toggle('is-invalid', on);
  $('.pl-error', f).hidden = !on;
  for (const n of ['firstName', 'lastName', 'preferredName', 'physicalDescription']) {
    if (on) intakeForm[n].setAttribute('aria-invalid', 'true');
    else intakeForm[n].removeAttribute('aria-invalid');
  }
}
intakeForm.addEventListener('input', (e) => {
  if (!$('#intake-error').hidden && ['firstName', 'lastName', 'preferredName', 'physicalDescription'].includes(e.target.name) && e.target.value.trim()) {
    setWhoError(false);
  }
});
intakeForm.addEventListener('reset', () => {
  setWhoError(false);
  intakeNeeds.reset();
  intakeServices.reset();
});

intakeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  const v = formValues(intakeForm);
  const { notes, ...person } = personBody(intakeForm, intakeNeeds);
  if (!person.firstName && !person.lastName && !person.preferredName && !person.physicalDescription) {
    setWhoError(true);
    $('#intake-error').focus();
    $('#intake-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  setWhoError(false);
  const loc = intakePicker.get();
  const body = {
    ...person,
    notes,
    encounter: { location: loc, locationDescription: v.locationDescription, servicesProvided: intakeServices.get() },
  };
  const btn = intakeForm.querySelector('button[type=submit]');
  try {
    const { individual } = await busy(btn, () => api('POST', '/individuals', body));
    intakeForm.reset();
    intakePicker.reset();
    const name = fullName(individual) && individual.preferredName ? `“${individual.preferredName}” (${fullName(individual)})` : displayName(individual);
    const open = el('a', 'Open their page');
    open.href = '#person';
    open.addEventListener('click', (ev) => {
      ev.preventDefault();
      openPerson(individual.id);
    });
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const how = loc ? (loc.source === 'manual' ? 'with a location set manually' : 'with GPS location') : 'with no location';
    flash(`Recorded at ${time} ${how}.`, 'ok', { title: `Saved: ${name}`, action: open });
    intakePicker.autoCapture();
  } catch (err) {
    flashError(err);
  }
});

// ---------- records ----------
$('#needs-list').replaceChildren(...NEEDS.map((n) => Object.assign(el('option'), { value: n })));

function skeleton(rows = 6) {
  const wrap = el('div', null, 'pl-tablewrap');
  wrap.setAttribute('aria-busy', 'true');
  wrap.setAttribute('aria-label', 'Loading');
  for (let i = 0; i < rows; i++) {
    const r = el('div', null, 'pl-skelrow');
    for (let j = 0; j < 4; j++) r.append(el('span', null, 'pl-skel'));
    wrap.append(r);
  }
  return wrap;
}
function emptyState(title, text, actionLabel, onAction, art) {
  const box = el('div', null, 'pl-empty');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'pl-empty__art');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of art) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  box.append(svg, el('h3', title), el('p', text));
  if (actionLabel) {
    const b = button(actionLabel, actionLabel.startsWith('Start') ? 'pl-btn--primary' : 'pl-btn--secondary');
    b.addEventListener('click', onAction);
    box.append(b);
  }
  return box;
}
const ART_LIST = ['M17 10h30a5 5 0 0 1 5 5v36a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5V15a5 5 0 0 1 5-5z', 'M22 24h20M22 33h20M22 42h12'];
const ART_SEARCH = ['M28 13a15 15 0 1 0 0 30a15 15 0 1 0 0-30z', 'm40 40 12 12'];

function td(cls, label, content) {
  const c = el('td', null, cls);
  if (label) c.dataset.label = label;
  if (content instanceof Node) c.append(content);
  else if (content !== undefined && content !== null) c.textContent = content;
  return c;
}

async function loadRecords() {
  const form = $('#records-form');
  const f = formValues(form);
  const filtered = ['q', 'need', 'veteranStatus', 'hasLocation'].some((k) => f[k]);
  $('#records-body').replaceChildren(skeleton());
  $('#records-summary').textContent = 'Loading…';
  try {
    const qs = new URLSearchParams({ limit: PAGE, offset: state.recordsOffset, sort: f.sort });
    for (const k of ['q', 'need', 'veteranStatus', 'hasLocation']) if (f[k]) qs.set(k, f[k]);
    const [{ individuals, total }, stats] = await Promise.all([api('GET', '/individuals?' + qs), api('GET', '/stats')]);

    const n = (x) => Number(x || 0).toLocaleString();
    const tiles = [
      [stats.individuals, 'People on record'],
      [stats.newIndividuals30d, 'New in 30 days'],
      [stats.encounters, 'Total contacts'],
      [stats.encounters7d, 'Contacts in 7 days'],
      [stats.encounters30d, 'Contacts in 30 days'],
    ];
    const items = tiles.map(([num, label]) => {
      const li = el('li', null, 'pl-tile');
      li.append(el('span', label, 'pl-tile__label'), el('span', n(num), 'pl-tile__num'));
      return li;
    });
    const noLoc = el('li');
    const noLocTile = el('button', null, 'pl-tile pl-tile--button' + (stats.encountersWithoutLocation > 0 ? ' pl-tile--attention' : ''));
    noLocTile.type = 'button';
    noLocTile.title = 'Show people with no location';
    noLocTile.append(el('span', 'Entries with no location', 'pl-tile__label'), el('span', n(stats.encountersWithoutLocation), 'pl-tile__num'));
    noLocTile.addEventListener('click', () => {
      form.hasLocation.value = 'false';
      state.recordsOffset = 0;
      loadRecords();
    });
    noLoc.append(noLocTile);
    $('#stats').replaceChildren(...items, noLoc);

    const sortLabel = form.sort.selectedOptions[0].textContent.toLowerCase();
    $('#records-summary').textContent = `${n(total)} ${total === 1 ? 'person' : 'people'} · sorted by ${sortLabel}`;
    $('#records-pager').hidden = total <= PAGE && state.recordsOffset === 0;

    if (!individuals.length) {
      $('#records-body').replaceChildren(
        filtered
          ? emptyState('No one matches these filters', 'Try fewer filters, or search by nickname or description instead.', 'Clear all filters', () => {
              form.reset();
              state.recordsOffset = 0;
              loadRecords();
            }, ART_SEARCH)
          : emptyState('No one on record yet', 'When the team records the first person they meet, they’ll appear here.', 'Start a new intake', () => show('intake'), ART_LIST),
      );
    } else {
      const table = el('table', null, 'pl-table');
      table.append(el('caption', 'People on record', 'pl-sr'));
      const thead = el('thead');
      const hr = el('tr');
      const sortCol = { lastSeen: 'Last seen', name: 'Name', created: 'Entered', contacts: 'Contacts' }[f.sort];
      for (const h of ['Name', 'Age', 'Gender', 'Veteran', 'Phone', 'Needs', 'Contacts', 'Last seen', 'Last location', 'Entered', 'Consent']) {
        const th = el('th', h === sortCol ? `${h} ${f.sort === 'name' ? '↑' : '↓'}` : h, h === 'Contacts' ? 'pl-num' : '');
        th.scope = 'col';
        if (h === sortCol) th.setAttribute('aria-sort', f.sort === 'name' ? 'ascending' : 'descending');
        hr.append(th);
      }
      thead.append(hr);
      const tbody = el('tbody');
      for (const p of individuals) {
        const tr = el('tr');
        const nameCell = td('pl-c-name');
        const link = el('a', displayName(p), 'pl-rowlink');
        link.href = '#person';
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          openPerson(p.id);
        });
        nameCell.append(link);
        const aka = akaOf(p);
        if (aka) nameCell.append(el('span', aka, 'pl-nick'));
        const vet = el('span', cap(p.veteranStatus) || '—', p.veteranStatus === 'yes' ? 'pl-yes' : 'pl-no');
        const contacts = td('pl-c-contacts pl-num', 'Contacts');
        contacts.append(el('b', String(p.encounterCount)), el('span', p.encounterCount === 1 ? 'contact' : 'contacts', 'pl-unit'));
        let where;
        if (p.lastLocationDescription) where = p.lastLocationDescription;
        else if (p.lastLocation) where = el('span', coords(p.lastLocation), 'pl-mono');
        if (!p.lastLocation) {
          const w = el('span');
          if (p.lastLocationDescription) w.append(p.lastLocationDescription, ' ');
          w.append(el('span', 'No location', 'pl-noloc'));
          where = w;
        }
        const entered = el('span');
        entered.append(el('span', fmtDay(p.createdAt), 'pl-nowrap'));
        if (p.createdByName) entered.append(el('br'), el('span', p.createdByName, 'pl-muted'));
        tr.append(
          nameCell,
          td('pl-c-hide-sm', 'Age', ageOf(p) || '—'),
          td('pl-c-hide-sm', 'Gender', p.gender || '—'),
          td('pl-c-hide-sm', 'Veteran', vet),
          td('pl-c-hide-sm pl-nowrap', 'Phone', p.phone || '—'),
          td('pl-c-needs', 'Needs', p.needs.length ? tags(p.needs) : el('span', '—', 'pl-muted')),
          contacts,
          td('pl-c-seen pl-nowrap', 'Last seen', fmt(p.lastSeenAt) || '—'),
          td('pl-c-where', 'Last location', where),
          td('pl-c-hide-sm', 'Entered', entered),
          td('pl-c-hide-sm', 'Consent', el('span', p.consentGiven ? 'Yes' : 'Not given', p.consentGiven ? 'pl-consent' : 'pl-consent pl-consent--no')),
        );
        // The whole row opens the person; the name stays a real link for keyboards.
        tr.addEventListener('click', (ev) => {
          if (!ev.target.closest('a')) openPerson(p.id);
        });
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const wrap = el('div', null, 'pl-tablewrap');
      wrap.append(table);
      $('#records-body').replaceChildren(wrap);
    }
    const from = total ? state.recordsOffset + 1 : 0;
    $('#records-count').textContent = `${n(from)}–${n(state.recordsOffset + individuals.length)} of ${n(total)}`;
    $('#records-prev').disabled = state.recordsOffset === 0;
    $('#records-next').disabled = state.recordsOffset + individuals.length >= total;
  } catch (err) {
    $('#records-body').replaceChildren();
    $('#records-summary').textContent = '';
    flashError(err);
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
  $('#map-count').textContent = 'Loading…';
  $('#log-body').replaceChildren(skeleton(4));
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
    const count = encounters.length;
    $('#map-count').textContent = `${count} ${count === 1 ? 'entry' : 'entries'}, ${markers.size} on the map`;
    $('#map-empty').hidden = markers.size > 0;
    $('#map-empty-text').textContent = count
      ? `${count} ${count === 1 ? 'entry' : 'entries'} in this range ${count === 1 ? 'was' : 'were'} saved without a location. Staff can add one from each person’s page.`
      : 'No entries were recorded in this range. Try a wider range of dates.';

    if (!count) {
      $('#log-body').replaceChildren(el('p', 'No entries in this range.', 'pl-muted'));
      return;
    }
    const table = el('table', null, 'pl-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['When', 'Person', 'Location', 'Where', 'Services', 'Recorded by']) {
      const th = el('th', h);
      th.scope = 'col';
      hr.append(th);
    }
    thead.append(hr);
    const tbody = el('tbody');
    for (const enc of encounters) {
      const tr = el('tr');
      const person = td('pl-c-name');
      const b = el('a', enc.individualName || 'Unnamed', 'pl-rowlink');
      b.href = '#person';
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        openPerson(enc.individualId);
      });
      person.append(b);
      const loc = td('pl-c-meta pl-nowrap', 'Location');
      if (enc.location) {
        const s = el('button', locationLabel(enc.location), 'pl-linkbtn');
        s.type = 'button';
        s.title = 'Show on map';
        s.addEventListener('click', () => {
          $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
          bigMap.setView([enc.location.latitude, enc.location.longitude], 17);
          markers.get(enc.id).openPopup();
        });
        loc.append(s);
      } else {
        loc.append(el('span', 'No location', 'pl-noloc'));
      }
      tr.append(
        td('pl-c-seen pl-nowrap', 'When', fmt(enc.occurredAt)),
        person,
        loc,
        td('pl-c-where', 'Where', enc.locationDescription || '—'),
        td('pl-c-needs', 'Services', enc.servicesProvided.length ? enc.servicesProvided.join(', ') : '—'),
        td('pl-c-meta', 'Recorded by', enc.recordedByName || ''),
      );
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const wrap = el('div', null, 'pl-tablewrap');
    wrap.append(table);
    $('#log-body').replaceChildren(wrap);
  } catch (err) {
    $('#map-count').textContent = '';
    $('#log-body').replaceChildren();
    flashError(err);
  }
}
$('#map-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadMap();
});

// ---------- person ----------
const encounterPicker = createLocationPicker('#encounter-location', { headingLevel: 3 });
const encounterServices = createChips($('[data-chips="services"]', $('#encounter-form')), SERVICES);
const editForm = $('#edit-person-form');
const editNeeds = createChips($('[data-chips="needs"]', editForm), NEEDS);
let personMap = null;
let personLayer = null;

function historyEntry(enc, personId) {
  const li = el('li', null, 'pl-entry');
  const kind = !enc.location ? 'none' : enc.location.source === 'manual' ? 'manual' : 'gps';
  li.append(el('span', null, kind === 'none' ? 'pl-entry__dot pl-entry__dot--none' : `pl-entry__dot pl-marker pl-marker--${kind}`));
  const when = el('div', null, 'pl-entry__when');
  const time = el('time', fmt(enc.occurredAt));
  time.dateTime = enc.occurredAt;
  when.append(time);
  li.append(when, el('div', `Recorded by ${enc.recordedByName || 'unknown'}`, 'pl-entry__by'));
  const body = el('div', null, 'pl-entry__body');
  const locLine = el('div', null, 'pl-entry__loc');
  const label = el('span');
  if (enc.location) label.append(el('b', locationLabel(enc.location)), ' ', el('span', coords(enc.location), 'pl-mono'));
  else label.append(el('span', 'No location recorded', 'pl-noloc'));
  locLine.append(label);
  body.append(locLine);
  if (enc.locationDescription) {
    const p = el('p');
    p.append(el('span', 'Where: ', 'pl-muted'), enc.locationDescription);
    body.append(p);
  }
  if (enc.servicesProvided.length) body.append(tags(enc.servicesProvided));
  if (enc.notes) body.append(el('p', enc.notes));

  if (atLeast('staff')) {
    const btn = button(enc.location ? 'Change location' : 'Add location', 'pl-btn--secondary pl-btn--sm', 'pin');
    btn.setAttribute('aria-expanded', 'false');
    locLine.append(btn);
    btn.addEventListener('click', () => {
      btn.hidden = true;
      btn.setAttribute('aria-expanded', 'true');
      const fix = el('div', null, 'pl-entry__fix');
      const holder = el('div');
      const row = el('div', null, 'pl-row pl-mt');
      const save = button('Save location', 'pl-btn--primary pl-btn--sm');
      const cancel = button('Cancel', 'pl-btn--quiet pl-btn--sm');
      row.append(save, cancel);
      fix.append(holder, row);
      body.append(fix);
      const picker = createLocationPicker(holder, { title: 'Place this contact', headingLevel: 4 });
      picker.set(enc.location);
      picker.openManual();
      cancel.addEventListener('click', () => {
        fix.remove();
        btn.hidden = false;
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      });
      save.addEventListener('click', async () => {
        try {
          await busy(save, () => api('PATCH', '/encounters/' + enc.id, { location: picker.get() }));
          await openPerson(personId, { keepFlash: true });
          flash('The map and history now show the new location.', 'ok', { title: 'Location updated' });
        } catch (err) {
          flashError(err);
        }
      });
    });
  }
  li.append(body);
  return li;
}

async function openPerson(id, { keepFlash = false } = {}) {
  if (!keepFlash) clearFlash();
  try {
    const { individual: p, encounters } = await api('GET', '/individuals/' + id);
    state.personId = id;
    state.person = p;
    $('#person-name').textContent = displayName(p);
    const since = encounters.length ? fmtDay(encounters[encounters.length - 1].occurredAt) : fmtDay(p.createdAt);
    const aka = fullName(p) && p.preferredName ? `Goes by “${p.preferredName}” · ` : '';
    $('#person-aka').textContent = `${aka}${encounters.length} ${encounters.length === 1 ? 'contact' : 'contacts'} since ${since}`;
    editForm.hidden = true;
    $('#person-card').hidden = false;
    $('#edit-person-btn').setAttribute('aria-expanded', 'false');

    const dl = $('#person-details');
    dl.replaceChildren();
    const rows = [
      ['Approx. age', ageOf(p)],
      ['Date of birth', p.dateOfBirth ? new Date(p.dateOfBirth + 'T00:00').toLocaleDateString([], { dateStyle: 'medium' }) : ''],
      ['Gender', p.gender],
      ['Phone', p.phone],
      ['Veteran', cap(p.veteranStatus)],
      ['Consent', el('span', p.consentGiven ? 'Given' : 'Not given', p.consentGiven ? 'pl-consent' : 'pl-consent pl-consent--no')],
      ['Needs', p.needs.length ? tags(p.needs) : '', true],
      ['Description', p.physicalDescription, true],
      ['Notes', p.notes, true],
      ['Entered', `${fmtDay(p.createdAt)} by ${p.createdByName || 'unknown'}`, true],
    ];
    for (const [k, v, wide] of rows) {
      if (v === null || v === undefined || v === '') continue;
      const d = el('div', null, wide ? 'pl-wide' : '');
      const dd = el('dd');
      if (v instanceof Node) dd.append(v);
      else dd.textContent = String(v);
      d.append(el('dt', k), dd);
      dl.append(d);
    }

    const ol = $('#encounters');
    ol.replaceChildren(...encounters.map((enc) => historyEntry(enc, id)));
    if (!encounters.length) ol.append(el('li', 'No contacts recorded yet.', 'pl-muted'));
    $('#hist-h').textContent = `Contact history · ${encounters.length}`;

    encounterPicker.reset();
    encounterServices.reset();
    show('person');
    if (!personMap) {
      personMap = makeMap($('#person-map'));
      personLayer = L.layerGroup().addTo(personMap);
    }
    const markers = plot(personMap, personLayer, encounters, { withName: false });
    $('#person-map-note').textContent = encounters.length
      ? `${markers.size} of ${encounters.length} ${encounters.length === 1 ? 'contact has' : 'contacts have'} a location.`
      : '';
    encounterPicker.autoCapture();
    window.scrollTo({ top: 0 });
  } catch (err) {
    flashError(err);
  }
}

$('#edit-person-btn').addEventListener('click', () => {
  const p = state.person;
  for (const k of ['firstName', 'lastName', 'preferredName', 'dateOfBirth', 'approximateAge', 'gender', 'phone', 'physicalDescription', 'notes']) {
    editForm.elements[k].value = p[k] ?? '';
  }
  for (const r of $$('input[name=veteranStatus]', editForm)) r.checked = r.value === p.veteranStatus;
  editNeeds.set(p.needs);
  editForm.elements.consentGiven.checked = p.consentGiven;
  editForm.hidden = false;
  $('#person-card').hidden = true;
  $('#edit-person-btn').setAttribute('aria-expanded', 'true');
  editForm.elements.firstName.focus();
});
$('#edit-person-cancel').addEventListener('click', () => {
  editForm.hidden = true;
  $('#person-card').hidden = false;
  $('#edit-person-btn').setAttribute('aria-expanded', 'false');
});
editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = editForm.querySelector('button[type=submit]');
  try {
    await busy(btn, () => api('PATCH', '/individuals/' + state.personId, personBody(editForm, editNeeds)));
    await openPerson(state.personId, { keepFlash: true });
    flash('Their details are up to date.', 'ok', { title: 'Details saved' });
  } catch (err) {
    flashError(err);
  }
});

$('#encounter-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = formValues(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  const loc = encounterPicker.get();
  try {
    await busy(btn, () =>
      api('POST', `/individuals/${state.personId}/encounters`, {
        location: loc,
        locationDescription: v.locationDescription,
        servicesProvided: encounterServices.get(),
        notes: v.notes,
      }),
    );
    e.target.reset();
    await openPerson(state.personId, { keepFlash: true });
    flash(loc ? 'It’s at the top of their history.' : 'Saved with no location. Staff can add one later.', 'ok', { title: 'Contact saved' });
  } catch (err) {
    flashError(err);
  }
});

// ---------- admin: team accounts ----------
async function loadUsers() {
  try {
    const { users } = await api('GET', '/users');
    const active = users.filter((u) => u.isActive).length;
    $('#users-summary').textContent = `${users.length} ${users.length === 1 ? 'person' : 'people'} · ${active} active`;
    const ul = $('#users');
    ul.replaceChildren();
    for (const u of users) {
      const li = el('li', null, 'pl-user' + (u.isActive ? '' : ' is-off'));
      const who = el('div');
      who.append(el('div', u.fullName, 'pl-user__name'), el('div', u.email, 'pl-user__email'));
      const meta = el('div', null, 'pl-user__meta-row');
      const last = el('span', 'Last sign-in: ', 'pl-user__meta');
      last.append(el('b', u.lastLoginAt ? fmt(u.lastLoginAt) : u.mustChangePassword ? 'Never — temporary password' : 'Never'));
      meta.append(
        el('span', cap(u.role), `pl-role pl-role--${u.role}`),
        el('span', u.isActive ? 'Active' : 'Deactivated', u.isActive ? 'pl-status' : 'pl-status pl-status--off'),
        last,
      );
      const actions = el('div', null, 'pl-user__actions');
      if (u.id === state.user.id) {
        actions.append(el('span', 'This is you', 'pl-small pl-muted'));
      } else {
        const toggle = button(u.isActive ? 'Deactivate' : 'Reactivate', `pl-btn--sm ${u.isActive ? 'pl-btn--danger' : 'pl-btn--secondary'}`);
        toggle.addEventListener('click', async () => {
          if (u.isActive && !confirm(`Deactivate ${u.fullName}? They’ll be signed out and can’t sign in until reactivated.`)) return;
          try {
            await busy(toggle, () => api('PATCH', '/users/' + u.id, { isActive: !u.isActive }));
            loadUsers();
          } catch (err) {
            flashError(err);
          }
        });
        const reset = button('Reset password', 'pl-btn--secondary pl-btn--sm');
        reset.addEventListener('click', async () => {
          if (!confirm(`Reset the password for ${u.fullName}? They’ll be signed out everywhere.`)) return;
          try {
            const { temporaryPassword } = await busy(reset, () => api('POST', `/users/${u.id}/reset-password`, {}));
            showTempPassword(u.fullName, u.email, temporaryPassword);
            loadUsers();
          } catch (err) {
            flashError(err);
          }
        });
        if (u.isActive) actions.append(reset);
        actions.append(toggle);
      }
      li.append(who, meta, actions);
      ul.append(li);
    }
  } catch (err) {
    flashError(err);
  }
}

function showTempPassword(name, email, pw) {
  $('#temppw-title').textContent = `Temporary password for ${name}`;
  $('#temppw-email').textContent = email;
  $('#temppw-code').textContent = pw;
  $('#temppw').hidden = false;
  $('#temppw').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function hideTempPassword() {
  $('#temppw').hidden = true;
  $('#temppw-code').textContent = '';
}
$('#temppw-done').addEventListener('click', hideTempPassword);
$('#temppw-copy').addEventListener('click', async () => {
  const btn = $('#temppw-copy');
  const label = $('span', btn);
  try {
    await navigator.clipboard.writeText($('#temppw-code').textContent);
    label.textContent = 'Copied';
    btn.classList.add('pl-btn--copied');
  } catch {
    // Clipboard blocked: select the text so it can be copied by hand.
    window.getSelection().selectAllChildren($('#temppw-code'));
    label.textContent = 'Selected — copy it';
  }
  setTimeout(() => {
    label.textContent = 'Copy';
    btn.classList.remove('pl-btn--copied');
  }, 3000);
});

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFlash();
  const btn = e.target.querySelector('button[type=submit]');
  try {
    const { user, temporaryPassword } = await busy(btn, () => api('POST', '/users', formValues(e.target)));
    e.target.reset();
    showTempPassword(user.fullName, user.email, temporaryPassword);
    loadUsers();
  } catch (err) {
    flashError(err);
  }
});

// ---------- boot ----------
(async () => {
  try {
    state.user = (await api('GET', '/auth/me')).user;
    const label = cap(state.user.role);
    $('#account-name').textContent = state.user.fullName;
    $('#account-role').textContent = label;
    $('#menu-name').textContent = state.user.fullName;
    $('#menu-detail').textContent = `${label} · ${state.user.email}`;
    if (state.user.mustChangePassword) return show('password');
    state.config = await api('GET', '/config');
    show('intake');
  } catch (err) {
    flashError(err);
  }
})();
