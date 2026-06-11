// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PredictionMarket
/// @notice Holds the metadata for a single prediction market.
///         State machine: Open → Closed → Resolved.
///
///         In the MVP the buy flow goes through MarketAMM, not through this
///         contract directly.  PredictionMarket is the source of truth for
///         the market question, close time, and settlement state.
contract PredictionMarket {
    enum State { Open, Closed, Resolved }

    struct MarketInfo {
        uint256 id;
        string question;
        string[2] outcomeLabels; // e.g. ["YES","NO"] or ["Barcelona","Real Madrid"]
        uint256 closeTime;       // unix seconds; 0 = no fixed close time
        State state;
        uint8 winningOutcome;    // set on resolution; 0 or 1
        address creator;
        string oracleProofUrl;
    }

    MarketInfo public info;

    event MarketClosed(uint256 indexed marketId);
    event MarketResolved(uint256 indexed marketId, uint8 winningOutcome);

    error NotCreator();
    error WrongState(State current, State required);
    error InvalidOutcome();
    error CloseTimeInPast();

    modifier onlyCreator() {
        if (msg.sender != info.creator) revert NotCreator();
        _;
    }

    modifier inState(State required) {
        if (info.state != required) revert WrongState(info.state, required);
        _;
    }

    constructor(
        uint256 id,
        string memory question,
        string[2] memory outcomeLabels,
        uint256 closeTime,
        address creator,
        string memory oracleProofUrl
    ) {
        if (closeTime != 0 && closeTime <= block.timestamp) revert CloseTimeInPast();

        info = MarketInfo({
            id: id,
            question: question,
            outcomeLabels: outcomeLabels,
            closeTime: closeTime,
            state: State.Open,
            winningOutcome: 0,
            creator: creator,
            oracleProofUrl: oracleProofUrl
        });
    }

    /// @notice Close the market (no more trading).  Only the creator may do this.
    function close() external onlyCreator inState(State.Open) {
        info.state = State.Closed;
        emit MarketClosed(info.id);
    }

    /// @notice Resolve with the winning outcome.  Only the creator may do this.
    function resolve(uint8 winningOutcome) external onlyCreator inState(State.Closed) {
        if (winningOutcome > 1) revert InvalidOutcome();
        info.winningOutcome = winningOutcome;
        info.state = State.Resolved;
        emit MarketResolved(info.id, winningOutcome);
    }

    /// @notice Convenience: market state enum as uint8.
    function state() external view returns (uint8) {
        return uint8(info.state);
    }

    /// @notice Outcome label for index 0 or 1.
    function outcomeLabel(uint8 index) external view returns (string memory) {
        if (index > 1) revert InvalidOutcome();
        return info.outcomeLabels[index];
    }
}
