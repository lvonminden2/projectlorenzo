import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSsl } from '../src/db/ssl.js';

const prod = (databaseUrl, databaseSsl = null) => resolveSsl({ databaseUrl, databaseSsl, isProduction: true });

test('production: internal hosts connect without TLS', () => {
  assert.equal(prod('postgresql://u:p@postgres.railway.internal:5432/railway'), false);
  assert.equal(prod('postgres://u:p@localhost:5432/db'), false);
  assert.equal(prod('postgres://u:p@db:5432/db'), false);
  assert.equal(prod('postgres://u:p@dpg-abc123-a/db'), false);
});

test('production: public hosts use TLS without rejecting self-signed certs', () => {
  assert.deepEqual(prod('postgresql://u:p@roundhouse.proxy.rlwy.net:12345/railway'), { rejectUnauthorized: false });
});

test('DATABASE_SSL overrides the automatic choice', () => {
  assert.deepEqual(prod('postgres://u:p@db.example.com/db', 'verify'), { rejectUnauthorized: true });
  assert.equal(prod('postgres://u:p@db.example.com/db', 'disable'), false);
  assert.equal(prod('postgres://u:p@db.example.com/db', 'false'), false);
  assert.deepEqual(prod('postgres://u:p@localhost/db', 'true'), { rejectUnauthorized: false });
  assert.throws(() => prod('postgres://u:p@localhost/db', 'bogus'));
});

test('development never forces TLS', () => {
  assert.equal(resolveSsl({ databaseUrl: 'postgres://u:p@db.example.com/db', databaseSsl: null, isProduction: false }), false);
});
