# One-shot container: compile contracts and deploy to Ganache.
# Writes deployments/ganache.json (mounted as a volume by compose).
#
# Usage (via compose):
#   docker compose --profile deploy up contracts-deploy
# Or standalone:
#   docker compose run --rm contracts-deploy

FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Copy workspace root manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contracts/package.json ./contracts/

# Install contracts workspace deps only
RUN pnpm install --frozen-lockfile --filter contracts

# Copy contracts source
COPY contracts/ ./contracts/

WORKDIR /app/contracts

# Compile (generates artifacts/ needed for deploy)
RUN pnpm build

# RPC_URL and GANACHE_MNEMONIC are injected by docker-compose at runtime.
# Default points to compose Ganache service.
ENV RPC_URL="http://ganache:8545"

CMD ["pnpm", "deploy:ganache"]
