import { expect } from "chai";
import { ethers } from "hardhat";
import type { Signer } from "ethers";
import {
  JustifyAccessControl__factory,
  MockUSDC__factory,
  OutcomeToken__factory,
  FeeTreasury__factory,
  OracleResolver__factory,
  MarketFactory__factory,
} from "../typechain-types";
import type {
  JustifyAccessControl,
  MockUSDC,
  OutcomeToken,
  MarketFactory,
  MarketAMM,
  PredictionMarket,
  FeeTreasury,
  OracleResolver,
} from "../typechain-types";

describe("MVP Buy Flow", function () {
  // ─── Actors ────────────────────────────────────────────────────────────
  let deployer: Signer & { address: string };
  let trader: Signer & { address: string };

  // ─── Contracts ──────────────────────────────────────────────────────────
  let acl: JustifyAccessControl;
  let usdc: MockUSDC;
  let outcomeToken: OutcomeToken;
  let feeTreasury: FeeTreasury;
  let oracleResolver: OracleResolver;
  let factory: MarketFactory;

  // ─── Per-market contracts ───────────────────────────────────────────────
  let market: PredictionMarket;
  let amm: MarketAMM;
  let marketId: bigint;

  // ─── Constants ─────────────────────────────────────────────────────────
  const USDC_DECIMALS = 6n;
  const USDC = (n: number) => BigInt(n) * 10n ** USDC_DECIMALS;

  before(async function () {
    // ethers.getSigners() is augmented by hardhat-ethers at runtime
    const signers = await (ethers as unknown as { getSigners(): Promise<(Signer & { address: string })[]> }).getSigners();
    deployer = signers[0]!;
    trader = signers[2]!; // account index 2 per compose mnemonic docs
  });

  beforeEach(async function () {
    // ── Deploy ACL ────────────────────────────────────────────────────────
    acl = await new JustifyAccessControl__factory(deployer).deploy(deployer.address);
    await acl.waitForDeployment();

    // Grant RESOLVER_ROLE — not strictly needed for buy-flow tests but mirrors deploy script
    const resolverRole = await acl.RESOLVER_ROLE();
    await acl.grantRole(resolverRole, deployer.address); // deployer doubles as oracle in tests

    // ── Deploy MockUSDC ───────────────────────────────────────────────────
    usdc = await new MockUSDC__factory(deployer).deploy(deployer.address);
    await usdc.waitForDeployment();

    // ── Deploy OutcomeToken ───────────────────────────────────────────────
    outcomeToken = await new OutcomeToken__factory(deployer).deploy(deployer.address);
    await outcomeToken.waitForDeployment();

    // ── Deploy FeeTreasury ────────────────────────────────────────────────
    feeTreasury = await new FeeTreasury__factory(deployer).deploy(
      await acl.getAddress(),
      await usdc.getAddress()
    );
    await feeTreasury.waitForDeployment();

    // ── Deploy OracleResolver ─────────────────────────────────────────────
    oracleResolver = await new OracleResolver__factory(deployer).deploy(await acl.getAddress());
    await oracleResolver.waitForDeployment();

    // ── Deploy MarketFactory ──────────────────────────────────────────────
    factory = await new MarketFactory__factory(deployer).deploy(
      await acl.getAddress(),
      await outcomeToken.getAddress(),
      await usdc.getAddress(),
      await feeTreasury.getAddress()
    );
    await factory.waitForDeployment();

    // Wire factory roles
    await acl.grantRole(await acl.FACTORY_ROLE(), await factory.getAddress());
    await outcomeToken.grantRole(
      await outcomeToken.DEFAULT_ADMIN_ROLE(),
      await factory.getAddress()
    );

    // ── Create a market ───────────────────────────────────────────────────
    const closeTime = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24h from now
    const tx = await factory.createMarket(
      "Will Barcelona win El Clásico?",
      ["Barcelona", "Real Madrid"],
      closeTime,
      "https://example.com/oracle"
    );
    const receipt = await tx.wait();

    // Extract marketId from MarketCreated event
    const iface = factory.interface;
    const event = receipt?.logs
      .map((log: { topics: readonly string[]; data: string }) => {
        try {
          return iface.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
          return null;
        }
      })
      .find(
        (e: ReturnType<typeof iface.parseLog> | null): e is NonNullable<typeof e> =>
          e?.name === "MarketCreated"
      );

    expect(event, "MarketCreated event not emitted").to.not.be.null;
    marketId = event!.args[0] as bigint;

    // Resolve market and AMM contract addresses
    const [marketAddr, ammAddr] = await factory.getMarket(marketId);
    market = (await ethers.getContractAt("PredictionMarket", marketAddr)) as unknown as PredictionMarket;
    amm = (await ethers.getContractAt("MarketAMM", ammAddr)) as unknown as MarketAMM;

    // ── Seed the AMM pool ─────────────────────────────────────────────────
    // Seed with 600 YES + 400 NO (implied YES probability = 40%)
    const seedYes = USDC(600);
    const seedNo = USDC(400);
    await usdc.mint(deployer.address, seedYes + seedNo);
    await usdc.approve(await amm.getAddress(), seedYes + seedNo);
    await amm.seed(seedYes, seedNo);

    // ── Fund trader with MockUSDC ─────────────────────────────────────────
    await usdc.mint(trader.address, USDC(1000));
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe("Market deployment", function () {
    it("creates a PredictionMarket in Open state", async function () {
      expect(await market.state()).to.equal(0); // State.Open
    });

    it("records the market question correctly", async function () {
      const info = await market.info();
      expect(info.question).to.equal("Will Barcelona win El Clásico?");
    });

    it("registers both outcome labels", async function () {
      expect(await market.outcomeLabel(0)).to.equal("Barcelona");
      expect(await market.outcomeLabel(1)).to.equal("Real Madrid");
    });

    it("increments marketCount in the factory", async function () {
      expect(await factory.marketCount()).to.equal(1n);
    });
  });

  describe("Pool seeding", function () {
    it("marks the AMM as seeded", async function () {
      expect(await amm.isSeeded()).to.be.true;
    });

    it("sets reserves to the seeded amounts", async function () {
      expect(await amm.reserves(0n)).to.equal(USDC(600));
      expect(await amm.reserves(1n)).to.equal(USDC(400));
    });

    it("YES implied probability ≈ 40% (within 2 bps)", async function () {
      const prob = await amm.impliedProbabilityBps(0);
      // YES prob = NO reserve / total = 400/1000 = 4000 bps
      expect(prob).to.be.closeTo(4000n, 2n);
    });

    it("NO implied probability ≈ 60% (within 2 bps)", async function () {
      const prob = await amm.impliedProbabilityBps(1);
      // NO prob = YES reserve / total = 600/1000 = 6000 bps
      expect(prob).to.be.closeTo(6000n, 2n);
    });
  });

  describe("CEO-4: Buy flow", function () {
    const BUY_AMOUNT = USDC(10); // $10 USDC

    it("requires approval — reverts without allowance", async function () {
      // No approval given
      await expect(
        amm.connect(trader).buy(0, BUY_AMOUNT, 0n)
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });

    it("emits Buy event with correct fields", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);
      await expect(amm.connect(trader).buy(0, BUY_AMOUNT, 0n))
        .to.emit(amm, "Buy")
        .withArgs(
          trader.address,
          0, // outcomeIndex = YES
          BUY_AMOUNT,
          (fee: bigint) => fee > 0n,
          (shares: bigint) => shares > 0n
        );
    });

    it("mints ERC-1155 YES shares to trader after buy", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);

      const yesTokenId = await outcomeToken.encodeId(marketId, 0);
      const balanceBefore = await outcomeToken.balanceOf(trader.address, yesTokenId);

      await amm.connect(trader).buy(0, BUY_AMOUNT, 0n);

      const balanceAfter = await outcomeToken.balanceOf(trader.address, yesTokenId);
      expect(balanceAfter - balanceBefore).to.be.gt(0n);
    });

    it("mints NO shares to trader when buying NO", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);

      const noTokenId = await outcomeToken.encodeId(marketId, 1);
      const balanceBefore = await outcomeToken.balanceOf(trader.address, noTokenId);

      await amm.connect(trader).buy(1, BUY_AMOUNT, 0n);

      expect(await outcomeToken.balanceOf(trader.address, noTokenId) - balanceBefore).to.be.gt(0n);
    });

    it("does NOT mint the other-side token when buying YES", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);

      const noTokenId = await outcomeToken.encodeId(marketId, 1);

      await amm.connect(trader).buy(0, BUY_AMOUNT, 0n);

      expect(await outcomeToken.balanceOf(trader.address, noTokenId)).to.equal(0n);
    });

    it("deducts collateral from trader", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);

      const before = await usdc.balanceOf(trader.address);
      await amm.connect(trader).buy(0, BUY_AMOUNT, 0n);
      const after = await usdc.balanceOf(trader.address);

      expect(before - after).to.equal(BUY_AMOUNT);
    });

    it("sends fee to FeeTreasury", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);

      const treasuryBefore = await usdc.balanceOf(await feeTreasury.getAddress());
      await amm.connect(trader).buy(0, BUY_AMOUNT, 0n);
      const treasuryAfter = await usdc.balanceOf(await feeTreasury.getAddress());

      const expectedFee = (BUY_AMOUNT * 200n) / 10000n; // 2%
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);
    });

    it("updates reserves after buy", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);

      const r0Before = await amm.reserves(0n);
      const r1Before = await amm.reserves(1n);

      await amm.connect(trader).buy(0, BUY_AMOUNT, 0n); // buy YES

      const r0After = await amm.reserves(0n);
      const r1After = await amm.reserves(1n);

      // NO reserve increases (other side gets net collateral)
      expect(r1After).to.be.gt(r1Before);
      // YES reserve decreases (shares flow out)
      expect(r0After).to.be.lt(r0Before);
    });

    it("reverts on invalid outcome index", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);
      await expect(
        amm.connect(trader).buy(2, BUY_AMOUNT, 0n)
      ).to.be.revertedWithCustomError(amm, "InvalidOutcome");
    });

    it("reverts when slippage guard is too tight", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT);

      // Set minSharesOut to an unreasonably high value
      const impossibleMinShares = USDC(10_000_000);
      await expect(
        amm.connect(trader).buy(0, BUY_AMOUNT, impossibleMinShares)
      ).to.be.revertedWithCustomError(amm, "SlippageExceeded");
    });

    it("multiple buys accumulate ERC-1155 balance", async function () {
      await usdc.connect(trader).approve(await amm.getAddress(), BUY_AMOUNT * 3n);

      const yesTokenId = await outcomeToken.encodeId(marketId, 0);

      await amm.connect(trader).buy(0, BUY_AMOUNT, 0n);
      const balAfter1 = await outcomeToken.balanceOf(trader.address, yesTokenId);

      await amm.connect(trader).buy(0, BUY_AMOUNT, 0n);
      const balAfter2 = await outcomeToken.balanceOf(trader.address, yesTokenId);

      expect(balAfter2).to.be.gt(balAfter1);
    });
  });

  describe("OutcomeToken token IDs", function () {
    it("encodes and decodes (marketId, outcomeIndex) correctly", async function () {
      const id = await outcomeToken.encodeId(0n, 0);
      const [decodedMarketId, decodedOutcome] = await outcomeToken.decodeId(id);
      expect(decodedMarketId).to.equal(0n);
      expect(decodedOutcome).to.equal(0);
    });

    it("YES and NO have different token IDs", async function () {
      const yesId = await outcomeToken.encodeId(0n, 0);
      const noId = await outcomeToken.encodeId(0n, 1);
      expect(yesId).to.not.equal(noId);
    });

    it("different markets have different token IDs for same outcome", async function () {
      const id0 = await outcomeToken.encodeId(0n, 0);
      const id1 = await outcomeToken.encodeId(1n, 0);
      expect(id0).to.not.equal(id1);
    });
  });

  describe("OracleResolver (deployed-not-exercised)", function () {
    it("reports unresolved for the created market", async function () {
      expect(await oracleResolver.isResolved(marketId)).to.be.false;
    });

    it("reverts resolution attempt from non-resolver account", async function () {
      await expect(
        oracleResolver.connect(trader).resolve(marketId, 0, "https://proof.example.com")
      ).to.be.revertedWithCustomError(oracleResolver, "NotResolver");
    });

    it("allows deployer (RESOLVER_ROLE) to resolve", async function () {
      await expect(
        oracleResolver.connect(deployer).resolve(marketId, 0, "https://proof.example.com")
      )
        .to.emit(oracleResolver, "MarketResolved")
        .withArgs(marketId, 0, "https://proof.example.com");

      expect(await oracleResolver.isResolved(marketId)).to.be.true;
    });
  });

  describe("AccessControl", function () {
    it("deployer holds DEFAULT_ADMIN_ROLE on ACL", async function () {
      const role = await acl.DEFAULT_ADMIN_ROLE();
      expect(await acl.hasRole(role, deployer.address)).to.be.true;
    });

    it("factory holds FACTORY_ROLE on ACL", async function () {
      const role = await acl.FACTORY_ROLE();
      expect(await acl.hasRole(role, await factory.getAddress())).to.be.true;
    });

    it("non-factory account cannot createMarket", async function () {
      const closeTime = BigInt(Math.floor(Date.now() / 1000) + 86400);
      await expect(
        factory.connect(trader).createMarket(
          "Unauthorized market",
          ["YES", "NO"],
          closeTime,
          "https://oracle.example.com"
        )
      ).to.be.revertedWithCustomError(factory, "NotFactoryRole");
    });
  });
});
