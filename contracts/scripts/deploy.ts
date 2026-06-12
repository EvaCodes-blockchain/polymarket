/**
 * deploy.ts — deterministic deploy script for PolyMarket Social MVP
 *
 * Account mapping (mnemonic "justify social prediction market mvp test test test test test test junk"):
 *   0  deployer / admin
 *   1  oracle resolver
 *   2-5 traders (pre-funded with MockUSDC)
 *   6  market creator
 *
 * Outputs: contracts/deployments/ganache.json
 *
 * Usage:
 *   pnpm -F contracts deploy:ganache
 *   # or from contracts/ directory:
 *   npx hardhat run scripts/deploy.ts --network ganache
 */

import { ethers } from "hardhat";
import type { Signer } from "ethers";
import * as fs from "fs";
import * as path from "path";

// hardhat-ethers augments `ethers` at runtime with getSigners(), getContractAt(),
// and provider, but tsc cannot see those augmentations through the pnpm symlink.
// We cast once here and use the typed alias throughout.
type HardhatEthers = typeof ethers & {
  getSigners(): Promise<(Signer & { address: string })[]>;
  getContractAt(name: string, address: string): Promise<ReturnType<typeof ethers.getContractAt>>;
  provider: {
    getNetwork(): Promise<{ chainId: bigint }>;
    getCode(address: string): Promise<string>;
  };
};
const hethers = ethers as unknown as HardhatEthers;

// ── Constants ──────────────────────────────────────────────────────────────────

// $10 000 USDC per trader (6 decimals)
const TRADER_USDC_FUNDING = 10_000n * 10n ** 6n;

// Seeded market: 6 000 YES + 4 000 NO = implied YES probability ≈ 40%
const SEED_YES = 6_000n * 10n ** 6n;
const SEED_NO  = 4_000n * 10n ** 6n;

