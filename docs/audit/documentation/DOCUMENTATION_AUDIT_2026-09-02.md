# MyFinances Documentation Audit — September 2, 2026

**Scope**: All markdown documentation in the repository, plus `guide.html`, `.env.example`, `setup.sh`/`setup.ps1` (verified against actual `package.json`/`pytest.ini`/`docker-compose.yml` behavior).
**Method**: Read every in-scope file; cross-checked claims (version numbers, test counts, file lists, ports, env vars) against the live codebase (`src/utils.js` `APP_VERSION`, `ls src/*.js`, `pytest --collect-only -q` per directory, `docker-compose.yml`, `server/src/index.js`, `server/src/routes/auth.js`, `server/package.json`); checked all relative markdown links and one `#anchor` link for resolution.
**Current version at audit time**: v4.40.0 (`src/utils.js`), branch `feature/ledger-cleared-transactions`.

This audit ran concurrently with parallel security/a11y/test/i18n/features/performance/database/misc audits (see `docs/README.md`'s "Latest reports" table for links) — some of their reports may still have been mid-write at the time this report was generated.

## Summary

| Severity | Count | Description |
|---|---|---|
| High | 2 | Broken/incorrect operational instructions a user would actually hit (wrong port, wrong env var) |
| Medium | 6 | Stale version/test-count numbers, broken anchor link, stale roadmap claims |
| Low | 3 | Minor miscounts, module-list gaps, missing test-file entries |
| Note-only | 2 | Real issues found but out of this audit's remit — flagged for a human/other audit |

All **High** and **Medium** findings were fixed directly in the working tree. No files were committed, per instructions.

---

## Fixed

### High severity

1. **`setup.ps1` printed the wrong port after setup** (`Open http://localhost:5500`). The port binding changed to 32900 in v4.38.0 and `setup.sh`/`docker-compose.yml`/every other doc were updated at the time, but `setup.ps1` was missed. Fixed to `32900`.
2. **`DEPLOYMENT.md` told operators to set a nonexistent `COOKIE_SECURE=false` env var** for local HTTPS-less testing. The actual code (`server/src/routes/auth.js`) gates the cookies' `Secure` flag on `NODE_ENV === 'production'` — there is no `COOKIE_SECURE` variable anywhere in `server/src`. Rewrote the guidance to describe the real `NODE_ENV` gate, and added `NODE_ENV` (documented, default `production`) to `.env.example`, which previously didn't mention it at all despite it controlling real session-cookie security behavior.

### Medium severity

3. **`server/README.md` told bare-Node users to open `http://localhost:3000`**; the server's actual default (`server/src/index.js`, `process.env.PORT || 4000`) is **4000**. Fixed, and noted it's overridable via `PORT`.
4. **`README.md` and `ROADMAP.md` had stale version numbers.** README's footer said "v4.36.0" (actual: v4.40.0); ROADMAP's header said "Current Version: v4.29.0" and hadn't been touched since June 28, 2026 (an 11-version, ~2-month gap). Updated both, and extended ROADMAP's "Note on Roadmap Coverage" summary with new bullets covering v4.30–v4.40 (Postgres setup wizard, delete/validation modal theming, weekly/twice-monthly income frequencies, account-deletion-with-replacement, Node 24 LTS upgrade, port change, ledger cleared-transaction tracking, etc.), sourced from `CHANGELOG.md`.
5. **Test counts throughout `README.md` and `tests/README.md` were significantly stale**, in some cases by hundreds of tests. Verified actual counts via `pytest --collect-only -q` per directory:

   | Category | Docs claimed (README) | Actual |
   |---|---|---|
   | security | 62 | 62 (correct) |
   | features | 347 | **379** |
   | ui | 205 | **233** |
   | a11y | 10 | 10 (correct) |
   | integration | 17 | **18** |
   | postgres | 34 | **41** |
   | **Total** | 675 (file tree) / 641 (stats line) | **743** (across 75 files) |

   `tests/README.md` was worse — it still said "553 Tests Passing across 5 categories" and "Last Updated: June 28, 2026", didn't mention the `postgres/` category at all, and its per-category file lists were missing `test_validation_modals.py` (features), `test_delete_confirm_modal.py` (ui), and `test_postgres_setup_wizard.py` (postgres). Fixed all counts, added the `postgres/` directory section, added the missing file names, and added a note flagging that ~14 test files added since the doc's last full revision (e.g. `test_break_even.py`, `test_i18n.py`, `test_pwa.py`, `test_cash_flow_trend.py`, `test_money_flow_sankey.py`, `test_high_contrast_theme.py`) don't yet have a dedicated per-file write-up in the "Test Categories" prose section — a fuller rewrite of that section is a separate, larger task (see Left As Note-Only below). Also added PWA / i18n / PostgreSQL-Backend rows to the feature-coverage matrix, which previously omitted all three shipped features entirely.

6. **Broken anchor link**: `ROADMAP.md`'s closing line linked to `SECURITY.md#security-issues`, but `SECURITY.md` has no heading that slugs to `security-issues` (the actual heading is `## Vulnerability Reporting`). Fixed to `SECURITY.md#vulnerability-reporting`.
7. **`README.md`'s "Continuous Security Scanning" section said "four automated scans" but listed five** (CodeQL, Trivy–Docker image, Trivy–Filesystem, Trivy–IaC, Dependency Review). Fixed the count to "five".
8. **`docs/README.md`'s "Latest reports" table was stale and incomplete.** It only listed June 2026 reports even though `docs/audit/test/TEST_SUITE_AUDIT_2026-08-31.md` already existed on disk unlinked, and the `audit/i18n/`, `audit/features/`, `audit/performance/`, `audit/database/`, `audit/other/`, `audit/documentation/` subdirectories (already created by other in-flight audits) weren't documented in the directory index at all. Added index rows for all six new categories and links to all nine 2026-09-02 reports (including this one), plus the previously-unlinked `TEST_SUITE_AUDIT_2026-08-31.md`, keeping every older dated row. Added a one-line caveat noting some 2026-09-02 links may 404 briefly if a parallel audit hadn't finished writing yet.

### Low severity

9. **`CLAUDE.md`'s feature-module list was missing 14 of the 51 files in `src/*.js`** that are genuine `featureFn(app, ...)`-style modules: `breakEven.js`, `dataTransferModal.js`, `guideNav.js`, `guideTheme.js`, `i18n.js`, `loginGate.js`, `pgMigrationModal.js`, `postgresImport.js`, `postgresSync.js`, `serviceWorker.js`, `settings.js`, `setupWizard.js`, `storageAdapters.js`, `utils.js`. Added all 14 to the list (verified `app.js` and `debtCalculator.js` are correctly excluded — they're each already described separately in surrounding prose as the central-state object and the classic global script, respectively).
10. **`README.md`'s file-tree comment said `postgresImport.js` fans out to "14 resource endpoints"**; the actual `loadFromPostgres()` in `src/storage.js` fetches 15 (10 entries in `POSTGRES_RESOURCE_ENDPOINTS` + net-worth-snapshots, settings, ledger-overrides, ledger-cleared, plan-settings). Fixed to 15 — this matches `CLAUDE.md`'s Phase 2a description, which was already correct.
11. **`README.md`'s file-tree test-file listing was missing `test_validation_modals.py` and `test_delete_confirm_modal.py`**, and its `postgres/` entry was missing `test_postgres_setup_wizard.py`. Added all three.

