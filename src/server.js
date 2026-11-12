import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { purgeExpiredSessions } from './auth.js';

if (config.isProduction && !config.secureCookies) {
  console.warn('WARNING: SECURE_COOKIES is off in production. Session cookies may be sent over plain HTTP.');
}

// The database is often still starting when the app boots on a fresh deploy,
// so retry for a while instead of crashing immediately.
async function migrateWithRetry(attempts = 10) {
  for (let i = 1; ; i++) {
    try {
      return await migrate();
    } catch (err) {
      const retryable = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', '57P03'].includes(err.code) ||
        /timeout|terminated/i.test(err.message);
      if (!retryable || i >= attempts) {
        console.error(`FATAL: could not prepare the database: ${err.message}`);
        if (err.code === 'ECONNREFUSED' && /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(config.databaseUrl)) {
          console.error('Hint: DATABASE_URL points at this machine. On a hosting service, set it to your database\'s URL.');
        }
        if (/SSL|certificate/i.test(err.message)) {
          console.error('Hint: set DATABASE_SSL to disable, require, or verify to match your database (see .env.example).');
        }
        process.exit(1);
      }
      const wait = Math.min(1000 * 2 ** (i - 1), 15000);
      console.warn(`Database not ready (${err.code || err.message}); retrying in ${wait / 1000}s (${i}/${attempts})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

await migrateWithRetry();
const app = createApp();
// Bind on all interfaces so the host's router can reach the container.
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Project Lorenzo API listening on port ${config.port}`);
});

setInterval(() => purgeExpiredSessions().catch((e) => console.error('session purge failed', e)), 60 * 60 * 1000).unref();
