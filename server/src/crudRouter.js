import express from 'express';
import { query } from './db.js';

export function createCrudResource({ table, columns, sanitize, requiredFields = [] }) {
    const router = express.Router();
    const jsFields = Object.keys(columns);
    const dbColumns = Object.values(columns);

    function rowToJson(row) {
        const out = {};
        for (const jsField of jsFields) out[jsField] = row[columns[jsField]];
        return out;
    }

    function isMissing(value) {
        return value === null || value === undefined || value === '';
    }

    router.get('/', async (req, res, next) => {
        try {
            const { rows } = await query(
                `SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1 ORDER BY id`,
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
            if (requiredFields.some(f => isMissing(clean[f]))) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${requiredFields[0]} is required` } });
            }
            const insertFields = jsFields.filter(f => f !== 'id');
            const insertCols = insertFields.map(f => columns[f]);
            const values = insertFields.map(f => clean[f]);
            const placeholders = insertFields.map((_, i) => `$${i + 2}`);
            const { rows } = await query(
                `INSERT INTO ${table} (user_id, ${insertCols.join(', ')}) VALUES ($1, ${placeholders.join(', ')}) RETURNING ${dbColumns.join(', ')}`,
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
            const existing = await query(
                `SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1 AND id = $2`,
                [req.userId, req.params.id]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            const merged = { ...rowToJson(existing.rows[0]), ...req.body };
            const clean = sanitize(merged, existing.rows[0].id);
            if (requiredFields.some(f => isMissing(clean[f]))) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${requiredFields[0]} is required` } });
            }
            const updateFields = jsFields.filter(f => f !== 'id');
            const setClauses = updateFields.map((f, i) => `${columns[f]} = $${i + 3}`);
            const values = updateFields.map(f => clean[f]);
            const { rows } = await query(
                `UPDATE ${table} SET ${setClauses.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING ${dbColumns.join(', ')}`,
                [req.userId, req.params.id, ...values]
            );
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

    return router;
}
