import net from 'node:net';

// #683: what Settings -> Security shows about a session, derived from the
// request. Pure functions; no database access.

export const USER_AGENT_MAX = 512;

// A coarse browser and OS from a User-Agent header. Order matters: Edge and
// Opera also say "Chrome", Chrome also says "Safari", and an iPad may claim
// to be a Mac. Unknown parts are null (the browser shows "Unknown").
export function summarizeUserAgent(ua) {
    const s = typeof ua === 'string' ? ua : '';
    let browser = null;
    if (/\bEdg(e|A|iOS)?\//.test(s)) browser = 'Edge';
    else if (/\b(OPR|Opera)\//.test(s)) browser = 'Opera';
    else if (/\b(Firefox|FxiOS)\//.test(s)) browser = 'Firefox';
    else if (/\bSamsungBrowser\//.test(s)) browser = 'Samsung Internet';
    else if (/\b(HeadlessChrome|Chrome|CriOS|Chromium)\//.test(s)) browser = 'Chrome';
    else if (/\bVersion\/[\d.]+.*\bSafari\//.test(s)) browser = 'Safari';

    let os = null;
    if (/\b(iPhone|iPad|iPod)\b/.test(s)) os = 'iOS';
    else if (/\bAndroid\b/.test(s)) os = 'Android';
    else if (/\bWindows\b/.test(s)) os = 'Windows';
    else if (/\bCrOS\b/.test(s)) os = 'ChromeOS';
    else if (/\bMac OS X\b|\bMacintosh\b/.test(s)) os = 'macOS';
    else if (/\bLinux\b/.test(s)) os = 'Linux';
    return { browser, os };
}

// The key a "known device" is remembered by: the browser/OS pair.
export function deviceKey(ua) {
    const { browser, os } = summarizeUserAgent(ua);
    return `${browser || 'unknown'}|${os || 'unknown'}`;
}

// The client address truncated to its network: IPv4 /24, IPv6 /48. An
// IPv4-mapped IPv6 address is treated as IPv4. Anything else is null.
export function truncateIp(ip) {
    if (typeof ip !== 'string') return null;
    let addr = ip.trim();
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) addr = mapped[1];
    if (net.isIPv4(addr)) {
        const [a, b, c] = addr.split('.');
        return `${a}.${b}.${c}.0/24`;
    }
    if (net.isIPv6(addr)) {
        const groups = expandIpv6(addr).slice(0, 3).map(g => g.replace(/^0+(?=.)/, ''));
        return `${groups.join(':')}::/48`;
    }
    return null;
}

function expandIpv6(addr) {
    const [head, tail = ''] = addr.split('::');
    const h = head ? head.split(':') : [];
    const t = addr.includes('::') && tail ? tail.split(':') : [];
    const fill = addr.includes('::') ? Array(8 - h.length - t.length).fill('0') : [];
    return [...h, ...fill, ...t].map(g => g.toLowerCase());
}

// What createSession stores about the request.
export function sessionMetaFromRequest(req) {
    const ua = req.get?.('User-Agent');
    return {
        userAgent: typeof ua === 'string' && ua ? ua.slice(0, USER_AGENT_MAX) : null,
        ipPrefix: truncateIp(req.ip)
    };
}
