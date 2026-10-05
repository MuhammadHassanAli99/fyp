# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Marketplace API — production image
#
# IMPORTANT: build from the REPOSITORY ROOT, not from backend/:
#
#     docker build -f backend/Dockerfile -t marketplace-api:1.0.0 .
#
# The build context must include database/ as well as backend/, because the
# schema-compatibility check resolves migrations at ../database/migrations
# relative to the working directory. The runtime layout mirrors the repo
# (/app/backend + /app/database) so that path resolution is unchanged.
#
# Multi-stage so the runtime layer carries no compiler, no dev dependencies and
# no TypeScript source.
#
# The image contains NO secrets and NO .env file. Configuration is injected at
# run time — see docs/SECRETS_MANAGEMENT.md. .dockerignore keeps .env,
# node_modules and storage/ out of the build context entirely.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=20.19-alpine

# --- Stage 1: install full dependencies (including dev, for tsc) -------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
# `npm ci` is reproducible and fails if the lockfile is out of sync.
RUN npm ci --no-audit --no-fund

# --- Stage 2: compile TypeScript --------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/package.json backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# --- Stage 3: production dependencies only ----------------------------------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- Stage 4: runtime -------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# curl for the container healthcheck; tzdata so DB_TIMEZONE and job scheduling
# resolve real zone names rather than falling back to UTC.
RUN apk add --no-cache curl tzdata

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app/backend

# Run as an unprivileged user. The `node` user ships with the base image at
# uid/gid 1000; reusing it avoids an ownership mismatch on mounted volumes.
COPY --from=prod-deps --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --chown=node:node backend/package.json ./

# Migrations and seeds are read at boot (schema compatibility) and by the
# migration scripts. SQL only — no application code.
COPY --chown=node:node database /app/database

# Writable only where it must be. STORAGE_DRIVER=local is not appropriate for a
# multi-replica deployment (see docs/PRODUCTION_CONFIGURATION.md); this exists
# so single-node and staging deployments work, and should be a mounted volume.
RUN mkdir -p /app/backend/storage/uploads /app/backend/storage/backups \
  && chown -R node:node /app/backend/storage

USER node

EXPOSE 3000

# Liveness only — it must not touch the database, or a brief DB blip would make
# the orchestrator kill an otherwise healthy container. Readiness is checked by
# the orchestrator against /health/ready, which is where dependencies are judged.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" > /dev/null || exit 1

# Direct node, no npm wrapper: npm does not forward SIGTERM to the child, which
# would break the graceful drain in src/index.ts and turn every rolling deploy
# into a hard kill mid-request.
CMD ["node", "dist/index.js"]
