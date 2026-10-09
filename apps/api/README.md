# Backend API

Node.js 24 + TypeScript + Express API, backed by PostgreSQL and Prisma. The API lives under `/api`; `/api/health/ready` checks readiness and `/api/openapi.json` publishes the 49-operation contract.

## Local development

```sh
cp .env.example .env
# Change the local-only PostgreSQL password and APP_ORIGIN as needed.
npm run docker:dev:up
```

Compose exposes the API only on `127.0.0.1:4000`. PostgreSQL has no host port. Migrations run as a one-shot container before the API starts. AI Smart supports only one provider credential type: each account supplies one Gemini API key and chooses its model in account settings. `AI_ENABLED` is an operator kill switch (default on); AI also needs the separate API-only encryption keyring and token ceilings. That server master keyring encrypts user keys at rest and is not a Gemini key or an account setting.

To manage the API stack with [Task](https://taskfile.dev/), run `task api-up` to start it and `task api-down` to stop it. The down task preserves the named PostgreSQL volume.

To create the isolated demo workspaces and date-boundary tasks, set `SEED_DEMO_DATA=yes` and a unique `SEED_DEMO_PASSWORD` in `.env`, then run:

```sh
npm run docker:dev:seed
```

The seed is idempotent and never runs during migration or deployment. It creates two accounts, each owning a workspace of their own, with Vietnamese content: `anh@gmail.com` owns `AIM Studio` (teams Backend and Frontend) and `khanh@gmail.com` owns `Quán Cà Phê Sáng` (team Vận hành), 44 tasks in total with checklists and dependencies. Neither account can see the other's workspace until invited. Both use the supplied password. The content lives in `prisma/seed-data.ts`. Use it only in a disposable development database.

## Verification

```sh
npm ci
npm run --workspace @task-management/api db:generate
npm run lint
npm run typecheck
npm test --workspace @task-management/api
npm run build
```

Integration tests require a dedicated disposable PostgreSQL database. Prefer setting `TEST_DATABASE_URL` explicitly; the `DATABASE_URL` fallback must also point only to a disposable test database. Test setup truncates application tables before each case, so never point either variable at development, demo, shared, or production data, and do not run multiple test processes concurrently against the same database. Tests use a deterministic fake Gemini provider; CI does not call Gemini.

## Images and operations

- `apps/api/Dockerfile` provides two targets: `api` builds the non-root runtime image with production dependencies; `migrate` applies committed Prisma migrations with `migrate deploy`.
- The root `.dockerignore` is shared by both targets.
- `docker-compose.dev.yml` is for local backend development.
- `docker-compose.prod.yml` contains production Compose settings; local development scripts do not use it.
- Restore, quota quarantine, retention schedules, backup/keyring preservation, release, rollback, and SSE proxy steps are in [the backend operations runbook](../../docs/03-operations/backend-operations-runbook.md).

Shared `GEMINI_API_KEY` and `GOOGLE_API_KEY` environment variables are rejected. Each account supplies its own single Gemini API key and model. The API separately receives a versioned server encryption keyring; this protects the stored Gemini keys and is not a provider key.
