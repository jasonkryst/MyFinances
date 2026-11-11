## What and why

<!-- What does this change, and why? Link the issue it fixes. -->

Closes #

## How I tested it

<!-- The commands you ran and what you checked by hand. Screenshots help for UI changes. -->

## Checklist

<!-- Tick what applies; strike through or explain anything that doesn't. See CONTRIBUTING.md. -->

- [ ] Tests added or updated, covering both accepted and rejected input
- [ ] New `tests/features/` or `tests/ui/` files are listed in a CI shard (`.github/workflows/ci.yml`)
- [ ] User-visible strings have keys in `src/locales/en.js`, `es.js` and `pl.js`
- [ ] User data rendered through `innerHTML` goes through `escapeHtml()`; no inline styles or scripts (CSP)
- [ ] New persisted fields have a sanitizer, a migration and a route `columns` entry
- [ ] Keyboard and screen-reader use still work (accessible names, focus, contrast)
- [ ] Docs updated (README, CLAUDE.md, DEPLOYMENT.md) where behaviour changed
- [ ] If `APP_VERSION` changed: `CHANGELOG.md`, `sw.js` `CACHE_NAME` and, for a minor version, What's New are updated too
- [ ] No real financial data, passwords or secrets in code, tests or screenshots
