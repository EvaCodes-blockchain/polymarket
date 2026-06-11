// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./OutcomeToken.sol";

/// @title MarketAMM
/// @notice Constant-product market maker (CPMM) for a single prediction market.
///         Prices are expressed in collateral units per outcome share.
///
///         Pool holds:
///           q[0]  — YES share reserve
///           q[1]  — NO  share reserve
///           Invariant: q[0] * q[1] = k  (constant product)
///
///         On buy(outcomeIndex, collateralIn):
///           1. A fee (FEE_BPS basis points) is deducted from collateralIn.
///           2. Both reserves are topped-up with collateralIn net of fee
///              (virtual liquidity add: mint equal YES+NO shares).
///           3. The buyer receives shares calculated by the CPMM swap:
///                sharesOut = q[outcomeIndex] - k / (q[1-outcomeIndex] + collateralNetFee)
///              Wait — simplified MVP version below uses the standard form.
///           4. OutcomeToken is minted to the buyer.
///
///         Fee BPS: 200 (2%) — sent to FeeTreasury on each trade.
///         MVP note: Sell flow is not implemented (FR gap §15 item 4).
contract MarketAMM is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 200; // 2%
    uint256 private constant BPS = 10_000;

    IERC20 public immutable collateral;
    OutcomeToken public immutable outcomeToken;
    address public immutable feeTreasury;

    /// @notice marketId this AMM is paired to (set once at construction).
    uint256 public immutable marketId;

    /// Share reserves: reserves[0] = YES, reserves[1] = NO.
    uint256[2] public reserves;

    event Seeded(uint256 yesReserve, uint256 noReserve);
    event Buy(
        address indexed buyer,
        uint8 outcomeIndex,
        uint256 collateralIn,
        uint256 fee,
        uint256 sharesOut
    );

    error AlreadySeeded();
    error NotSeeded();
    error InvalidOutcome();
    error SlippageExceeded();
    error ZeroCollateral();

    bool private _seeded;

    constructor(
        address _collateral,
        address _outcomeToken,
        address _feeTreasury,
        uint256 _marketId
    ) {
        collateral = IERC20(_collateral);
        outcomeToken = OutcomeToken(_outcomeToken);
        feeTreasury = _feeTreasury;
        marketId = _marketId;
    }

    /// @notice Seed the pool with initial liquidity.
    ///         Caller must have approved this contract to spend collateral.
    ///         `yesAmount + noAmount` collateral is escrowed in this contract to
    ///         back future share redemptions.  Reserves are virtual — no ERC-1155
    ///         shares are minted at seed; they are only minted when buyers trade.
    ///         Odds at seed = yesAmount : noAmount (e.g. 600:400 → YES≈40%).
    function seed(uint256 yesAmount, uint256 noAmount) external {
        if (_seeded) revert AlreadySeeded();
        _seeded = true;

        collateral.safeTransferFrom(msg.sender, address(this), yesAmount + noAmount);

        // Virtual reserves: 1 reserve unit = 1 collateral unit of implied liquidity.
        reserves[0] = yesAmount;
        reserves[1] = noAmount;

        emit Seeded(yesAmount, noAmount);
    }

    /// @notice Buy outcome shares for a market.
    /// @param outcomeIndex  0 = YES, 1 = NO.
    /// @param collateralIn  Raw collateral amount (6-decimal USDC units).
    /// @param minSharesOut  Minimum shares to receive (slippage guard); pass 0 to skip.
    /// @return sharesOut    Number of outcome shares received.
    function buy(uint8 outcomeIndex, uint256 collateralIn, uint256 minSharesOut)
        external
        nonReentrant
        returns (uint256 sharesOut)
    {
        if (!_seeded) revert NotSeeded();
        if (outcomeIndex > 1) revert InvalidOutcome();
        if (collateralIn == 0) revert ZeroCollateral();

        // ── 1. Transfer collateral from buyer ────────────────────────────────
        collateral.safeTransferFrom(msg.sender, address(this), collateralIn);

        // ── 2. Deduct fee ──────────────────────────────────────────────────
        uint256 fee = (collateralIn * FEE_BPS) / BPS;
        uint256 netCollateral = collateralIn - fee;

        // ── 3. CPMM swap ───────────────────────────────────────────────────
        //   Intuition: the netCollateral buys shares of the chosen outcome.
        //   Both reserves are increased by netCollateral/2 (virtual add of
        //   equal shares), then we compute how many of the chosen outcome
        //   shares come out to maintain the constant product.
        //
        //   Standard Polymarket-style CPMM:
        //     k = reserves[0] * reserves[1]
        //     new reserve of the OTHER outcome after adding net = old + netCollateral
        //     new reserve of the CHOSEN outcome preserving k:
        //       newChosen = k / (oldOther + netCollateral)
        //     sharesOut = oldChosen - newChosen
        //
        uint8 other = 1 - outcomeIndex;
        uint256 k = reserves[0] * reserves[1];

        uint256 newOtherReserve = reserves[other] + netCollateral;
        uint256 newChosenReserve = k / newOtherReserve;
        sharesOut = reserves[outcomeIndex] - newChosenReserve;

        if (minSharesOut > 0 && sharesOut < minSharesOut) revert SlippageExceeded();

        // ── 4. Update reserves ────────────────────────────────────────────
        reserves[outcomeIndex] = newChosenReserve;
        reserves[other] = newOtherReserve;

        // ── 5. Transfer fee to FeeTreasury ───────────────────────────────
        if (fee > 0) {
            collateral.safeTransfer(feeTreasury, fee);
        }

        // ── 6. Mint outcome shares to buyer ───────────────────────────────
        uint256 tokenId = outcomeToken.encodeId(marketId, outcomeIndex);
        outcomeToken.mint(msg.sender, tokenId, sharesOut);

        emit Buy(msg.sender, outcomeIndex, collateralIn, fee, sharesOut);
    }

    /// @notice Current implied probability of YES in basis points (0–10 000).
    ///         price_yes = noReserve / (yesReserve + noReserve)
    function impliedProbabilityBps(uint8 outcomeIndex) external view returns (uint256) {
        if (outcomeIndex > 1) revert InvalidOutcome();
        uint256 total = reserves[0] + reserves[1];
        if (total == 0) return 0;
        // YES probability = NO reserve / total (standard CPMM pricing)
        // NO  probability = YES reserve / total
        uint8 other = 1 - outcomeIndex;
        return (reserves[other] * BPS) / total;
    }

    /// @notice Check if the pool is seeded.
    function isSeeded() external view returns (bool) {
        return _seeded;
    }
}