---

## Left as note-only (not fixed here)

1. **`docker-compose.yml`'s `server` service never sets `NODE_ENV`.** Given finding #2 above (the `Secure` cookie flag is gated on `NODE_ENV === 'production'`), this means a deployment that follows `DEPLOYMENT.md`'s Nginx/HTTPS instructions verbatim, using the shipped `docker-compose.yml` unmodified, will **not** actually get `Secure` session/CSRF cookies unless the operator manually adds `NODE_ENV: production` to the compose file's `environment:` block — the docs now correctly describe this behavior (see fix #2), but whether `docker-compose.yml` itself should default to `NODE_ENV: production` is a deployment-security decision, not a documentation fix, and is out of this audit's remit. Flagging for the security audit / a human decision.
2. **`tests/README.md`'s "Test Categories" prose section** (per-file `#### test_x.py` write-ups) is missing dedicated entries for roughly 14 test files added since its last full revision — PWA, i18n, Postgres, high-contrast theme, storage backend, cash-flow-trend/Sankey, and modal-theming tests among them. I fixed the summary counts, directory tree, and coverage matrix (see fix #5), but writing a full new `#### test_x.py` prose block for each of the ~14 missing files is a larger content-authoring task better done as its own pass (ideally scripted off `pytest --collect-only`) rather than folded into a staleness-audit sweep.

---

## Verified clean (no action needed)

- `SECURITY.md`, `guide.html` core content, `.env.example` (pre-fix), `docs/superpowers/specs/*.md` (spot-checked `2026-08-23-postgresql-storage-phase2a-design.md` and `2026-08-24-postgresql-storage-phase2b-design.md` — both correctly dated point-in-time design docs, left untouched per instructions), `docs/implementation/IMPLEMENTATION_SUMMARY.md` (May 2026 CSP-hardening summary, internally consistent, left untouched).
- All relative markdown-to-markdown/file links in `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `SECURITY.md`, `DEPLOYMENT.md`, `docs/README.md`, and `server/README.md` resolve to real files (checked programmatically) — the only broken reference found was the `SECURITY.md#security-issues` anchor (fixed, see #6).
- `guide.html`'s 10-page navigation description, the ledger "Marking Transactions Cleared" section (documenting the brand-new v4.40.0 feature), the Settings-modal/reconciliation-mode walkthrough, and the command-palette references all match current `index.html`/`src/` behavior. Real gap found (not fixed — this is a content-authoring gap, not a staleness bug): `guide.html` still has **no section covering PWA installability/offline behavior, the language switcher (English/Español/Polski), or the optional self-hosted PostgreSQL backend** (login gate, data-transfer modal, migration flow). `ROADMAP.md`'s Tier 5 "Guide page content audit" item previously claimed a *different*, now-resolved set of gaps (Health Dashboard, Reconciliation, Command Palette, Forecast, Spending Analysis were all already covered) — that entry was rewritten to reflect the real remaining gap (see fix #4's ROADMAP edits).
- `CHANGELOG.md`'s top entry (`## [4.40.0] — 2026-09-02`) matches `APP_VERSION` and is well-formed; heading order across the file is descending. No historical entries were touched, per instructions.
- `pytest.ini` / `tests/conftest.py` markers and `BASE_URL` (`http://localhost:32900/`) match what `README.md`/`tests/README.md` describe.
- `setup.sh` matches `docker-compose.yml`/`server/package.json` behavior exactly (this was the file already fixed in the v4.38.0 port migration).

---

## Files changed

`CLAUDE.md`, `README.md`, `ROADMAP.md`, `DEPLOYMENT.md`, `.env.example`, `setup.ps1`, `server/README.md`, `docs/README.md`, `tests/README.md`. `SECURITY.md` itself was read and verified but not edited (only a link pointing *at* it, in `ROADMAP.md`, needed fixing). No files were created except this report; no git commits were made.
