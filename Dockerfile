# syntax=docker/dockerfile:1
FROM node:24.14.0-bookworm-slim AS base
WORKDIR /app
# Prisma's migration engine needs OpenSSL; the API uses the JS PostgreSQL adapter.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    NODE_OPTIONS=--max-old-space-size=512 npm ci --no-audit --no-fund

FROM dependencies AS build
COPY backend ./backend
COPY frontend ./frontend
# Build only the full target, with root-relative assets and no host environment files.
RUN npm run build --workspace backend \
    && VITE_BASE_PATH=/ npm run build:full --workspace frontend

FROM base AS production-dependencies
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    NODE_OPTIONS=--max-old-space-size=512 npm ci --omit=dev --omit=optional --workspace backend --include-workspace-root=false --no-audit --no-fund

FROM base AS migration-dependencies
COPY docker/migrations/package.json docker/migrations/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    NODE_OPTIONS=--max-old-space-size=512 npm ci --omit=dev --omit=optional --no-audit --no-fund

# A separate one-shot image contains the locked Prisma CLI, schema and migrations.
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=migration-dependencies /app/node_modules ./node_modules
COPY backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/prisma/schema.prisma ./backend/prisma/schema.prisma
COPY backend/prisma/migrations ./backend/prisma/migrations
COPY docker/prisma.config.mjs ./backend/prisma.config.mjs
WORKDIR /app/backend
USER node
CMD ["node", "../node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.mjs"]

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 FRONTEND_DIRECTORY=/app/frontend/dist
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
WORKDIR /app/backend
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=6 \
    CMD ["node", "--input-type=module", "-e", "try { const r = await fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/ready', { signal: AbortSignal.timeout(3000) }); process.exit(r.ok ? 0 : 1); } catch { process.exit(1); }"]
CMD ["node", "dist/server.js"]
