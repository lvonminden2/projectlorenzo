import { query } from './db/pool.js';

/**
 * Record an action in the append-only audit log. Never put passwords or
 * full record contents in `details`; field names are enough.
 */
export async function audit(req, action, { entityType = null, entityId = null, details = null, userId } = {}) {
  const uid = userId !== undefined ? userId : req?.user?.id ?? null;
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uid, action, entityType, entityId ? String(entityId) : null, req?.ip ?? null, details],
  );
}
