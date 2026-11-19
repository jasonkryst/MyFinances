// Set a new password for the account, from the server host (no SMTP needed).
//
//   docker compose run --rm server node scripts/reset-password.js
//
// Prompts for the account email and the new password (one line each, like
// create-user.js; both can be piped on stdin). The new password must pass the
// same policy as sign-up. Every existing session and pending reset link for
// the account is revoked, so other devices must sign in again.

import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth/argon2.js';
import { checkNewPassword, PASSWORD_MIN_LENGTH } from '../src/auth/passwordCheck.js';
import { normalizeEmail, EMAIL_MATCH_SQL } from '../src/auth/email.js';

async function promptTwoLines(firstPrompt, secondPrompt) {
    stdout.write(firstPrompt);
    const rl = readline.createInterface({ input: stdin });
    const lines = [];
    for await (const line of rl) {
        lines.push(line);
        if (lines.length === 1) stdout.write(secondPrompt);
        if (lines.length === 2) break;
    }
    rl.close();
    return lines;
}

async function main() {
    const [rawEmail = '', password = ''] = await promptTwoLines('Account email: ', `New password (min ${PASSWORD_MIN_LENGTH} chars): `);
    stdout.write('\n');
    const email = normalizeEmail(rawEmail);

    const { rows } = await pool.query(`SELECT id, email FROM users WHERE ${EMAIL_MATCH_SQL} ORDER BY id LIMIT 1`, [email]);
    if (rows.length === 0) {
        const { rows: all } = await pool.query('SELECT count(*)::int AS n FROM users');
        console.error(all[0].n === 0
            ? 'No account exists yet. Create one with: node scripts/create-user.js'
            : `No account with the email ${JSON.stringify(email)}. Check the address (it is not case-sensitive).`);
        process.exitCode = 1;
        return;
    }
    const user = rows[0];

    const problem = await checkNewPassword(password, { email: user.email });
    if (problem) {
        console.error(problem.message);
        process.exitCode = 1;
        return;
    }

    const hash = await hashPassword(password);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
        const { rowCount: sessions } = await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
        await client.query('COMMIT');
        console.log(`Password updated for ${user.email}. ${sessions} signed-in session(s) were signed out.`);
        console.log('If sign-in was locked after failed attempts, restart the server to clear the limit: docker compose restart server');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

main()
    .catch(err => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
