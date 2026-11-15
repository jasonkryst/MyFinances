import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { up, down } from '../migrations/1755600000038_add-incomes-person-id-index.js';

// Issue #535: incomes.person_id (FK, ON DELETE SET NULL) is indexed.

after(() => pool.end());

async function indexDef() {
    const { rows } = await pool.query(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'incomes' AND indexname = 'idx_incomes_person_id'"
    );
    return rows[0]?.indexdef ?? null;
}

// Collects the SQL a migration emits, then runs it, so up()/down() are tested
// as written (including their IF [NOT] EXISTS guards).
async function run(fn) {
    const statements = [];
    await fn({ sql: (s) => statements.push(s) });
    for (const s of statements) await pool.query(s);
}

test('incomes.person_id has an index after migrate up', async () => {
    const def = await indexDef();
    assert.ok(def, 'idx_incomes_person_id should exist');
    assert.match(def, /\(person_id\)/);
});

test('up() is idempotent and down() removes the index (negative), then restores it', async () => {
    await run(up);
    assert.ok(await indexDef());
    try {
        await run(down);
        assert.equal(await indexDef(), null);
        await run(down); // dropping twice must not fail
    } finally {
        await run(up);
    }
    assert.ok(await indexDef());
});
