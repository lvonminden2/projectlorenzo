import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { audit } from '../audit.js';
import { asyncHandler, notFound } from '../errors.js';
import {
  parse,
  uuidParam,
  createIndividualSchema,
  updateIndividualSchema,
  listIndividualsSchema,
  encounterSchema,
  listEncountersSchema,
} from '../validation.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth());

// Map API (camelCase) field names to columns.
const INDIVIDUAL_COLUMNS = {
  firstName: 'first_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  dateOfBirth: 'date_of_birth',
  approximateAge: 'approximate_age',
  gender: 'gender',
  phone: 'phone',
  email: 'email',
  veteranStatus: 'veteran_status',
  physicalDescription: 'physical_description',
  needs: 'needs',
  notes: 'notes',
  consentGiven: 'consent_given',
};

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

export const toIndividual = (r) => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  preferredName: r.preferred_name,
  dateOfBirth: fmtDate(r.date_of_birth),
  approximateAge: r.approximate_age,
  gender: r.gender,
  phone: r.phone,
  email: r.email,
  veteranStatus: r.veteran_status,
  physicalDescription: r.physical_description,
  needs: r.needs,
  notes: r.notes,
  consentGiven: r.consent_given,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastSeenAt: r.last_seen_at,
  encounterCount: r.encounter_count !== undefined ? Number(r.encounter_count) : undefined,
});

export const toEncounter = (r) => ({
  id: r.id,
  individualId: r.individual_id,
  recordedBy: r.recorded_by,
  recordedByName: r.recorded_by_name,
  occurredAt: r.occurred_at,
  location:
    r.latitude === null
      ? null
      : {
          latitude: r.latitude,
          longitude: r.longitude,
          accuracyMeters: r.location_accuracy_m,
          source: r.location_source,
        },
  locationDescription: r.location_description,
  servicesProvided: r.services_provided,
  notes: r.notes,
  createdAt: r.created_at,
  individualName: r.individual_name,
});

async function insertEncounter(db, individualId, userId, e) {
  const loc = e.location ?? null;
  const { rows } = await db.query(
    `INSERT INTO encounters (individual_id, recorded_by, occurred_at, latitude, longitude,
       location_accuracy_m, location_source, location_description, services_provided, notes)
     VALUES ($1, $2, COALESCE($3, now()), $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      individualId,
      userId,
      e.occurredAt ?? null,
      loc?.latitude ?? null,
      loc?.longitude ?? null,
      loc?.accuracyMeters ?? null,
      loc ? loc.source : 'unavailable',
      e.locationDescription ?? null,
      e.servicesProvided ?? [],
      e.notes ?? null,
    ],
  );
  return rows[0];
}

// Search / list
router.get(
  '/individuals',
  asyncHandler(async (req, res) => {
    const { q, limit, offset } = parse(listIndividualsSchema, req.query);
    const params = [limit, offset];
    let where = 'i.deleted_at IS NULL';
    if (q) {
      params.push(`%${q.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      where += ` AND (lower(coalesce(i.first_name,'')) LIKE $3 OR lower(coalesce(i.last_name,'')) LIKE $3
                  OR lower(coalesce(i.preferred_name,'')) LIKE $3
                  OR lower(coalesce(i.first_name,'') || ' ' || coalesce(i.last_name,'')) LIKE $3
                  OR coalesce(i.phone,'') LIKE $3)`;
    }
    const { rows } = await query(
      `SELECT i.*, e.last_seen_at, e.encounter_count, count(*) OVER () AS total
         FROM individuals i
         LEFT JOIN LATERAL (
           SELECT max(occurred_at) AS last_seen_at, count(*) AS encounter_count
             FROM encounters WHERE individual_id = i.id) e ON TRUE
        WHERE ${where}
        ORDER BY e.last_seen_at DESC NULLS LAST, i.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    await audit(req, 'individuals_searched', { details: { q: q ? '[redacted]' : null, results: rows.length } });
    res.json({ total: rows[0] ? Number(rows[0].total) : 0, individuals: rows.map(toIndividual) });
  }),
);

// Create (intake) — records the person and the location where they were met.
router.post(
  '/individuals',
  asyncHandler(async (req, res) => {
    const input = parse(createIndividualSchema, req.body);
    const { encounter: encounterInput, ...fields } = input;
    const result = await withTransaction(async (db) => {
      const cols = ['created_by', 'updated_by'];
      const vals = [req.user.id, req.user.id];
      for (const [key, col] of Object.entries(INDIVIDUAL_COLUMNS)) {
        if (fields[key] !== undefined) {
          cols.push(col);
          vals.push(fields[key]);
        }
      }
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await db.query(
        `INSERT INTO individuals (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        vals,
      );
      const individual = rows[0];
      const encounter = await insertEncounter(db, individual.id, req.user.id, encounterInput ?? {});
      return { individual, encounter };
    });
    await audit(req, 'individual_created', {
      entityType: 'individual',
      entityId: result.individual.id,
      details: { encounterId: result.encounter.id, hasLocation: result.encounter.latitude !== null },
    });
    res.status(201).json({ individual: toIndividual(result.individual), encounter: toEncounter(result.encounter) });
  }),
);

