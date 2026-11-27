# Full Application Audit: Summary (2026-11-27)

**Version audited:** 8.8.6 (`main` at `fc69165`). **Baseline:** the 2026-11-04 audit set (v7.0.0).
**Method:** a delta audit. Static review of code, config and docs, plus live checks that need no running stack (`npm audit`, `gh` alerts and issues, repo inspection). It did **not** run the Playwright suite, the Docker stack, Lighthouse or manual assistive-technology passes (decided with the owner: "static + light runs"). Where a finding would need a measurement to be sure, the report says so.

| Area | Report | Result |
|---|---|---|
| Documentation | [documentation/DOCUMENTATION_AUDIT_2026-11-27.md](documentation/DOCUMENTATION_AUDIT_2026-11-27.md) | 7 stale items, all fixed in this PR |
| Security | [security/SECURITY_AUDIT_2026-11-27.md](security/SECURITY_AUDIT_2026-11-27.md) | No High or Medium. 5 Low, 3 Info |
| Accessibility | [a11y/A11Y_AUDIT_REPORT_2026-11-27.md](a11y/A11Y_AUDIT_REPORT_2026-11-27.md) | 7 carried findings verified resolved in code, the rest not re-measured; 1 new (dimmed text) |
| i18n | [i18n/I18N_AUDIT_2026-11-27.md](i18n/I18N_AUDIT_2026-11-27.md) | `lang` and plurals fixed; #504/#505 still open; 1 new |
| Functionality | [features/FEATURES_AUDIT_2026-11-27.md](features/FEATURES_AUDIT_2026-11-27.md) | All 12 prior findings have code-level fixes; no new defects found statically |
| Testing | [test/TESTING_AUDIT_2026-11-27.md](test/TESTING_AUDIT_2026-11-27.md) | Guards and pins in place; local Jest broken in this checkout |
| Database | [database/DATABASE_AUDIT_2026-11-27.md](database/DATABASE_AUDIT_2026-11-27.md) | 1 new Low (unpruned tables); backups still same-host (#582) |
| Performance | [performance/PERFORMANCE_AUDIT_2026-11-27.md](performance/PERFORMANCE_AUDIT_2026-11-27.md) | 10 carried findings resolved; 1 carried finding unchanged (SW revalidation); nothing measured this pass |
| Backlog | [other/BACKLOG_AUDIT_2026-11-27.md](other/BACKLOG_AUDIT_2026-11-27.md) | 25 open issues; roadmap drift fixed; 2 questions for the owner |
| Other (ops, repo, CI) | [other/OTHER_AUDIT_2026-11-27.md](other/OTHER_AUDIT_2026-11-27.md) | 1 Medium (no graceful shutdown); repo hygiene fixed in this PR |

## Live signals at audit time

- `npm audit --omit=dev`: 0 vulnerabilities (root and `server/`).
- Dependabot open alerts: 0. Code-scanning open alerts: 0. (Down from 2 Dependabot alerts on 2026-11-04.)
- Outdated server dependencies (patch/minor only): `argon2` 0.45.1 to 0.45.2, `express-rate-limit` 8.7.1 to 8.7.5, `nodemailer` 10.1.0 to 10.6.1. Dependabot covers all of them.

## Findings filed as issues

Filed 2026-11-27: OTH-01 #752, DB-01 #753, A11Y-01 #754, I18N-01 #755, PERF-01 #756, SEC-01 to SEC-04 #757 to #760 (security items labelled p0 at the owner's request, although Low severity). Owner decisions: #640/#642 stay; #260 folded into #269.

Severity is the audit's view; the priority label follows the repo scheme (p1 to p3). **Security findings are held back until the owner approves publishing them** (the repository is public).

| ID | Finding | Area | Sev | Proposed labels |
|---|---|---|---|---|
| OTH-01 | The server has no `SIGTERM` handler. Node runs as PID 1 (`exec "$@"`), so `docker stop` waits the 10 s grace period and then SIGKILLs it, cutting in-flight requests (including a long import transaction) and never closing the pool. | Ops | Medium | p2, maintenance |
| DB-01 | `password_reset_tokens` and `known_devices` are never pruned (the hourly job prunes sessions, `job_runs`, notifications and the audit log only). | Database | Low | p3, maintenance |
| SEC-01 | The `server` and `postgres` services lack the hardening the `myfinances` (nginx) service has: `no-new-privileges`, `cap_drop: ALL`; `server` could also be `read_only` with a tmpfs. | Security | Low | p3, security |
| SEC-02 | The CSP always allows `googletagmanager.com` and `google-analytics.com` in `script-src`/`connect-src`, even when `GA_MEASUREMENT_ID` is unset (the default). | Security | Low | p3, security |
| SEC-03 | Brute-force limits are in memory and per IP only: they reset on restart, there is no per-account throttle, and the authenticated `/api` has no limiter. Overlaps the TOTP issue #682. | Security | Low | p3, security |
| SEC-04 | GitHub Actions are pinned by tag (for example `actions/checkout@v7`), not commit SHA. Dependabot covers updates. | Security | Low | p3, security, ci |
| A11Y-01 | 21 `opacity:` declarations in `styles.css` dim content; CLAUDE.md says not to dim text with opacity. Archived and paused cards (`.acct-card--archived` 0.65, `.recurring-card--archived` 0.55, `.recurring-card--paused` 0.6, `.sinking-card--archived` 0.65) dim all the text inside. Needs a contrast measurement per rule. | A11y | Low to Medium | p2, accessibility |
| I18N-01 | 19 direct `toLocaleDateString`/`toLocaleTimeString`/`toLocaleString` calls outside `utils.js` bypass the cached, app-locale formatters (CLAUDE.md rule), so dates can follow the browser locale. | i18n | Low | p3, i18n |
| PERF-01 | Every static asset is `no-cache` and the service worker is network-first, so a warm load revalidates about 127 module files plus CSS and HTML; `styles.css` (309 KB) and `index.html` (223 KB) ship as single files with gzip only. Carried from PERF-07 (2026-11-04), unchanged. | Performance | Low | p3, performance |

Already tracked, no new issue: the i18n backlog (#504, #505, #506, #507, #508, #510, #511, #516, #465), off-host backups (#582), render-function size (#538), TOTP (#682), PWA offline tests (#344).

## Fixed in this PR (no issue needed)

- ROADMAP.md: version 8.2.0 to 8.8.6; removed six closed issues from "Next"/"Later"; added the 8.x "Recently shipped" section.
- README.md and SECURITY.md: audit date and status now point at this audit; stale Dependabot line replaced; test-count note refreshed.
- AGENTS.md: stale "creates `secrets/`" corrected (credentials are `.env` since 8.0.0).
- docs/README.md: index rewritten for the 2026-11-27 set; removed the "still being generated" note.
- Repo hygiene: 27 tracked `__pycache__/*.pyc` files and the stale `docs/audit/a11y/run_stderr.log` removed from git (already in `.gitignore`).

## Questions for the owner

1. **#640 (UniFi/CrowdSec) and #642 (Loki/Grafana)** are home-network infrastructure, not MyFinances features. Keep them in this repo's backlog, move them elsewhere, or close them?
2. **#260 and #269** (bank CSV/OFX import) overlap, and both depend on #690. Fold #260 into #269 as a checklist item?
3. **Security issues:** publish SEC-01 to SEC-04 as public issues, or keep them in the audit docs and fix them directly in a PR?
4. **OTH-01 (graceful shutdown)** touches `server/src/index.js` and the job runner. Fix in a follow-up PR from this audit?