const SEEDED_MARKET = {
  question:       "Will Barcelona win El Clásico?",
  outcomeLabels:  ["Barcelona", "Real Madrid"] as [string, string],
  // close time: 30 days from deploy
  closeTimeDelta: 30 * 24 * 60 * 60,
  oracleProofUrl: "https://example.com/el-clasico-oracle",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function usdc(n: bigint): string {
  return `${Number(n) / 1e6} USDC`;
}

// Some public RPCs (e.g. Arc testnet) reject hardhat's auto eth_estimateGas on
// txs that do nested CREATE (createMarket deploys 2 contracts) even though the
// tx executes fine. Set TX_GAS_LIMIT to pin an explicit gas limit and skip
// estimation. Empty (Ganache) → no override, normal estimation.
const TX_GAS_LIMIT = process.env.TX_GAS_LIMIT?.trim();
const txOverrides: { gasLimit?: bigint } = TX_GAS_LIMIT
  ? { gasLimit: BigInt(TX_GAS_LIMIT) }
  : {};

// ── Idempotency guard ──────────────────────────────────────────────────────────
// The chain (Ganache --database.dbPath volume) and the artifact (deployments
// volume) both persist across `docker compose run contracts-deploy`. If the
// artifact's MarketFactory still has code on this chain, the previous deploy is
// intact — skip, so CI/CD can run the deploy unconditionally on every build
// without orphaning addresses that web/generator/seeds already reference.
async function alreadyDeployed(artifactPath: string): Promise<boolean> {
  if (!fs.existsSync(artifactPath)) return false;
  try {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
      chainId?: number;
      contracts?: { MarketFactory?: { address?: string } };
    };
    const factoryAddress = artifact.contracts?.MarketFactory?.address;
    // Match the artifact's chain to the chain we're actually connected to, so
    // an artifact from a different network (e.g. Ganache 1337 vs Arc 5042002)
    // never counts as "already deployed" here.
    const liveChainId = Number((await hethers.provider.getNetwork()).chainId);
    if (artifact.chainId !== liveChainId || !factoryAddress) return false;
    const code = await hethers.provider.getCode(factoryAddress);
    return code !== "0x";
  } catch {
    return false; // unreadable/corrupt artifact → redeploy
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // Artifact filename is env-driven so an Arc deploy (arc.json) doesn't clobber
  // the Ganache one (ganache.json). Defaults to ganache.json for local dev.
  const artifactName = process.env.DEPLOY_ARTIFACT?.trim() || "ganache.json";
  const artifactPath = path.join(__dirname, "..", "deployments", artifactName);
  if (await alreadyDeployed(artifactPath)) {
    console.log("Contracts already deployed on this chain (artifact matches live code) — skipping.");
    console.log(`Artifact: ${artifactPath}`);
    return;
  }

  const signers = await hethers.getSigners();

  const deployer = signers[0]!;
  const oracle   = signers[1]!;
  const traders  = [signers[2]!, signers[3]!, signers[4]!, signers[5]!];
  const creator  = signers[6]!;

  console.log("=".repeat(60));
  console.log("PolyMarket Social MVP — Contract Deployment");
  console.log("=".repeat(60));
  console.log(`deployer : ${deployer.address}`);
  console.log(`oracle   : ${oracle.address}`);
  console.log(`creator  : ${creator.address}`);
  traders.forEach((t, i) => console.log(`trader ${i + 2} : ${t.address}`));
  console.log();

  // ── 1. JustifyAccessControl ────────────────────────────────────────────────
  console.log("Deploying JustifyAccessControl...");
  const ACLFactory = await ethers.getContractFactory("JustifyAccessControl", deployer);
  const acl = await ACLFactory.deploy(deployer.address);
  await acl.waitForDeployment();
  const aclAddress = await acl.getAddress();
  console.log(`  ✓ JustifyAccessControl @ ${aclAddress}`);

  // Grant RESOLVER_ROLE to oracle account
  await acl.grantRole(await acl.RESOLVER_ROLE(), oracle.address);
  console.log(`  ✓ Granted RESOLVER_ROLE to oracle (${oracle.address})`);

  // ── 2. Collateral USDC ─────────────────────────────────────────────────────
  // Two modes:
  //   • COLLATERAL_USDC_ADDRESS set → use that external ERC-20 (e.g. Circle
  //     testnet USDC on Arc). We can't mint it, so seeding / trader funding /
  //     the on-chain smoke buy are SKIPPED — those accounts must be funded from
  //     a faucet (faucet.circle.com) beforehand.
  //   • unset → deploy our mintable MockUSDC (local Ganache + fallback path).
  const externalCollateral = process.env.COLLATERAL_USDC_ADDRESS?.trim();
  const useExternalCollateral = !!externalCollateral;

  let usdcAddress: string;
  // `usdc_` is the mintable MockUSDC handle; null when using external collateral.
  let usdc_: Awaited<ReturnType<typeof USDCFactoryDeploy>> | null = null;
  async function USDCFactoryDeploy() {
    const USDCFactory = await ethers.getContractFactory("MockUSDC", deployer);
    const c = await USDCFactory.deploy(deployer.address);
    await c.waitForDeployment();
    return c;
  }

  if (useExternalCollateral) {
    usdcAddress = externalCollateral!;
    console.log(`Using external collateral USDC @ ${usdcAddress} (no mint; fund via faucet)`);
  } else {
    console.log("Deploying MockUSDC...");
    usdc_ = await USDCFactoryDeploy();
    usdcAddress = await usdc_.getAddress();
    console.log(`  ✓ MockUSDC @ ${usdcAddress}`);
  }

  // ── 3. OutcomeToken ────────────────────────────────────────────────────────
  console.log("Deploying OutcomeToken...");
  const OTFactory = await ethers.getContractFactory("OutcomeToken", deployer);
  const outcomeToken = await OTFactory.deploy(deployer.address);
  await outcomeToken.waitForDeployment();
  const outcomeTokenAddress = await outcomeToken.getAddress();
  console.log(`  ✓ OutcomeToken @ ${outcomeTokenAddress}`);

  // ── 4. FeeTreasury ─────────────────────────────────────────────────────────
  console.log("Deploying FeeTreasury...");
  const TreasuryFactory = await ethers.getContractFactory("FeeTreasury", deployer);
  const feeTreasury = await TreasuryFactory.deploy(aclAddress, usdcAddress);
  await feeTreasury.waitForDeployment();
  const feeTreasuryAddress = await feeTreasury.getAddress();
  console.log(`  ✓ FeeTreasury @ ${feeTreasuryAddress}`);

  // ── 5. OracleResolver ──────────────────────────────────────────────────────
  console.log("Deploying OracleResolver...");
  const ORFactory = await ethers.getContractFactory("OracleResolver", deployer);
  const oracleResolver = await ORFactory.deploy(aclAddress);
  await oracleResolver.waitForDeployment();
  const oracleResolverAddress = await oracleResolver.getAddress();
  console.log(`  ✓ OracleResolver @ ${oracleResolverAddress}`);

  // ── 6. MarketFactory ───────────────────────────────────────────────────────
  console.log("Deploying MarketFactory...");
  const MFFactory = await ethers.getContractFactory("MarketFactory", deployer);
  const factory = await MFFactory.deploy(
    aclAddress,
    outcomeTokenAddress,
    usdcAddress,
    feeTreasuryAddress
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`  ✓ MarketFactory @ ${factoryAddress}`);

  // Wire factory: FACTORY_ROLE on ACL + DEFAULT_ADMIN_ROLE on OutcomeToken
  await acl.grantRole(await acl.FACTORY_ROLE(), factoryAddress);
  await outcomeToken.grantRole(await outcomeToken.DEFAULT_ADMIN_ROLE(), factoryAddress);
  console.log(`  ✓ Wired factory roles`);

  // Grant FACTORY_ROLE to creator so they can call createMarket
  await acl.grantRole(await acl.FACTORY_ROLE(), creator.address);
  console.log(`  ✓ Granted FACTORY_ROLE to creator (${creator.address})`);

  // ── 7. Create seeded market ────────────────────────────────────────────────
  console.log("\nCreating seeded market...");
  const closeTime = BigInt(Math.floor(Date.now() / 1000) + SEEDED_MARKET.closeTimeDelta);
  const createTx = await factory.connect(creator).createMarket(
    SEEDED_MARKET.question,
    SEEDED_MARKET.outcomeLabels,
    closeTime,
    SEEDED_MARKET.oracleProofUrl,
    txOverrides
  );
  const createReceipt = await createTx.wait();

  // Parse MarketCreated event
  const marketCreatedEvent = createReceipt?.logs
    .map((log) => {
      try {
        return factory.interface.parseLog({ topics: log.topics as string[], data: log.data });
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "MarketCreated");

  if (!marketCreatedEvent) throw new Error("MarketCreated event not found");

  const seededMarketId: bigint = marketCreatedEvent.args[0] as bigint;
  const predictionMarketAddress: string = marketCreatedEvent.args[1] as string;
  const ammAddress: string = marketCreatedEvent.args[2] as string;

  console.log(`  ✓ Market #${seededMarketId}: "${SEEDED_MARKET.question}"`);
  console.log(`    PredictionMarket @ ${predictionMarketAddress}`);
  console.log(`    MarketAMM        @ ${ammAddress}`);

  // ── 8-10. Seed / fund / smoke — only when we control a mintable MockUSDC ────
  // With external collateral (real Circle USDC) we can't mint, so these steps
  // are skipped; seed the AMM and fund wallets manually from the faucet. The
  // market + AMM already exist on-chain, which is enough for the Arc artifact.
  if (!usdc_) {
    console.log("\nExternal collateral — skipping AMM seed, trader funding, and smoke buy.");
    console.log("  → Seed the AMM and fund wallets from faucet.circle.com, then trade via the UI.");
  } else {
    // ── 8. Seed the AMM ──────────────────────────────────────────────────────
    console.log("\nSeeding AMM pool...");
    const totalSeed = SEED_YES + SEED_NO;
    await (await usdc_.mint(deployer.address, totalSeed, txOverrides)).wait();
    await (await usdc_.approve(ammAddress, totalSeed, txOverrides)).wait();
    const amm = await hethers.getContractAt("MarketAMM", ammAddress);
    await (await amm.seed(SEED_YES, SEED_NO, txOverrides)).wait();
    console.log(`  ✓ Seeded: YES=${usdc(SEED_YES)}, NO=${usdc(SEED_NO)}`);
    console.log(`    Implied YES probability: ~${Math.round(Number(SEED_NO) / Number(SEED_YES + SEED_NO) * 100)}%`);

    // ── 9. Pre-fund traders 2-5 with MockUSDC ───────────────────────────────
    console.log("\nPre-funding traders...");
    for (let i = 0; i < traders.length; i++) {
      const trader = traders[i]!;
      await (await usdc_.mint(trader.address, TRADER_USDC_FUNDING, txOverrides)).wait();
      console.log(`  ✓ trader ${i + 2} (${trader.address}): ${usdc(TRADER_USDC_FUNDING)}`);
    }

    // ── 10. Smoke test: one Buy transaction from trader 2 ───────────────────
    // Skips when the trader has no native gas (e.g. fresh Arc deploy where only
    // deployer/creator were funded from the faucet). The market + seeded AMM are
    // already live, so the artifact is valid either way.
    const smokeTrader = traders[0]!; // account index 2
    const traderGas = await hethers.provider.getBalance?.(smokeTrader.address)
      .catch(() => 0n) ?? 0n;
    if (traderGas === 0n) {
      console.log("\nSmoke test: skipped (trader 2 has no gas — fund from faucet to trade).");
    } else {
    console.log("\nSmoke test: Buy flow...");
    const buyAmount = 10n * 10n ** 6n; // $10 USDC

    await (await usdc_.connect(smokeTrader).approve(ammAddress, buyAmount, txOverrides)).wait();
    const outcomeTokenContract = await hethers.getContractAt("OutcomeToken", outcomeTokenAddress);
    const yesTokenId = await outcomeTokenContract.encodeId(seededMarketId, 0);

    const balBefore = await outcomeTokenContract.balanceOf(smokeTrader.address, yesTokenId);

    const buyTx = await amm.connect(smokeTrader).buy(0, buyAmount, 0n, txOverrides);
    await buyTx.wait();

    const balAfter = await outcomeTokenContract.balanceOf(smokeTrader.address, yesTokenId);

    const sharesReceived = balAfter - balBefore;
    if (sharesReceived <= 0n) throw new Error("Smoke test failed: no YES shares minted");
    console.log(`  ✓ Bought ${usdc(buyAmount)} → ${sharesReceived.toString()} YES shares`);
    console.log(`  ✓ ERC-1155 token ID: ${yesTokenId}`);
    }
  }

  // ── 11. Build ABIs from artifacts ─────────────────────────────────────────
  // Map contract name → source file name (for the one case they differ).
  const CONTRACT_FILE_MAP: Record<string, string> = {
    JustifyAccessControl: "AccessControl",
  };

  function loadAbi(contractName: string): unknown[] {
    const fileName = CONTRACT_FILE_MAP[contractName] ?? contractName;
    const artifactPath = path.join(
      __dirname,
      "..",
      "artifacts",
      "src",
      `${fileName}.sol`,
      `${contractName}.json`
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi: unknown[] };
    return artifact.abi;
  }

  // ── 12. Write ganache.json ─────────────────────────────────────────────────
  const network = await hethers.provider.getNetwork();
  const artifact = {
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    contracts: {
      JustifyAccessControl: {
        address: aclAddress,
        abi: loadAbi("JustifyAccessControl"),
      },
      MockUSDC: {
        address: usdcAddress,
        abi: loadAbi("MockUSDC"),
      },
      OutcomeToken: {
        address: outcomeTokenAddress,
        abi: loadAbi("OutcomeToken"),
      },
      FeeTreasury: {
        address: feeTreasuryAddress,
        abi: loadAbi("FeeTreasury"),
      },
      OracleResolver: {
        address: oracleResolverAddress,
        abi: loadAbi("OracleResolver"),
      },
      MarketFactory: {
        address: factoryAddress,
        abi: loadAbi("MarketFactory"),
      },
    },
    seededMarket: {
      marketId: Number(seededMarketId),
      question: SEEDED_MARKET.question,
      outcomeLabels: SEEDED_MARKET.outcomeLabels,
      contracts: {
        PredictionMarket: {
          address: predictionMarketAddress,
          abi: loadAbi("PredictionMarket"),
        },
        MarketAMM: {
          address: ammAddress,
          abi: loadAbi("MarketAMM"),
        },
      },
    },
    accounts: {
      deployer:       deployer.address,
      oracleResolver: oracle.address,
      traders:        traders.map((t) => t.address),
      creator:        creator.address,
    },
  };

  const outputDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Reuse the env-driven artifact path resolved at the top (ganache.json by
  // default, arc.json for Arc deploys).
  const outputPath = artifactPath;
  fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Deployment complete!`);
  console.log(`Artifact written: ${outputPath}`);
  console.log(`${"=".repeat(60)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
