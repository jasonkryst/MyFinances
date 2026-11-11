import express from 'express';
import { query } from './db.js';

export function createCrudResource({ table, columns, sanitize, requiredFields = [], foreignKeys = {} }) {
    const router = express.Router();
    const jsFields = Object.keys(columns);
    const dbColumns = Object.values(columns);
    // row_version (#578) lives outside `columns`: it isn't a sanitizer field,
    // so field parity and the sanitizers never see it.
    const selectList = `${dbColumns.join(', ')}, row_version`;

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
            const { rows } = await query(
                `SELECT ${selectList} FROM ${table} WHERE user_id = $1 ORDER BY id`,
                [req.userId]
            );
            res.json(rows.map(rowToJson));
        } catch (err) {
            next(err);
        }
    });

    router.post('/', async (req, res, next) => {
        try {
            const clean = sanitize(req.body, Date.now());
            if (!clean) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid payload' } });
            }
            if (requiredFields.some(f => isMissing(clean[f]))) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${requiredFields[0]} is required` } });
            }
            const unownedField = await findUnownedForeignKey(req.userId, clean);
            if (unownedField) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${unownedField} does not reference a resource you own` } });
            }
            const insertFields = jsFields.filter(f => f !== 'id');
            const insertCols = insertFields.map(f => columns[f]);
            const values = insertFields.map(f => clean[f]);
            const placeholders = insertFields.map((_, i) => `$${i + 2}`);
            const { rows } = await query(
                `INSERT INTO ${table} (user_id, ${insertCols.join(', ')}) VALUES ($1, ${placeholders.join(', ')}) RETURNING ${selectList}`,
                [req.userId, ...values]
            );
            res.status(201).json(rowToJson(rows[0]));
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
            const clean = sanitize(merged, existing.rows[0].id);
            if (!clean) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid payload' } });
            }
            if (requiredFields.some(f => isMissing(clean[f]))) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${requiredFields[0]} is required` } });
            }
            const unownedField = await findUnownedForeignKey(req.userId, clean);
            if (unownedField) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${unownedField} does not reference a resource you own` } });
            }
            const updateFields = jsFields.filter(f => f !== 'id');
            const setClauses = updateFields.map((f, i) => `${columns[f]} = $${i + 3}`);
            const values = updateFields.map(f => clean[f]);
            // The version check is repeated in the UPDATE itself so a write
            // that lands between the SELECT above and here can't be lost.
            const versionGuard = versioned ? ` AND row_version = $${updateFields.length + 3}` : '';
            const { rows } = await query(
                `UPDATE ${table} SET ${setClauses.join(', ')}, row_version = row_version + 1
                 WHERE user_id = $1 AND id = $2${versionGuard} RETURNING ${selectList}`,
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
            const { rowCount } = await query(`DELETE FROM ${table} WHERE user_id = $1 AND id = $2`, [req.userId, req.params.id]);
            if (rowCount === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    router.delete('/', async (req, res, next) => {
        try {
            await query(`DELETE FROM ${table} WHERE user_id = $1`, [req.userId]);
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    // Exposed so test/fieldParity.test.js can compare columns to sanitizer output.
    router.crudConfig = { table, columns, sanitize };
    return router;
}
