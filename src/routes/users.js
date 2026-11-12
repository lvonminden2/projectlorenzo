import { Router } from 'express';
import { query } from '../db/pool.js';
import { audit } from '../audit.js';
import { asyncHandler, conflict, notFound, badRequest } from '../errors.js';
import { parse, createUserSchema, updateUserSchema, uuidParam } from '../validation.js';
import { requireAuth, requireRole, hashPassword, generateTemporaryPassword, destroyUserSessions } from '../auth.js';

const router = Router();
router.use(requireAuth(), requireRole('admin'));

const toUser = (u) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  role: u.role,
  isActive: u.is_active,
  mustChangePassword: u.must_change_password,
  lockedUntil: u.locked_until,
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query('SELECT * FROM users ORDER BY is_active DESC, full_name');
    res.json({ users: rows.map(toUser) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(createUserSchema, req.body);
    const tempPassword = generateTemporaryPassword();
    try {
      const { rows } = await query(
        `INSERT INTO users (email, full_name, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
        [input.email, input.fullName, await hashPassword(tempPassword), input.role],
      );
      await audit(req, 'user_created', { entityType: 'user', entityId: rows[0].id, details: { role: input.role } });
      // The temporary password is shown exactly once; it is never stored in plain text.
      res.status(201).json({ user: toUser(rows[0]), temporaryPassword: tempPassword });
    } catch (err) {
      if (err.code === '23505') throw conflict('A user with that email already exists');
      throw err;
    }
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateUserSchema, req.body);
    if (id === req.user.id && (input.isActive === false || (input.role && input.role !== 'admin'))) {
      throw badRequest('You cannot deactivate or demote your own account');
    }
    const { rows } = await query(
      `UPDATE users SET
         full_name = COALESCE($2, full_name),
         role = COALESCE($3, role),
         is_active = COALESCE($4, is_active),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, input.fullName ?? null, input.role ?? null, input.isActive ?? null],
    );
    if (!rows[0]) throw notFound('User not found');
    if (input.isActive === false || input.role) await destroyUserSessions(id);
    await audit(req, 'user_updated', { entityType: 'user', entityId: id, details: { fields: Object.keys(input) } });
    res.json({ user: toUser(rows[0]) });
  }),
);

router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const tempPassword = generateTemporaryPassword();
    const { rows } = await query(
      `UPDATE users SET password_hash = $2, must_change_password = TRUE, failed_login_count = 0,
         locked_until = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, await hashPassword(tempPassword)],
    );
    if (!rows[0]) throw notFound('User not found');
    await destroyUserSessions(id);
    await audit(req, 'user_password_reset', { entityType: 'user', entityId: id });
    res.json({ user: toUser(rows[0]), temporaryPassword: tempPassword });
  }),
);

export default router;
