# Project Lorenzo – Outreach Backend

A secure backend (plus a simple mobile web page) for the Project Lorenzo outreach van. Team members sign in with their own accounts, record the people they meet, and every entry stores the GPS location where it was made.

## What it does

- **Individual logins** with three roles:
  | Role | Can do |
  |---|---|
  | `volunteer` | Sign in, do intakes, search people, log new contacts |
  | `staff` | All of the above, plus edit records and see all contacts and locations (for maps and reports) |
  | `admin` | All of the above, plus manage accounts, delete records, and read the audit log |
- **Intake**: record a person's name or nickname, approximate age, DOB, phone, veteran status, needs, notes, and consent. Name is optional; a physical description is enough.
- **Location tracking**: each intake and each follow-up contact is saved as an *encounter* with latitude, longitude, GPS accuracy, a text description of the place, the services provided, and who recorded it.
- **Search and history** for each person, showing where and when they were seen.
- **Audit log** of logins, failed logins, record views, creates, edits, and deletes.

## Security measures

- Passwords hashed with **Argon2id**. Admins never choose or see passwords. New accounts and resets get a random temporary password that the user **must change at first login**. New passwords need at least 12 characters and cannot contain the user's name or email.
- **Server-side sessions**: the cookie is HttpOnly, SameSite=Strict, and Secure in production, and only a hash of the token is stored. Deactivating a user, resetting their password, or changing their role signs them out immediately. Sessions end after 8 hours idle or 24 hours total.
- **Brute-force protection**: login rate limit, plus a 15-minute account lockout after 5 failed attempts. Unknown emails and wrong passwords return the same error.
- **CSRF protection**: SameSite cookies, JSON-only writes, and an Origin check.
- **Strict input validation** (zod). Unknown fields are rejected and every SQL query is parameterized.
- **Security headers** (helmet): strict CSP, HSTS, no framing, no referrer. API responses use `Cache-Control: no-store`.
- Records are **soft-deleted**, so they can be recovered.

## API overview

All endpoints are under `/api` and use JSON.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/login` | – | `{email, password}` |
| POST | `/auth/logout` | any | |
| GET | `/auth/me` | any | current user |
| POST | `/auth/change-password` | any | `{currentPassword, newPassword}` |
| GET | `/individuals?q=&limit=&offset=` | volunteer | search/list |
| POST | `/individuals` | volunteer | intake (see below) |
| GET | `/individuals/:id` | volunteer | person + contact history |
| PATCH | `/individuals/:id` | staff | edit fields |
| DELETE | `/individuals/:id` | admin | soft delete |
| POST | `/individuals/:id/encounters` | volunteer | log a follow-up contact with location |
| GET | `/encounters?from=&to=&minLat=&maxLat=&minLng=&maxLng=` | staff | all contacts, for maps and reports |
| GET/POST | `/users` | admin | list / create (returns a temporary password once) |
| PATCH | `/users/:id` | admin | `{fullName?, role?, isActive?}` |
| POST | `/users/:id/reset-password` | admin | returns a new temporary password |
| GET | `/audit?userId=&entityType=&entityId=&before=` | admin | audit log |

Example intake:

```json
POST /api/individuals
{
  "firstName": "John", "lastName": "Doe", "approximateAge": 45,
  "needs": ["food", "shelter"], "consentGiven": true,
  "encounter": {
    "location": { "latitude": 30.2672, "longitude": -97.7431, "accuracyMeters": 12 },
    "locationDescription": "Under the 5th St overpass",
    "servicesProvided": ["meal", "water"]
  }
}
```

## Running locally

Requirements: Node.js 20+ and PostgreSQL 14+.

```bash
npm install
```

```bash
export DATABASE_URL=postgres://postgres@localhost:5432/lorenzo
```

```bash
npm run create-admin -- you@projectlorenzo.org "Your Name"
```

```bash
npm run dev
```

Open http://localhost:3000. The browser asks for location permission when you start an intake.

Tests need a database whose name ends in `_test`. The tests wipe it.

```bash
createdb lorenzo_test && npm test
```

## Deploying

Any Node host with managed PostgreSQL works, such as Railway, Render, Fly.io, or Heroku.

1. Create a PostgreSQL database and set `DATABASE_URL`.
2. Set `NODE_ENV=production`. This turns on secure cookies, HSTS, and proxy trust. Database TLS is chosen automatically from the host; override it with `DATABASE_SSL` if needed. See `.env.example`.
3. Start command: `npm start`. Migrations run automatically on boot.
4. Run `npm run create-admin -- <email> "<name>"` once from the host's shell to create the first admin.
5. **Always serve over HTTPS.** Phone browsers only allow GPS on HTTPS pages, and the login cookie is HTTPS-only in production.

### Railway

1. In your project, add **PostgreSQL** (New → Database → PostgreSQL), plus this repo as a service.
2. On the app service, open **Variables** and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `NODE_ENV` = `production`
3. Under **Settings → Networking**, generate a domain. Railway serves it over HTTPS.
4. After the first successful deploy, open the service's shell and run `npm run create-admin -- you@example.org "Your Name"`.

If the deploy logs say `DATABASE_URL is not set`, step 2 is missing. If they mention SSL or certificates, set `DATABASE_SSL` to `disable` (private-network URL) or `require` (public URL).

### Operational recommendations

- Turn on **automated backups** and **encryption at rest** for the database. Most managed providers do this by default.
- Give each person their own account and deactivate accounts promptly when people leave.
- Review the audit log regularly (`GET /api/audit`).
- Collect only what the team needs, and record consent. Location history of vulnerable people is sensitive data.
- If you receive HUD/CoC funding, check your HMIS data-sharing and privacy requirements before exporting data.
