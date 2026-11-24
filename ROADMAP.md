# MyFinances Roadmap

**Last updated**: 2026-11-24
**Current version**: 8.1.0

## How this is planned

GitHub issues are the source of truth. Each open issue carries a priority label (p1, p2 or p3), and the triage page is the working view of them. This file summarizes that triage and is not a second backlog. When the two disagree, the issue wins. [CHANGELOG.md](CHANGELOG.md) is the history of what shipped.

The v4-era roadmap (feature phases, technical debt tables and the old test statistics) is kept in [docs/history/ROADMAP-v4.md](docs/history/ROADMAP-v4.md).

## Now (P1)

Translating the app into Spanish and Polish is the main open effort. The Health page and the global chrome are the largest untranslated surfaces.

- #504 Translate the remaining Health page strings and add Health to the i18n render guard.
- #505 Translate global chrome: Keyboard Shortcuts, the What's New title and header aria labels (the command palette is done).

## Next (P2)

- **Bank import**, in this order:
  1. #690 Store posted transactions as Ledger rows and keep future occurrences projected. This is the foundation.
  2. #260 Bank CSV/OFX import with auto-clear.
  3. #269 The full bank CSV import pipeline (umbrella issue).
  4. #529 A transactional bulk import endpoint instead of one request per record, which large imports need.
- #682 Optional TOTP two-factor authentication with recovery codes.
- #362 A savable dashboard layout.

## Later (P3)

**Internationalization, second wave**
- #506 What's New entries are hardcoded English.
- #507 Translate the setup wizard, account-replacement and calendar feed modals, and the empty state.
- #508 Route runtime alerts, banners, toasts and import messages through `t()`.
- #510 Detect the browser language and persist locale and currency on the server.
- #511 Percentages and decimals use `toFixed()`, so the decimal separator is not localized.
- #465 Polish plural forms: `plural()` cannot express few/many.
- #516 Server emails and the calendar feed are English-only with a hardcoded `$`. It pairs with #526.
- #334 Community-contributed translation infrastructure.

**Performance**
- #713 Fewer modules before the first Health paint (app Lighthouse score 0.75 toward 0.8).

**Maintenance**
- #538 Break up the largest render functions.
- #526 Extract the duplicated calendar/ICS logic into one shared module.

**UX and features**
- #684 A push channel for notifications for self-hosters (ntfy, Gotify, webhook or Web Push).
- #685 Restore previous values or re-create deleted records from a change history entry.
- #687 Optional month-to-month rollover for category budgets.
- #688 Split one manual transaction across several categories.
- #363 Desktop UI adjustment.
- #587 Sync an in-progress reconciliation and the Ledger column choice to the server.

**Documentation and operations**
- #582 Off-host backups and a restore drill.
- #344 Real offline interaction tests for the PWA.

**Deferred storage ideas**
- #96 Managed or cloud PostgreSQL hosting.
- #97 Multi-user accounts and per-field permissions.
- #98 Offline support and conflict resolution beyond last-write-wins.

**Home-network infrastructure.** #640 (block repeat offenders at the UniFi gateway with CrowdSec) and #642 (centralized logs with Loki, Alloy and Grafana) are tracked in the same list. They concern the network the app runs on, not app code.

## Recently shipped (7.x)

Version 7.0.0 made the self-hosted server the only storage. The rest of the 7.x line, newest first. Details for each release are in [CHANGELOG.md](CHANGELOG.md).

- **7.26 to 7.32: debts, sinking funds and security you can see**
  - Promotional APR on debts, with deferred interest (7.26).
  - Per-debt Plan History comparison (7.27).
  - Active sessions, sign out of other devices and a new-device email (7.28).
  - Read-only personal API tokens (7.29).
  - Sinking fund target dates and status (7.30), and the "sinking fund behind" alert (7.32).
  - List pagination on Liabilities and Recurring (7.31).
  - Spanish and Polish dictionaries load on demand (7.32.1).
- **7.20 to 7.25: Settings, history and dated changes**
  - Settings redesign as a grouped list (7.20).
  - Change history, backed by a new audit log (7.22).
  - Amount changes that apply from a date, for incomes and recurring items (7.23).
  - Year in review report (7.24).
  - Income end dates (7.25).
- **7.11 to 7.19: notifications and recovery**
  - Recurring annual bonuses (7.11).
  - Server-side background jobs (7.13).
  - Notifications: bell, email and in-app alerts for bills due and low or overdrawn balances (7.14), and the Notifications page (7.17).
  - Undo for deletes and archives (7.15).
  - Case-insensitive sign-in and an admin password reset script for servers without email (7.15.1).
  - Reconciliation report export (7.19).
- **7.5 to 7.10: Ledger and import**
  - Refresh across tabs (7.5).
  - Manual one-off transactions in the Ledger (7.6).
  - Merge import that no longer duplicates records (7.6).
  - Weekend due-date shift (7.9).
  - Ledger search (7.10).
- **7.0 to 7.4: server-only storage.** The Node.js and PostgreSQL stack became the only store, with sign-in, sessions and no financial data in browser storage.

The earlier roadmap is in [docs/history/ROADMAP-v4.md](docs/history/ROADMAP-v4.md).
