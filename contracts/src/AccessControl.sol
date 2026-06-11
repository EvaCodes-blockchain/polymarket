// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title JustifyAccessControl
/// @notice Role registry for the PolyMarket Social platform.
///         - DEFAULT_ADMIN_ROLE: deployer; can grant/revoke all roles.
///         - FACTORY_ROLE: accounts that may call MarketFactory.createMarket().
///         - RESOLVER_ROLE: accounts that may resolve a market via OracleResolver.
///         - TREASURY_ROLE: accounts that may withdraw fees from FeeTreasury.
contract JustifyAccessControl is AccessControl {
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FACTORY_ROLE, admin);
        _grantRole(RESOLVER_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
    }
}
