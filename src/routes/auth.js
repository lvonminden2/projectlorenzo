import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { audit } from '../audit.js';
import { asyncHandler, unauthorized, HttpError, badRequest } from '../errors.js';
import { parse, loginSchema, changePasswordSchema } from '../validation.js';
import {
  verifyPassword,
  dummyVerify,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
  destroyUserSessions,
  requireAuth,
  hashPassword,
  validatePasswordStrength,
} from '../auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

const INVALID = 'Invalid email or password';

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];

    if (!user) {
      await dummyVerify(password);
      await audit(req, 'login_failed', { details: { reason: 'unknown_email' }, userId: null });
      throw unauthorized(INVALID);
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await audit(req, 'login_failed', { entityType: 'user', entityId: user.id, details: { reason: 'locked' }, userId: user.id });
      throw new HttpError(423, 'Account temporarily locked due to too many failed attempts. Try again later.');
    }

    const ok = await verifyPassword(user.password_hash, password);
    if (!ok || !user.is_active) {
      if (!ok) {
        const failed = user.failed_login_count + 1;
        const lock = failed >= config.maxFailedLogins;
        await query(
          `UPDATE users SET failed_login_count = $2,
             locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
           WHERE id = $1`,
          [user.id, lock ? 0 : failed, lock, config.lockoutMinutes],
        );
      }
      await audit(req, 'login_failed', {
        entityType: 'user',
        entityId: user.id,
        details: { reason: ok ? 'inactive' : 'bad_password' },
        userId: user.id,
      });
      throw unauthorized(INVALID);
    }

    await query(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [user.id],
    );
    const { token, expiresAt } = await createSession(user.id, req);
    setSessionCookie(res, token, expiresAt);
    await audit(req, 'login', { entityType: 'user', entityId: user.id, userId: user.id });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        mustChangePassword: user.must_change_password,
      },
    });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.sessionToken) {
      await destroySession(req.sessionToken);
      await audit(req, 'logout');
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

router.get('/me', requireAuth({ allowPasswordChangePending: true }), (req, res) => {
  res.json({ user: req.user });
});

router.post(
  '/change-password',
  loginLimiter,
  requireAuth({ allowPasswordChangePending: true }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await verifyPassword(rows[0].password_hash, currentPassword))) {
      await audit(req, 'password_change_failed', { entityType: 'user', entityId: req.user.id });
      throw unauthorized('Current password is incorrect');
    }
    if (currentPassword === newPassword) throw badRequest('New password must be different from the current one');
    validatePasswordStrength(newPassword, { email: req.user.email, fullName: req.user.fullName });
    await query(
      'UPDATE users SET password_hash = $2, must_change_password = FALSE, updated_at = now() WHERE id = $1',
      [req.user.id, await hashPassword(newPassword)],
    );
    // Sign out every other device that was using the old password.
    await destroyUserSessions(req.user.id, { exceptToken: req.sessionToken });
    await audit(req, 'password_changed', { entityType: 'user', entityId: req.user.id });
    res.json({ ok: true });
  }),
);

export default router;
