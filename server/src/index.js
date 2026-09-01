import { createApp } from './app.js';
import migrate from 'node-pg-migrate';

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
    app.listen(port, () => console.log(`myfinances-server listening on ${port}`));
}

main().catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
});
