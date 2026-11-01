# AGENTS.md

Operational notes for automated agents (CI bots, Claude Code, etc.) running tasks in this repo.

## Running the Playwright test suite locally

### Port 32900 conflict

The app's default dev-server port is **32900**. The Docker stack (`docker compose up -d`) binds that port — and Docker's port binding persists even through `docker compose pause` (the proxy process stays alive).

Before running tests, ensure port 32900 is free, or use the `TEST_BASE_URL` env var to redirect tests to a different port:

```powershell
# Start a lightweight server on a different port (e.g. 32901)
python -m http.server 32901

# Run tests against that server
$env:TEST_BASE_URL = "http://localhost:32901/"
pytest tests/ -v
```

If Docker owns port 32900, stop the stack first:

```powershell
docker compose down   # or: docker compose stop
```

### Login gate / Postgres auto-detection

When a Docker stack is running at the test URL, the app's `checkPostgresBackendPresent()` detects the `X-Myfinances-Backend: postgres` response header on `HEAD /` and shows a full-page login gate — blocking all Playwright tests.

The `app_page` fixture in `tests/conftest.py` **automatically intercepts that `HEAD /` request** and strips the Postgres header, so tests run against `app_page` are unaffected regardless of what server is behind the URL.

For tests that bypass `app_page` (e.g. raw `page` fixture or custom navigation), inject the same interception:

```python
page.route(BASE_URL, lambda route: route.fulfill(status=200)
           if route.request.method == 'HEAD' else route.continue_())
```

To clear any persisted Postgres backend preference that a previous test run may have stored in `localStorage`, add this init script before navigating:

```python
page.add_init_script("""
    try { localStorage.removeItem('debtTrackerStorageBackend'); } catch(e) {}
""")
```

### Quick start (no Docker conflict)

```powershell
# Terminal 1 — serve the app
python -m http.server 32900

# Terminal 2 — run tests
pytest tests/ -v
```

## Branches, pull requests and merging (issue #380)

`main` is protected by rulesets; see [SECURITY.md](SECURITY.md#repository--ci-governance).

- **Never push to `main` directly.** Work on a branch and open a pull request; direct pushes are rejected.
- **CI runs only on PRs** (and pushes to `main`). Open a **draft** PR to get CI, then mark it ready once it is green.
- **Never use the branch-protection override to merge a PR with a failing or missing required check.** Fix it, or leave it unmerged and report it. Commits land under the owner's identity, so this rule binds agents too.
- **Adding a job to `.github/workflows/ci.yml`?** Add it to `ci-complete`'s `needs:` list as well, or `tests/features/test_ci_shard_coverage.py` fails. The ruleset requires only `ci-complete`, so an unlisted job could fail without blocking a merge.
- The owner reviews and merges PRs; agents do not merge.
