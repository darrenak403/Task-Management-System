# Backend code standards

These implementation rules supplement [System Architecture](02-architecture/system-architecture.md) and [AI + Realtime Technical Design](02-architecture/ai-and-realtime-technical-design.md). Those documents remain the source of product and architecture decisions.

## TypeScript and modules

- Use strict TypeScript, explicit input/output types at module boundaries, and Zod schemas for untrusted HTTP/provider input.
- Organize API code by feature. Keep routes, schemas, controllers, services, queries and DTOs close to their feature; avoid generic base repositories/services.
- Keep HTTP handling in controllers, business rules in services, and SQL/Prisma access in scoped queries. Return explicit DTO projections; never serialize Prisma records directly.
- Pass the current Prisma transaction (`tx`) through every query in a transaction. Do not open nested transactions or call the global client from transaction-scoped code.
- Await promises and handle background failures explicitly. Do not use synchronous filesystem, crypto or password operations in request paths.

## Security and data

- Validate and authorize every resource within its workspace/team scope. Mutations recheck permission in the same transaction using the documented lock order.
- Use strict request schemas and field allowlists. Never spread request bodies into Prisma writes.
- Keep credentials and session material out of logs, events, error responses, job payloads and DTOs. Use redacted structured logs and stable public error envelopes.
- Keep Gemini calls outside DB transactions. Jobs use only the creator's current BYOK credential revision; no shared provider-key environment fallback is allowed.
- Treat outbox writes as part of the business transaction. Realtime delivery is event driven; do not add periodic database polling or client polling fallbacks.

## Tests and operations

- Cover business/security behavior with Vitest and Supertest. Use isolated PostgreSQL for persistence, migrations and concurrency behavior; use a deterministic fake Gemini adapter in automated tests.
- Keep app construction side-effect free. Listening sockets, Prisma lifecycle, SSE dispatchers and workers start only from the runtime entry point.
- Keep readiness bounded and non-mutating. Apply committed migrations with `prisma migrate deploy`; do not use `db push` in deployed environments.
- Pin runtime/dependency/action versions. Keep CI permissions minimal and secrets out of untrusted jobs and container layers.
