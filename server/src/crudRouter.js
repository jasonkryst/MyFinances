import express from 'express';
import { query } from './db.js';
import { recordJsonSql, auditCteSql } from './audit.js';

// What the routes run their SQL on. Bulk import (#529) passes a transaction
// client with the same query() instead.
const poolDb = { query };

export function createCrudResource({ table, columns, sanitize, requiredFields = [], foreignKeys = {}, foreignKeyArrays = {}, jsonColumns = [] }) {
    const router = express.Router();
    const jsFields = Object.keys(columns);
    const dbColumns = Object.values(columns);
    // row_version (#578) lives outside `columns`: it isn't a sanitizer field,
    // so field parity and the sanitizers never see it.
    const selectList = `${dbColumns.join(', ')}, row_version`;
    // #580: every write also logs the record (API shape, without rowVersion).
    const json = alias => recordJsonSql(alias, columns);

    // jsonb columns holding arrays (#678): node-pg sends a JS array as a
    // Postgres array literal, which jsonb rejects, so serialize them here.
    const jsonFieldSet = new Set(jsonColumns);
    const toDb = (field, value) => (jsonFieldSet.has(field) && value !== null && value !== undefined ? JSON.stringify(value) : value);

    function rowToJson(row) {
        const out = {};
        for (const jsField of jsFields) out[jsField] = row[columns[jsField]];
        out.rowVersion = row.row_version;
        return out;
    }

    function conflict(res, row) {
        return res.status(409).json({
            error: { code: 'CONFLICT', message: 'This record was changed elsewhere' },
            current: rowToJson(row)
        });
    }

    function isMissing(value) {
        return value === null || value === undefined || value === '';
    }

    // Rejects a payload that references another user's row via a foreign
    // key (e.g. accountId) -- ids are sequential bigserials, so without
    // this check any authenticated user could attach their own records to
    // another tenant's account just by guessing/incrementing an id.
    async function findUnownedForeignKey(userId, clean, db = poolDb) {
        for (const [field, refTable] of Object.entries(foreignKeys)) {
            const value = clean[field];
            if (value === null || value === undefined) continue;
            // A bulk import (#529) passes a Set of the ids already proven to be
            // this user's, so thousands of records on the same few accounts
            // cost one check each instead of one per record.
            const cacheKey = `${refTable}:${value}`;
            if (db.ownedIds?.has(cacheKey)) continue;
            const { rows } = await db.query(`SELECT 1 FROM ${refTable} WHERE id = $1 AND user_id = $2`, [value, userId]);
            if (rows.length === 0) return field;
            db.ownedIds?.add(cacheKey);
        }
        return null;
    }

    // Same check for array-valued references (#557: debts.personIds). Every
    // id must be one of the caller's rows. There is no database FK behind an
    // array column, so a legacy row may still hold the id of a deleted
    // record: a PATCH is checked only when it sends that field, so editing
    // an unrelated field of such a row still works.
    async function findUnownedForeignKeyArray(userId, clean, onlyFields = null, db = poolDb) {
        for (const [field, refTable] of Object.entries(foreignKeyArrays)) {
            if (onlyFields && !onlyFields.includes(field)) continue;
            const ids = Array.isArray(clean[field]) ? [...new Set(clean[field])] : [];
            if (ids.length === 0) continue;
            const { rows } = await db.query(
                `SELECT count(*)::int AS n FROM ${refTable} WHERE user_id = $1 AND id = ANY($2::bigint[])`,
                [userId, ids]
            );
            if (rows[0].n !== ids.length) return field;
        }
        return null;
    }

    // The GET body for one user. Also used by the background jobs (#579) to
    // load a user's data in exactly the shape the browser receives.
    async function listForUser(userId, db = poolDb) {
        const { rows } = await db.query(
            `SELECT ${selectList} FROM ${table} WHERE user_id = $1 ORDER BY id`,
            [userId]
        );
        return rows.map(rowToJson);
    }

    router.get('/', async (req, res, next) => {
        try {
            res.json(await listForUser(req.userId));
        } catch (err) {
            next(err);
        }
    });

    // Validate and insert one record for `userId` on `db` (the pool, or a
    // transaction client during a bulk import, #529). Resolves to { row } or,
    // for a payload the route answers with a 400, { error: message }. The
    // audit row is written by the same statement.
    async function insertRecord(userId, body, db = poolDb) {
        const clean = sanitize(body, Date.now());
        if (!clean) return { error: 'Invalid payload' };
        if (requiredFields.some(f => isMissing(clean[f]))) return { error: `${requiredFields[0]} is required` };
        const unownedField = await findUnownedForeignKey(userId, clean, db)
            || await findUnownedForeignKeyArray(userId, clean, null, db);
        if (unownedField) return { error: `${unownedField} does not reference a resource you own` };
        const insertFields = jsFields.filter(f => f !== 'id');
        const insertCols = insertFields.map(f => columns[f]);
        const values = insertFields.map(f => toDb(f, clean[f]));
        const placeholders = insertFields.map((_, i) => `$${i + 2}`);
        const { rows } = await db.query(
            `WITH ins AS (
                INSERT INTO ${table} (user_id, ${insertCols.join(', ')}) VALUES ($1, ${placeholders.join(', ')}) RETURNING ${selectList}
             ), ${auditCteSql({ table, op: 'create', source: 'ins', rowId: 'ins.id::text', after: json('ins') })}
             SELECT * FROM ins`,
            [userId, ...values]
        );
        return { row: rowToJson(rows[0]) };
    }

    // Removes every row of the user's, writing one audit row per record.
    async function deleteAllForUser(userId, db = poolDb) {
        await db.query(
            `WITH del AS (
                DELETE FROM ${table} WHERE user_id = $1 RETURNING ${selectList}
             ), ${auditCteSql({ table, op: 'delete', source: 'del', rowId: 'del.id::text', before: json('del') })}
             SELECT count(*) FROM del`,
            [userId]
        );
    }

    router.post('/', async (req, res, next) => {
        try {
            const { row, error } = await insertRecord(req.userId, req.body);
            if (error) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: error } });
            }
            res.status(201).json(row);
        } catch (err) {
            next(err);
        }
    });

    router.patch('/:id', async (req, res, next) => {
        try {
            if (!/^\d+$/.test(req.params.id)) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            // Optional optimistic-concurrency check (#578): the version the
            // client last saw. Absent means an unchecked write (an old cached
            // client); present must be a non-negative integer.
            const { rowVersion: expectedVersion, ...body } = (req.body && typeof req.body === 'object') ? req.body : {};
            const versioned = expectedVersion !== undefined && expectedVersion !== null;
            if (versioned && !(Number.isInteger(expectedVersion) && expectedVersion >= 0)) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'rowVersion must be a non-negative integer' } });
            }
            const existing = await query(
                `SELECT ${selectList} FROM ${table} WHERE user_id = $1 AND id = $2`,
                [req.userId, req.params.id]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            if (versioned && existing.rows[0].row_version !== expectedVersion) {
                return conflict(res, existing.rows[0]);
            }
            const merged = { ...rowToJson(existing.rows[0]), ...body };
            const clean = sanitize(merged, existing.rows[0].id, { patchedFields: Object.keys(body) });
            if (!clean) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid payload' } });
            }
            if (requiredFields.some(f => isMissing(clean[f]))) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${requiredFields[0]} is required` } });
            }
            const unownedField = await findUnownedForeignKey(req.userId, clean)
                || await findUnownedForeignKeyArray(req.userId, clean, Object.keys(body));
            if (unownedField) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${unownedField} does not reference a resource you own` } });
            }
            const updateFields = jsFields.filter(f => f !== 'id');
            const setClauses = updateFields.map((f, i) => `${columns[f]} = $${i + 3}`);
            const values = updateFields.map(f => toDb(f, clean[f]));
            // The version check is repeated in the UPDATE itself so a write
            // that lands between the SELECT above and here can't be lost.
            const versionGuard = versioned ? ` AND row_version = $${updateFields.length + 3}` : '';
            // `old` reads the row as this statement found it, before the UPDATE.
            const { rows } = await query(
                `WITH old AS (
                    SELECT ${selectList} FROM ${table} WHERE user_id = $1 AND id = $2
                 ), upd AS (
                    UPDATE ${table} SET ${setClauses.join(', ')}, row_version = row_version + 1
                    WHERE user_id = $1 AND id = $2${versionGuard} RETURNING ${selectList}
                 ), ${auditCteSql({ table, op: 'update', source: 'upd JOIN old ON old.id = upd.id', rowId: 'upd.id::text', before: json('old'), after: json('upd') })}
                 SELECT * FROM upd`,
                versioned ? [req.userId, req.params.id, ...values, expectedVersion] : [req.userId, req.params.id, ...values]
            );
            if (rows.length === 0) {
                const now = await query(`SELECT ${selectList} FROM ${table} WHERE user_id = $1 AND id = $2`, [req.userId, req.params.id]);
                if (now.rows.length === 0) {
                    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
                }
                return conflict(res, now.rows[0]);
            }
            res.json(rowToJson(rows[0]));
        } catch (err) {
            next(err);
        }
    });

    router.delete('/:id', async (req, res, next) => {
        try {
            if (!/^\d+$/.test(req.params.id)) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            const { rows } = await query(
                `WITH del AS (
                    DELETE FROM ${table} WHERE user_id = $1 AND id = $2 RETURNING ${selectList}
                 ), ${auditCteSql({ table, op: 'delete', source: 'del', rowId: 'del.id::text', before: json('del') })}
                 SELECT id FROM del`,
                [req.userId, req.params.id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    router.delete('/', async (req, res, next) => {
        try {
            await deleteAllForUser(req.userId);
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    // Exposed so test/fieldParity.test.js can compare columns to sanitizer output.
    router.crudConfig = { table, columns, sanitize, listForUser, insertRecord, deleteAllForUser };
    return router;
}
