# Agentic

A NestJS API with sign-in, users, organizations, admin tools and AI agent access. Auth is handled by [Better Auth](https://better-auth.com), data lives in Postgres through Prisma.

## Run it locally

You need Bun 1.3.14+, Node.js 24+ and Docker.

```bash
cp .env.example .env
docker compose up -d --wait   # Postgres (5433), PgBouncer (6433), Valkey (6380), MinIO (9000) and Mailpit (inbox: http://localhost:8025)
bun install --frozen-lockfile
bun run db:migrate
bun run start:dev        # the API
bun run start:worker     # in a second terminal: background jobs (emails, routines)
```

Then open the API docs:

- Scalar: http://localhost:3000/docs
- Swagger: http://localhost:3000/api

## What's built

**Sign-in**

- Email codes (one-time codes sent by email). There are no passwords.
- Google, GitHub and Discord. Each turns on when its ID and secret are set in `.env`.
- Passkeys and two-factor (2FA).
- A Google, GitHub or Discord sign-in never takes over an existing account just because the email matches. The user signs in first, then links the provider.
- Throwaway email domains are blocked, and `ada+1@gmail.com` can't make a second account for `ada@gmail.com`.
- Free-trial abuse: Sentinel counts accounts per device (fingerprint, 90 days). The 3rd account from one device must solve a challenge; the 4th is blocked. It needs `sentinelClient()` on the frontend.
- Optional Google reCAPTCHA on the email code routes.
- New users without a photo get their Gravatar, or else an animated DiceBear "loops" avatar. Only a hash of the email is sent.

**Users, organizations and admin**

- Users can see their profile, sign-in methods and sessions, and stay signed in to several accounts at once.
- Organizations have teams, invites, and custom roles with chosen permissions.
- Admins can list, ban and impersonate users, invite staff, and create staff roles with permissions. Staff live in a built-in "Staff" organization.

**AI agents (Agent Auth)**

- Agents act for a user, who approves each thing an agent may do: read the profile, list bots, ask the assistant or a bot, search documents, start a plan, and read usage. They run with the same limits and rules as the user.
- Agents find the setup at `/.well-known/agent-configuration`.

**Chat with AI agents (Cencori)**

- `POST /v1/chat` streams the answer as events: text, widgets (cards, lists, charts), tool calls, approvals and handoffs. The frontend can use Cencori's `<AgentChat>`.
- The main agent "Agentic" hands account questions to "Account" and web questions to "Research", asks "Writer" for drafts, and can hand the chat to a person on our team.
- Tools that change data (like changing your name) wait for the user to approve them in the chat.
- Truthful by rule: every agent is told to answer only from the user's messages, its tools and well-established facts, to say when it doesn't know, and never to invent names, numbers, links or results (`truthRules` in `src/config/agents/agents.ts`). `bun run eval` checks this on the real model.
- Follow-ups: after a draft, a list, research or a plan, the agent may offer 1 to 3 next steps ("Make it shorter") with its `suggest_follow_ups` tool; never after small talk or simple facts. They come in the stream's `saved` event and on each message in the history (`followUps`), for the app to show as buttons. Tapping one sends it as a normal message.
- Reactions: `PUT /v1/chat/:id/messages/:messageId/reaction` with `{ "emoji": "👍" }` (or `null` to remove). One per message, shown in the history (`reaction`). Bots learn from them.
- Replies, like WhatsApp: send `replyTo` (a message id) with a message, and the AI is shown the quoted text. Agents can quote too, with their `reply_to_message` tool. The history gives each message's `replyTo` (a short preview). After each turn the stream sends a `saved` event with the new messages' ids, so the app can quote them straight away.
- Images and files (PDF, text, CSV...) can be attached, up to 5 per message, for the default assistant and every bot. The files are kept in Cloudflare R2 (`STORAGE_URL`; locally MinIO), private, and opened from the chat history through links that last 15 minutes. Deleting a chat or a user deletes their files. Small pictures are enlarged before the model sees them, because models misread tiny images; the stored file stays the original.
- Guardrails block pasted keys and passwords, and any answer that contains one of our secrets.
- Every message is saved in our own database (`chatMessage`), so the history is ours and we can switch AI providers without losing it. Chats and messages load in small pages.
- Each chat belongs to the user who started it. Staff with the `chat` permission can read and reply to chats handed to a person, then hand them back.
- Agents live in `src/config/agents/agents.ts`.

**Routines and background jobs**

- Routines: the agent runs a prompt on a schedule ("every morning at 8, summarize the news") in the user's time zone. Each run is saved as a chat. Users can pause, edit, run now, and see past runs.
- Limits (in `src/config/agents/limits.ts`): 25 routines per user, at most one run every 15 minutes.
- Background jobs use BullMQ on Redis or Valkey (`REDIS_URL`; locally the Valkey container). Failed jobs retry with growing waits. Tests run jobs straight away and need no Redis.
- Jobs run on **worker** servers (`src/workers/jobs.ts`), never on the API servers, so busy routines don't slow the app. API servers only add jobs. Run as many workers as you need; they share Postgres and Redis.
- Production: one small image (`docker build --target api .`) runs both. API: the default command. Worker: `node --enable-source-maps dist/workers/jobs.js` (it has no web port, so turn off the HTTP health check for it).
- Emails are sent by the worker too: right away, plus a 5-second sweep for retries.

**MCP server (for outside AI apps)**

- `/mcp` lets any MCP app (Claude, Cursor, other agents) use a user's own services: profile, organizations, chats (including sending a message), bots with their memories and skills, groups, routines and integrations. Admin and staff features are never offered.
- The user signs the app in through Better Auth (OAuth). Every call runs as that user.
- Bots (`/v1/bots`): a user gives a bot a name and instructions, then chats with it (`POST /v1/chat` with `botId`). Everything else is optional:
  - **Memories**: facts it already knows. The user adds them, and the bot saves new ones itself during chats. Kept per bot, in our database.
  - **Skills**: playbooks it can run. Stored by us, and sent to Cencori for a safety scan and version history.
  - **Routines**: jobs that run on their own (`/v1/routines` with `botId`).
  - **Integrations**: apps it can use.
- Voice typing (LiveKit): `POST /v1/voice/dictate` gives the app a ticket to speak instead of typing. The words appear live in the message box as the user talks, then go to the chat as a normal message. No bot answers on its own.
- Voice calls (LiveKit): `POST /v1/voice/call` gives the app a ticket to talk live with the default assistant, a bot or a group. The bot starts speaking while it is still writing its answer (first words in about 1.5 seconds in our tests), and the user can talk over it. Our voice worker (`src/workers/voice.ts`, run with `bun run start:voice`) joins the call, turns speech into text, asks the bot through the normal chat, and speaks the answer. A call uses the bot's memories, skills and integrations and is saved as a chat. Needs `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from a LiveKit Cloud project; without them the route answers 503.
- Deploying the voice worker: LiveKit Cloud runs it for us (about $0.01 per call minute, nothing when idle). It builds the `Dockerfile`'s last stage on its own machines, so your Mac never builds it. Install the `lk` CLI and sign in (`lk cloud auth`), then:
  - First time: `lk agent create --region us-east --secrets-file .env.production`. This saves the agent's id in `livekit.toml`; commit that file.
  - Each update: `lk agent deploy`.
  - The worker makes outbound connections to production Postgres, Redis and Cencori. Keep Postgres and Redis private where possible; use LiveKit Private Links for supported AWS or Azure services, or a private tunnel. If a public endpoint is necessary, require TLS, unique strong credentials and the narrowest available firewall rules. Never expose Postgres or Redis without authentication.
  - LiveKit gives the worker its own `LIVEKIT_*` settings; don't put them in the secrets file.
- Groups (`/v1/groups`): 2 to 6 of a user's bots on one chat (`POST /v1/chat` with `groupId`). A built-in lead reads each message and asks the bots that fit; the bots can ask each other too. The history shows what each bot said. Bots are asked at most 8 times per message, which keeps cost in check and stops them talking in circles.
- A bot can rewrite its own instructions when asked; the user approves the change in the chat first.
- Knowledge (`/v1/documents`): users add files (PDF, Word, text, Markdown, CSV, JSON, HTML, up to 10 MB) or plain text. A worker reads each file and splits it into pieces that Postgres searches by word (its built-in text search: free and ours). Each bot searches only the documents its owner gave it (`documentIds`); the default assistant can search all of them. Answers say which document a fact came from.
- Plans (`/v1/plans`): a big goal ("compare three CRM tools and write a report") is split into up to 8 steps by a Planner agent, then a worker does one step at a time in one chat, so each step sees the earlier work. Apps check the plan to show the steps as they run. A step that needs the user's approval pauses the plan; the user approves it in the chat, then resumes. The default assistant can start a plan too (the user approves first).
- Marketplace (`/v1/marketplace`): users share a copy of a bot (name, description, instructions, skills; never memories, integrations, documents or sign-ins). An AI safety review runs before anyone sees it; staff with the marketplace permission can approve or reject by hand (`/v1/admin/marketplace`). Anyone can browse; signed-in users copy a bot into their own bots.
- The orchestrator is the default assistant ("Agentic", in `src/config/agents/agents.ts`). It answers first and hands the chat to its helpers or to one of the user's bots (those with a description).
- The model for all agents is set in one place: `agentModel` (now `gpt-6-luna`) and `agentThinking` in `src/config/agents/limits.ts`. Older OpenAI models (gpt-4.1, gpt-4o, gpt-5) are being shut down, so don't switch back to them.
- Integrations (`/v1/integrations`): what a user connects for their bots. Apps like Gmail, Slack and Notion sign in through Cencori ("Connect"); a user can connect the same app several times (two Gmail accounts) and give each to a different bot. They can also add their own MCP server (https, public internet; token stored encrypted). Up to 10 per user.
- A bot only uses the integrations its owner picked. The default assistant uses none. Every tool call on a user's own MCP server asks first.
- The `/mcp` address is listed in the docs under "MCP".
- Our own chat agent can manage routines too ("remind me every morning at 8"). Creating, pausing or deleting one asks the user to approve first.

**Teaching a bot a task** (like Grok): walk a bot through a task once in a chat and say "remember how to do this". It calls `save_skill` with general, numbered steps; the user sees the exact steps on an approval card first. A skill with the same name is replaced (a new version), and the usual limits and Cencori safety scan apply. The bot then follows the steps whenever the task comes up, and a routine can run it on a schedule. The learner may also suggest skills after chats.

The assistant and bots can read the user's own plan, AI use and credits (`my_plan_and_usage`), so answers about limits are facts.

**Skills and MCP servers from outside**

- Install a skill from a link or a pasted `SKILL.md` (the common Agent Skills format): `POST /v1/bots/:id/skills/import/preview` reads it (GitHub folder and file links become the raw `SKILL.md`), Cencori scans it, and the user sees its name, description and steps. `POST /v1/bots/:id/skills/import` with the preview's token installs exactly that skill on that bot (the token lasts an hour). Only public addresses are fetched, up to 256 KB.
- MCP catalog: `GET /v1/integrations/catalog?search=` lists servers from the public MCP registry that we can connect to (online, at most a Bearer token). `POST /v1/integrations/catalog` adds one by its registry name; the address always comes from the registry, never from the request. Servers that run on a laptop (stdio) or need other headers are left out.

**Guardrails** (in `src/config/agents/agents.ts`; every agent, bot and group runs them)

- Secrets in: a message that looks like a key or password (`sk-...`, private keys, AWS keys, `password: ...`) is stopped before the AI reads it.
- Scams and abuse in: messages of 20+ characters go through Cencori's moderation rules (fraud, phishing, harassment, violence...). A blocked one never reaches the AI. The check gives up after 1.5 seconds and lets the message through, so chats stay fast.
- Secrets out: an answer that contains one of our own keys (Cencori, Better Auth, LiveKit, InstaBox...) is stopped.
- Outside text (documents, web pages, app results, memories, skills) is marked as untrusted, so the AI treats it as information, never as orders.
- Each block is written to the activity log (`guardrail.blocked`). The user sees "That request was blocked."
- These run in our server, so they don't show in Cencori's dashboard. Cencori's own check (PII: emails, phone numbers, card numbers) is off by default; turn it on in Cencori under Settings → General → PII protection (paid Cencori plans).
- `bun run eval` checks them against the real model.

**Approvals, usage and activity** (ideas from Meta's Muse: the AI proposes, rules decide)

- Approval cards are written by our server, never by the AI: each waiting step has a `card` with a title, one plain sentence and the exact values ("When: Every day at 08:00"), the same in the chat stream and the inbox (`src/config/agents/cards.ts`). Apps show that fixed card with Approve and Decline.
- Risky tools ask first by default. The user can set a standing rule per tool: allow, ask or never (`/v1/approvals/rules`), everywhere or for one bot. On an approval card they can also tick "for this chat" (a week) or "always" (`remember` in the decision). Reading tools never ask, so people don't tire of approving.
- Approvals inbox (`/v1/approvals`): steps the AI stopped at, from chats, routines and plans. Each has a signed state; sending it to `POST /v1/chat` with the decisions carries the run on in its chat. Unanswered ones go after 14 days.
- Connected-app steps (Gmail, Slack...): Cencori runs these tools itself and stops at risky ones (sending email, deleting, paying). It tells us through a signed webhook (`POST /v1/approvals/cencori`). The user's rules answer it when they can; otherwise it waits in the inbox with `source: "app"` and the user answers it there (`POST /v1/approvals/:id/answer`). To turn it on, add a webhook in Cencori (dashboard, or `cencori.webhooks.create`) for `action.*` events pointing at `<BETTER_AUTH_URL>/v1/approvals/cencori`, and put its signing secret in `CENCORI_WEBHOOK_SECRET`. Locally the URL is your ngrok address.
- Outside text (document search results, answers from users' own MCP servers) is marked as untrusted, so the AI treats it as data and not orders. Tools the user turned off are hidden from the AI.
- Usage (`/v1/usage`): every AI call's tokens and cost are counted per user and day (Cencori reports them; our meter reads them as they stream past). Plans in `src/config/billing/plans.ts` set a monthly AI allowance for each plan (see Billing below). When it is used and no bought credits are left, new chats, routines, plans and voice calls answer 402 until next month. Voice calls also count their speech (listening per minute, speaking per character, at LiveKit's prices in `src/config/agents/limits.ts`); a call that runs out of allowance says so and hangs up. Staff see everyone's spend (`/v1/admin/usage`) and set plans (`PUT /v1/admin/users/:id/plan`).
- Plans and payments (`/v1/billing`, with Bachs at bachs.io): three plans for individuals (Free $0 with $2 of AI, Plus $9 with $6, Pro $29 with $20) and three for businesses (Team $99 with $70, Business $249 with $180, Scale $599 with $450), set in `src/config/billing/plans.ts`.
  - Prices show in naira to people in Nigeria (from the `cf-ipcountry` or `x-vercel-ip-country` header) and in dollars to everyone else; `?currency=` picks one. Naira prices come from `ngnPerUsd` (check it before going live).
  - Dollars renew by card every month. Naira pays one month at a time (card or bank transfer), because Bachs only renews dollar cards for now; paying again early adds a month.
  - A 7-day free trial of any paid plan, without a card, once per account (Sentinel stops new accounts made for more trials).
  - AI credits: packs of $10 ($8 of AI), $25 ($20) and $50 ($40), in either currency. They are used only after the month's allowance and never expire.
  - The customer portal (`POST /v1/billing/portal`) is Bachs's own page for the card, invoices and plan changes. `POST /v1/billing/cancel` stops a card plan at the end of the paid month. Deleting an account cancels its card plan at once.
  - Only Bachs's signed webhooks (`POST /v1/billing/bachs`) change what someone has paid for, never the return from checkout; each event is used once. To turn it on: set `BACHS_API_KEY` (an `sk_sandbox_` key for tests), add a webhook in Bachs pointing at `<BETTER_AUTH_URL>/v1/billing/bachs` for `checkout.completed` and `customer.subscription.*`, and put its secret in `BACHS_WEBHOOK_SECRET`. Plan products are made at Bachs by themselves the first time someone pays.
  - Plans are also sent to Cencori: the user becomes a Cencori "end user" with the rate plan of the same slug, if you made one in Cencori's Revenue settings.
  - Staff (permission `billing`): an overview of plans, trials, card and naira payers, monthly revenue at list price and the latest payments (`GET /v1/admin/billing`); one user's billing and payments; give or take back AI credits with a reason; reset a user's free trial; cancel a user's card plan now or at month end.
- Activity log (`/v1/activity`; staff: `/v1/admin/activity`): sign-ins, every change made through the API, each tool the AI ran, approvals asked and answered, and Agent Auth events. Kept a year.
- Alerts: set `ALERT_WEBHOOK_URL` (Slack or Discord) to get a message when the server errors or a background job fails for good. The same alert is sent at most once every 10 minutes per server.

**Bots that learn**

- After a bot chat goes quiet (10 minutes), a worker job reads its new messages with a Learner agent. Lasting facts the user or their team said (who does what, tools, how they like work done, who approves what) become the bot's memories at once. Repeats are skipped, and so is anything that looks like a secret.
- When the chat shows a clear need (the user corrected the bot, reacted 👎, or asked for the same kind of task again), the bot suggests a change to itself: new instructions or a new skill. Nothing changes until the user accepts it (`/v1/bots/:id/suggestions`, then `accept` or `dismiss`). At most 5 wait per bot.
- Learning counts toward the user's allowance (kind `learning`) and is skipped when it is used up.

**Agent computer (InstaBox)**

- With `INSTABOX_API_KEY` set, each user gets their own cloud computer (a small Linux VM on InstaBox, 2 CPUs and 4 GB) the first time an agent needs it. Agents run commands, read and write files there; files in `/data/home` stay between chats. It pauses itself after 5 idle minutes.
- Running a command or writing a file asks the user first, like any risky tool (they can allow it always). Reading a file doesn't. Output is marked as outside text, and no keys or passwords are ever put on the computer.
- Users see it at `/v1/computer`, browse its files (`/v1/computer/files`) and can wipe it (`DELETE /v1/computer`). Deleting the account deletes the computer.
- Its run time counts toward the user's allowance: each command for its run time, at least a minute, at InstaBox's price for that size.

**Built for heavy traffic**

- Run as many API and worker servers as you need; nothing lives inside one server.
- Sessions are read from Redis (no database read per request) and still saved in Postgres. A role edited straight in the database shows up at the user's next sign-in; changes through the API apply at once.
- Both rate limits (ours and Better Auth's) count in Redis, so they hold across all servers.
- The app reaches Postgres through PgBouncer, a connection pooler (locally port 6433), so many servers share a few real connections. Migrations go straight to Postgres with `DIRECT_DATABASE_URL`. Each server keeps 10 connections to the pooler.
- Emails go out 10 at a time, so a burst of sign-ups drains fast.

**Security**

- Security headers, CSRF checks, rate limits and request IDs on every route.
- Every route needs a signed-in user unless it's marked `@Public()`.
- Passwords (if any are ever stored) are hashed with Argon2id.

**Email**

- Sent with `@nestjs/mail`: SendByte when `SENDBYTE_API_KEY` is set, otherwise SMTP. Locally every email lands in Mailpit at http://localhost:8025.
- Emails are saved (encrypted) to an outbox table first, then sent by the worker with retries.

## API docs

The docs are grouped into Auth, Agent Auth, User, Organization, Chat, Voice, Routines, Bots, Groups, Integrations, MCP and Admin. Every route has a short title, a one-line description and sample data. A test fails if a title goes over 4 words or a field has no sample.

There are two API versions, `/v1` and `/v2`. Better Auth's own routes live under `/v1/auth` (v2 gets its own when we start v2).

## Where things go

The full rules for people and AI coding agents are in [AGENTS.md](AGENTS.md) (Claude reads it through `CLAUDE.md`).

```
src/
  modules/<name>/   one feature: <name>.service.ts, .controller.ts, .module.ts (exactly these 3)
  lib/<name>/       one outside tool, named after it (better-auth, prisma, bullmq...): .module.ts, .service.ts (exactly these 2)
  dto/<feature>/    request and response shapes, all exported from dto/index.ts
  config/           settings: environment.ts, auth/ (Better Auth), docs/ (doc wording and samples)
  middleware/       guards, decorators, filters, interceptors; commons/ for helpers (hashing)
```

## Settings

Everything is in `.env.example` with a comment. The main ones:

| Setting                                                                      | What it's for                                                     |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`                                                               | Postgres connection                                               |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                       | Optional: live voice calls (LiveKit Cloud). Set all three or none |
| `BACHS_API_KEY`, `BACHS_WEBHOOK_SECRET`                                      | Optional: payments with Bachs. Without them billing answers 503   |
| `CENCORI_WEBHOOK_SECRET`                                                     | Optional: lets app steps (Gmail...) follow your tool rules        |
| `STORAGE_URL`                                                                | Cloudflare R2 (or S3-compatible) for chat files. Required in prod |
| `REDIS_URL`                                                                  | Redis or Valkey: sessions, rate limits, jobs. Required in prod    |
| `BETTER_AUTH_SECRET`                                                         | Signs sessions (32+ characters). Required in production           |
| `BETTER_AUTH_URL`                                                            | This API's address                                                |
| `APP_URL`                                                                    | The frontend's address                                            |
| `SENDBYTE_API_KEY` or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Sends emails. Locally SMTP defaults to Mailpit                    |
| `MAIL_REPLY_TO`                                                              | Optional: where replies to our emails go                          |
| `MAIL_FROM`                                                                  | The sender address. Required in production                        |
| `BETTER_AUTH_API_KEY`                                                        | Optional: Better Auth dashboard and Sentinel abuse protection     |
| `GOOGLE_*`, `GITHUB_*`, `DISCORD_*`                                          | Sign-in providers. Set both ID and secret, or leave both empty    |
| `RECAPTCHA_SECRET_KEY`                                                       | Turns on reCAPTCHA                                                |
| `CENCORI_API_KEY`                                                            | Turns on the AI chat. Without it chat routes answer 503           |

Production also needs `AUTH_IP_HEADERS`: the one header your host sets with the visitor's real IP (plus `AUTH_TRUSTED_PROXIES` when that header is `x-forwarded-for`). The login cookie is shared automatically when the frontend and API share a parent domain (`app.example.com` and `api.example.com`).

## Changing the database

- Our own tables: edit `prisma/schema.prisma`, then `bun run db:migrate`.
- Better Auth's tables: change the options in `src/config/auth/better-auth.ts`, then run `bun run auth:generate` and `bun run db:migrate`. Don't edit Better Auth's tables by hand.

- OAuth token encryption: Better Auth encrypts newly stored provider tokens. After setting the production `BETTER_AUTH_SECRET`, run `bun run auth:encrypt-oauth-tokens` to encrypt existing linked-account tokens. The command is idempotent and does not print token values.

- Production proxy settings: set `AUTH_IP_HEADERS` to the single client-IP header your edge proxy overwrites. For `x-forwarded-for`, set `AUTH_TRUSTED_PROXIES` to the proxy IPs or CIDRs. Production startup rejects missing or invalid settings and rejects non-HTTPS app/API/CORS origins.

- Email outbox: deploy the `emailOutbox` migration with `bun run db:deploy` before starting the new application. Outbound email payloads are encrypted with `BETTER_AUTH_SECRET`; keep that secret stable while pending messages exist. Delivery retries are at-least-once, so an abrupt restart after a provider accepted a message can cause a duplicate email.

## Tests and checks

```bash
bun run lint
bun run typecheck
bun run test       # unit tests
bun run test:e2e   # API tests; the database ones run when DATABASE_URL is set
bun run build
bun run eval       # AI quality and safety checks on the real model (costs a few cents)
bun run load-test  # against a running server: bun run load-test http://localhost:3000 20 30
```

The load test hits one IP, so the rate limit (100 a minute) answers 429 quickly; that is expected. Run it from several machines to measure real capacity.

CI runs all of these on every push, then builds and scans the Docker image. Tagging a version (`git tag v1.0.0 && git push origin v1.0.0`) publishes the image.

## Tools for coding agents

`.mcp.json` connects coding agents (Claude Code and others) working on this repo to two MCP servers:

- `instabox`: InstaBox's machines (list, create, run commands, files, delete). It reads `INSTABOX_API_KEY` from your shell, so export it before starting the agent.
- `livekit-docs`: LiveKit's docs, code search and prices. No key needed.

## Known issues

- **The agent computer is untested with a real InstaBox account.** It is tested against a stand-in of InstaBox's API; add `INSTABOX_API_KEY` to try it. Its live screen view needs a personal InstaBox key, so it is left out for now.
- **Computer cost is an estimate.** We count each command's run time (at least a minute); InstaBox also bills the idle minutes before the machine pauses.
- **Payments are untested with a real Bachs account.** The flows are tested with a stand-in for Bachs. Bachs is in private beta, only renews dollar cards, and its SDK notes that renewals (a second month) are not yet verified in their sandbox. Changing a card plan's tier happens in Bachs's portal.
- **Voice speech prices are estimates.** They are LiveKit's list prices for our two speech models; check them in `limits.ts` when the models change.
- **App-step approvals were tested with Cencori's real webhook, using test steps, not a real Gmail send.** Cencori's webhook names the step and the user's tenant (ids without their `act_`/`ten_` prefix); we read the step's details from Cencori. Whether a chat waits for the answer, or carries on and the step runs later, is up to Cencori.
- **Document search matches words, not meaning.** "money back" won't find "refund" unless the words overlap. The bots usually search with good key words, so it works well in practice; search by meaning (embeddings) can be added later.
- **Scanned PDFs (pictures of text) can't be read.** They are kept and marked failed with the reason.

- **Docker Desktop's default 8 GB disk is small.** Build only the API image locally (`docker build --target api .`, about 730 MB); the voice image (about 1.4 GB) is built by LiveKit Cloud. Run `docker builder prune` now and then to clear the build cache.

- **Voice calls are untested with real audio.** The call ticket, the worker's start-up and the spoken answer style are tested; a real call needs LiveKit Cloud keys and a frontend with LiveKit's client.

- **App sign-ins (Gmail, Slack...) need setup in Cencori first.** Until each app's sign-in is configured in the Cencori dashboard, "Connect" answers that the app is not ready.
- **Bots using app connections are untested end to end.** Linking a signed-in connection to a bot follows Cencori's API as tested with stand-in data; a real Gmail tool call in a chat has not been run yet.
- **Cencori cannot change a bot's connection list in place** (their API errors), so we remove and re-create the link when it changes.

- **Better Auth's schema generator writes one table wrong** (Agent Auth grants). `scripts/fix-auth-schema.mjs` repairs it automatically after `auth:generate`.
- **`better-call` is pinned to 1.4.5** in `package.json` so all Better Auth packages share one copy. Remove the pin once Agent Auth updates.
- **Agent Auth is marked unstable** by Better Auth and may change.
- **Frontend pages still needed:** accept invite, approve agent, and sign-in/consent pages for agents.
