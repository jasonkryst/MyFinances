import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth/argon2.js';

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

    const [email, password] = await promptTwoLines('Email: ', 'Password (min 12 chars): ');

    if (!email.includes('@')) {
        console.error('Invalid email.');
        process.exitCode = 1;
        return;
    }
    if (password.length < 12) {
        console.error('Password must be at least 12 characters.');
        process.exitCode = 1;
        return;
    }

    const hash = await hashPassword(password);
    await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, hash]);
    console.log(`User ${email} created.`);
}

main()
    .catch(err => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
