import { pool } from '../../src/db.js';
import argon2 from 'argon2';

export async function resetDb() {
    await pool.query(
        `TRUNCATE sessions, ledger_amount_overrides, settings, net_worth_snapshots,
                  reconciliations, sinking_funds, emergency_funds, recurring_templates, debts,
                  bonuses, incomes, expenses, bills, accounts, users RESTART IDENTITY CASCADE`
    );
}

export async function createTestUser(email = 'test@example.com', password = 'correct horse battery staple') {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, hash]
    );
    return { id: rows[0].id, email, password };
}

export async function loginTestUser(baseUrl, email, password) {
    return fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
}
