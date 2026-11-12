import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Invalid input', z.flattenError(result.error).fieldErrors);
  }
  return result.data;
}

const optText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const tagList = z.array(z.string().trim().min(1).max(100)).max(50);

export const uuidParam = z.object({ id: z.string().uuid() });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

export const roleSchema = z.enum(['admin', 'staff', 'volunteer']);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(1).max(200),
  role: roleSchema,
});

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0).max(1_000_000).nullable().optional(),
    source: z.enum(['device_gps', 'manual']).default('device_gps'),
  })
  .strict();

export const encounterSchema = z
  .object({
    occurredAt: z.coerce.date().optional(),
    location: locationSchema.nullable().optional(),
    locationDescription: optText(500),
    servicesProvided: tagList.default([]),
    notes: optText(5000),
  })
  .strict()
  .refine((e) => !e.occurredAt || e.occurredAt.getTime() <= Date.now() + 5 * 60 * 1000, {
    message: 'occurredAt cannot be in the future',
    path: ['occurredAt'],
  });

const individualFields = {
  firstName: optText(100),
  lastName: optText(100),
  preferredName: optText(100),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((d) => !Number.isNaN(Date.parse(d)) && Date.parse(d) <= Date.now(), 'Invalid date')
    .nullable()
    .optional(),
  approximateAge: z.number().int().min(0).max(120).nullable().optional(),
  gender: optText(50),
  phone: optText(30),
  email: z.string().trim().toLowerCase().email().max(254).nullable().optional().or(z.literal('').transform(() => null)),
  veteranStatus: z.enum(['yes', 'no', 'unknown', 'declined']).nullable().optional(),
  physicalDescription: optText(1000),
  needs: tagList.optional(),
  notes: optText(10000),
  consentGiven: z.boolean().optional(),
};

export const createIndividualSchema = z
  .object({
    ...individualFields,
    // The intake itself is recorded as the first encounter, with location.
    encounter: encounterSchema.optional(),
  })
  .strict()
  .refine((v) => v.firstName || v.lastName || v.preferredName || v.physicalDescription, {
    message: 'Provide at least a name, preferred name, or physical description',
    path: ['firstName'],
  });

export const updateIndividualSchema = z.object(individualFields).strict();

const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listIndividualsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  need: z.string().trim().max(100).optional(),
  veteranStatus: z.enum(['yes', 'no', 'unknown', 'declined']).optional(),
  hasLocation: queryBool.optional(),
  sort: z.enum(['lastSeen', 'name', 'created', 'contacts']).default('lastSeen'),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const updateEncounterSchema = z
  .object({
    location: locationSchema.nullable().optional(),
    locationDescription: optText(500),
    servicesProvided: tagList.optional(),
    notes: optText(5000),
  })
  .strict();

export const listEncountersSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minLat: z.coerce.number().min(-90).max(90).optional(),
  maxLat: z.coerce.number().min(-90).max(90).optional(),
  minLng: z.coerce.number().min(-180).max(180).optional(),
  maxLng: z.coerce.number().min(-180).max(180).optional(),
  hasLocation: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(200),
});

export const auditQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().positive().optional(),
});
