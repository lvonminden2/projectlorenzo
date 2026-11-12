-- Project Lorenzo initial schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'volunteer')),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count   INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- Server-side sessions. Only a SHA-256 hash of the token is stored, so a
-- database leak does not expose usable session tokens.
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- A person the outreach team has met.
CREATE TABLE individuals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       TEXT,
  last_name        TEXT,
  preferred_name   TEXT,
  date_of_birth    DATE,
  approximate_age  INTEGER CHECK (approximate_age IS NULL OR (approximate_age BETWEEN 0 AND 120)),
  gender           TEXT,
  phone            TEXT,
  email            TEXT,
  veteran_status   TEXT CHECK (veteran_status IS NULL OR veteran_status IN ('yes', 'no', 'unknown', 'declined')),
  physical_description TEXT,
  needs            TEXT[] NOT NULL DEFAULT '{}',
  notes            TEXT,
  consent_given    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX individuals_name_idx ON individuals (lower(coalesce(last_name, '')), lower(coalesce(first_name, '')));

-- Each time the van team records/updates someone, an encounter is logged
-- along with where it happened.
CREATE TABLE encounters (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  individual_id         UUID NOT NULL REFERENCES individuals(id) ON DELETE CASCADE,
  recorded_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  latitude              DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude             DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  location_accuracy_m   DOUBLE PRECISION CHECK (location_accuracy_m IS NULL OR location_accuracy_m >= 0),
  location_source       TEXT CHECK (location_source IS NULL OR location_source IN ('device_gps', 'manual', 'unavailable')),
  location_description  TEXT,
  services_provided     TEXT[] NOT NULL DEFAULT '{}',
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX encounters_individual_idx ON encounters (individual_id, occurred_at DESC);
CREATE INDEX encounters_occurred_idx ON encounters (occurred_at DESC);

-- Append-only record of who did what. Required for sensitive client data.
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  ip          TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
