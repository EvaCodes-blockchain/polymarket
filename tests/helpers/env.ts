// Environment configuration for the integration suite.
//
// Every value can be overridden via env vars; defaults match the local dev stack
// described in docs/delivery/agentic-sprint-contracts.md Section 1:
//   - web dev server on :3000
//   - Ganache on :8545 (chain 1337)
//   - Postgres on HOST PORT 5433 (local docker-compose.override.yaml; in-container 5432)

import fs from 'node:fs';
import path from 'node:path';

export const API_BASE_URL: string = process.env.API_BASE_URL ?? 'http://localhost:3000';

export const RPC_URL: string = process.env.RPC_URL ?? 'http://localhost:8545';

export const DATABASE_URL: string =
  process.env.DATABASE_URL ?? 'postgresql://justify:justify@localhost:5433/justify';

export const GENERATOR_API_KEY: string = process.env.GENERATOR_API_KEY ?? 'dev-generator-key';

// ---------------------------------------------------------------------------
// Deployments artifact (contracts/deployments/ganache.json) — canonical source
// of contract addresses/ABIs and the fixed Ganache account-role mapping
// (testing-integration.md Section 2.2). Minimal typing on purpose: tests only
// rely on the fields below; everything else stays opaque.
// ---------------------------------------------------------------------------

export interface DeploymentContract {
  address: `0x${string}`;
  abi: unknown[];
}

export interface Deployments {
  chainId: number;
  contracts: Record<string, DeploymentContract>;
  accounts: {
    deployer: string; // account 0 — contract deployer / platform admin
    oracleResolver: string; // account 1 — trusted oracle resolver
    traders: string[]; // accounts 2–5 — test traders (pre-funded with MockUSDC)
    creator: string; // account 6 — market creator ("founder", FACTORY_ROLE)
  };
  seededMarket: {
    marketId: number; // on-chain id of the seeded El Clásico market
  };
}

// Path resolved from the tests package dir (helpers/ → tests/ → repo root).
const DEPLOYMENTS_FILE: string =
  process.env.DEPLOYMENTS_FILE ??
  path.resolve(__dirname, '..', '..', 'contracts', 'deployments', 'ganache.json');

export const DEPLOYMENTS: Deployments = JSON.parse(
  fs.readFileSync(DEPLOYMENTS_FILE, 'utf8'),
) as Deployments;
