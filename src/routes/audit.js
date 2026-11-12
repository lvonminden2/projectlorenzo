import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../errors.js';
import { parse, auditQuerySchema } from '../validation.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth(), requireRole('admin'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const f = parse(auditQuerySchema, req.query);
    const where = [];
    const vals = [];
    const add = (sql, v) => {
      vals.push(v);
      where.push(sql.replace('?', `$${vals.length}`));
    };
    if (f.userId) add('a.user_id = ?', f.userId);
    if (f.entityType) add('a.entity_type = ?', f.entityType);
    if (f.entityId) add('a.entity_id = ?', f.entityId);
    if (f.before) add('a.id < ?', f.before);
    vals.push(f.limit);
    const { rows } = await query(
      `SELECT a.*, u.full_name AS user_name, u.email AS user_email
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY a.id DESC LIMIT $${vals.length}`,
      vals,
    );
    res.json({
      entries: rows.map((r) => ({
        id: Number(r.id),
        userId: r.user_id,
        userName: r.user_name,
        userEmail: r.user_email,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        ip: r.ip,
        details: r.details,
        createdAt: r.created_at,
      })),
    });
  }),
);

export default router;
