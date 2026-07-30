# GitHub Actions CI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a push/PR CI workflow (`.github/workflows/ci.yml`) to MyFinances, adapted from `jasonkryst/ThePlayground`'s `ci.yml` for this repo's no-build-step, no-npm, Python/pytest toolchain, per GitHub Story #57.

**Architecture:** One new workflow file with 8 independent jobs (5 pytest-by-category jobs, `docker-build`, `trivy`, `lighthouse`), plus one new supporting config file (`lighthouserc.json`). No changes to the existing `docker-image.yml` (release-time publishing, untouched). No app code changes — this is CI/infra config only.

**Tech Stack:** GitHub Actions, Python 3.14 + pytest + Playwright (already the project's test stack), Docker, `aquasecurity/trivy-action@v0.36.0`, `github/codeql-action/upload-sarif@v4`, `browser-actions/setup-chrome@v2`, Lighthouse CI (`@lhci/cli` via `npx`).

## Global Constraints

- Workflow file lives at `.github/workflows/ci.yml`; triggers on `push` and `pull_request` to `main` only (per spec).
- Test jobs run against `tests/features`, `tests/integration`, `tests/ui`, `tests/security`, `tests/a11y` — one job per directory, all in parallel, none combined (per spec's "Job granularity" decision).
- Python version pinned to `"3.14"` in every pytest job (matches local dev; see spec).
- pip installs exactly `playwright pytest pytest-asyncio` (matches `CLAUDE.md`'s documented local setup) — no new pinned-requirements file, no other packages.
- `trivy` job does **not** declare `needs: docker-build` — it independently rebuilds the image, exactly matching ThePlayground's pattern (see spec correction).
- `lighthouserc.json` targets `http://localhost:5500/` and `http://localhost:5500/guide.html` only — the app's only two static HTML pages.
- No `lint`, `lint-css`, or `npm-audit` jobs — no equivalent tooling exists in this repo (per spec's non-goals).
- No changes to `docker-image.yml`, `CLAUDE.md`, or any `src/` file.

---

## Task 1: Add `lighthouserc.json`

**Files:**
- Create: `lighthouserc.json` (repo root)

**Interfaces:**
- Produces: a Lighthouse CI config file that `npx lhci autorun` (Task 4) reads by default from the repo root — no other task depends on its exports, only on its existence and validity.

- [ ] **Step 1: Create the config file**

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

- [ ] **Step 2: Validate JSON syntax**

Run: `python -c "import json; json.load(open('lighthouserc.json'))" && echo VALID`
Expected: `VALID` printed, no exception.

- [ ] **Step 3: Commit**

```bash
git add lighthouserc.json
git commit -m "Add lighthouserc.json for CI Lighthouse audits (Story #57)"
```

---

## Task 2: Create `ci.yml` with the five pytest jobs

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: a workflow file with jobs `test-features`, `test-integration`, `test-ui`, `test-security`, `test-a11y`; Tasks 3 and 4 append further jobs (`docker-build`, `trivy`, `lighthouse`) to this same file under the existing `jobs:` key.

- [ ] **Step 1: Create the workflow file with the trigger and all five pytest jobs**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-features:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.14"
          cache: pip
      - run: pip install playwright pytest pytest-asyncio
      - run: playwright install --with-deps chromium
      - name: Start static server
        run: |
          python -m http.server 5500 &
          for i in $(seq 1 30); do
            curl -sf http://localhost:5500/ > /dev/null && break
            sleep 1
          done
      - run: pytest tests/features -v

  test-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.14"
          cache: pip
      - run: pip install playwright pytest pytest-asyncio
      - run: playwright install --with-deps chromium
      - name: Start static server
        run: |
          python -m http.server 5500 &
          for i in $(seq 1 30); do
            curl -sf http://localhost:5500/ > /dev/null && break
            sleep 1
          done
      - run: pytest tests/integration -v

  test-ui:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.14"
          cache: pip
      - run: pip install playwright pytest pytest-asyncio
      - run: playwright install --with-deps chromium
      - name: Start static server
        run: |
          python -m http.server 5500 &
          for i in $(seq 1 30); do
            curl -sf http://localhost:5500/ > /dev/null && break
            sleep 1
          done
      - run: pytest tests/ui -v

  test-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.14"
          cache: pip
      - run: pip install playwright pytest pytest-asyncio
      - run: playwright install --with-deps chromium
      - name: Start static server
        run: |
          python -m http.server 5500 &
          for i in $(seq 1 30); do
            curl -sf http://localhost:5500/ > /dev/null && break
            sleep 1
          done
      - run: pytest tests/security -v

  test-a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.14"
          cache: pip
      - run: pip install playwright pytest pytest-asyncio
      - run: playwright install --with-deps chromium
      - name: Start static server
        run: |
          python -m http.server 5500 &
          for i in $(seq 1 30); do
            curl -sf http://localhost:5500/ > /dev/null && break
            sleep 1
          done
      - run: pytest tests/a11y -v
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('VALID')"`
Expected: `VALID` printed, no exception.

- [ ] **Step 3: Locally reproduce each job's core command to confirm it would pass in CI**

The project's `.venv` already has `playwright`, `pytest`, `pytest-asyncio` installed (matching what each job installs), so this reproduces exactly what CI will run, minus the container.

Run (PowerShell, from repo root):
```
Start-Process -NoNewWindow python -ArgumentList "-m","http.server","5500"
Start-Sleep -Seconds 2
.venv\Scripts\pytest.exe tests/features tests/integration tests/ui tests/security tests/a11y -v
```
Expected: all five suites pass (this is the existing, already-green local test suite — confirms the *commands* the new jobs run are correct, not that anything new was implemented).

Stop the server afterward: `Get-Process python | Where-Object {$_.Path -like '*python.exe'} | Stop-Process` (or close the terminal that ran `Start-Process`).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add ci.yml with pytest-by-category jobs (Story #57)"
```

---

## Task 3: Append `docker-build` and `trivy` jobs

**Files:**
- Modify: `.github/workflows/ci.yml` (append two jobs under the existing `jobs:` key from Task 2)

**Interfaces:**
- Consumes: the `jobs:` key created in Task 2 — appends as sibling keys `docker-build` and `trivy`, same indentation level as `test-features` etc.
- Produces: nothing further tasks depend on (Task 4's `lighthouse` job is independent of these).

- [ ] **Step 1: Append the two jobs**

Add after the `test-a11y` job (same indentation, under `jobs:`):

```yaml
  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t myfinances:ci .

  trivy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t myfinances:ci .
      - name: Vulnerability gate (fixable CRITICAL/HIGH findings)
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: myfinances:ci
          format: table
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          exit-code: 1
      - name: Full vulnerability report (all severities, including unfixed)
        if: always()
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: myfinances:ci
          format: sarif
          output: trivy-results.sarif
      - name: Upload scan results to the Security tab
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: trivy-results.sarif
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('VALID')"`
Expected: `VALID` printed, no exception.

- [ ] **Step 3: Locally reproduce the `docker-build` job**

Run: `docker build -t myfinances:ci .`
Expected: build completes successfully (exit code 0). This is the exact command the `docker-build` job runs, and is also the first step of `trivy` — confirms both jobs' image build will succeed. (Trivy's scan itself isn't run locally — that requires the `aquasecurity/trivy-action` container action, which only makes sense to exercise inside Actions; Task 5 covers observing its actual CI run.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add docker-build and trivy jobs to ci.yml (Story #57)"
```

---

## Task 4: Append `lighthouse` job

**Files:**
- Modify: `.github/workflows/ci.yml` (append one job under the existing `jobs:` key)

**Interfaces:**
- Consumes: `lighthouserc.json` from Task 1 (read implicitly by `npx lhci autorun`, which defaults to the repo-root config — no explicit path argument needed).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Append the job**

Add after the `trivy` job (same indentation, under `jobs:`):

```yaml
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Chrome for Lighthouse CI
        id: setup-chrome
        uses: browser-actions/setup-chrome@v2
        with:
          chrome-version: stable
      - name: Run Lighthouse CI
        run: npx lhci autorun
        env:
          CHROME_PATH: ${{ steps.setup-chrome.outputs.chrome-path }}
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('VALID')"`
Expected: `VALID` printed, no exception.

- [ ] **Step 3: Sanity-check that `lhci autorun` can at least locate its config and target**

`npx`/Lighthouse aren't part of this Python-only project's local toolchain, so a full local `lhci autorun` isn't a fair reproduction of the CI job (it would pull `@lhci/cli` fresh and needs a real Chrome). Instead, confirm the two pieces `lhci` depends on are correct in isolation:

Run (from repo root, server already validated reachable in Task 2 Step 3's pattern):
```
Start-Process -NoNewWindow python -ArgumentList "-m","http.server","5500"
Start-Sleep -Seconds 2
Invoke-WebRequest http://localhost:5500/ -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:5500/guide.html -UseBasicParsing | Select-Object StatusCode
```
Expected: both return `StatusCode: 200` — confirms the two URLs in `lighthouserc.json` are real, reachable pages under the exact server command Lighthouse CI will start. Stop the server afterward as in Task 2 Step 3.

Full end-to-end confirmation that the job passes its 0.8 score thresholds happens in Task 5, once pushed to GitHub Actions (Lighthouse's scoring engine isn't something to approximate locally in this Python-only repo).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add lighthouse job to ci.yml (Story #57)"
```

---

## Task 5: Push and observe the real GitHub Actions run

**Files:** none (verification-only task; no file changes)

**Interfaces:**
- Consumes: the complete `.github/workflows/ci.yml` (Tasks 2–4) and `lighthouserc.json` (Task 1).
- Produces: nothing — this task confirms the finished workflow behaves correctly on GitHub's actual runners, which is the only environment that can truly validate Actions syntax, the Trivy/Chrome/Lighthouse third-party actions, and real Lighthouse scores.

**This task pushes a branch and opens a PR — confirm with the user before running Step 1, since pushing and opening a PR are visible to others and not something to do silently.**

- [ ] **Step 1: Push the work to a branch and open a PR** (confirm with user first)

```bash
git checkout -b ci-workflow-story-57
git push -u origin ci-workflow-story-57
gh pr create --title "Add CI workflow (Story #57)" --body "Adds .github/workflows/ci.yml (5 pytest jobs by category, docker-build, trivy, lighthouse) and lighthouserc.json, adapted from jasonkryst/ThePlayground's ci.yml. See docs/superpowers/specs/2026-07-28-github-actions-ci-workflow-design.md for the design.

Closes #57"
```

- [ ] **Step 2: Watch the PR's checks**

Run: `gh pr checks --watch`
Expected: all 8 jobs (`test-features`, `test-integration`, `test-ui`, `test-security`, `test-a11y`, `docker-build`, `trivy`, `lighthouse`) eventually show ✓.

- [ ] **Step 3: If any job fails, diagnose from its log and fix**

Run: `gh run view --log-failed` (after noting the failed run ID from Step 2's output, or omit the ID to view the most recent run)

Common expected failure modes to check for specifically, since they're the parts of this plan that couldn't be verified locally:
- `lighthouse`: a real score below 0.8 on one of the four categories — read which category and page failed in the log; only lower that specific `minScore` in `lighthouserc.json` if the gap is genuine and not something the app should fix (per spec's verification plan, Step 4 — don't paper over a fixable regression).
- `trivy`: a fixable CRITICAL/HIGH CVE in the `nginx:1.27-alpine` base image or its packages — check whether a newer `nginx` alpine tag resolves it before adding it to any allowlist.
- Any pytest job: should not fail, since Task 2 Step 3 already confirmed all five suites pass locally with the same commands — a CI-only failure here would point to an environment difference (e.g., Ubuntu vs. Windows path handling) worth investigating with systematic-debugging rather than patched around blindly.

Push fixes as new commits on the same branch; `gh pr checks --watch` again after each fix.

- [ ] **Step 4: Confirm the Security tab shows the Trivy SARIF upload**

Run: `gh api repos/{owner}/{repo}/code-scanning/alerts --jq 'length'` (substitute the actual `owner/repo`, or just check via `gh browse --settings` / the Security tab in the browser)
Expected: no error calling the endpoint (confirms the upload succeeded and code scanning is active), even if the returned count is 0 (no findings).

- [ ] **Step 5: Merge**

Once all checks are green and the user has reviewed the PR, merge per the user's normal process (this plan doesn't presume squash vs. merge-commit preference — ask, or leave the PR open for the user to merge themselves).

---

## Self-Review Notes

- **Spec coverage:** all 5 goals from the spec are covered — Task 2 (goal 1: trigger + 5 pytest jobs), Task 3 (goals 3–4: docker-build + trivy), Task 4 + Task 1 (goal 5: lighthouse + config). Non-goals (no lint/lint-css/npm-audit, no `docker-image.yml` changes, no branch-protection changes) are respected — no task touches any of those.
- **Type/name consistency:** job names (`test-features`, `test-integration`, `test-ui`, `test-security`, `test-a11y`, `docker-build`, `trivy`, `lighthouse`) and the image tag (`myfinances:ci`) are used identically across Tasks 2–5. `lighthouserc.json`'s two URLs match the two real top-level HTML files confirmed via `ls` during brainstorming (`index.html`, `guide.html`).
- **No placeholders:** every step has literal YAML/JSON/commands, not descriptions of what to write.
