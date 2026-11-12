import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { purgeExpiredSessions } from './auth.js';

if (config.isProduction && !config.secureCookies) {
  console.warn('WARNING: SECURE_COOKIES is off in production. Session cookies may be sent over plain HTTP.');
}

await migrate();
const app = createApp();
app.listen(config.port, () => {
  console.log(`Project Lorenzo API listening on port ${config.port}`);
});

setInterval(() => purgeExpiredSessions().catch((e) => console.error('session purge failed', e)), 60 * 60 * 1000).unref();
