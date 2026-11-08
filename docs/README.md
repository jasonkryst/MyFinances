
# docs/

This directory holds design specs, implementation plans, and audit reports generated during development. It is **reference material** — the authoritative living documentation lives in the root-level files (`README.md`, `CHANGELOG.md`, `ROADMAP.md`, `SECURITY.md`).

---

## Directory Index

### `audit/`
Audit reports generated at key milestones. Subdirectories match the audit type.

| Path | Contents |
|------|----------|
| `audit/security/` | Security audit reports — CVE scan results, CSP compliance, input-validation findings |
| `audit/a11y/` | Accessibility audit reports — WCAG 2.1 AA sweep across all pages and themes |
| `audit/test/` | Test-suite audit reports — coverage gap analysis, cleanup summaries |
| `audit/i18n/` | Internationalization audit reports — locale coverage, missing/mistyped translation keys |
| `audit/features/` | Feature-completeness audit reports — cross-checks the feature set against `CLAUDE.md`/README claims |
| `audit/performance/` | Performance audit reports — load time, Lighthouse, rendering/chart performance |
| `audit/database/` | Database/backend audit reports — PostgreSQL schema, migrations, query patterns |
| `audit/other/` | Miscellaneous audits that don't fit another category |
| `audit/documentation/` | Documentation audit reports — staleness, broken links, inconsistency with the codebase |

Latest reports (newest first per category):
- [`audit/security/SECURITY_AUDIT_2026-11-04.md`](audit/security/SECURITY_AUDIT_2026-11-04.md) — November 4, 2026 — v7.0.0 PostgreSQL-only storage review (no High/Medium findings)
- [`audit/a11y/A11Y_AUDIT_REPORT_2026-11-04.md`](audit/a11y/A11Y_AUDIT_REPORT_2026-11-04.md) — November 4, 2026 — v7.0.0 WCAG 2.1 AA review of the server-only surfaces (0 Critical / 7 Major / 14 Minor)
- [`audit/i18n/I18N_AUDIT_2026-11-04.md`](audit/i18n/I18N_AUDIT_2026-11-04.md) — November 4, 2026 — v7.0.0 internationalization review (2 High / 6 Medium / 8 Low; coverage guard 175/175 passing)
- [`audit/performance/PERFORMANCE_SUSTAINABILITY_AUDIT_2026-11-04.md`](audit/performance/PERFORMANCE_SUSTAINABILITY_AUDIT_2026-11-04.md) — November 4, 2026 — v7.0.0 performance and sustainability review (3 High / 9 Medium / 15 Low; boot, sync, render, server, CI cost)
- [`audit/test/TESTING_AUDIT_2026-11-04.md`](audit/test/TESTING_AUDIT_2026-11-04.md) — November 4, 2026 — v7.0.0 testing audit (2 High / 7 Medium / 9 Low; 2,141 Playwright, 457 Jest, 220 server tests; mutation score 67.20%)
- [`audit/features/FEATURES_AUDIT_2026-11-04.md`](audit/features/FEATURES_AUDIT_2026-11-04.md) — November 4, 2026 — v7.0.0 features audit and recommendations (17 works / 3 degraded / 1 broken; 2 High / 4 Medium / 6 Low; multi-device lost updates)
- [`audit/test/TESTING_AUDIT_2026-10-06.md`](audit/test/TESTING_AUDIT_2026-10-06.md) — October 6, 2026 (previous test audit)
- [`audit/i18n/I18N_AUDIT_2026-10-06.md`](audit/i18n/I18N_AUDIT_2026-10-06.md) — October 6, 2026 (previous i18n audit)
- [`audit/performance/PERFORMANCE_AUDIT_2026-10-06.md`](audit/performance/PERFORMANCE_AUDIT_2026-10-06.md) — October 6, 2026 (previous performance audit)
- [`audit/a11y/A11Y_AUDIT_REPORT_2026-10-06.md`](audit/a11y/A11Y_AUDIT_REPORT_2026-10-06.md) — October 6, 2026 (previous accessibility audit)
- [`audit/documentation/DOCUMENTATION_AUDIT_2026-09-02.md`](audit/documentation/DOCUMENTATION_AUDIT_2026-09-02.md) — September 2, 2026 — full markdown/docs staleness audit (this report)
- [`audit/security/SECURITY_AUDIT_2026-09-02.md`](audit/security/SECURITY_AUDIT_2026-09-02.md) — September 2, 2026 (previous full security audit)
- [`audit/a11y/A11Y_AUDIT_REPORT_2026-09-02.md`](audit/a11y/A11Y_AUDIT_REPORT_2026-09-02.md) — September 2, 2026
- [`audit/test/TESTING_AUDIT_2026-09-02.md`](audit/test/TESTING_AUDIT_2026-09-02.md) — September 2, 2026 (earlier test audit)
- [`audit/i18n/I18N_AUDIT_2026-09-02.md`](audit/i18n/I18N_AUDIT_2026-09-02.md) — September 2, 2026 (earlier i18n audit)
- [`audit/features/FEATURES_AUDIT_2026-09-02.md`](audit/features/FEATURES_AUDIT_2026-09-02.md) — September 2, 2026 (previous features audit)
- [`audit/performance/PERFORMANCE_AUDIT_2026-09-02.md`](audit/performance/PERFORMANCE_AUDIT_2026-09-02.md) — September 2, 2026 (earlier performance audit)
- [`audit/database/DATABASE_AUDIT_2026-09-02.md`](audit/database/DATABASE_AUDIT_2026-09-02.md) — September 2, 2026
- [`audit/other/MISC_AUDIT_2026-09-02.md`](audit/other/MISC_AUDIT_2026-09-02.md) — September 2, 2026
- [`audit/test/TEST_SUITE_AUDIT_2026-08-31.md`](audit/test/TEST_SUITE_AUDIT_2026-08-31.md) — August 31, 2026 (previous test-suite audit)
- [`audit/security/SECURITY_AUDIT_2026-06-19.md`](audit/security/SECURITY_AUDIT_2026-06-19.md) — June 19, 2026 (previous security audit)
- [`audit/a11y/A11Y_AUDIT_REPORT_2026-06-19.md`](audit/a11y/A11Y_AUDIT_REPORT_2026-06-19.md) — June 19, 2026 (earlier accessibility audit)
- [`audit/test/TEST_REPORT_2026-06-28.md`](audit/test/TEST_REPORT_2026-06-28.md) — June 28, 2026 (452 tests / 51 files, v4.2.0)

> Some 2026-09-02 reports above were still being generated in parallel at the time this index was last updated — if a link 404s, the report may not have finished writing yet.

---

### `superpowers/`
Feature specs and implementation plans produced during the design phase. Organized by feature.

| Subdirectory | Contents |
|---|---|
| `superpowers/specs/` | Design specifications — requirements, data-model decisions, UI/UX notes |
| `superpowers/plans/` | Implementation plans — ordered task breakdowns for subagent-driven development |

These documents describe *intent at planning time*. The code and `CHANGELOG.md` are the authoritative record of what actually shipped.

---

### `implementation/`
Post-implementation summaries written after major security or architecture work.

- [`implementation/IMPLEMENTATION_SUMMARY.md`](implementation/IMPLEMENTATION_SUMMARY.md) — CSP compliance and security hardening work (May 2026)

---

## File Naming Conventions

Audit reports are dated: `REPORT_NAME_YYYY-MM-DD.md`  
Superpowers specs/plans are dated: `YYYY-MM-DD-feature-name.md`

When a new audit is run, add the dated report file — do not overwrite the previous one. The dated history lets you compare findings across audit cycles.
