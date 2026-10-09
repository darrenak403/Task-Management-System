# Backend Operations Runbook

Scope: Express API, PostgreSQL, AI job worker, SSE endpoint, the Next.js web container and the Docker Hub → Dokploy → VPS path behind Cloudflare Tunnel. Public browser acceptance of the deployed system is still pending (see [Web and Cloudflare Tunnel](#web-and-cloudflare-tunnel)).

## Local Compose

1. Copy `.env.example` to `.env`; replace the sample database password and set `APP_ORIGIN` to the local frontend origin.
2. Start the isolated backend stack with `npm run docker:dev:up`. Compose exposes the API on loopback port 4000; PostgreSQL has no host port. The API gets outbound access for provider calls while DB and migration containers stay on the private network.
3. Readiness is `/api/health/ready`; the OpenAPI document is `/api/openapi.json`. Migrations are a one-shot dependency and use `prisma migrate deploy`.
4. The dev Compose stack is backend-only. To run the web app against it, start `npm run dev:web` in a second terminal (port 3000); Next forwards same-origin `/api/*` to `API_PROXY_TARGET` (default `http://localhost:4000`), and `APP_ORIGIN` must stay `http://localhost:3000` so the API accepts the browser's Origin.
5. Demo records are opt-in. Set `SEED_DEMO_DATA=yes` and a unique `SEED_DEMO_PASSWORD` with at least 8 characters, then run `npm run docker:dev:seed`. The seed creates two isolated workspaces, role/team membership and relative-to-today deadline examples. The seed only writes its own fixed records and leaves every other record untouched.
6. Production demo data uses the same seed. In Dokploy set `SEED_DEMO_DATA=yes` and a strong, unique `SEED_DEMO_PASSWORD`, then deploy: the `seed` step runs after migrations. While the flag stays `yes`, every deploy resets the demo users' password and the demo tasks, so set it back to `no` once the data is in place. Anyone who knows the password can sign in as a demo user on the public site.

Compose's `AI_ENABLED` operator switch defaults to on, but AI stays unavailable until its server-side encryption keyring and token ceilings are valid. To test locally, generate a 32-byte encryption key with `openssl rand -base64 32`, put it in a versioned JSON keyring in `.env`, and set application token ceilings. This keyring only encrypts account credentials at rest; it is not a Gemini API key. Each user then supplies one Gemini key and selects a model in the application. The API rejects shared `GEMINI_API_KEY` and `GOOGLE_API_KEY` environment variables.

## CI and immutable release

`.github/workflows/backend-ci.yml` runs on PRs and pushes to `dev`/`main`: pinned Node/npm versions, dependency audit, PostgreSQL migrations, fake-provider integration tests, lint, typecheck, build and both Docker builds. It receives no production or user credentials.

`.github/workflows/backend-release.yml` runs only after successful `Backend CI` for `main`. Configure these secrets in the protected GitHub `production` environment:

| Secret | Purpose |
| --- | --- |
| `DOCKERHUB_USERNAME`, `DOCKERHUB_PASSWORD` | Push the private API, migration and web images. |

The workflow only builds and publishes. It pushes both images tagged `sha-<commit>` and `latest`, serializes releases, refuses to publish a commit that is no longer the head of `main`, and writes the two image digests to the Actions summary. It holds no Dokploy credentials and does not deploy.

The web image has its own pair of workflows. `.github/workflows/web-ci.yml` runs on PRs and pushes to `dev`/`main` when `apps/web/**` or a shared build file changes: dependency audit, eslint, typecheck, unit tests, production build and a container build of `apps/web/Dockerfile`. `.github/workflows/web-release.yml` runs after `Web CI` succeeds on a push to `main`, pushes `<dockerhub-user>/task-management-web` tagged `sha-<commit>` and `latest`, and writes the digest to the Actions summary. It needs only the same two secrets. None of these workflows has run on GitHub yet.

Deployment is manual: after the workflow succeeds, press **Deploy** on the Compose service in the Dokploy dashboard. `docker-compose.prod.yml` sets `pull_policy: always` on `api`, `migrate` and `web`, so each deploy pulls the current `latest`. Afterwards confirm `/api/health/ready` returns 200 and its `X-Release-Sha` header equals the released commit. Dokploy must have read access to the private Docker Hub repository.

To roll back or pin a release, set `BACKEND_API_IMAGE_REF` and `BACKEND_MIGRATE_IMAGE_REF` in Dokploy to the `sha-<commit>` tag or digest from the Actions summary and deploy again.

In Dokploy, set the Compose environment values required by `docker-compose.prod.yml`: `APP_ORIGIN`, private `DATABASE_URL`, PostgreSQL credentials, `BACKEND_API_IMAGE_REF`, `BACKEND_MIGRATE_IMAGE_REF` and `WEB_IMAGE_REF` (normally `<dockerhub-user>/task-management-api:latest`, `<dockerhub-user>/task-management-api-migrate:latest` and `<dockerhub-user>/task-management-web:latest`), `TRUSTED_PROXY_CIDRS`, `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION`, `CREDENTIAL_ENCRYPTION_KEYRING`, and AI token ceilings. `AI_ENABLED` is an optional operator kill switch and defaults to on. Each account separately configures one Gemini API key and the model it wants to use through the application; there is no system-wide Gemini key or model setting. The server encryption keyring is a separate API-only runtime secret used to encrypt those account keys at rest. Keep every still-used encryption-key version backed up in a separate secret store; database backups contain ciphertext but not the keyring. Set `TRUSTED_PROXY_CIDRS` to the exact source IPs/CIDRs of the immediate proxy peer as seen by Express; include another proxy only when traffic actually reaches Express through it. Do not use `0.0.0.0/0`, `::/0`, or `*`. Confirm the real container network path before enabling forwarded client IPs, and restrict direct API access so clients cannot bypass the proxy.

Before first deploy, create a Dokploy Docker Compose service using this repository's deployment file and set its runtime environment. The release workflow never reads or changes Dokploy configuration.

## Cloudflare Tunnel and realtime

The target server runs Dokploy without Traefik; `cloudflared` runs on the host as a systemd service. `docker-compose.prod.yml` therefore publishes the API only on host loopback (`127.0.0.1:${API_HOST_PORT:-4100}`), and the tunnel's public hostname must point to `http://localhost:4100`. Nothing else on the network can reach the API directly.

Requests from the tunnel arrive at Express from the gateway of the Compose `edge` network, fixed to `172.31.240.0/29`, so `TRUSTED_PROXY_CIDRS=172.31.240.1` covers them; requests forwarded by the web container come from another address in that subnet, so set `TRUSTED_PROXY_CIDRS=172.31.240.0/29` (see [Web and Cloudflare Tunnel](#web-and-cloudflare-tunnel)). Override `EDGE_SUBNET` or `API_HOST_PORT` only when they collide with another stack, and update the tunnel target and `TRUSTED_PROXY_CIDRS` to match.

Keep `/api/realtime/events` on the same public origin as Next.js, forward Cookie and Origin unchanged, and do not add a buffering or compressing proxy in front of it. Express returns `X-Accel-Buffering: no` and `Cache-Control: no-store, no-transform` and sends a heartbeat every 15 seconds.

The web app opens one `EventSource` per tab on `GET /api/realtime/events?workspaceId=&cursor=` and has no polling fallback. Verify a stream remains open beyond the REST timeout, receives events, reconnects/resyncs, and preserves cookies through the public tunnel. These checks have not been run: they need a browser against the deployed domain.

## Web and Cloudflare Tunnel

`docker-compose.prod.yml` defines the `web` service next to `api`. It runs the Next.js standalone server as user `node` on a read-only root filesystem with `/tmp` and the Next runtime cache directory as tmpfs, drops all capabilities, joins only the `edge` network, and publishes on loopback only: `127.0.0.1:${WEB_HOST_PORT:-4101}:3000`. Its healthcheck requests `/login`. It has no `depends_on`, and it needs no environment variable pointing at the API because the browser calls the relative path `/api`.

| Variable | Where | Meaning |
| --- | --- | --- |
| `WEB_IMAGE_REF` | Dokploy Compose environment, required | Web image, for example `<dockerhub-user>/task-management-web:latest` or a `sha-<commit>` tag. |
| `WEB_HOST_PORT` | Dokploy Compose environment, optional | Host loopback port for the web container, default `4101`. Change it only if the port is taken, and change the tunnel rule to match. |

The app uses two public hostnames on the same tunnel. Configure both in the Cloudflare dashboard:

| Public hostname | Service | Used for |
| --- | --- | --- |
| `task.darrenak.id.vn` | `http://localhost:4101` (web; `WEB_HOST_PORT` if overridden) | The application. The browser only ever talks to this hostname. |
| `task-api.darrenak.id.vn` | `http://localhost:4100` (API; `API_HOST_PORT` if overridden) | Swagger UI, health checks and direct API calls. |

The browser calls `https://task.darrenak.id.vn/api/*` and the web server forwards those requests, including the realtime stream, to the `api` service over the `edge` network. The session cookie therefore stays first-party on the web hostname and the API needs no CORS setup. Keep the API's `APP_ORIGIN` at `https://task.darrenak.id.vn`: write requests carry that origin, also when they arrive through the web server. Signing in from `task-api.darrenak.id.vn` directly (for example Swagger "Try it out" on write endpoints) is rejected by the origin check.

Forwarded requests reach Express from the web container, not from the gateway, so `TRUSTED_PROXY_CIDRS` must cover the whole `edge` subnet (`172.31.240.0/29` by default) instead of only `172.31.240.1`. Otherwise rate limits count every user as the web container's address. The repository does not manage the tunnel hostnames. Status as reported by the operator on 2026-10-09: `task-api.darrenak.id.vn` points to `http://localhost:4100`; `task.darrenak.id.vn` is added once the web container is deployed. Neither has been checked from this repository.

### Post-deploy checks

1. `https://task-api.darrenak.id.vn/api/health/ready` and `https://task.darrenak.id.vn/api/health/ready` both return 200 JSON and the `X-Release-Sha` header equals the released commit. A failure on only the second one means the web container cannot reach `api`.
2. `https://task.darrenak.id.vn/login` is served by the web container (HTML login page, status 200).
3. Register or sign in in a browser, open a workspace, and confirm `/api/realtime/events` stays open in the network panel, receives an event after a change from a second browser, and survives longer than the REST timeout (about 12 seconds). If Cloudflare buffers or drops it, check the `Cache-Control` and `X-Accel-Buffering` response headers and record the finding here.
4. Check that the session cookie is set on the public origin and write requests succeed (Origin matches `APP_ORIGIN`).

### Web rollback

Set `WEB_IMAGE_REF` in Dokploy to the previous `sha-<commit>` tag (or digest from the Actions summary) and press **Deploy**. The API and database are not affected. The web container holds no data.

## Database backups and restore

### Backup

1. Take a PostgreSQL custom-format backup before each migration or release; retain it outside the VPS and test restoring it.
2. Back up the server-side credential-encryption keyring versions separately in a secret manager/secure offline copy. These are not users' Gemini API keys. Preserve the versions that decrypt rows in the database. Do not put keyring contents in the database backup, Docker image, CI artifact or deployment log.
3. Keep release commit plus API and migration digests beside the backup metadata.

Example for the local Compose service (redirect the output into protected backup storage):

```sh
docker compose --env-file .env -f docker-compose.dev.yml exec -T db \
  sh -lc 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > task-management.dump
```

### Restore

1. Stop API, scheduled cleanup commands and all writers. Restore the selected backup to PostgreSQL; keep public API traffic stopped.
2. Run the current migration image against the restored database. If migration fails, keep API stopped and repair/restore before continuing.
3. Run the API image's restore isolation command once:

```sh
CONFIRM_BACKEND_RESTORE=yes docker compose -f docker-compose.prod.yml \
  run --rm --no-deps -e CONFIRM_BACKEND_RESTORE=yes -e AI_ENABLED=false \
  -e CREDENTIAL_ENCRYPTION_KEYRING= api node apps/api/dist/jobs/post-restore-backend.js
```

This sets a persistent AI quarantine first, cancels active/queued jobs without replay, settles their reservations conservatively, deletes restored sessions and realtime events, and rotates the realtime epoch/cursor. A failure leaves the database quarantined; keep traffic stopped and `AI_ENABLED=false` while repairing it.

4. Reconcile by explicitly closing the current Asia/Ho_Chi_Minh quota day:

```sh
CONFIRM_AI_QUOTA_RECONCILIATION=yes docker compose -f docker-compose.prod.yml \
  run --rm --no-deps -e CONFIRM_AI_QUOTA_RECONCILIATION=yes -e AI_ENABLED=false \
  -e CREDENTIAL_ENCRYPTION_KEYRING= api node apps/api/dist/jobs/reconcile-ai-quota.js \
  --operator 'operator name or ticket' \
  --reason 'restored backup identifier and reconciliation notes' \
  --confirm close-current-window
```

The command records an audit row and consumes the full daily application allowance (100 operations/400 provider attempts) for every existing scope and the global scope before it clears quarantine. This avoids inferring free quota from potentially stale counters; new requests remain quota-blocked for the rest of that business date. The next business date starts normally. If the command did not complete or its audit row cannot be verified, keep AI disabled and quarantined.

5. Verify restored task/workspace rows, migrations, session revocation and the new realtime epoch. Restore encryption-keyring versions into the API runtime. Only then start the API and reopen traffic. AI can be enabled when the server keyring/token configuration is valid and the reconciliation record is present; each user still needs their own verified Gemini key and selected model.

No uncertain Gemini call is replayed. User Gemini keys bill the provider project linked to each user's key; application quotas do not cap charges outside this application.

## Release, rollback and scheduled operations

- Migrations are additive and use `migrate deploy`; never run `db push` in production. Keep the database backup before deployment.
- A rollback pins the previous API and migration digests from the Actions summary while retaining the new additive schema. Local compatibility smoke passed with the API image built before the final additive migration against a fresh database after all eight migrations: readiness, registration/session, workspace/team, AI-plan and task read paths succeeded. This does not prove compatibility of a previously deployed production digest or production data. Before calling a release rollback-ready, run the previous deployed API digest against an isolated copy of the migrated production schema and exercise health/read paths. Never roll back by deleting migration history or dropping new columns.
- Schedule one-shot maintenance commands in Dokploy: `cleanup:expired-sessions`, `cleanup:realtime-outbox`, and `cleanup:ai-planner-retention`. These run as scheduled operations, not API intervals or client polling.
- An outbox/listener outage closes streams and requires clients to reconnect/resync; it does not switch to periodic fetches.
- Still pending, with no evidence in this repository: GitHub workflow runs, Docker Hub publish, the Dokploy deploy, the Cloudflare Tunnel rules, SSE through the tunnel, two-browser collaboration in a browser, mobile/keyboard/reduced-motion/Lighthouse checks, a live Gemini generation, and the demo video.
