// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./AccessControl.sol";

/// @title FeeTreasury
/// @notice Collects trading fees from MarketAMM and allows a privileged
///         account (TREASURY_ROLE) to withdraw them.
///         Deployed but fee withdrawal is NOT exercised in the MVP buy flow.
contract FeeTreasury {
    using SafeERC20 for IERC20;

    JustifyAccessControl public immutable acl;
    IERC20 public immutable collateral;

    event FeesReceived(address indexed from, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error NotTreasuryRole();
    error ZeroAmount();

    constructor(address _acl, address _collateral) {
        acl = JustifyAccessControl(_acl);
        collateral = IERC20(_collateral);
    }

    /// @notice Receive fee tokens transferred from MarketAMM.
    ///         Caller must have approved this contract or transfer directly.
    function receiveFeesFrom(address from, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        collateral.safeTransferFrom(from, address(this), amount);
        emit FeesReceived(from, amount);
    }

    /// @notice Withdraw accumulated fees to `to`. Requires TREASURY_ROLE.
    function withdraw(address to, uint256 amount) external {
        if (!acl.hasRole(acl.TREASURY_ROLE(), msg.sender)) revert NotTreasuryRole();
        if (amount == 0) revert ZeroAmount();
        collateral.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    /// @notice View current fee balance held by this contract.
    function balance() external view returns (uint256) {
        return collateral.balanceOf(address(this));
    }
}
