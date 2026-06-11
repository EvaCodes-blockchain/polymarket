/**
 * Runtime loader for the canonical deployment artifact
 * `contracts/deployments/ganache.json` (frozen integration contract).
 *
 * MockUSDC address + ABI come from `contracts.MockUSDC`; the MarketAMM ABI is
 * identical for every market, so it is read once from the seeded market entry
 * (`seededMarket.contracts.MarketAMM.abi`) — per-market AMM *addresses* come
 * from the Markets API.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Abi, Address } from "viem";

export class DeploymentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentsError";
  }
}

export interface DeploymentArtifacts {
  readonly chainId: number;
  readonly usdcAddress: Address;
  readonly usdcAbi: Abi;
  readonly ammAbi: Abi;
}

/** Repo-root artifact, resolved relative to this module (generator/src/trading/). */
export function defaultDeploymentsPath(): string {
  return path.resolve(__dirname, "..", "..", "..", "contracts", "deployments", "ganache.json");
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function asAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new DeploymentsError(`deployments: ${label} is not a valid address`);
  }
  return value as Address;
}

function asAbi(value: unknown, label: string): Abi {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DeploymentsError(`deployments: ${label} is not a non-empty ABI array`);
  }
  return value as Abi;
}

function getProp(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/**
 * Loads and validates the artifact. `filePath` defaults to the repo-relative
 * location; override with the DEPLOYMENTS_FILE env (cfg.deploymentsFile).
 */
export function loadDeployments(filePath?: string): DeploymentArtifacts {
  const resolved = filePath ?? defaultDeploymentsPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    throw new DeploymentsError(`deployments: cannot read ${resolved} (${String(cause)})`);
  }

  const chainId = getProp(parsed, "chainId");
  if (typeof chainId !== "number") {
    throw new DeploymentsError(`deployments: missing numeric chainId in ${resolved}`);
  }

  const mockUsdc = getProp(getProp(parsed, "contracts"), "MockUSDC");
  const usdcAddress = asAddress(getProp(mockUsdc, "address"), "contracts.MockUSDC.address");
  const usdcAbi = asAbi(getProp(mockUsdc, "abi"), "contracts.MockUSDC.abi");

  const seededAmm = getProp(getProp(getProp(parsed, "seededMarket"), "contracts"), "MarketAMM");
  const ammAbi = asAbi(getProp(seededAmm, "abi"), "seededMarket.contracts.MarketAMM.abi");

  return { chainId, usdcAddress, usdcAbi, ammAbi };
}
