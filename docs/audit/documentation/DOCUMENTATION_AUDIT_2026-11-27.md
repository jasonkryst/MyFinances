# Documentation Audit (2026-11-27)

**Baseline:** [DOCUMENTATION_AUDIT_2026-09-02.md](DOCUMENTATION_AUDIT_2026-09-02.md). **Method:** read every root-level `.md`, `docs/README.md` and `docs/architecture/*.md`; grep for version numbers, test counts, dates and removed concepts; cross-check against `src/utils.js` (`APP_VERSION = '8.8.6'`), `CHANGELOG.md`, the open-issue list and the code. `test_community_files.py` guards broken relative links and backticked repo paths in CI, so link rot was not re-checked by hand.

## Files reviewed

| File | State | Action |
|---|---|---|
| `README.md` | Security status line pointed at the 2026-11-04 audit; test-count note dated v7.32.1 | **Updated** |
| `CHANGELOG.md` | Current (8.8.6, 2026-11-26, descending order) | none |
| `ROADMAP.md` | **Stale:** version 8.2.0 (actual 8.8.6); 6 closed issues listed as upcoming; no 8.x history | **Updated** |
| `SECURITY.md` | "Most recent audit" and the Dependabot line (2 alerts) stale; 0 open now | **Updated** |
| `AGENTS.md` | Said setup "creates `secrets/`"; since 8.0.0 it writes `.env` | **Updated** |
| `CLAUDE.md` | Current. 25.6 KB (was 80.9 KB on 2026-11-04) with detail in `docs/architecture/` | none |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `ACCESSIBILITY.md` | Current; ACCESSIBILITY's one limitation (#505) is still open | none |
| `DEPLOYMENT.md` | Current: 8.0.0 environment-variable credentials, 8.4.0 import limit, time-zone note | none |
| `docs/README.md` | Index stopped at 2026-11-04, still carried "being generated in parallel" note | **Updated** |
| `docs/architecture/{features,storage,testing}.md` | Current; `features.md` has entries up to 8.6.0 (#363) | none |
| `docs/third-party-notices.md` | Chart.js 4.4.3 matches `index.html` | none |
| `docs/history/ROADMAP-v4.md` | Intentionally historical | none |
| `guide.html` | Not re-read; English only by design | none |
| `server/README.md`, `tests/README.md` | Spot-checked (8.0.0 note present in `server/README.md`); `tests/README.md` is 748 lines and not fully re-read | see DOC-03 |

## Findings

### DOC-01 (fixed): ROADMAP.md drift
"Current version 8.2.0" with a "Recently shipped (7.x)" section; #529, #687, #688, #363, #713 and #526 are closed but were listed as planned. ROADMAP says GitHub issues are the source of truth, so the stale list was misleading. Fixed; see the [backlog audit](../other/BACKLOG_AUDIT_2026-11-27.md).

### DOC-02 (fixed): README and SECURITY audit pointers
Both named the v7.0.0 audit as "most recent". Updated to this audit (v8.8.6) with the live-signals line (0 Dependabot, 0 code scanning, 0 `npm audit` findings).

### DOC-03 (Low, open): README test counts and `tests/README.md`
The README table is hand-maintained and dated; counts are approximate by its own note. An automated count would stop the drift: a small script that prints the Playwright, Jest and server counts (CI already produces them) and a docs test that fails when the README's date is older than N minor versions. `tests/README.md` at 748 lines likely repeats material now in `docs/architecture/testing.md`; consider reducing it to a pointer plus quick start. (Not changed here.)

### DOC-04 (Info): old audit artefacts accumulate
`docs/audit/` holds 40 files across five rounds of audits, including superseded top-level reports (`SECURITY_AUDIT.md`, `A11Y_AUDIT_REPORT.md`, `TEST_REPORT.md`, `FINAL_TEST_SUMMARY.md`, `TEST_SUITE_REORGANIZATION_SUMMARY.py`) with no date in the name. They are history, which is fine, but a reader landing in the folder cannot tell which is current. `docs/README.md` is the index; keep it as the single "what is current" pointer. A `docs/audit/archive/` move is optional and was not done here, since other docs link to these paths.

### DOC-05 (Info): the rule "update the reference, AGENTS.md, CONTRIBUTING and the PR checklist when a rule changes" has no check
CLAUDE.md states it; only link integrity is tested. A rule moved from CLAUDE.md to `docs/architecture/` or back can leave copies that disagree. This audit found none, but a periodic read like this one is the only control.

## Changes made in this PR
`ROADMAP.md`, `README.md`, `SECURITY.md`, `AGENTS.md`, `docs/README.md`, plus the new reports in this folder. CHANGELOG is **not** changed: this PR changes no app behaviour and does not bump `APP_VERSION`, so the versioning rules in CLAUDE.md do not apply.
