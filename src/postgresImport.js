import { getCsrfCookie, loadFromPostgres } from './storage.js';
import { trackWrite } from './postgresSync.js';
import { requestLogin } from './loginGate.js';
import { discardBody } from './utils.js';
import { toWireJson } from './importCore.js';

// Import (#529): the whole backup goes to POST /api/import in one request. The
// server runs src/importCore.js (the replace and merge algorithms) in a single
// database transaction, so an import either completes or changes nothing; a
// failure needs no client-side rollback. Afterwards the app adopts what the
// server now holds, which is also what seeds the record versions (#578).

// Sends the import and returns the parsed response. Throws, with the server's
// message, on any failure: nothing was changed on the server then, and the
// app's own state has not been touched.
async function postImport(app, mode, clean, incomingStrategy) {
    // A file's `strategy` is { paymentStrategy, monthlyPayment }; anything else (a hand-edited
    // file) is ignored, as it always was.
    const strategy = incomingStrategy && typeof incomingStrategy === 'object' && !Array.isArray(incomingStrategy) ? incomingStrategy : null;
    const body = toWireJson({ mode, data: clean, strategy });
    // The csrf cookie is re-read per attempt: signing in issues a new one.
    const send = () => fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfCookie() },
        body
    });
    let res = await send();
    if (res.status === 401) {
        // Rejected before anything ran, so sending again after sign-in is safe.
        await discardBody(res);
        await requestLogin(app);
        res = await send();
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = text;
        try { message = JSON.parse(text)?.error?.message || text; } catch { /* not JSON */ }
        throw new Error(`[pgImport] ${mode} import failed (${res.status}): ${message}`);
    }
    return res.json();
}

async function runServerImport(app, mode, clean, incomingStrategy, warnings) {
    // Counted as a pending write so the Saving chip, the unload warning and
    // live refresh (which waits for pending writes) see it (#576).
    const result = await trackWrite(() => postImport(app, mode, clean, incomingStrategy));
    if (Array.isArray(warnings) && Array.isArray(result?.warnings)) warnings.push(...result.warnings);
    // loadFromPostgres replaces every collection with the server rows and
    // seeds the shadow copies PATCHes diff against.
    await loadFromPostgres(app);
    return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Replace-mode import: the server wipes the user's data and creates everything
// from `clean`. `warnings` (optional) collects import warnings, e.g. dropped
// Ledger keys.
export async function replaceForPostgres(app, clean, incomingStrategy, warnings) {
    await runServerImport(app, 'replace', clean, incomingStrategy, warnings);
}

// Merge-mode import: the server creates only the records whose natural key it
// does not already hold, upserts keyed resources and merges plan settings.
// Resolves to { skipped }: how many records were left out as duplicates, per
// collection (#567, #478).
export async function mergeForPostgres(app, clean, incomingStrategy, warnings) {
    const result = await runServerImport(app, 'merge', clean, incomingStrategy, warnings);
    return { skipped: result?.skipped || {} };
}
