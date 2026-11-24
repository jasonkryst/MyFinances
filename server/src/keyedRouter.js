import express from 'express';
import { query } from './db.js';
import { recordJsonSql, auditCteSql } from './audit.js';

// What the routes run their SQL on. Bulk import (#529) passes a transaction
// client with the same query() instead.
const poolDb = { query };

export function createKeyedResource({ table, keyColumn, keyField, columns, sanitize, foreignKeys = {} }) {
    const router = express.Router();
    const jsFields = Object.keys(columns);
    const dbColumns = Object.values(columns);
    const keyColumnSql = columns[keyField];
    // #580: every write also logs the entry in its API shape.
    const json = alias => recordJsonSql(alias, columns);

    function rowToJson(row) {
        const out = {};
        for (const jsField of jsFields) out[jsField] = row[columns[jsField]];
        return out;
    }

    // Same ownership check as crudRouter.js's findUnownedForeignKey -- a
    // client-supplied foreign key (e.g. accountId) must reference a row
    // this user actually owns, not just any existing id.
    async function findUnownedForeignKey(userId, clean, db = poolDb) {
        for (const [field, refTable] of Object.entries(foreignKeys)) {
            const value = clean[field];
            if (value === null || value === undefined) continue;
            // See crudRouter.js: a bulk import caches ids already proven to be the user's.
            const cacheKey = `${refTable}:${value}`;
            if (db.ownedIds?.has(cacheKey)) continue;
            const { rows } = await db.query(`SELECT 1 FROM ${refTable} WHERE id = $1 AND user_id = $2`, [value, userId]);
            if (rows.length === 0) return field;
            db.ownedIds?.add(cacheKey);
        }
        return null;
    }

    // The GET body for one user; also used by the background jobs (#579).
    async function listForUser(userId, db = poolDb) {
        const { rows } = await db.query(`SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1`, [userId]);
        return rows.map(rowToJson);
    }

    // Validate and upsert one entry for `userId` on `db` (the pool, or a
    // transaction client during a bulk import, #529). Resolves to { row } or,
    // for a payload the route answers with a 400, { error: message }.
    async function upsertEntry(userId, key, body, db = poolDb) {
        const clean = sanitize(body, key);
        if (!clean) return { error: 'Invalid payload' };
        const unownedField = await findUnownedForeignKey(userId, clean, db);
        if (unownedField) return { error: `${unownedField} does not reference a resource you own` };
        const insertCols = jsFields.map(f => columns[f]);
        const values = jsFields.map(f => clean[f]);
        const placeholders = jsFields.map((_, i) => `$${i + 2}`);
        const updateClauses = jsFields
            .filter(f => f !== keyField)
            .map(f => `${columns[f]} = EXCLUDED.${columns[f]}`);
        // `old` is the entry before the upsert, if there was one: no row
        // means a create, and an unchanged value writes no audit row.
        const keyParam = `$${jsFields.indexOf(keyField) + 2}`;
        const { rows } = await db.query(
            `WITH old AS (
                SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1 AND ${keyColumn} = ${keyParam}
             ), up AS (
                INSERT INTO ${table} (user_id, ${insertCols.join(', ')}) VALUES ($1, ${placeholders.join(', ')})
                ON CONFLICT (user_id, ${keyColumn}) DO UPDATE SET ${updateClauses.join(', ')}
                RETURNING ${dbColumns.join(', ')}
             ), ${auditCteSql({
                table,
                source: 'up LEFT JOIN old ON true',
                rowId: `up.${keyColumnSql}::text`,
                opSql: `CASE WHEN old.${keyColumnSql} IS NULL THEN 'create' ELSE 'update' END`,
                before: `CASE WHEN old.${keyColumnSql} IS NULL THEN NULL ELSE ${json('old')} END`,
                after: json('up')
             })}
             SELECT * FROM up`,
            [userId, ...values]
        );
        return { row: rowToJson(rows[0]) };
    }

    // Removes every entry of the user's, writing one audit row per entry.
    async function deleteAllForUser(userId, db = poolDb) {
        await db.query(
            `WITH del AS (
                DELETE FROM ${table} WHERE user_id = $1 RETURNING ${dbColumns.join(', ')}
             ), ${auditCteSql({ table, op: 'delete', source: 'del', rowId: `del.${keyColumnSql}::text`, before: json('del') })}
             SELECT count(*) FROM del`,
            [userId]
        );
    }

    router.get('/', async (req, res, next) => {
        try {
            res.json(await listForUser(req.userId));
        } catch (err) {
            next(err);
        }
    });

    router.put('/:key', async (req, res, next) => {
        try {
            const { row, error } = await upsertEntry(req.userId, req.params.key, req.body);
            if (error) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: error } });
            }
            res.json(row);
        } catch (err) {
            next(err);
        }
    });

    router.delete('/:key', async (req, res, next) => {
        try {
            const { rows } = await query(
                `WITH del AS (
                    DELETE FROM ${table} WHERE user_id = $1 AND ${keyColumn} = $2 RETURNING ${dbColumns.join(', ')}
                 ), ${auditCteSql({ table, op: 'delete', source: 'del', rowId: `del.${keyColumnSql}::text`, before: json('del') })}
                 SELECT 1 FROM del`,
                [req.userId, req.params.key]
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

    router.crudConfig = { table, columns, sanitize, listForUser, upsertEntry, deleteAllForUser };
    return router;
}
