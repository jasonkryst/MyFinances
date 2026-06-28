
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

Latest reports:
- [`audit/security/SECURITY_AUDIT_2026-06-19.md`](audit/security/SECURITY_AUDIT_2026-06-19.md) — June 19, 2026
- [`audit/a11y/A11Y_AUDIT_REPORT_2026-06-19.md`](audit/a11y/A11Y_AUDIT_REPORT_2026-06-19.md) — June 19, 2026
- [`audit/test/TEST_REPORT_2026-06-28.md`](audit/test/TEST_REPORT_2026-06-28.md) — June 28, 2026 (452 tests / 51 files, v4.2.0)

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
