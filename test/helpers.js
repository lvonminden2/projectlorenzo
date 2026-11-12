process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgres://postgres@localhost:5432/lorenzo_test';
process.env.LOGIN_RATE_LIMIT = '1000';

const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');
const supertest = (await import('supertest')).default;

export { pool };

export async function resetDb() {
  if (!/_test\b/.test(process.env.DATABASE_URL)) throw new Error('Refusing to reset a non-test database');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
}

export async function createUser({ email, password = 'correct horse battery staple', role = 'staff', fullName = 'Test User', mustChange = false }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [email, fullName, await hashPassword(password), role, mustChange],
  );
  return { id: rows[0].id, email, password };
}

export const app = createApp();

/** Returns a supertest agent (keeps cookies) logged in as the given user. */
export async function login(email, password = 'correct horse battery staple') {
  const agent = supertest.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export const request = () => supertest(app);
