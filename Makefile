# PolyMarket Social — local development Makefile
# ─────────────────────────────────────────────────────────────────────────────
# One-command bootstrap: make up
# Requires: docker with compose plugin, pnpm
# ─────────────────────────────────────────────────────────────────────────────

COMPOSE := docker compose

.PHONY: up down down-volumes logs logs-ganache logs-postgres dev install lint build test typecheck \
        generate trade-bots generator-up generator-logs seed-users help

## up: Start Ganache + Postgres + prototype in the background
up:
	$(COMPOSE) up -d
	@echo ""
	@echo "Services started:"
	@echo "  Ganache  JSON-RPC → http://localhost:8545  (chain ID 1337)"
	@echo "  Postgres           → localhost:5432         (db: justify)"
	@echo "  Prototype          → http://localhost:3001"

## down: Stop all services and remove containers (volumes preserved)
down:
	$(COMPOSE) down

## down-volumes: Stop all services AND remove persistent volumes (WARNING: destroys data)
down-volumes:
	$(COMPOSE) down -v

## logs: Tail logs from all running services
logs:
	$(COMPOSE) logs -f

## logs-ganache: Tail Ganache logs only
logs-ganache:
	$(COMPOSE) logs -f ganache

## logs-postgres: Tail Postgres logs only
logs-postgres:
	$(COMPOSE) logs -f postgres

## dev: Bootstrap infra + start all workspace apps in watch mode
dev: up
	pnpm dev

## install: Install all workspace dependencies
install:
	pnpm install

## lint: Run linter across all workspaces
lint:
	pnpm -r run lint

## build: Build all workspaces
build:
	pnpm -r run build

## test: Run all workspace tests
test:
	pnpm -r run test

## typecheck: Typecheck all workspaces
typecheck:
	pnpm -r run typecheck

## generate: Run one market-generator cycle on the host (fixture mode by default)
generate:
	corepack pnpm -F generator generate

## trade-bots: Run one bot-trading cycle on the host (Ganache accounts 7-9)
trade-bots:
	corepack pnpm -F generator trade

## generator-up: Build + start the containerized market generator (compose profile "generator")
generator-up:
	$(COMPOSE) --profile generator up -d --build market-generator

## generator-logs: Tail market-generator logs
generator-logs:
	$(COMPOSE) --profile generator logs -f market-generator

## seed-users: Seed demo users into the web database
seed-users:
	corepack pnpm -F web exec tsx prisma/seed-users.ts

## help: Show this help
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | column -t -s ':'
