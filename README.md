# Agentic

A NestJS API with sign-in, users, organizations, admin tools and AI agent access. Auth is handled by [Better Auth](https://better-auth.com), data lives in Postgres through Prisma.

## Run it locally

You need Bun 1.3.14+, Node.js 24+ and Docker.

```bash
cp .env.example .env
docker compose up -d --wait   # Postgres on port 5433
bun install --frozen-lockfile
bun run db:migrate
bun run start:dev
```

Then open the API docs:

- Scalar: http://localhost:3000/docs
- Swagger: http://localhost:3000/api

## What's built

**Sign-in**

- Email codes (one-time codes sent by email). There are no passwords.
- Google, GitHub and LinkedIn. Each turns on when its ID and secret are set in `.env`.
- Passkeys and two-factor (2FA).
- A Google, GitHub or LinkedIn sign-in never takes over an existing account just because the email matches. The user signs in first, then links the provider.
- Throwaway email domains are blocked, and `ada+1@gmail.com` can't make a second account for `ada@gmail.com`.
- Optional Google reCAPTCHA on the email code routes.

**Users, organizations and admin**

- Users can see their profile, sign-in methods and sessions, and stay signed in to several accounts at once.
- Organizations have teams, invites, and custom roles with chosen permissions.
- Admins can list, ban and impersonate users, invite staff, and create staff roles with permissions. Staff live in a built-in "Staff" organization.

**AI agents (Agent Auth)**

- Agents act for a user, who approves each thing an agent may do. For now agents can only read the user's profile.
- Agents find the setup at `/.well-known/agent-configuration`.

**Security**

- Security headers, CSRF checks, rate limits and request IDs on every route.
- Every route needs a signed-in user unless it's marked `@Public()`.
- Passwords (if any are ever stored) are hashed with Argon2id.

## API docs

The docs are grouped into Auth, Agent Auth, User, Organization and Admin. Every route has a short title, a one-line description and sample data. A test fails if a title goes over 4 words or a field has no sample.

There are two API versions, `/v1` and `/v2`. Better Auth's own routes live under `/api/auth` and appear in both.

## Where things go

```
src/
  modules/<name>/   one feature: <name>.service.ts, .controller.ts, .module.ts (exactly these 3)
  lib/<name>/       one outside tool (Better Auth, Prisma, hashing): .module.ts, .service.ts (exactly these 2)
  dto/<feature>/    request and response shapes, all exported from dto/index.ts
  config/           settings: environment.ts, auth/ (Better Auth), docs/ (doc wording and samples)
  middleware/       guards, decorators, filters, interceptors
```

## Settings

Everything is in `.env.example` with a comment. The main ones:

| Setting                              | What it's for                                                  |
| ------------------------------------ | -------------------------------------------------------------- |
| `DATABASE_URL`                       | Postgres connection                                            |
| `BETTER_AUTH_SECRET`                 | Signs sessions (32+ characters). Required in production        |
| `BETTER_AUTH_URL`                    | This API's address                                             |
| `APP_URL`                            | The frontend's address                                         |
| `BETTER_AUTH_API_KEY`                | Sends sign-in emails and powers the Better Auth dashboard      |
| `GOOGLE_*`, `GITHUB_*`, `LINKEDIN_*` | Sign-in providers. Set both ID and secret, or leave both empty |
| `RECAPTCHA_SECRET_KEY`               | Turns on reCAPTCHA                                             |
| `AUTH_IP_HEADERS`                    | Only when hosted behind a proxy, e.g. `cf-connecting-ip`       |

Without `BETTER_AUTH_API_KEY`, development prints sign-in codes in the server log instead of emailing them. The login cookie is shared automatically when the frontend and API share a parent domain (`app.example.com` and `api.example.com`).

## Changing the database

- Our own tables: edit `prisma/schema.prisma`, then `bun run db:migrate`.
- Better Auth's tables: change the options in `src/config/auth/better-auth.ts`, then run `bun run auth:generate` and `bun run db:migrate`. Don't edit Better Auth's tables by hand.

## Tests and checks

```bash
bun run lint
bun run typecheck
bun run test       # unit tests
bun run test:e2e   # API tests; the database ones run when DATABASE_URL is set
bun run build
```

CI runs all of these on every push, then builds and scans the Docker image. Tagging a version (`git tag v1.0.0 && git push origin v1.0.0`) publishes the image.

## Known issues

- **MCP sign-in doesn't work yet.** A Better Auth bug with Prisma and Postgres stops it from saving its setup, and the server logs an error at startup. Everything else works.
- **Better Auth's schema generator writes one table wrong** (Agent Auth grants). `scripts/fix-auth-schema.mjs` repairs it automatically after `auth:generate`.
- **`better-call` is pinned to 1.4.5** in `package.json` so all Better Auth packages share one copy. Remove the pin once Agent Auth updates.
- **Agent Auth is marked unstable** by Better Auth and may change.
- **Frontend pages still needed:** accept invite, approve agent, and sign-in/consent pages for agents.
