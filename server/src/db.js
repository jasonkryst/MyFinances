import pg from 'pg';

const { Pool } = pg;

// node-postgres defaults to returning `numeric` as a string (to avoid
// float precision loss) and `date`/`timestamptz` as parsed JS Date objects
// (which shift with local timezone and don't round-trip through
// sanitizeDateISO()'s plain "YYYY-MM-DD" string check). Every resource
// here works with plain JSON, so return these as the raw wire text
// instead -- sanitize() functions already do their own numeric/date
// coercion on the way in.
pg.types.setTypeParser(1700, val => (val === null ? null : parseFloat(val))); // numeric
pg.types.setTypeParser(1082, val => val); // date
pg.types.setTypeParser(1184, val => val); // timestamptz

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export function query(text, params) {
    return pool.query(text, params);
}
