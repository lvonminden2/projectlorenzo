import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from './config.js';
import { query } from './db/pool.js';
import { unauthorized, forbidden, badRequest } from './errors.js';

export const SESSION_COOKIE = config.secureCookies ? '__Host-lorenzo_session' : 'lorenzo_session';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Used when the email does not exist, so response timing does not reveal
// which accounts exist.
let dummyHashPromise;
export function dummyVerify(password) {
  dummyHashPromise ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise.then((h) => verifyPassword(h, password));
}

export function validatePasswordStrength(password, { email, fullName } = {}) {
  const problems = [];
  if (typeof password !== 'string' || password.length < config.minPasswordLength) {
    problems.push(`Password must be at least ${config.minPasswordLength} characters long`);
  }
  if (typeof password === 'string' && password.length > 256) problems.push('Password is too long');
  const lower = String(password).toLowerCase();
  if (email && lower.includes(String(email).split('@')[0].toLowerCase())) {
    problems.push('Password must not contain your email name');
  }
  if (fullName) {
    for (const part of String(fullName).toLowerCase().split(/\s+/)) {
      if (part.length >= 4 && lower.includes(part)) problems.push('Password must not contain your name');
    }
  }
  if (/^(.)\1+$/.test(String(password))) problems.push('Password must not be a single repeated character');
  if (problems.length) throw badRequest('Password does not meet requirements', { password: problems });
}

export function generateTemporaryPassword() {
  // 18 chars from an unambiguous alphabet (~100 bits).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(18);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionMaxHours * 3600 * 1000);
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, req.ip, String(req.get('user-agent') || '').slice(0, 300)],
  );
  return { token, expiresAt };
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/' });
}

export async function destroySession(token) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function destroyUserSessions(userId, { exceptToken } = {}) {
  if (exceptToken) {
    await query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, hashToken(exceptToken)]);
  } else {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

/** Loads req.user from the session cookie (if valid). Does not reject. */
export async function loadSession(req, _res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== 'string' || token.length > 100) return next();
    const { rows } = await query(
      `UPDATE sessions s SET last_seen_at = now()
         FROM users u
        WHERE s.token_hash = $1
          AND s.user_id = u.id
          AND u.is_active
          AND s.expires_at > now()
          AND s.last_seen_at > now() - make_interval(mins => $2)
        RETURNING u.id, u.email, u.full_name, u.role, u.must_change_password`,
      [hashToken(token), config.sessionIdleMinutes],
    );
    if (rows[0]) {
      req.user = {
        id: rows[0].id,
        email: rows[0].email,
        fullName: rows[0].full_name,
        role: rows[0].role,
        mustChangePassword: rows[0].must_change_password,
      };
      req.sessionToken = token;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Require a logged-in user. Users with a temporary password may only reach
 * the endpoints needed to change it.
 */
export function requireAuth({ allowPasswordChangePending = false } = {}) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.mustChangePassword && !allowPasswordChangePending) {
      return next(forbidden('You must change your temporary password before continuing'));
    }
    next();
  };
}

const ROLE_RANK = { volunteer: 1, staff: 2, admin: 3 };

/** Require at least the given role (volunteer < staff < admin). */
export function requireRole(minRole) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if ((ROLE_RANK[req.user.role] || 0) < ROLE_RANK[minRole]) return next(forbidden());
    next();
  };
}

export async function purgeExpiredSessions() {
  await query(
    `DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(mins => $1)`,
    [config.sessionIdleMinutes],
  );
}
