# Rules for anyone changing this repo (people and AI coding agents)

Follow these rules exactly. If a change doesn't fit them, ask before breaking one.

## Folder layout (NestJS)

- `src/modules/<name>/`: one feature. **Exactly 3 files**: `<name>.service.ts`, `<name>.controller.ts`, `<name>.module.ts`. Nothing else in the folder.
- `src/lib/<name>/`: one outside tool or service we wrap (Better Auth, Prisma, email, Cencori). **Exactly 2 files**: `<name>.module.ts`, `<name>.service.ts`. Nothing else in the folder. Helpers, tokens, types or extra services do not go here.
- `src/dto/<feature>/*.dto.ts`: request and response shapes, grouped by feature. **One** `src/dto/index.ts` at the root exports them all (imported as `@/dto`). No index files inside feature folders.
- `src/config/`: settings, grouped by topic in folders (`config/auth/`, `config/docs/`, `config/email/`). `environment.ts` and `index.ts` stay at the root.
- `src/middleware/`: guards, decorators, filters, interceptors, and shared helpers in `middleware/commons/` (for example hashing and token encryption).
- Anything else goes in `config/` or `middleware/`. Do not create new top-level folders in `src/` without asking.

## Auth

- Better Auth is used directly (no NestJS wrapper library). Its routes live under `/v1/auth` (API versioning; v2 gets its own when we start v2).
- Every route needs a signed-in user unless marked `@Public()`.
- Better Auth tables come from `bun run auth:generate`. Never hand-edit them, except for extra `@@index` lines.
- Hash with Argon2id (`middleware/commons/hash.ts`).

## Email

- Use `@nestjs/mail` (the official NestJS mail package). Resend when `RESEND_API_KEY` is set, otherwise SMTP (`SMTP_URL`; locally Mailpit from `compose.yaml`).
- Every email goes through the outbox in `lib/email/email.service.ts` (encrypted, retried). Email wording lives in `config/email/templates.ts`.

## API docs (Swagger at /api, Scalar at /docs)

- Sections: Auth, Agent Auth, User, Organization, Admin (plus Server).
- Every route title is **at most 4 words**; every route description is **at most 12 words**.
- Every DTO field and every response has sample data (`example`).
- `test/e2e/docs.e2e-spec.ts` enforces this. Keep it passing.

## Settings

- Don't add a `.env` setting if the value can be worked out from another one (for example from `BETTER_AUTH_URL` or `APP_URL`).
- Every new setting goes in `.env.example` with a one-line comment.

## Before you finish

Run and keep green: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run format:check`.

## Writing

Comments, docs and the README use short, plain English. No jargon walls.
