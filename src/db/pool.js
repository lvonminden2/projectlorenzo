import pg from 'pg';
import { config } from '../config.js';
import { resolveSsl } from './ssl.js';

if (!config.databaseUrl) {
  console.error(
    'FATAL: DATABASE_URL is not set, so the app has no database to connect to.\n' +
      '  On Railway: add a PostgreSQL database to the project, then on this app service open\n' +
      '  Variables and add DATABASE_URL = ${{Postgres.DATABASE_URL}} and redeploy.\n' +
      '  Locally: export DATABASE_URL=postgres://postgres@localhost:5432/lorenzo (or use npm run dev).',
  );
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: resolveSsl(config),
  connectionTimeoutMillis: 10_000,
  max: 10,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
