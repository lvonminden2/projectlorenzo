import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDb, createUser, login, request } from './helpers.js';

let admin, staff, volunteer;

before(async () => {
  await resetDb();
  admin = await createUser({ email: 'admin@lorenzo.test', role: 'admin', fullName: 'Ada Admin' });
  staff = await createUser({ email: 'staff@lorenzo.test', role: 'staff', fullName: 'Sam Staff' });
  volunteer = await createUser({ email: 'vol@lorenzo.test', role: 'volunteer', fullName: 'Val Volunteer' });
});

after(() => pool.end());

test('API requires authentication', async () => {
  const res = await request().get('/api/individuals');
  assert.equal(res.status, 401);
});

test('login sets an httpOnly SameSite=Strict cookie and /me works', async () => {
  const res = await request().post('/api/auth/login').send({ email: 'STAFF@lorenzo.test', password: staff.password });
  assert.equal(res.status, 200);
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const agent = await login(staff.email);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.body.user.role, 'staff');
});

test('wrong password and unknown email give the same error', async () => {
  const a = await request().post('/api/auth/login').send({ email: staff.email, password: 'nope-nope-nope' });
  const b = await request().post('/api/auth/login').send({ email: 'nobody@lorenzo.test', password: 'nope-nope-nope' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error, b.body.error);
});

test('account locks after repeated failures', async () => {
  const u = await createUser({ email: 'lockme@lorenzo.test' });
  for (let i = 0; i < 5; i++) {
    await request().post('/api/auth/login').send({ email: u.email, password: 'wrong-password-123' });
  }
  const res = await request().post('/api/auth/login').send({ email: u.email, password: u.password });
  assert.equal(res.status, 423);
});

test('non-JSON and cross-origin writes are rejected (CSRF)', async () => {
  const agent = await login(staff.email);
  const form = await agent.post('/api/individuals').type('form').send('firstName=x');
  assert.equal(form.status, 415);
  const xo = await agent.post('/api/individuals').set('Origin', 'https://evil.example').send({ firstName: 'x' });
  assert.equal(xo.status, 403);
});

test('volunteer intake records the individual with GPS location', async () => {
  const agent = await login(volunteer.email);
  const res = await agent.post('/api/individuals').send({
    firstName: 'John',
    lastName: 'Doe',
    approximateAge: 45,
    needs: ['food', 'shelter'],
    consentGiven: true,
    encounter: {
      location: { latitude: 30.2672, longitude: -97.7431, accuracyMeters: 12 },
      locationDescription: 'Under the 5th St overpass',
      servicesProvided: ['meal', 'water'],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.individual.firstName, 'John');
  assert.deepEqual(res.body.encounter.location, {
    latitude: 30.2672,
    longitude: -97.7431,
    accuracyMeters: 12,
    source: 'device_gps',
  });

  const detail = await agent.get(`/api/individuals/${res.body.individual.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.encounters.length, 1);
  assert.equal(detail.body.encounters[0].recordedByName, 'Val Volunteer');

  const search = await agent.get('/api/individuals?q=john d');
  assert.equal(search.body.total, 1);
  assert.equal(search.body.individuals[0].encounterCount, 1);
});

test('intake without location is allowed and marked unavailable', async () => {
  const agent = await login(staff.email);
  const res = await agent.post('/api/individuals').send({ preferredName: 'Red' });
  assert.equal(res.status, 201);
  assert.equal(res.body.encounter.location, null);
  const { rows } = await pool.query('SELECT location_source FROM encounters WHERE id = $1', [res.body.encounter.id]);
  assert.equal(rows[0].location_source, 'unavailable');
});

test('input validation rejects bad coordinates and unknown fields', async () => {
  const agent = await login(staff.email);
  const bad = await agent.post('/api/individuals').send({
    firstName: 'X',
    encounter: { location: { latitude: 200, longitude: 0 } },
  });
  assert.equal(bad.status, 400);
  const extra = await agent.post('/api/individuals').send({ firstName: 'X', isAdmin: true });
  assert.equal(extra.status, 400);
  const empty = await agent.post('/api/individuals').send({});
  assert.equal(empty.status, 400);
});

test('role permissions: volunteers cannot edit, staff can, only admins delete', async () => {
  const s = await login(staff.email);
  const v = await login(volunteer.email);
  const a = await login(admin.email);
  const created = await s.post('/api/individuals').send({ firstName: 'Jane' });
  const id = created.body.individual.id;

  assert.equal((await v.patch(`/api/individuals/${id}`).send({ notes: 'x' })).status, 403);
  const upd = await s.patch(`/api/individuals/${id}`).send({ notes: 'Needs ID replacement', phone: '555-0100' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.individual.notes, 'Needs ID replacement');

  const enc = await v.post(`/api/individuals/${id}/encounters`).send({
    location: { latitude: 30.1, longitude: -97.1, source: 'manual' },
    servicesProvided: ['blanket'],
  });
  assert.equal(enc.status, 201);

  assert.equal((await v.get('/api/encounters')).status, 403);
  const all = await s.get('/api/encounters?minLat=30&maxLat=30.2');
  assert.ok(all.body.encounters.some((e) => e.individualId === id));

  assert.equal((await s.delete(`/api/individuals/${id}`)).status, 403);
  assert.equal((await a.delete(`/api/individuals/${id}`)).status, 200);
  assert.equal((await s.get(`/api/individuals/${id}`)).status, 404);
});

test('admin user management: create, temp password, forced change, deactivate', async () => {
  const a = await login(admin.email);
  const s = await login(staff.email);
  assert.equal((await s.get('/api/users')).status, 403);

  const created = await a.post('/api/users').send({ email: 'new@lorenzo.test', fullName: 'Nia New', role: 'volunteer' });
  assert.equal(created.status, 201);
  const temp = created.body.temporaryPassword;
  assert.ok(temp.length >= 16);

  const dup = await a.post('/api/users').send({ email: 'NEW@lorenzo.test', fullName: 'Dup', role: 'staff' });
  assert.equal(dup.status, 409);

  const n = await login('new@lorenzo.test', temp);
  assert.equal((await n.get('/api/individuals')).status, 403, 'must change password first');
  const weak = await n.post('/api/auth/change-password').send({ currentPassword: temp, newPassword: 'short' });
  assert.equal(weak.status, 400);
  const changed = await n
    .post('/api/auth/change-password')
    .send({ currentPassword: temp, newPassword: 'a much better passphrase 42' });
  assert.equal(changed.status, 200);
  assert.equal((await n.get('/api/individuals')).status, 200);

  const deact = await a.patch(`/api/users/${created.body.user.id}`).send({ isActive: false });
  assert.equal(deact.status, 200);
  assert.equal((await n.get('/api/individuals')).status, 401, 'sessions revoked on deactivation');
  const relog = await request()
    .post('/api/auth/login')
    .send({ email: 'new@lorenzo.test', password: 'a much better passphrase 42' });
  assert.equal(relog.status, 401);

  assert.equal((await a.patch(`/api/users/${admin.id}`).send({ isActive: false })).status, 400);
});

test('logout revokes the session server-side', async () => {
  const agent = await login(staff.email);
  assert.equal((await agent.post('/api/auth/logout').send({})).status, 200);
  assert.equal((await agent.get('/api/auth/me')).status, 401);
});

test('sensitive actions are written to the audit log, viewable by admins only', async () => {
  const a = await login(admin.email);
  const s = await login(staff.email);
  assert.equal((await s.get('/api/audit')).status, 403);
  const res = await a.get('/api/audit?limit=500');
  const actions = new Set(res.body.entries.map((e) => e.action));
  for (const act of ['login', 'login_failed', 'individual_created', 'individual_viewed', 'individual_deleted', 'user_created']) {
    assert.ok(actions.has(act), `missing ${act}`);
  }
  const json = JSON.stringify(res.body);
  assert.ok(!json.includes('correct horse'), 'no passwords in audit log');
});

test('security headers and no-store caching on API', async () => {
  const agent = await login(staff.email);
  const res = await agent.get('/api/individuals');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(res.headers['content-security-policy']);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
});
