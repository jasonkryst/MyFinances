import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth/argon2.js';
import { checkNewPassword, PASSWORD_MIN_LENGTH } from '../src/auth/passwordCheck.js';
import { sendTemplatedEmail } from '../src/email/send.js';

async function promptTwoLines(emailPrompt, passwordPrompt) {
    stdout.write(emailPrompt);
    const rl = readline.createInterface({ input: stdin });
    const lines = [];
    for await (const line of rl) {
        lines.push(line);
        if (lines.length === 1) stdout.write(passwordPrompt);
        if (lines.length === 2) break;
    }
    rl.close();
    return lines;
}

async function main() {
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM users');
    if (rows[0].count > 0) {
        console.error('A user already exists. This is a single-user deployment; refusing to create another.');
        process.exitCode = 1;
        return;
    }

    const [email, password] = await promptTwoLines('Email: ', `Password (min ${PASSWORD_MIN_LENGTH} chars): `);

    if (!email.includes('@')) {
        console.error('Invalid email.');
        process.exitCode = 1;
        return;
    }
    // #456: same new-password policy as /auth/register (length, common,
    // context, and the optional breached-password check).
    const problem = await checkNewPassword(password, { email });
    if (problem) {
        console.error(problem.message);
        process.exitCode = 1;
        return;
    }

    const hash = await hashPassword(password);
    await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, hash]);

    try {
        await sendTemplatedEmail(email, 'welcomeEmail', { email });
    } catch (err) {
        console.error('Welcome email failed (account was still created):', err.message);
    }

    console.log(`User ${email} created.`);
}

main()
    .catch(err => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
