// How many reverse proxies sit in front of the server (Express `trust proxy`).
// The bundled nginx is one hop, the default. Behind another proxy (Traefik,
// Nginx Proxy Manager, Caddy, a tunnel) set TRUST_PROXY_HOPS=2, or req.ip is
// that outer proxy's address for every visitor: the login rate limit then
// counts every device's failed attempts together, and the session cookie's
// Secure flag follows the wrong hop's X-Forwarded-Proto.
// Never set it higher than the real number of proxies: each extra hop lets a
// client choose its own address with a forged X-Forwarded-For header.

export const TRUST_PROXY_HOPS_DEFAULT = 1;
export const TRUST_PROXY_HOPS_MAX = 10;

export function trustProxyHops(env = process.env, log = console) {
    const raw = env.TRUST_PROXY_HOPS;
    if (raw === undefined || raw === null || String(raw).trim() === '') return TRUST_PROXY_HOPS_DEFAULT;
    const s = String(raw).trim();
    if (/^\d+$/.test(s) && Number(s) <= TRUST_PROXY_HOPS_MAX) return Number(s);
    log.warn(`[server] TRUST_PROXY_HOPS=${JSON.stringify(s)} is not a whole number from 0 to ${TRUST_PROXY_HOPS_MAX}; using ${TRUST_PROXY_HOPS_DEFAULT}`);
    return TRUST_PROXY_HOPS_DEFAULT;
}
