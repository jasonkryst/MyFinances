# Contributing to MyFinances

Thanks for your interest in MyFinances! Bug reports, fixes, tests, translations and
documentation are all welcome. This guide covers how to get a working stack, how
to run the tests, and the conventions a pull request has to follow.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Found a security problem?** Don't open an issue. Report it privately; see
  [SECURITY.md](SECURITY.md#vulnerability-reporting).
- **Have a question or an idea you want to discuss?** Use
  [Discussions](https://github.com/jasonkryst/MyFinances/discussions).
- **Found a bug or an accessibility barrier, or want to request a feature?**
  [Open an issue](https://github.com/jasonkryst/MyFinances/issues/new/choose) using
  one of the forms.
- **Looking for something to work on?** Issues labelled
  [`good first issue`](https://github.com/jasonkryst/MyFinances/labels/good%20first%20issue)
  are small and self-contained. Comment on the issue before starting larger work,
  so two people don't build the same thing.

## How the project is built

- The frontend is **vanilla ES modules with no build step and no framework**.
  Every calculation runs in the browser. The only frontend dependency is Chart.js,
  loaded from a CDN.
- Since v7.0.0 the **self-hosted Node.js + PostgreSQL server (`server/`) is the
  only storage**. The app needs the Docker stack (nginx + server + Postgres);
  a plain static file server no longer works.
- [CLAUDE.md](CLAUDE.md) is the detailed architecture reference, covering the
  app object, feature modules, storage, i18n and the test harness. It's written
  for AI coding agents but is just as useful to people.

## Set up a local stack

```bash
./setup.sh                 # or setup.ps1 on Windows: creates secrets/*.txt
docker compose up -d       # http://localhost:32900
```

To edit the frontend without rebuilding the image, use the dev override, which
bind-mounts `index.html`, `src/`, the stylesheets and the service worker:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for every setting.

## Run the tests

> **Warning:** the browser tests wipe all server data before every test. Never
> point them at a stack that holds real data.

**Browser tests** (pytest + Playwright, against a running stack):

```bash
pip install -r tests/requirements.txt
playwright install chromium

# Once per fresh stack: create the test user (email line, then password line)
printf '%s\n%s\n' testuser@example.com 'ci-Test-Passphrase-2026!' \
  | docker compose run --rm -T server node scripts/create-user.js

pytest tests/features/test_debts.py -v   # one file
pytest tests/ -v                         # everything (slow)
```

Run only one pytest process per stack; parallel runs share one user and wipe
each other's data.

**Unit tests** (Jest) for the pure calculation modules:

```bash
npm install
npm run test:unit
```

**Server tests** (node:test, against a throwaway Postgres):

```bash
cd server
docker compose -f docker-compose.test.yml up -d
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npm run migrate up && npm test
```

CI runs all of these on every pull request.

## Conventions a pull request must follow

Many of these are enforced by tests, so CI fails if one is missed.

### Code

- **Feature-module pattern.** Put logic in a module function `featureFn(app, ...)`
  and add a one-line delegating method on `DebtTrackerApp` in `src/app.js`.
- **Strict CSP.** No inline `<script>`, no `style="..."`, no `eval`. Style through
  CSS classes (`styles-csp-classes.css`) toggled with `classList`.
- **Escape user data.** Anything user-supplied that goes into `innerHTML` passes
  through `escapeHtml()`; prefer `textContent`.
- **New persisted field.** It needs an entry in its `sanitizeX()` function in
  `src/sanitizers.js`, a database migration, and a `columns` entry in its
  `server/src/routes/*.js` route. Otherwise the server silently drops it.
- **Migrations.** Number a new migration higher than the newest one on `main`
  *when your PR merges*, and write it idempotently (`IF NOT EXISTS`).
- **No financial data in browser storage.** Only device preferences belong in
  `localStorage`.

### Text and accessibility

- **Translations.** Every user-visible string needs a key in all three locale
  files, `src/locales/{en,es,pl}.js`, with a real translation rather than an
  English copy. If you can't translate, say so in the PR and we'll help.
- **Accessible controls.** Every button needs an accessible name. Toggle buttons
  carry `aria-pressed`. Charts need a `renderChartDataTable()` fallback.
- **Contrast.** Text colours must reach 4.5:1. Use `var(--danger-text)` for
  error text, and don't dim text with `opacity`.

### Tests

- **Add positive and negative tests** for new behaviour, including what happens
  when bad input is rejected.
- **New test files must be listed in a CI shard.** A new `tests/features/` or
  `tests/ui/` file goes into a shard in `.github/workflows/ci.yml`, or it never
  runs.
- **Assert; don't skip.** Never write `if not el: pytest.skip(...)`. A missing
  control should fail the test.
- **Wait for saves.** After submitting a form, wait for the save to finish
  before acting on the result (see the `submit_*_form` helpers in
  `tests/conftest.py`).

### Versions and the changelog

Leave the version alone unless the maintainer asks; it is usually bumped when a
change is merged. When a PR does bump `APP_VERSION` (`src/utils.js`), the same PR
must also:

- add a matching `## [x.y.z] — YYYY-MM-DD` entry at the top of `CHANGELOG.md`;
- set `sw.js`'s `CACHE_NAME` to the same version; and
- for a minor version, add a What's New entry (`WHATS_NEW_ENTRIES` in `src/ui.js`).

## Pull requests

1. Fork the repository, and branch from the latest `main`.
2. Keep each PR focused on one change. Reference the issue it closes
   (`Closes #123`).
3. Fill in the pull request template, including how you tested it.
4. Make sure CI is green. `main` is protected: every change goes through a PR and
   must pass the required checks before it can merge.
5. The maintainer reviews and merges. If changes are requested, push more
   commits to the same branch.

Thank you for helping make MyFinances better!
