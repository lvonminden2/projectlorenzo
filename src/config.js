import 'node:process';

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProduction: env === 'production',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/lorenzo',
  databaseSsl: bool(process.env.DATABASE_SSL, env === 'production'),
  // Cookies are only sent over HTTPS in production.
  secureCookies: bool(process.env.SECURE_COOKIES, env === 'production'),
  // Set when running behind a proxy/load balancer (Railway, Render, Heroku, nginx).
  trustProxy: bool(process.env.TRUST_PROXY, env === 'production'),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES || 60 * 8),
  sessionMaxHours: Number(process.env.SESSION_MAX_HOURS || 24),
  maxFailedLogins: Number(process.env.MAX_FAILED_LOGINS || 5),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES || 15),
  minPasswordLength: Number(process.env.MIN_PASSWORD_LENGTH || 12),
};
