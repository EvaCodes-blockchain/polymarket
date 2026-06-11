// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AccessControl.sol";

/// @title OracleResolver
/// @notice Records oracle-proof references for each market and allows a
///         trusted resolver (RESOLVER_ROLE) to report the winning outcome.
///         Deployed but NOT exercised by the MVP buy flow — resolution is a
///         later interaction (see functional-requirements.md §15).
contract OracleResolver {
    JustifyAccessControl public immutable acl;

    struct Resolution {
        bool resolved;
        uint8 winningOutcome; // 0 = YES, 1 = NO
        string oracleProofUrl;
    }

    /// marketId => Resolution
    mapping(uint256 => Resolution) public resolutions;

    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome, string oracleProofUrl);

    error NotResolver();
    error AlreadyResolved();

    constructor(address _acl) {
        acl = JustifyAccessControl(_acl);
    }

    /// @notice Set the oracle-proof URL for `marketId` and record the winning outcome.
    function resolve(uint256 marketId, uint8 winningOutcome, string calldata oracleProofUrl)
        external
    {
        if (!acl.hasRole(acl.RESOLVER_ROLE(), msg.sender)) revert NotResolver();
        if (resolutions[marketId].resolved) revert AlreadyResolved();

        resolutions[marketId] = Resolution({
            resolved: true,
            winningOutcome: winningOutcome,
            oracleProofUrl: oracleProofUrl
        });

        emit MarketResolved(marketId, winningOutcome, oracleProofUrl);
    }

    /// @notice Returns true when a market has been resolved.
    function isResolved(uint256 marketId) external view returns (bool) {
        return resolutions[marketId].resolved;
    }
}
