# Agentic

Agentic is a stateless NestJS API foundation for provider-specific agent experiments. The application exposes versioned APIs, health checks, OpenAPI documents, structured responses, and global error handling.

## Requirements

- Bun 1.3.14
- Node.js 24 or later for the production runtime
- Docker or another OCI-compatible container runtime for deployment

## Local development

```bash
cp .env.example .env
docker compose up -d --wait   # local Postgres on port 5433
bun install --frozen-lockfile # also generates the Prisma client
bun run db:migrate            # creates the tables
bun run start:dev
```

## Auth

Auth uses [Better Auth](https://better-auth.com) directly, with Prisma and Postgres. No NestJS wrapper library is used.

- Better Auth serves sign-up, sign-in and sign-out under `/api/auth/*` (for example `POST /api/auth/sign-up/email`).
- Every Nest route needs a signed-in user unless it is marked `@Public()` or `@OptionalAuth()`. Read the user with `@CurrentSession()`.
- `GET /v1/auth/session` returns the signed-in user.
- Shared Better Auth options live in `src/config/better-auth.ts`. After changing them, run `bun run auth:generate` and then `bun run db:migrate`.

Swagger UI runs at `http://localhost:3000/api`, and Scalar runs at `http://localhost:3000/docs`. Both use the version-specific OpenAPI documents at `/api/v1-json` and `/api/v2-json`. The application prints every enabled documentation URL when it starts.

## Configuration

The application validates configuration before it starts. Invalid ports, booleans, and CORS origins stop startup.

| Variable             | Default                                            | Purpose                                                                     |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`           | `development`                                      | Selects development, test, or production behavior.                          |
| `PORT`               | `3000`                                             | Sets the HTTP port.                                                         |
| `PLATFORM_NAME`      | `Agentic`                                          | Names the API and OpenAPI document.                                         |
| `CORS_ORIGINS`       | empty                                              | Lists exact, comma-separated browser origins. Empty disables CORS.          |
| `SWAGGER_ENABLED`    | on outside production                              | Enables Swagger, Scalar, and OpenAPI JSON. Set it explicitly in production. |
| `DATABASE_URL`       | none (required in production)                      | Postgres connection URL.                                                    |
| `BETTER_AUTH_SECRET` | random per run (required in production)            | Signs sessions. At least 32 characters.                                     |
| `BETTER_AUTH_URL`    | `http://localhost:<PORT>` (required in production) | This API's origin, without a path.                                          |
| `AUTH_COOKIE_DOMAIN` | empty                                              | Parent domain to share the session cookie across subdomains.                |
| `OBSERVE_ENABLED`    | `false`                                            | Enables NestJS Observe when valid credentials are present.                  |

Never use `*` in `CORS_ORIGINS`. The server accepts only complete HTTP or HTTPS origins without paths.

## Health checks

- `GET /v1/health/live` proves that the process can answer requests.
- `GET /v1/health/ready` checks the process's memory limits.

Both routes also support API version 2. The checks do not depend on external websites, databases, or Redis.

## Verification

All tests live under `test/`.

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run test:cov
bun run build
```

## Container deployment

Build and run the same OCI image on Docker, Kubernetes, Nomad, ECS, Cloud Run, Fly.io, Railway, Render, or any compatible platform:

```bash
docker build --tag agentic:local .
docker run --rm --read-only --tmpfs /tmp --publish 3000:3000 agentic:local
```

The image uses pinned Bun and Node digests, contains production dependencies only, and runs as the unprivileged `node` user.

## CI/CD

`.github/workflows/ci.yml` installs the lockfile exactly, checks formatting and types, runs all tests, audits dependencies, builds the application and container, and scans the runtime image. Every external action is pinned to a full commit SHA.

`.github/workflows/release.yml` verifies semantic-version tags, then publishes Linux AMD64 and ARM64 images to GitHub Container Registry. It creates an SBOM and signs a provenance attestation through GitHub OIDC. Configure protection rules and required reviewers on the repository's `production` environment before the first release.

Create a release with an immutable semantic version:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow delivers a portable image. Each hosting platform can deploy that immutable image digest with its own native rollout and rollback controls.

## Reliability and state

The service is stateless. It does not pretend that memory or a container filesystem is durable. Add workflow and idempotency modules only with a shared production store and tested transaction boundaries. Until then, replicas can start, stop, and roll back without losing application-owned state because the application owns none.

The application enables graceful NestJS shutdown hooks. Its global exception filter also handles exceptions thrown by middleware, assigns a safe request ID, logs unexpected server errors, and keeps internal error details out of client responses.

## NestJS guidance applied

This project follows the current NestJS guidance for [exception filters](https://docs.nestjs.com/exception-filters), [security headers](https://docs.nestjs.com/techniques/security/cors), [CSRF protection](https://docs.nestjs.com/security/csrf), [validation](https://docs.nestjs.com/application/validation), [rate limiting](https://docs.nestjs.com/security/rate-limiting), and [shutdown hooks](https://docs.nestjs.com/fundamentals/lifecycle-events).
