# GitHub Actions CI Workflow (push/PR checks)

## Context

GitHub Story #57 ("GITHUB ACTIONS") asks for workflow files similar to those in `jasonkryst/ThePlayground` (`.github/workflows/`). That repo has two workflows:

- **`ci.yml`** — runs on push/PR to `main`: `lint`, `lint-css`, `unit-tests`, `build`, `e2e` (Playwright/JS), `docker-build`, `npm-audit`, `trivy`, `lighthouse`.
- **`docker-image.yml`** ("Docker Release") — on GitHub release publish, builds and pushes the Docker image to Docker Hub + GHCR.

MyFinances already has an identical `docker-image.yml` (`.github/workflows/docker-image.yml`, image names updated to `myfinances`). It has **no push/PR CI workflow**. This spec covers adding one.

MyFinances is a no-build-step vanilla-JS static app (per `CLAUDE.md`) with no `package.json`/npm and no lint tooling (no ESLint/Stylelint config exists). Its test suite is Python/pytest + Playwright (`playwright.sync_api`/`async_api`, not the `pytest-playwright` plugin), run against `python -m http.server 5500` per `tests/conftest.py`'s `BASE_URL`. Tests are organized under `tests/{features,integration,ui,security,a11y}/`, matching the pytest markers registered in `tests/conftest.py::pytest_configure` (`feature`, `integration`, `ui`, `security`, `a11y`, `slow`).

Because of this, ThePlayground's `ci.yml` doesn't map 1:1 — `lint`/`lint-css`/`npm-audit` have no equivalent tooling here, and `unit-tests`/`build`/`e2e` collapse into pytest since there's no bundler and no separate unit/e2e split in JS.

## Goals

1. Add `.github/workflows/ci.yml`, triggered on `push` and `pull_request` to `main`, matching ThePlayground's trigger.
2. Run the full pytest suite as five parallel jobs split by test category (`tests/features`, `tests/integration`, `tests/ui`, `tests/security`, `tests/a11y`), mirroring ThePlayground's per-concern job breakdown.
3. Add a `docker-build` job that builds the existing `Dockerfile` as a sanity check (no push).
4. Add a `trivy` job that scans the built image for fixable CRITICAL/HIGH CVEs (gate) and uploads a full SARIF report to the repo's Security tab (report-only), same two-step pattern as ThePlayground.
5. Add a `lighthouse` job serving the app locally and asserting performance/accessibility/best-practices/seo scores, same 0.8 thresholds as ThePlayground. This requires a new `lighthouserc.json` at repo root (none exists today).

## Non-goals

- No `lint`/`lint-css` jobs — no ESLint/Stylelint config exists in this repo; adding linting tooling is out of scope for this story.
- No `npm-audit` job — there's no `package.json`; the app's only external dependency is Chart.js loaded via CDN, already constrained by the CSP tested in `tests/security/`.
- No changes to `docker-image.yml` — it already exists and already covers release-time publishing.
- No branch-protection/required-status-check configuration — this spec adds the workflow file only; making checks required on `main` is a separate repo-settings change the user can apply afterward.

## Workflow design — `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

### pytest jobs (`test-features`, `test-integration`, `test-ui`, `test-security`, `test-a11y`)

Each job independently, in parallel:

1. `actions/checkout@v4`
2. `actions/setup-python@v5` (`python-version: "3.14"`, matching local dev per `python --version`; `cache: pip`)
3. `pip install playwright pytest pytest-asyncio`
4. `playwright install --with-deps chromium`
5. Start the static server in the background: `python -m http.server 5500 &` then wait for it to respond (`curl` retry loop) before proceeding — there's no build step, so the server can start immediately after checkout.
6. `pytest tests/<category> -v`

