# ─── Stage 1: deps ────────────────────────────────────────────────────────────
# Install all workspace dependencies (devDeps needed for prisma generate + build)
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

# Copy workspace root manifests so pnpm workspace protocol resolves correctly
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json ./web/

RUN pnpm install --frozen-lockfile --filter web...

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY web/ ./web/

WORKDIR /app/web

# Dummy build-time env so `prisma generate` and `next build` don't fail.
# Real secrets are injected at runtime via docker-compose environment / env_file.
ENV DATABASE_URL="postgresql://justify:justify@localhost:5432/justify"
ENV NEXTAUTH_SECRET="build-time-placeholder"
ENV NEXTAUTH_URL="http://localhost:3000"
ENV NEXT_PUBLIC_RPC_URL="http://localhost:8545"
ENV NEXT_PUBLIC_CHAIN_ID="1337"
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the full web workspace (built .next + node_modules + prisma)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/web ./web
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./

# Copy entrypoint that runs migrate deploy then starts Next.js
COPY web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/docker-entrypoint.sh"]
