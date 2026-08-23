import express from 'express';
import { query } from './db.js';

export function createKeyedResource({ table, keyColumn, keyField, columns, sanitize, foreignKeys = {} }) {
    const router = express.Router();
    const jsFields = Object.keys(columns);
    const dbColumns = Object.values(columns);

    function rowToJson(row) {
        const out = {};
        for (const jsField of jsFields) out[jsField] = row[columns[jsField]];
        return out;
    }

    // Same ownership check as crudRouter.js's findUnownedForeignKey -- a
    // client-supplied foreign key (e.g. accountId) must reference a row
    // this user actually owns, not just any existing id.
    async function findUnownedForeignKey(userId, clean) {
        for (const [field, refTable] of Object.entries(foreignKeys)) {
            const value = clean[field];
            if (value === null || value === undefined) continue;
            const { rows } = await query(`SELECT 1 FROM ${refTable} WHERE id = $1 AND user_id = $2`, [value, userId]);
            if (rows.length === 0) return field;
        }
        return null;
    }

    router.get('/', async (req, res, next) => {
        try {
            const { rows } = await query(`SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1`, [req.userId]);
            res.json(rows.map(rowToJson));
        } catch (err) {
            next(err);
        }
    });

    router.put('/:key', async (req, res, next) => {
        try {
            const clean = sanitize(req.body, req.params.key);
            if (!clean) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid payload' } });
            }
            const unownedField = await findUnownedForeignKey(req.userId, clean);
            if (unownedField) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${unownedField} does not reference a resource you own` } });
            }
            const insertCols = jsFields.map(f => columns[f]);
            const values = jsFields.map(f => clean[f]);
            const placeholders = jsFields.map((_, i) => `$${i + 2}`);
            const updateClauses = jsFields
                .filter(f => f !== keyField)
                .map(f => `${columns[f]} = EXCLUDED.${columns[f]}`);
            const { rows } = await query(
                `INSERT INTO ${table} (user_id, ${insertCols.join(', ')}) VALUES ($1, ${placeholders.join(', ')})
                 ON CONFLICT (user_id, ${keyColumn}) DO UPDATE SET ${updateClauses.join(', ')}
                 RETURNING ${dbColumns.join(', ')}`,
                [req.userId, ...values]
            );
            res.json(rowToJson(rows[0]));
        } catch (err) {
            next(err);
        }
    });

    router.delete('/:key', async (req, res, next) => {
        try {
            const { rowCount } = await query(
                `DELETE FROM ${table} WHERE user_id = $1 AND ${keyColumn} = $2`,
                [req.userId, req.params.key]
            );
            if (rowCount === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    return router;
}
