import pg from 'pg';

const { Pool } = pg;

// node-postgres defaults to returning `numeric` as a string (to avoid
// float precision loss) and `date`/`timestamptz` as parsed JS Date objects
// (which shift with local timezone and don't round-trip through
// sanitizeDateISO()'s plain "YYYY-MM-DD" string check). Every resource
// here works with plain JSON, so return these as the raw wire text
// instead -- sanitize() functions already do their own numeric/date
// coercion on the way in.
pg.types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10))); // bigint/bigserial
pg.types.setTypeParser(1700, val => (val === null ? null : parseFloat(val))); // numeric
pg.types.setTypeParser(1082, val => val); // date
pg.types.setTypeParser(1184, val => val); // timestamptz

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
}

// SSL is skipped only for the two same-machine/same-Docker-network hosts
// this app's own deployment paths ever produce (`postgres`, the compose
// service name set by docker-entrypoint.sh, and `localhost`/`127.0.0.1` for
// bare-Node dev per server/README.md). Any other host -- a future non-local
// Postgres target, not currently used by any documented deployment path --
// requires TLS with full certificate validation by default; there is no env
// var to weaken this, so a self-signed remote Postgres needs a properly
// trusted cert (or a CA added to Node's trust store) rather than silently
// accepting a MITM-able connection.
const dbHost = new URL(process.env.DATABASE_URL).hostname;
const LOCAL_HOSTS = new Set(['postgres', 'localhost', '127.0.0.1']);
const sslConfig = LOCAL_HOSTS.has(dbHost) ? false : true;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Sent as `SET statement_timeout` on every new connection -- caps a
    // runaway/blocked query instead of holding a pool connection
    // indefinitely (docs/audit/database/DATABASE_AUDIT_2026-09-02.md M2).
    statement_timeout: 30000,
});

export function query(text, params) {
    return pool.query(text, params);
}
