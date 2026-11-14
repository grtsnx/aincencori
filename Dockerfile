# syntax=docker/dockerfile:1.7

# Two images from one file:
# - api: the API and the job worker. Small (Alpine), with no voice packages.
#     docker build --target api -t agentic-api .
# - voice: the voice worker (LiveKit). Debian, because LiveKit's voice code
#   only runs on glibc Linux. It is the last stage, so it is the default:
#   LiveKit Cloud builds it with `lk agent deploy` (see README).

# ---- Shared: compile the app (plain JavaScript, works on both images) ----

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS dependencies
WORKDIR /app
COPY package.json bun.lock prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs prisma generate, which writes the client into src/generated.
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY scripts/check-build.mjs ./scripts/check-build.mjs
COPY src ./src
RUN bun run build

# ---- api: the API and the job worker ----

FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS api-dependencies
WORKDIR /app
COPY package.json bun.lock ./
# The client is already compiled into dist, so skip postinstall here.
# Voice packages are removed: only the voice image uses them.
# (@livekit/protocol stays: the API uses it to make call tickets.)
RUN bun install --frozen-lockfile --production --ignore-scripts --omit=peer \
  && rm -rf node_modules/@livekit/agents node_modules/@livekit/av* \
    node_modules/@livekit/blingfire* node_modules/@livekit/local-inference* \
    node_modules/@livekit/rtc-*

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS api
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Apply OS fixes and remove npm: the app never installs packages at runtime.
RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=api-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
RUN rm -f dist/workers/voice.js dist/workers/voice.js.map

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# The API. The same image runs the job worker:
#   node --enable-source-maps dist/workers/jobs.js
CMD ["node", "--enable-source-maps", "dist/main.js"]

# ---- voice: the voice worker (last, so LiveKit Cloud builds it) ----

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS voice-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS voice
ENV NODE_ENV=production
WORKDIR /app

# ca-certificates is needed: without it, joining a LiveKit room fails.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=voice-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json

USER node
# LiveKit gives the worker its LIVEKIT_* settings; the rest come from
# `lk agent create --secrets-file`.
CMD ["node", "--enable-source-maps", "dist/workers/voice.js", "start"]
