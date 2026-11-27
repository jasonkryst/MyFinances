# Other Areas Audit: Ops, Repository, CI, Governance (2026-11-27)

**Baseline:** [MISC_AUDIT_2026-10-06.md](MISC_AUDIT_2026-10-06.md). **Method:** static review of the server entrypoint, compose, Dockerfiles, workflows, repository contents and community files.

## Findings

### OTH-01 (Medium): the server does not handle `SIGTERM`
`server/src/index.js` calls `app.listen(...)` and registers no signal handlers; `docker-entrypoint.sh` ends with `exec "$@"`, so `node` is PID 1. On Linux, PID 1 gets no default signal action, so an unhandled `SIGTERM` is ignored. `docker stop` / `docker compose down` / a Portainer redeploy waits out the 10 s grace period and then sends `SIGKILL`.
**Impact:** every restart takes 10 s longer than needed, in-flight requests (including a long `POST /api/import` transaction, up to 120 s allowed) are cut mid-flight, and the pool is never closed. A job interrupted mid-run is not lost: `jobs/runner.js` reclaims stale runs after `STALE_RUN_MINUTES` (60) and retries up to `MAX_ATTEMPTS`. Row versions make a client retry safe, so this is an availability and tidiness problem, not data corruption.
**Fix:**
1. In `index.js`, keep the `http.Server` from `listen`, and on `SIGTERM`/`SIGINT` call `server.close()`, clear the scheduler's timer (`startJobScheduler` would need to return a stop handle), `await pool.end()`, then `process.exit(0)`, with a 10 s hard-exit timer.
2. Optionally add `init: true` to the `server` service so Docker's tini forwards signals (belt and braces).
3. Test: a server test that boots the app, sends the handler its signal, and asserts the listener closes.
Group with DB-01.

### OTH-02 (Low, fixed in this PR): generated and cached files tracked in git
28 files were committed despite `.gitignore`: 27 `__pycache__/*.pyc` files under `tests/` and `docs/`, and `docs/audit/a11y/run_stderr.log`. They bloat diffs and can cause spurious conflicts. Removed from the index in this PR (`git rm --cached`). The audit's JSON raw-findings files are kept; they are small and referenced by the older reports.

### OTH-03 (Info): stray local `secrets/` files
A maintainer checkout still has `secrets/postgres_password.txt` and `secrets/smtp_password.txt`. They are gitignored and not tracked (verified with `git check-ignore`). Since 8.0.0 the stack reads environment variables, so these are dead; DEPLOYMENT.md "Upgrading to 8.0.0" tells operators to delete them. Nothing to change in the repo.

### OTH-04 (Info): healthcheck and update hygiene
All four services have healthchecks (the nginx one now uses `127.0.0.1`). Dependabot covers npm (root and `server/`), Docker (both images), pip and GitHub Actions weekly, with grouped PRs. Base images are `nginx:1.31-alpine`, `node:24-alpine`, `postgres:16-alpine`, tag-pinned, not digest-pinned.

## Positive checks
- **Community files** present and guarded: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md` (private vulnerability reporting), `ACCESSIBILITY.md` with a report form, issue forms, PR template; `test_community_files.py` fails on broken links.
- **Governance:** protected `main`, required `ci-complete`, CodeQL, Trivy and dependency-review; PR-only admin bypass; documented in SECURITY.md and AGENTS.md.
- **Licence and notices:** `LICENSE` and `docs/third-party-notices.md` (Chart.js 4.4.3, matching `index.html`).
- **Operations:** nightly `pg_dump` with retention, `restore.sh`/`restore.ps1`, systemd/cron examples in `docs/examples/`, `setup.sh`/`setup.ps1`, optional Mailpit overlay for email testing.
- **No browser storage of financial data**, enforced by `test_no_browser_financial_storage.py` and an allowlist.

## Not covered
Real deployment behind each documented reverse proxy, TLS configuration, host hardening, and restore drills (see #582).
