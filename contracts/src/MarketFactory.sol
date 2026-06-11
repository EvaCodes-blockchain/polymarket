// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AccessControl.sol";
import "./PredictionMarket.sol";
import "./MarketAMM.sol";
import "./OutcomeToken.sol";

/// @title MarketFactory
/// @notice Registry and deployer of (PredictionMarket, MarketAMM) pairs.
///         Only accounts with FACTORY_ROLE on the ACL may create markets.
///
///         Each call to createMarket():
///           1. Deploys a new PredictionMarket contract.
///           2. Deploys a paired MarketAMM contract.
///           3. Records both in the registry.
///           4. Emits MarketCreated.
///
///         The deploy caller is responsible for seeding the AMM via
///         MarketAMM.seed() after creation.
contract MarketFactory {
    JustifyAccessControl public immutable acl;
    OutcomeToken public immutable outcomeToken;
    address public immutable collateral;
    address public immutable feeTreasury;

    uint256 private _nextMarketId;

    struct MarketRecord {
        uint256 id;
        address market;
        address amm;
    }

    /// marketId => record
    mapping(uint256 => MarketRecord) public markets;
    uint256[] public marketIds;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed market,
        address indexed amm,
        string question
    );

    error NotFactoryRole();

    constructor(
        address _acl,
        address _outcomeToken,
        address _collateral,
        address _feeTreasury
    ) {
        acl = JustifyAccessControl(_acl);
        outcomeToken = OutcomeToken(_outcomeToken);
        collateral = _collateral;
        feeTreasury = _feeTreasury;
    }

    /// @notice Deploy a new PredictionMarket + MarketAMM pair.
    /// @param question        The market question, e.g. "Will El Clásico go to Barcelona?".
    /// @param outcomeLabels   Two outcome names, e.g. ["Barcelona","Real Madrid"].
    /// @param closeTime       Unix timestamp when trading closes; 0 = no fixed close.
    /// @param oracleProofUrl  URL to the oracle source for resolution.
    /// @return marketId       Auto-incremented ID, starting at 0.
    function createMarket(
        string calldata question,
        string[2] calldata outcomeLabels,
        uint256 closeTime,
        string calldata oracleProofUrl
    ) external returns (uint256 marketId) {
        if (!acl.hasRole(acl.FACTORY_ROLE(), msg.sender)) revert NotFactoryRole();

        marketId = _nextMarketId++;

        // Deploy PredictionMarket
        PredictionMarket market = new PredictionMarket(
            marketId,
            question,
            outcomeLabels,
            closeTime,
            msg.sender,
            oracleProofUrl
        );

        // Deploy MarketAMM
        MarketAMM amm = new MarketAMM(
            collateral,
            address(outcomeToken),
            feeTreasury,
            marketId
        );

        // Grant MINTER_ROLE to the new AMM so it can mint outcome shares.
        outcomeToken.grantRole(outcomeToken.MINTER_ROLE(), address(amm));

        markets[marketId] = MarketRecord({
            id: marketId,
            market: address(market),
            amm: address(amm)
        });
        marketIds.push(marketId);

        emit MarketCreated(marketId, address(market), address(amm), question);
    }

    /// @notice Total number of markets created.
    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    /// @notice Convenience: get both contract addresses for a market.
    function getMarket(uint256 marketId)
        external
        view
        returns (address market, address amm)
    {
        MarketRecord storage rec = markets[marketId];
        return (rec.market, rec.amm);
    }
}