Five independent jobs (rather than one job matrixed or one combined run) so a failure in, say, `tests/security` is immediately visible as its own red X in the PR checks list, matching how ThePlayground separates `lint`/`lint-css`/`unit-tests`/`e2e`. The cost is duplicated setup (~5x pip/Playwright install) across jobs, which GitHub Actions parallelizes away in wall-clock time.

### `docker-build`

1. `actions/checkout@v4`
2. `docker build -t myfinances:ci .`

Pure sanity check — confirms the Dockerfile still builds; no push, no registry login (unlike `docker-image.yml`, which only runs on release).

### `trivy`

Runs independently in parallel (like ThePlayground's, it does **not** declare `needs: docker-build` — it rebuilds the image itself rather than sharing an artifact, matching the reference workflow exactly). Same two-step pattern as ThePlayground:

1. Checkout, `docker build -t myfinances:ci .`
2. `aquasecurity/trivy-action@v0.36.0`, `severity: CRITICAL,HIGH`, `ignore-unfixed: true`, `exit-code: 1` — **gates** the job on fixable high-severity CVEs.
3. `aquasecurity/trivy-action@v0.36.0` again, `format: sarif`, `if: always()` — full report including unfixed/lower-severity findings.
4. `github/codeql-action/upload-sarif@v4` to publish the SARIF to the Security tab.

Needs `permissions: contents: read, security-events: write`. Works on the free tier since the repo is public (confirmed via `gh repo view`).

### `lighthouse`

1. Checkout, start `python -m http.server 5500 &`, wait for it to be ready.
2. `npx lhci autorun` against the new `lighthouserc.json` (below). No `npm ci`/build step needed first, since there's no bundler — the server just needs to be up.
3. Chrome setup: `browser-actions/setup-chrome@v2` (same as ThePlayground's `ci.yml`, which needed this after `ubuntu-latest` stopped guaranteeing a pre-installed Chrome), `CHROME_PATH` passed to the `lhci` step.

### New file — `lighthouserc.json` (repo root)

Modeled on ThePlayground's `lighthouserc.json`, adapted for a static-file server and this app's two pages (`index.html`, `guide.html` — confirmed via repo root listing; no other top-level HTML pages exist):

```json
{
  "ci": {
    "collect": {
      "startServerCommand": "python -m http.server 5500",
      "startServerReadyPattern": "Serving HTTP",
      "url": [
        "http://localhost:5500/",
        "http://localhost:5500/guide.html"
      ],
      "numberOfRuns": 3
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.8 }],
        "categories:accessibility": ["error", { "minScore": 0.8 }],
        "categories:best-practices": ["error", { "minScore": 0.8 }],
        "categories:seo": ["error", { "minScore": 0.8 }]
      }
    },
    "upload": {
      "target": "temporary-public-storage"
    }
  }
}
```

No `puppeteerScript`/`puppeteerLaunchOptions` — ThePlayground's `lighthouse-puppeteer.cjs` exists to handle app-specific auth/routing setup for a Node app; MyFinances is a static page with no auth gate, so plain `lhci autorun` against the URLs is sufficient.

## Verification plan

1. Push the new workflow to a branch and open a PR (or push directly, since `push: [main]` also triggers) — confirm all 8 jobs (5 pytest + docker-build + trivy + lighthouse) appear as separate checks and go green.
2. Deliberately inspect one pytest job's logs to confirm the background `python -m http.server` step doesn't leave the job hanging (i.e., the server start is properly backgrounded, not blocking).
3. Confirm the Security tab shows the Trivy SARIF upload after a run.
4. Confirm Lighthouse scores clear the 0.8 thresholds against the real deployed-equivalent static files; adjust `lighthouserc.json` thresholds down only if a genuine, unavoidable score gap is found (not to paper over a fixable regression).

## Docs

- No `CLAUDE.md` changes needed — the "Commands" section already documents local pytest usage; CI running the same suites doesn't change local dev workflow. Optionally mention the new CI workflow in `README.md` if the user wants a badge, but that's not required for the story.
