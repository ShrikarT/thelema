// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDataStreamsVerifier} from "../interfaces/IDataStreamsVerifier.sol";
import {Ownable} from "../lib/Ownable.sol";

/// @title DataStreamsAdapter
/// @notice Pull-oracle adapter for Chainlink Data Streams reports.
/// @dev Verifies off-chain cryptographically signed Data Streams payload via on-chain verifier
///      and extracts normalized 6-decimal micro-USDC spot prices for index settlement.
contract DataStreamsAdapter is Ownable {
    IDataStreamsVerifier public immutable verifier;
    bytes32 public immutable feedId;
    uint8 public immutable reportDecimals;

    struct ReportData {
        bytes32 feedId;
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint192 nativeFee;
        uint192 linkFee;
        uint32 expiresAt;
        int192 benchmarkPrice;
        int192 bid;
        int192 ask;
    }

    event PriceVerified(
        bytes32 indexed feedId,
        uint32 observationTimestamp,
        int192 rawBenchmarkPrice,
        uint256 normalizedPrice6
    );

    error InvalidVerifier();
    error FeedMismatch(bytes32 expected, bytes32 actual);
    error InvalidPrice(int192 rawPrice);
    error ObservationTooEarly(uint32 observed, uint256 minAllowed);

    constructor(
        address owner_,
        address verifier_,
        bytes32 feedId_,
        uint8 reportDecimals_
    ) Ownable(owner_) {
        if (verifier_ == address(0) || verifier_.code.length == 0) revert InvalidVerifier();
        verifier = IDataStreamsVerifier(verifier_);
        feedId = feedId_;
        reportDecimals = reportDecimals_;
    }

    /// @notice Verifies a Chainlink Data Streams signed report payload and decodes the benchmark price
    /// @param payload Cryptographically signed report payload
    /// @param minObservationTimestamp Earliest acceptable observation timestamp
    /// @return price6 The normalized 6-decimal USDC spot price
    /// @return observationTimestamp The timestamp at which the oracle recorded the benchmark price
    function verifyAndExtractPrice(
        bytes calldata payload,
        uint256 minObservationTimestamp
    ) external payable returns (uint256 price6, uint32 observationTimestamp) {
        bytes memory verifierResponse = verifier.verify{value: msg.value}(payload, "");
        ReportData memory report = abi.decode(verifierResponse, (ReportData));

        if (report.feedId != feedId) revert FeedMismatch(feedId, report.feedId);
        if (report.benchmarkPrice <= 0) revert InvalidPrice(report.benchmarkPrice);
        if (report.observationsTimestamp < minObservationTimestamp) {
            revert ObservationTooEarly(report.observationsTimestamp, minObservationTimestamp);
        }

        uint256 rawPrice = uint256(uint192(report.benchmarkPrice));
        if (reportDecimals > 6) {
            price6 = rawPrice / (10 ** (reportDecimals - 6));
        } else if (reportDecimals < 6) {
            price6 = rawPrice * (10 ** (6 - reportDecimals));
        } else {
            price6 = rawPrice;
        }

        observationTimestamp = report.observationsTimestamp;
        emit PriceVerified(feedId, observationTimestamp, report.benchmarkPrice, price6);
    }
}
