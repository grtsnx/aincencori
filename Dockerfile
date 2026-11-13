# syntax=docker/dockerfile:1.7

# Debian slim, not Alpine: LiveKit (voice calls) ships compiled code for
# glibc Linux only, and one image runs the API, the job worker and the voice
# worker.

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS dependencies
WORKDIR /app
COPY package.json bun.lock prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs prisma generate, which writes the client into src/generated.
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
# The client is already compiled into dist, so skip postinstall here.
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Apply available OS fixes and remove npm from the runtime attack surface.
# The application starts with node and never installs packages at runtime.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# The API. The same image runs the job worker and the voice worker:
#   node --enable-source-maps dist/worker.js
#   node --enable-source-maps dist/voice-worker.js start
CMD ["node", "--enable-source-maps", "dist/main.js"]
