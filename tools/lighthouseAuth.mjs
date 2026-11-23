// Lighthouse CI auth (#470). Since v7 the app needs a session, so an
// unauthenticated audit only sees the sign-in screen. This script:
//   setup  <baseUrl> <email> <password> <outConfig>
//     logs in over HTTP, stores reconciliationAdjustsBalance (keeps the
//     first-run setup wizard from covering Health), checks the session works
//     and writes a copy of lighthouserc.json whose collect settings send the
//     session cookie as an extra header on every request.
//   verify [dir]
//     asserts every audited app page (not guide.html) loaded real data from
//     the API (200 on /api/accounts and /api/debts) and never hit the login
//     gate's /auth/setup-status probe.
// The password is the public CI fixture; nothing here is a secret.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const [mode, ...args] = process.argv.slice(2);

function fail(msg) {
    console.error(`lighthouseAuth: ${msg}`);
    process.exit(1);
}

async function setup([baseUrl, email, password, outConfig]) {
    if (!baseUrl || !email || !password || !outConfig) fail('usage: setup <baseUrl> <email> <password> <outConfig>');
    const root = baseUrl.replace(/\/+$/, '');
    const login = await fetch(`${root}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!login.ok) fail(`login failed: ${login.status} ${await login.text()}`);
    await login.text();
    const cookies = {};
    for (const line of login.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    if (!cookies.session || !cookies.csrf) fail('login did not set session and csrf cookies');
    const cookieHeader = `session=${cookies.session}; csrf=${cookies.csrf}`;

    const put = await fetch(`${root}/api/settings/reconciliationAdjustsBalance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'X-CSRF-Token': cookies.csrf },
        body: JSON.stringify({ value: false }),
    });
    await put.text();
    if (!put.ok) fail(`PUT setting failed: ${put.status}`);

    const probe = await fetch(`${root}/api/plan-settings`, { headers: { Cookie: cookieHeader } });
    await probe.text();
    if (probe.status !== 200) fail(`session probe returned ${probe.status}, expected 200`);

    const config = JSON.parse(readFileSync('lighthouserc.json', 'utf8'));
    config.ci.collect.settings = {
        ...config.ci.collect.settings,
        extraHeaders: JSON.stringify({ Cookie: cookieHeader }),
    };
    writeFileSync(outConfig, JSON.stringify(config, null, 2));
    console.log(`lighthouseAuth: signed in, wrote ${outConfig}`);
}

function verify([dir = '.lighthouseci']) {
    const files = readdirSync(dir).filter(f => /^lhr-.*\.json$/.test(f));
    if (!files.length) fail(`no lhr-*.json in ${dir}`);
    let appRuns = 0;
    for (const f of files) {
        const lhr = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
        const url = new URL(lhr.finalDisplayedUrl || lhr.finalUrl);
        if (url.pathname.endsWith('guide.html')) continue;
        const reqs = lhr.audits['network-requests']?.details?.items || [];
        const ok = path => reqs.some(r => new URL(r.url).pathname === path && r.statusCode === 200);
        if (reqs.some(r => new URL(r.url).pathname === '/auth/setup-status')) fail(`${f}: login gate probe seen, the run was not signed in`);
        for (const path of ['/api/accounts', '/api/debts']) {
            if (!ok(path)) fail(`${f}: ${path} was not loaded with 200, so the audited page is not the app`);
        }
        appRuns++;
    }
    if (!appRuns) fail('no app page runs found');
    console.log(`lighthouseAuth: ${appRuns} app run(s) verified as signed in`);
}

if (mode === 'setup') await setup(args);
else if (mode === 'verify') verify(args);
else fail('mode must be setup or verify');
