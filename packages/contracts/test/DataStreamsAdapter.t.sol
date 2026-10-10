// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDataStreamsVerifier} from "../src/interfaces/IDataStreamsVerifier.sol";
import {DataStreamsAdapter} from "../src/oracle/DataStreamsAdapter.sol";

contract MockDataStreamsVerifier is IDataStreamsVerifier {
    bytes public returnData;
    bool public shouldRevert;

    function setReturnData(bytes memory data) external {
        returnData = data;
    }

    function setShouldRevert(bool revert_) external {
        shouldRevert = revert_;
    }

    function verify(bytes calldata, bytes calldata) external payable override returns (bytes memory) {
        if (shouldRevert) revert("VERIFICATION_FAILED");
        return returnData;
    }
}

contract DataStreamsAdapterTest {
    MockDataStreamsVerifier internal verifier;
    DataStreamsAdapter internal adapter;
    bytes32 internal constant FEED_ID = keccak256("THELEMA_DATA_STREAMS_FEED_ID");

    function setUp() public {
        verifier = new MockDataStreamsVerifier();
        adapter = new DataStreamsAdapter(
            address(this),
            address(verifier),
            FEED_ID,
            8 // 8 decimals standard for USD crypto pairs
        );
    }

    function test_VerifyAndExtractPrice_Success() public {
        // Price = $250.50 with 8 decimals = 25050000000
        DataStreamsAdapter.ReportData memory report = DataStreamsAdapter.ReportData({
            feedId: FEED_ID,
            validFromTimestamp: 1000,
            observationsTimestamp: 2000,
            nativeFee: 0,
            linkFee: 0,
            expiresAt: 3000,
            benchmarkPrice: 25050000000, // $250.50
            bid: 25040000000,
            ask: 25060000000
        });

        verifier.setReturnData(abi.encode(report));

        (uint256 price6, uint32 obsTime) = adapter.verifyAndExtractPrice("", 1500);

        // Normalized to 6 decimals: 25050000000 / 100 = 250500000 ($250.50)
        assert(price6 == 250500000);
        assert(obsTime == 2000);
    }

    function test_VerifyAndExtractPrice_RevertsOnFeedMismatch() public {
        bytes32 wrongFeed = keccak256("WRONG_FEED_ID");
        DataStreamsAdapter.ReportData memory report = DataStreamsAdapter.ReportData({
            feedId: wrongFeed,
            validFromTimestamp: 1000,
            observationsTimestamp: 2000,
            nativeFee: 0,
            linkFee: 0,
            expiresAt: 3000,
            benchmarkPrice: 25000000000,
            bid: 25000000000,
            ask: 25000000000
        });

        verifier.setReturnData(abi.encode(report));

        try adapter.verifyAndExtractPrice("", 1500) {
            revert("Expected revert on feed mismatch");
        } catch {}
    }

    function test_VerifyAndExtractPrice_RevertsOnTooEarlyObservation() public {
        DataStreamsAdapter.ReportData memory report = DataStreamsAdapter.ReportData({
            feedId: FEED_ID,
            validFromTimestamp: 1000,
            observationsTimestamp: 1400, // earlier than minAllowed 1500
            nativeFee: 0,
            linkFee: 0,
            expiresAt: 3000,
            benchmarkPrice: 25000000000,
            bid: 25000000000,
            ask: 25000000000
        });

        verifier.setReturnData(abi.encode(report));

        try adapter.verifyAndExtractPrice("", 1500) {
            revert("Expected revert on early observation");
        } catch {}
    }

    function test_VerifyAndExtractPrice_RevertsOnNonPositivePrice() public {
        DataStreamsAdapter.ReportData memory report = DataStreamsAdapter.ReportData({
            feedId: FEED_ID,
            validFromTimestamp: 1000,
            observationsTimestamp: 2000,
            nativeFee: 0,
            linkFee: 0,
            expiresAt: 3000,
            benchmarkPrice: 0, // non-positive
            bid: 0,
            ask: 0
        });

        verifier.setReturnData(abi.encode(report));

        try adapter.verifyAndExtractPrice("", 1500) {
            revert("Expected revert on non-positive price");
        } catch {}
    }
}