router.get(
  '/individuals/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { rows } = await query(
      `SELECT i.*, u.full_name AS created_by_name FROM individuals i
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) throw notFound('Individual not found');
    const enc = await query(
      `SELECT e.*, u.full_name AS recorded_by_name FROM encounters e
         LEFT JOIN users u ON u.id = e.recorded_by
        WHERE e.individual_id = $1 ORDER BY e.occurred_at DESC`,
      [id],
    );
    await audit(req, 'individual_viewed', { entityType: 'individual', entityId: id });
    res.json({ individual: toIndividual(rows[0]), encounters: enc.rows.map(toEncounter) });
  }),
);

router.patch(
  '/individuals/:id',
  requireRole('staff'),
  asyncHandler(async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateIndividualSchema, req.body);
    const sets = ['updated_at = now()', 'updated_by = $2'];
    const vals = [id, req.user.id];
    for (const [key, col] of Object.entries(INDIVIDUAL_COLUMNS)) {
      if (input[key] !== undefined) {
        vals.push(input[key]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    const { rows } = await query(
      `UPDATE individuals SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      vals,
    );
    if (!rows[0]) throw notFound('Individual not found');
    await audit(req, 'individual_updated', {
      entityType: 'individual',
      entityId: id,
      details: { fields: Object.keys(input) },
    });
    res.json({ individual: toIndividual(rows[0]) });
  }),
);

router.delete(
  '/individuals/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const { rowCount } = await query(
      'UPDATE individuals SET deleted_at = now(), updated_by = $2 WHERE id = $1 AND deleted_at IS NULL',
      [id, req.user.id],
    );
    if (!rowCount) throw notFound('Individual not found');
    await audit(req, 'individual_deleted', { entityType: 'individual', entityId: id });
    res.json({ ok: true });
  }),
);

// Log a follow-up contact (with location) for someone already in the system.
router.post(
  '/individuals/:id/encounters',
  asyncHandler(async (req, res) => {
    const { id } = parse(uuidParam, req.params);
    const input = parse(encounterSchema, req.body);
    const exists = await query('SELECT 1 FROM individuals WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!exists.rowCount) throw notFound('Individual not found');
    const row = await insertEncounter({ query }, id, req.user.id, input);
    await audit(req, 'encounter_created', {
      entityType: 'encounter',
      entityId: row.id,
      details: { individualId: id, hasLocation: row.latitude !== null },
    });
    res.status(201).json({ encounter: toEncounter(row) });
  }),
);

// Encounters across everyone, for mapping/reporting. Staff and above only.
router.get(
  '/encounters',
  requireRole('staff'),
  asyncHandler(async (req, res) => {
    const f = parse(listEncountersSchema, req.query);
    const where = ['i.deleted_at IS NULL'];
    const vals = [];
    const add = (sql, v) => {
      vals.push(v);
      where.push(sql.replace('?', `$${vals.length}`));
    };
    if (f.from) add('e.occurred_at >= ?', f.from);
    if (f.to) add('e.occurred_at <= ?', f.to);
    if (f.minLat !== undefined) add('e.latitude >= ?', f.minLat);
    if (f.maxLat !== undefined) add('e.latitude <= ?', f.maxLat);
    if (f.minLng !== undefined) add('e.longitude >= ?', f.minLng);
    if (f.maxLng !== undefined) add('e.longitude <= ?', f.maxLng);
    vals.push(f.limit);
    const { rows } = await query(
      `SELECT e.*, u.full_name AS recorded_by_name,
              coalesce(i.preferred_name, trim(coalesce(i.first_name,'') || ' ' || coalesce(i.last_name,''))) AS individual_name
         FROM encounters e
         JOIN individuals i ON i.id = e.individual_id
         LEFT JOIN users u ON u.id = e.recorded_by
        WHERE ${where.join(' AND ')}
        ORDER BY e.occurred_at DESC
        LIMIT $${vals.length}`,
      vals,
    );
    await audit(req, 'encounters_listed', { details: { results: rows.length } });
    res.json({ encounters: rows.map(toEncounter) });
  }),
);

export default router;
