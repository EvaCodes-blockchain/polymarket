// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title OutcomeToken
/// @notice ERC-1155 representing conditional outcome shares.
///         Token IDs encode a market + outcome:
///           id = (marketId << 1) | outcomeIndex
///           outcomeIndex 0 = YES, 1 = NO
///
///         MINTER_ROLE is granted to each MarketAMM by MarketFactory at
///         deploy time, allowing multiple AMMs to mint independently.
///         The factory (admin) holds DEFAULT_ADMIN_ROLE and MINTER_ROLE.
contract OutcomeToken is ERC1155, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Emitted when shares are minted to a trader.
    event SharesMinted(address indexed to, uint256 indexed id, uint256 amount);
    /// @notice Emitted when shares are burned (redemption / settlement).
    event SharesBurned(address indexed from, uint256 indexed id, uint256 amount);

    constructor(address admin) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    /// @inheritdoc ERC1155
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Mint `amount` shares of token `id` to `to`.
    ///         Requires MINTER_ROLE.
    function mint(address to, uint256 id, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, id, amount, "");
        emit SharesMinted(to, id, amount);
    }

    /// @notice Burn `amount` shares of token `id` from `from`.
    ///         Requires MINTER_ROLE.
    function burn(address from, uint256 id, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, id, amount);
        emit SharesBurned(from, id, amount);
    }

    /// @notice Helper: encode a (marketId, outcomeIndex) pair into a token ID.
    function encodeId(uint256 marketId, uint8 outcomeIndex) public pure returns (uint256) {
        return (marketId << 1) | uint256(outcomeIndex);
    }

    /// @notice Helper: decode a token ID into (marketId, outcomeIndex).
    function decodeId(uint256 id) public pure returns (uint256 marketId, uint8 outcomeIndex) {
        marketId = id >> 1;
        outcomeIndex = uint8(id & 1);
    }
}
