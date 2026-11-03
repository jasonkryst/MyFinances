import { createHash } from 'node:crypto';

// Optional Have I Been Pwned "Pwned Passwords" range check (issue #456).
//
// k-anonymity: only the first 5 hex characters of the password's SHA-1 leave
// the server. HIBP answers with every suffix sharing that prefix, and the
// match happens here. `Add-Padding: true` makes HIBP pad the response with
// zero-count decoys so its size doesn't hint at the prefix.
//
// Off unless SECURITY_CHECK_BREACHED_PASSWORDS=true (the issue's
// `Security:CheckBreachedPasswords`), so a box with no outbound internet
// never depends on it. It fails open: a timeout, network error or non-2xx
// answer accepts the password and logs a warning without any password data.
// SECURITY_BREACH_CHECK_URL can point at a self-hosted range mirror (HIBP
// publishes the dataset); the tests point it at a local stub server.

const DEFAULT_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const DEFAULT_TIMEOUT_MS = 3000;
// A real range answer is ~30-40 KB with padding; anything far larger is a
// broken or hostile mirror, so stop reading and fail open.
const MAX_BODY_BYTES = 512 * 1024;

export function isBreachCheckEnabled() {
    return /^(1|true|yes|on)$/i.test(String(process.env.SECURITY_CHECK_BREACHED_PASSWORDS || '').trim());
}

function rangeUrl() {
    const configured = String(process.env.SECURITY_BREACH_CHECK_URL || '').trim();
    if (!configured) return DEFAULT_RANGE_URL;
    return configured.endsWith('/') ? configured : `${configured}/`;
}

function timeoutMs() {
    const n = Number(process.env.SECURITY_BREACH_CHECK_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

async function readCapped(res) {
    if (Number(res.headers.get('content-length')) > MAX_BODY_BYTES) return null;
    if (!res.body) return '';
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    for await (const chunk of res.body) {
        size += chunk.byteLength;
        if (size > MAX_BODY_BYTES) return null;
        text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
}

// Returns true only when the check is enabled AND HIBP reports the password
// with a count above zero. Every other outcome, including errors, is false.
export async function isPasswordBreached(password) {
    if (!isBreachCheckEnabled()) return false;
    const sha1 = createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
        const res = await fetch(rangeUrl() + prefix, {
            headers: { 'Add-Padding': 'true', 'User-Agent': 'MyFinances-self-hosted' },
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs())
        });
        if (!res.ok) {
            console.warn(`[auth] breached-password check skipped (HTTP ${res.status}); password accepted`);
            return false;
        }
        const body = await readCapped(res);
        if (body === null) {
            console.warn('[auth] breached-password check skipped (response too large); password accepted');
            return false;
        }
        for (const line of body.split('\n')) {
            const [candidate, count] = line.trim().split(':');
            if (candidate && candidate.toUpperCase() === suffix) return Number(count) > 0;
        }
        return false;
    } catch (err) {
        console.warn(`[auth] breached-password check skipped (${err?.name || 'error'}); password accepted`);
        return false;
    }
}
