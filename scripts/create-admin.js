// Usage: npm run create-admin -- admin@example.org "Full Name"
// Creates (or resets) an admin account and prints a one-time temporary password.
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword, generateTemporaryPassword } from '../src/auth.js';

const [email, ...nameParts] = process.argv.slice(2);
const fullName = nameParts.join(' ').trim();
if (!email || !email.includes('@') || !fullName) {
  console.error('Usage: npm run create-admin -- <email> "<full name>"');
  process.exit(1);
}

await migrate();
const temp = generateTemporaryPassword();
const hash = await hashPassword(temp);
const { rows } = await pool.query(
  `INSERT INTO users (email, full_name, password_hash, role, must_change_password)
   VALUES (lower($1), $2, $3, 'admin', TRUE)
   ON CONFLICT ((lower(email))) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = TRUE,
         must_change_password = TRUE, failed_login_count = 0, locked_until = NULL, updated_at = now()
   RETURNING id`,
  [email, fullName, hash],
);
await pool.query(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
                  VALUES (NULL, 'admin_bootstrapped', 'user', $1, '{"via":"cli"}')`, [rows[0].id]);
console.log(`Admin account ready for ${email}`);
console.log(`Temporary password (shown once, must be changed at first login): ${temp}`);
await pool.end();
