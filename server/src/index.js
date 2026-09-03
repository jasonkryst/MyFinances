import { createApp } from './app.js';
import migrate from 'node-pg-migrate';
import { isEmailConfigured } from './email/transport.js';

async function main() {
    // Run any pending migrations before accepting connections. node-pg-migrate
    // tracks applied migrations in the pgmigrations table, so this is safe to
    // call on every startup (idempotent). Fail fast if migration fails so the
    // container doesn't serve against a broken schema.
    await migrate({
        databaseUrl: process.env.DATABASE_URL,
        dir: 'migrations',
        direction: 'up',
        migrationsTable: 'pgmigrations',
        log: msg => console.log('[migrate]', msg),
    });

    const app = createApp();
    const port = process.env.PORT || 4000;
    if (isEmailConfigured() && !process.env.SMTP_FROM) {
        console.warn('[email] SMTP_HOST is set but SMTP_FROM is empty — outgoing mail will likely be rejected by your SMTP provider.');
    }
    app.listen(port, () => console.log(`myfinances-server listening on ${port}`));
}

main().catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
});
