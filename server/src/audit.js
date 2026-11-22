// Change log (#580). The generic routers append an `_audit` CTE to their write
// statement, so the audit row is written by the same SQL statement as the
// change: it commits or rolls back with it, and no write path can forget it.
// Only writes made through the API are logged; foreign-key cascades (a debt's
// balance history, SET NULL on an account delete) and the background jobs are not.

export const AUDIT_LOG_RETENTION_DAYS = 90;
export const AUDIT_OPS = ['create', 'update', 'delete'];

// jsonb_build_object takes at most 100 arguments (50 pairs), so wider records
// are built in chunks and concatenated.
const PAIRS_PER_CALL = 50;

// SQL for the record held in `alias` as a jsonb object in the API's JSON shape
// ({ jsField: alias.db_column }). Field and column names come from route
// definitions in code, never from a request.
export function recordJsonSql(alias, columns) {
    const pairs = Object.entries(columns).map(([field, column]) => `'${field}', ${alias}.${column}`);
    const calls = [];
    for (let i = 0; i < pairs.length; i += PAIRS_PER_CALL) {
        calls.push(`jsonb_build_object(${pairs.slice(i, i + PAIRS_PER_CALL).join(', ')})`);
    }
    return calls.length ? calls.join(' || ') : `'{}'::jsonb`;
}

// The `_audit` CTE body. `source` is the FROM clause (one row per change),
// `rowId` an SQL text expression, `before`/`after` SQL jsonb expressions or
// NULL. `userParam` is the statement's user-id placeholder. An update whose
// before and after are equal writes nothing.
export function auditCteSql({ table, op, userParam = '$1', source, rowId, before = 'NULL', after = 'NULL', opSql }) {
    const opExpr = opSql || `'${op}'`;
    const unchanged = before !== 'NULL' && after !== 'NULL' ? ` WHERE (${before}) IS DISTINCT FROM (${after})` : '';
    return `_audit AS (
        INSERT INTO audit_log (user_id, table_name, row_id, op, before, after)
        SELECT ${userParam}::bigint, '${table}', ${rowId}, ${opExpr}, ${before}, ${after}
        FROM ${source}${unchanged}
    )`;
}
