import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDb, createUser, login, request } from './helpers.js';

let staff, volunteer;
before(async () => {
  await resetDb();
  staff = await createUser({ email: 'staff@lorenzo.test', role: 'staff', fullName: 'Sam Staff' });
  volunteer = await createUser({ email: 'vol@lorenzo.test', role: 'volunteer', fullName: 'Val Volunteer' });
});
after(() => pool.end());

test('the app is not served without a login', async () => {
  const home = await request().get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.location, '/login');
  assert.equal((await request().get('/app.js')).status, 401);
  assert.equal((await request().get('/index.html')).status, 404);
  assert.equal((await request().get('/api/config')).status, 401);
  assert.equal((await request().get('/api/stats')).status, 401);

  const loginPage = await request().get('/login');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.text, /Sign in/);
  assert.ok(!loginPage.text.includes('intake-form'), 'login page must not contain the app');
});

test('signed-in users get the app; /login sends them home', async () => {
  const agent = await login(staff.email);
  const home = await agent.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /intake-form/);
  assert.equal(home.headers['cache-control'], 'no-store');
  assert.equal((await agent.get('/app.js')).status, 200);
  assert.equal((await agent.get('/login')).headers.location, '/');
  await agent.post('/api/auth/logout').send({});
  assert.equal((await agent.get('/')).status, 302);
});

test('records list: filters, sorting, last location, stats', async () => {
  const agent = await login(staff.email);
  const a = await agent.post('/api/individuals').send({
    firstName: 'Alice', lastName: 'Zed', needs: ['Shelter', 'food'], veteranStatus: 'yes',
    encounter: { location: { latitude: 30.25, longitude: -97.75, source: 'manual' }, locationDescription: 'Library' },
  });
  assert.equal(a.status, 201);
  assert.equal(a.body.encounter.location.source, 'manual');
  await agent.post('/api/individuals').send({ firstName: 'Bob', lastName: 'Young', needs: ['food'] });

  const byNeed = await agent.get('/api/individuals?need=shelter');
  assert.deepEqual(byNeed.body.individuals.map((p) => p.firstName), ['Alice']);
  assert.deepEqual(byNeed.body.individuals[0].lastLocation, { latitude: 30.25, longitude: -97.75 });
  assert.equal(byNeed.body.individuals[0].lastLocationDescription, 'Library');
  assert.equal(byNeed.body.individuals[0].createdByName, 'Sam Staff');

  const noLoc = await agent.get('/api/individuals?hasLocation=false');
  assert.deepEqual(noLoc.body.individuals.map((p) => p.firstName), ['Bob']);
  const vets = await agent.get('/api/individuals?veteranStatus=yes');
  assert.equal(vets.body.total, 1);
  const byName = await agent.get('/api/individuals?sort=name');
  assert.deepEqual(byName.body.individuals.map((p) => p.lastName), ['Young', 'Zed']);
  assert.equal((await agent.get('/api/individuals?sort=evil')).status, 400);

  const stats = await agent.get('/api/stats');
  assert.equal(stats.body.individuals, 2);
  assert.equal(stats.body.encounters, 2);
  assert.equal(stats.body.encountersWithoutLocation, 1);
});

test('a location can be added to an entry afterwards (staff only)', async () => {
  const s = await login(staff.email);
  const v = await login(volunteer.email);
  const list = await s.get('/api/encounters?hasLocation=false');
  assert.equal(list.body.encounters.length, 1);
  const id = list.body.encounters[0].id;

  const body = { location: { latitude: 30.3, longitude: -97.7, source: 'manual' } };
  assert.equal((await v.patch(`/api/encounters/${id}`).send(body)).status, 403);
  assert.equal((await s.patch(`/api/encounters/${id}`).send({ location: { latitude: 999, longitude: 0 } })).status, 400);
  assert.equal((await s.patch(`/api/encounters/${id}`).send({})).status, 400);
  const ok = await s.patch(`/api/encounters/${id}`).send(body);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.encounter.location, { latitude: 30.3, longitude: -97.7, accuracyMeters: null, source: 'manual' });
  assert.equal((await s.get('/api/encounters?hasLocation=false')).body.encounters.length, 0);

  const cleared = await s.patch(`/api/encounters/${id}`).send({ location: null });
  assert.equal(cleared.body.encounter.location, null);
  const { rows } = await pool.query(`SELECT count(*) FROM audit_log WHERE action = 'encounter_updated'`);
  assert.equal(Number(rows[0].count), 2);
});

test('map settings are available to signed-in users and tiles are allowed by the CSP', async () => {
  const agent = await login(volunteer.email);
  const cfg = await agent.get('/api/config');
  assert.match(cfg.body.map.tileUrl, /^https:\/\//);
  const csp = (await agent.get('/')).headers['content-security-policy'];
  assert.match(csp, /img-src[^;]*https:\/\/tile\.openstreetmap\.org/);
  assert.match(csp, /script-src 'self'/);
  assert.equal((await request().get('/vendor/leaflet/leaflet.js')).status, 200);
});
