# MyFinances Server (Phase 1)

Self-hosted Node.js + PostgreSQL backend for MyFinances multi-device sync.
Optional — the browser app works fully without this; see the root
`CLAUDE.md` for how it fits into the overall architecture.

## Local development

    cp .env.example .env   # edit DATABASE_URL to point at a local Postgres
    npm install
    npm run migrate up
    npm run create-user
    npm start

## Tests

Tests require a real Postgres instance (never mocked):

    docker compose -f docker-compose.test.yml up -d
    export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
    npm run migrate up
    npm test

## Production

See the root `docker-compose.yml` (`postgres` and `server` services) and
`nginx.conf`'s `/api/` and `/auth/` proxy blocks. The `server` service's
Docker build context is the repo root (not `server/`) because
`src/sanitizers/index.js` reuses the frontend's `src/sanitizers.js` and
`src/utils.js` by relative import rather than duplicating validation
logic — the Dockerfile copies that directory into the image at `/src`.
