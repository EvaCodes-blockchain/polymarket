# Market generator (test/demo component) — news-driven market creation bots.
# See documentation_polymarket_social/testing-market-generator.md.
#
# Build context is the REPO ROOT (pnpm workspace), e.g.:
#   docker compose --profile generator build market-generator
#
# The generator is an external API client: it talks only to the web API
# (API_BASE_URL) and to Ganache (RPC_URL). The contracts deployment artifact
# (ganache.json) is mounted by compose at /deployments and selected via
# DEPLOYMENTS_FILE; a build-time copy is baked in only as a fallback for
# running the image outside compose.

FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Workspace root manifests so the pnpm workspace protocol resolves correctly
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY generator/package.json ./generator/

# Install generator workspace deps only
RUN pnpm install --frozen-lockfile --filter generator

# Generator source (tsx — no build step) + fixtures
COPY generator/ ./generator/

# Fallback copy of the deployment artifact (compose overrides via
# DEPLOYMENTS_FILE=/deployments/ganache.json + a read-only bind mount,
# so a redeploy never requires an image rebuild).
COPY contracts/deployments/ ./contracts/deployments/

# Safe defaults — every knob is overridable via compose (Section 7 of the spec)
ENV NEWS_SOURCE=fixture
ENV DEPLOYMENTS_FILE=/app/contracts/deployments/ganache.json

CMD ["pnpm", "-F", "generator", "generate:loop"]
