# apps/admin Dockerfile — Next.js self-host + Playwright (Chromium).
#
# Railway setup (monorepo):
#   - Root Directory: .          (repo root — build context needs packages/db)
#   - Dockerfile path:  apps/admin/Dockerfile
#
# Build context = repo root. The Dockerfile copies both apps/admin and packages/db
# so the @bumi/db workspace resolves.

# ── Stage 1: install deps + build ────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# Copy workspace manifests first for better layer caching.
COPY package.json ./
COPY package-lock.json* ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/db/package.json ./packages/db/
COPY apps/storefront/package.json ./apps/storefront/

RUN npm install --workspaces --include-workspace-root

# Copy source for the workspaces this service needs.
COPY packages/db ./packages/db
COPY apps/admin ./apps/admin

# Generate Prisma client, then build the admin app.
RUN npm run generate -w packages/db
RUN npm run build -w apps/admin

# ── Stage 2: runtime (Playwright base bundles Chromium + OS deps) ───────────
FROM mcr.microsoft.com/playwright:v1.64.0-jammy AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=4001

COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/admin/.next ./apps/admin/.next
COPY --from=builder /repo/apps/admin/public ./apps/admin/public
COPY --from=builder /repo/apps/admin/package.json ./apps/admin/package.json
COPY --from=builder /repo/apps/admin/next.config.mjs ./apps/admin/next.config.mjs
COPY --from=builder /repo/apps/admin/middleware.ts ./apps/admin/middleware.ts
COPY --from=builder /repo/packages/db ./packages/db

EXPOSE 4001
CMD ["npm", "run", "start", "-w", "apps/admin"]
