# Backlog Audit (2026-11-27)

**Source:** `gh issue list` on 2026-11-27. 25 open issues, 0 open pull requests. The `audit-2026-11` label has closed 102 issues since 2026-11-04 and still marks 14 open ones.

## Shape of the backlog

| Priority | Open | Issues |
|---|---|---|
| p1 | 2 | #504 (Health strings), #505 (global chrome) |
| p2 | 7 | #690, #682, #642, #640, #362, #269, #260 |
| p3 | 15 | #685, #684, #582, #538, #516, #511, #510, #508, #507, #506, #465, #344, #334, #98, #97, #96 |

By theme: **i18n 11** (#504 to #511, #516, #465, #334), **bank import 3** (#690, #269, #260), **security/infra 3** (#682, #640, #642), **storage ideas 3** (#96, #97, #98), UX/features 3 (#684, #685, #362), maintenance/ops/CI 3 (#538, #582, #344).

## Observations

1. **The P1 items are 23 days old.** #504 and #505 were filed in the 2026-11-04 audit and are the only P1 work; meanwhile 102 audit issues closed. The roadmap already leads with them. They are the clearest next-up work.
2. **Two infrastructure issues do not belong to the app.** #640 (UniFi gateway + CrowdSec bouncer) and #642 (Loki/Alloy/Grafana for "all self-hosted apps") describe the owner's home network, not MyFinances behaviour. They carry `p2, security` labels and so appear in the app's priority list. Suggest moving them to a personal infra repo or closing them here. *Owner decision requested.*
3. **#260 and #269 overlap.** #269 is the umbrella "full bank CSV import pipeline"; #260 is the "bank CSV/OFX import with auto-clear" slice. Both are blocked on #690 (store posted transactions as Ledger rows). Consider folding #260 into #269 as a checklist item so there is one place to track. *Owner decision requested.*
4. **#465 may be obsolete.** The 2026-11-04 i18n audit found `plural()` already selects forms via `Intl.PluralRules` and partly refuted the issue. Re-check whether Polish few/many actually render correctly; close if so.
5. **#362 (Dashboard savable layout) vs the closed #363 (Desktop UI)** were once adjacent; the roadmap listed #363 as open until this PR. #362 is still genuine p2.
6. **Label hygiene.** #362, #344, #334, #260, #98, #96 lack the `audit-2026-11` label (fine, they are older or not audit-born), and 8 issues lack `complexity:`/`impact:` labels (#344, #334, #260, #269, #98, #97, #96, #362 are missing at least one). Triage consistency matters because ROADMAP.md reads these labels.
7. **Storage ideas (#96, #97, #98) are three long-standing p3s** (managed Postgres, multi-user, offline conflict resolution). They are product direction rather than backlog; consider moving them to a "Ideas" milestone or discussions so p3 means "will do".
8. **No stale PRs.** 0 open PRs.

## ROADMAP.md corrections made in this PR

- Current version 8.2.0 to 8.8.6; "Last updated" 2026-11-27.
- Removed closed issues from "Next"/"Later": #529, #687, #688, #363, #713, #526.
- Added a "Recently shipped (8.x)" section (bulk import, credentials as environment variables, effective-dated and routing work, phone tab bar, change history readability).
- Added the audit findings as proposed work (see the [summary](../AUDIT_SUMMARY_2026-11-27.md)); issue numbers are added after the owner approves them.

## Proposed issues (from this audit)
See the table in the summary. Nine candidates: OTH-01, DB-01, SEC-01 to SEC-04, A11Y-01, I18N-01, PERF-01.
