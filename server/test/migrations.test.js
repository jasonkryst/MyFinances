import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';

after(() => pool.end());

test('users table accepts a hashed-password row', async () => {
    await resetDb();
    const user = await createTestUser();
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [user.id]);
    assert.equal(rows[0].email, 'test@example.com');
});

test('sessions cascade-delete when their user is deleted', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('tok', $1, now() + interval '1 day')",
        [user.id]
    );
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const { rows } = await pool.query('SELECT * FROM sessions');
    assert.equal(rows.length, 0);
});
