# PolyMarket Social ("Justify") — Project & Team Guide

Social prediction-market platform: a Twitter-like feed where the shareable object is a tradeable
prediction market. Spec lives in `documentation_polymarket_social/` (start with `overview.md`,
then `functional-requirements.md`; the MVP scope is fixed by `functional-requirements-ceo.md` —
that directive wins on what must actually work). The `html-polymarket-social-prototype/` is a
static Bootstrap/jQuery demo with hard-coded data — it is the **visual source of truth**, not the
target architecture.

## MVP scope (CEO directive)

Four must-work flows, end-to-end, no mocks: **CEO-1** register/sign-in (one auth method),
**CEO-2** follow the founder's profile (persisted count), **CEO-3** connect MetaMask
(Ganache 1337), **CEO-4** place one real Buy bet on one seeded market, settled on-chain.
Everything else may ship hardcoded exactly as the prototype renders it.

## Tech stack (decided)

| Layer       | Stack                                                                                            |
|-------------|--------------------------------------------------------------------------------------------------|
| Frontend    | Next.js 14 (App Router) + TypeScript + wagmi/viem                                                |
| Backend     | Next.js API routes + NextAuth.js + PostgreSQL + Prisma                                           |
| Contracts   | Solidity + Hardhat + OpenZeppelin                                                                |
| Chain (MVP) | Ganache in Docker — chain ID **1337**, JSON-RPC **:8545**, mock ERC-20 collateral, manual oracle |
| Tooling     | pnpm workspaces (`web`, `contracts`)                                                             |

Base + USDC + decentralized oracle is a **later phase** — design for it, don't build it now.

## Repo layout

```
web/                # Next.js 14: UI + API routes + Prisma
  prisma/           #   schema + migrations          — backend-engineer
  src/app/api/      #   API routes                   — backend-engineer
  src/lib/server/   #   auth config, db client       — backend-engineer
  src/app/          #   pages (everything else)      — frontend-engineer
  src/components/   #   UI components                — frontend-engineer
  src/lib/client/   #   wagmi config, hooks          — frontend-engineer
contracts/          # Solidity + Hardhat             — contracts-engineer
  deployments/      #   deployed-address artifacts (frozen integration contract)
docker-compose.yaml # Ganache + Postgres + prototype + web — devops-engineer
.github/workflows/  # CI                             — devops-engineer
documentation_polymarket_social/mvp-*.md             — documentation-engineer
```

## Team & orchestration

The orchestrator decomposes work and delegates to the team, each member with **strict file
ownership** so they can work in parallel without conflicts:

- **frontend-engineer** → `web/src/**` except `api/` and `lib/server/`; `web/public/**`
- **backend-engineer** → `web/prisma/**`, `web/src/app/api/**`, `web/src/lib/server/**`
- **contracts-engineer** → `contracts/**`
- **devops-engineer** → `docker-compose.yaml`, `.github/workflows/**`, root config, `web/Dockerfile`
- **documentation-engineer** → `documentation_polymarket_social/mvp-*.md`, `web/README.md`, `contracts/README.md`

### Coordination rules

- An agent edits **only** the files it owns. Cross-boundary changes go through the orchestrator.
- **Integration contracts** are the seams: API route shapes + Prisma types (backend), contract
  ABIs + `contracts/deployments/ganache.json` (contracts), env-var names + service topology
  (devops). Consumers import these — never redefine them.
- Announce any breaking change to a shared shape or ABI to the orchestrator before merging.
- Before reporting a task done, run the workspace's lint/test/build and paste the output.

## Conventions

- TypeScript strict everywhere; no `any` in committed code.
- No secrets in code — use env vars (`.env.example` is the catalog).
- Keep the Ganache chain ID / RPC port consistent across all configs (1337 / 8545).
- Conventional commits per `.gitmessage`; scopes: `web | api | contracts | infra | e2e | delivery | deps`.
