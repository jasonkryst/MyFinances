import express from 'express';
import { query } from '../db.js';
import { generateApiToken, MAX_TOKENS_PER_USER } from '../auth/apiTokens.js';
import { hashToken } from '../auth/middleware.js';
import { normalizeText } from '../sanitizers/index.js';

// #581: manage read-only API tokens (Settings -> Security). Reachable only
// with a browser session: requireSessionOrApiToken refuses tokens here. The
// raw token is returned once, by POST, and never again; only its hash is
// stored. Every query is scoped to the signed-in user.
const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN_NAME_MAX = 60;

const toJson = r => ({
    id: r.public_id,
    name: r.name,
    prefix: r.token_prefix,
    scope: r.scope,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at
});

router.get('/', async (req, res, next) => {
    try {
        const { rows } = await query(
            'SELECT public_id, name, token_prefix, scope, created_at, last_used_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC, id DESC',
            [req.userId]
        );
        res.json(rows.map(toJson));
    } catch (err) {
        next(err);
    }
});

router.post('/', async (req, res, next) => {
    try {
        const raw = req.body?.name;
        const name = typeof raw === 'string' ? normalizeText(raw, TOKEN_NAME_MAX) : '';
        if (!name) {
            return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'A token name is required' } });
        }
        const token = generateApiToken();
        // One statement, so concurrent creates can't pass the limit.
        const { rows } = await query(
            `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix)
             SELECT $1, $2, $3, $4
             WHERE (SELECT count(*) FROM api_tokens WHERE user_id = $1) < $5
             RETURNING public_id, name, token_prefix, scope, created_at, last_used_at`,
            [req.userId, name, hashToken(token), token.slice(0, 12), MAX_TOKENS_PER_USER]
        );
        if (rows.length === 0) {
            return res.status(400).json({ error: { code: 'TOKEN_LIMIT', message: `At most ${MAX_TOKENS_PER_USER} tokens` } });
        }
        res.status(201).json({ ...toJson(rows[0]), token });
    } catch (err) {
        next(err);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        if (!UUID_RE.test(req.params.id)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
        }
        const { rowCount } = await query('DELETE FROM api_tokens WHERE user_id = $1 AND public_id = $2', [req.userId, req.params.id]);
        if (rowCount === 0) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
        }
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

export default router;
