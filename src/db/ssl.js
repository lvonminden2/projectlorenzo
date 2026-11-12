/**
 * Decide how to use TLS for the database connection.
 *
 * Managed hosts differ: Railway and Heroku Postgres use self-signed
 * certificates, and private-network hosts (e.g. *.railway.internal, Docker
 * service names, Render internal URLs) often have no TLS at all. Forcing
 * verified TLS everywhere makes the app crash on boot on those hosts, so:
 *
 *   DATABASE_SSL=disable  -> plain connection
 *   DATABASE_SSL=require  -> encrypted, certificate not verified
 *   DATABASE_SSL=verify   -> encrypted and certificate verified
 *   (unset)               -> development: disable; production: disable for
 *                            private/internal hosts, require otherwise.
 *
 * An explicit `sslmode=` in DATABASE_URL always takes precedence (handled by pg).
 */
const ALIASES = { false: 'disable', off: 'disable', no: 'disable', '0': 'disable', true: 'require', on: 'require', yes: 'require', '1': 'require' };

export function isPrivateHost(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.startsWith('127.') ||
    h === '::1' ||
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    !h.includes('.') // Docker/Compose service names, Render internal hosts
  );
}

export function resolveSsl({ databaseUrl, databaseSsl, isProduction }) {
  let mode = databaseSsl ? ALIASES[databaseSsl] || databaseSsl : null;
  if (mode && !['disable', 'require', 'verify'].includes(mode)) {
    throw new Error(`DATABASE_SSL must be one of disable, require, verify (got "${databaseSsl}")`);
  }
  if (!mode) {
    let host = null;
    try {
      host = new URL(databaseUrl).hostname;
    } catch {
      /* invalid URL is reported by pg */
    }
    mode = isProduction && !isPrivateHost(host) ? 'require' : 'disable';
  }
  if (mode === 'disable') return false;
  return { rejectUnauthorized: mode === 'verify' };
}
