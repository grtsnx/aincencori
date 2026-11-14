<div align="center">

# 🤖 Agentic

**The backend for an AI bot platform:** people make their own bots, teach them tasks, give them
apps and a computer, and the bots work for them, safely.

![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.3-000000?logo=bun&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-17-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![Better Auth](https://img.shields.io/badge/Better_Auth-sign--in-111111)
![Tests](https://img.shields.io/badge/tests-unit_%2B_API_%2B_AI_evals-2EA44F)

[**Features**](docs/features.md) · [**Build the app**](docs/frontend.md) ·
[**Run in production**](docs/operations.md) · [**Rules for contributors**](AGENTS.md)

</div>

---

## ⚡ Quick start

You need **Bun 1.3+**, **Node.js 24+** and **Docker**.

```bash
cp .env.example .env
docker compose up -d --wait     # Postgres, PgBouncer, Valkey, MinIO, Mailpit, SearXNG
bun install --frozen-lockfile
bun run db:migrate

bun run start:dev               # the API          → http://localhost:3000
bun run start:worker            # background jobs  (second terminal)
bun run start:voice             # live voice calls (optional, third terminal)
```

Then open the API docs:

| Docs       | Address                    |
| ---------- | -------------------------- |
| 📘 Scalar  | http://localhost:3000/docs |
| 📗 Swagger | http://localhost:3000/api  |
| 📨 Emails  | http://localhost:8025      |

> [!TIP]
> Most features switch on by themselves when their key is in `.env`. Without a key, a feature
> answers "not available" instead of breaking the app.

## ✨ What it does

|     | Feature                | In short                                                                                |
| --- | ---------------------- | --------------------------------------------------------------------------------------- |
| 💬  | **Chat**               | Streaming answers, cards and charts, quoted replies, reactions, smart follow-ups        |
| 🤖  | **Bots**               | Instructions, memories, skills, apps and documents; they learn and suggest improvements |
| 🎓  | **Skills**             | Teach a task in chat, or install a `SKILL.md` from a link (safety scanned)              |
| 🧩  | **Apps and MCP**       | Gmail, Slack and more, an MCP catalog, or your own MCP server                           |
| 🌐  | **Web**                | Exa → Firecrawl → Context.dev → our own SearXNG, with fair use per user                 |
| 💻  | **Computer**           | A Linux machine per user: terminal, files and a browser (InstaBox)                      |
| ⏰  | **Routines and plans** | Tasks on a schedule, and big goals worked through in steps                              |
| 🎙️  | **Voice**              | Live calls with a bot, and voice typing (LiveKit)                                       |
| ✅  | **Approvals**          | Risky steps ask first, with fixed cards; rules per tool; an inbox                       |
| 🛡️  | **Safety**             | Guardrails for secrets and scams, untrusted-text labels, alerts to the team             |
| 💳  | **Billing**            | 6 plans, naira or dollars, a free trial, AI credits, customer portal (Bachs)            |
| 🛒  | **Marketplace**        | Share bots for free, or sell them; creators get paid out                                |
| 🔐  | **Sign-in**            | Email codes, Google, GitHub, Discord, passkeys, two-factor, organizations               |
| 🔔  | **Notifications**      | An in-app bell, plus email and phone or browser push (Firebase, free), per user choice  |
| 👮  | **Admin**              | Users, roles, usage, billing, marketplace review, alerts                                |

Every feature, in detail: **[docs/features.md](docs/features.md)**.

## 🧭 Where things go

```text
src/
├─ modules/<name>/   one feature: <name>.service.ts, .controller.ts, .module.ts (exactly 3)
├─ lib/<name>/       one outside service (prisma, exa, bachs…): .module.ts, .service.ts (exactly 2)
├─ dto/<feature>/    request and response shapes, all exported from dto/index.ts
├─ config/           settings, grouped by topic (auth/, agents/, billing/, docs/, email/)
├─ middleware/       guards, filters, interceptors; commons/ for shared helpers
└─ workers/          jobs.ts (background jobs) and voice.ts (live calls)
```

The full rules for people and AI coding agents are in [AGENTS.md](AGENTS.md).

## ✅ Before you push

```bash
bun run lint && bun run typecheck && bun run format:check
bun run test        # unit tests
bun run test:e2e    # API tests (the database ones run when DATABASE_URL is set)
bun run eval        # AI quality and safety checks on the real model (a few cents)
```

CI runs these on every push, then builds and scans the Docker image. Tagging a version
(`git tag v1.0.0 && git push origin v1.0.0`) publishes it.

## 🔑 Settings

Every setting is in [`.env.example`](.env.example), each with a one-line comment.

<details>
<summary><b>The main ones</b> (click to open)</summary>

| Setting                                                              | What it's for                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`                                                       | Postgres                                              |
| `REDIS_URL`                                                          | Sessions, rate limits, jobs (required in production)  |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL`                   | Sign-in secret, this API's address, the app's address |
| `CORS_ORIGINS`                                                       | The app addresses allowed to call the API             |
| `CENCORI_API_KEY`                                                    | The AI (without it, chat answers 503)                 |
| `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `CONTEXT_API_KEY`, `SEARXNG_URL` | Web search and page reading, tried in this order      |
| `INSTABOX_API_KEY`                                                   | The agent's computer                                  |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`               | Live voice calls                                      |
| `BACHS_API_KEY`, `BACHS_WEBHOOK_SECRET`                              | Payments and creator payouts                          |
| `STORAGE_URL`                                                        | Chat files (Cloudflare R2 or S3)                      |
| `SENDBYTE_API_KEY` or `SMTP_*`, `MAIL_FROM`                          | Email (locally: Mailpit)                              |
| `GOOGLE_*`, `GITHUB_*`, `DISCORD_*`                                  | Sign-in providers                                     |
| `ALERT_WEBHOOK_URL`                                                  | Optional: a Slack or Discord channel for alerts       |

</details>

Production settings, database changes and the coding-agent tools are in
**[docs/operations.md](docs/operations.md)**.

## 🚧 Known issues

The short list (details in [docs/features.md](docs/features.md#-known-issues)):

- Payments (Bachs and Connect) are tested with a stand-in, not a real Bachs account yet.
- Monthly paid bots are paid one month at a time (Bachs has no split subscriptions).
- Web search prices in `webPriceUsd` are our estimates; check them now and then.
- Chat files have no total size limit per user yet.
