# AGENTS.md

Operational notes for automated agents (CI bots, Claude Code, etc.) running tasks in this repo.

## Running the Playwright test suite locally

Since 7.0.0 the app has no browser-only mode, so every Playwright test runs against a real stack (nginx + Node API + PostgreSQL). A static file server is not enough.

```powershell
# Start the stack (first time: .\setup.ps1 or ./setup.sh creates secrets/)
docker compose up -d

# Credentials of the stack's single user (these are the harness defaults).
# No user yet? Create it the way CI does:
#   docker compose run --rm server node scripts/create-user.js   (prompts for email, then password)
# (The harness can also register it, but only if the server has ALLOW_SETUP=true.)
$env:TEST_EMAIL = "testuser@example.com"
$env:TEST_PASSWORD = "ci-Test-Passphrase-2026!"
# Optional: another URL (default http://localhost:32900/)
$env:TEST_BASE_URL = "http://localhost:32900/"

pytest tests/ -v
```

- **The tests wipe the server's data.** `app_page` calls `reset_server_state` before every test. Never point them at a stack that holds real data.
- **One pytest process per stack.** All tests share one user, so two runs against the same stack wipe each other's data.
- **Login fails loudly.** If the server has a user and `TEST_EMAIL`/`TEST_PASSWORD` don't match, the run aborts without changing anything. `POSTGRES_TEST_EMAIL`/`POSTGRES_TEST_PASSWORD` are accepted as fallbacks.
- **Session cache.** The harness caches the session cookies in a temp file across pytest processes and logs in again on a 401.
- **Seeding.** Use `seed_state(page, state)` (JSON-export shape, imported through `replaceForPostgres`), and `wait_for_api(page, path, check)` before a reload that must see a fire-and-forget save. See `tests/conftest.py` and `CLAUDE.md`.
- **Service worker.** It can serve JS modules past `page.route`; tests that intercept module or API requests use `browser.new_context(service_workers='block')` (see `tests/features/test_code_splitting.py`).
- **Frontend edits** show up on refresh with `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`; without it, rebuild the `myfinances` image.

## Branches, pull requests and merging (issue #380)

`main` is protected by rulesets; see [SECURITY.md](SECURITY.md#repository--ci-governance).

- **Never push to `main` directly.** Work on a branch and open a pull request; direct pushes are rejected.
- **CI runs only on PRs** (and pushes to `main`). Open a **draft** PR to get CI, then mark it ready once it is green.
- **Never use the branch-protection override to merge a PR with a failing or missing required check.** Fix it, or leave it unmerged and report it. Commits land under the owner's identity, so this rule binds agents too.
- **Adding a job to `.github/workflows/ci.yml`?** Add it to `ci-complete`'s `needs:` list as well, or `tests/features/test_ci_shard_coverage.py` fails. The ruleset requires only `ci-complete`, so an unlisted job could fail without blocking a merge.
- The owner reviews and merges PRs; agents do not merge.
