import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';

// Issue #472: migration 1755600000031 casts debts.updated_at from timestamptz
// to date with `updated_at::date`, which depends on the session TimeZone. These
// tests pin down when that cast is exact (DEPLOYMENT.md "Database time zone").
// Each runs in a rolled-back transaction on a temp table, so no schema changes.

after(async () => {
    await pool.end();
});

// Writes `dateStr` into a timestamptz column with TimeZone=writeZone (as the
// pre-7.0 server did), then runs the migration's exact ALTER with
// TimeZone=migrateZone and returns the resulting date.
async function writeThenMigrate(dateStr, writeZone, migrateZone) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('CREATE TEMP TABLE tz_debts (updated_at timestamptz) ON COMMIT DROP');
        await client.query(`SET LOCAL TimeZone TO '${writeZone}'`);
        await client.query('INSERT INTO tz_debts (updated_at) VALUES ($1)', [dateStr]);
        await client.query(`SET LOCAL TimeZone TO '${migrateZone}'`);
        await client.query('ALTER TABLE tz_debts ALTER COLUMN updated_at TYPE date USING updated_at::date');
        const { rows } = await client.query('SELECT updated_at FROM tz_debts');
        return rows[0].updated_at;
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
}

for (const zone of ['UTC', 'America/Chicago', 'Pacific/Kiritimati', 'Etc/GMT+12', 'Asia/Kolkata']) {
    test(`cast is exact when written and migrated in ${zone}`, async () => {
        assert.equal(await writeThenMigrate('2026-03-04', zone, zone), '2026-03-04');
        // Month and year boundaries too.
        assert.equal(await writeThenMigrate('2025-12-31', zone, zone), '2025-12-31');
    });
}

test('cast shifts a day when the zone changed between write and migration', async () => {
    // Midnight in UTC+14 is 10:00 UTC the previous day.
    assert.equal(await writeThenMigrate('2026-03-04', 'Pacific/Kiritimati', 'UTC'), '2026-03-03');
    // Midnight UTC is 14:00 the same day in UTC+14 (no shift) but 12:00 the
    // previous day in UTC-12 (Etc/GMT+12 is UTC-12 in POSIX sign convention).
    assert.equal(await writeThenMigrate('2026-03-04', 'UTC', 'Pacific/Kiritimati'), '2026-03-04');
    assert.equal(await writeThenMigrate('2026-03-04', 'UTC', 'Etc/GMT+12'), '2026-03-03');
});

test('the migration still uses the session-zone cast this file tests', async () => {
    const { up } = await import('../migrations/1755600000031_add-missing-persisted-fields.js');
    const sql = [];
    await up({ sql: s => sql.push(s) });
    assert.ok(sql.includes('ALTER TABLE debts ALTER COLUMN updated_at TYPE date USING updated_at::date;'));
});

test('the bundled Postgres runs in UTC', async () => {
    // CI and the bundled container never set TZ for Postgres; if this fails,
    // DEPLOYMENT.md's "Database time zone" note no longer matches the stack.
    const { rows } = await pool.query("SELECT current_setting('TimeZone') AS tz");
    assert.match(rows[0].tz, /^(Etc\/)?UTC$/);
});
