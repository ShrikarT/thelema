// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "./lib/Ownable.sol";

interface IBinarySettle { function settle(bool eventYes) external; }
interface IShareSettle { function settle(bool eventYes, uint256 settlementValue6) external; }

contract DemoOracle is Ownable {
    uint256 public constant TIMELOCK_DELAY = 24 hours;

    IBinarySettle public immutable binaryVault;
    IShareSettle public immutable shareVault;

    address public disputeGuardian;

    bool public eventResolved;
    bool public priceFixed;
    bool public eventYes;
    uint256 public settlementValue6;

    struct PendingSettlement {
        bool queued;
        bool eventYes;
        uint256 settlementValue6;
        uint256 executeAfter;
    }
    PendingSettlement public pendingSettlement;

    error AlreadyPublished();
    error TimelockNotExpired();
    error NoPendingSettlement();
    error SettlementAlreadyQueued();
    error DirectResolutionDisabled();
    error NotAContract();
    error InvalidSettlementParams();

    event EventOutcomePublished(bool indexed eventYes);
    event SettlementPricePublished(uint256 settlementValue6);
    event SettlementQueued(bool indexed eventYes, uint256 settlementValue6, uint256 executeAfter);
    event SettlementCancelled();
    event DisputeGuardianUpdated(address indexed guardian);

    constructor(address owner_, address binaryVault_, address shareVault_) Ownable(owner_) {
        if (binaryVault_ == address(0) || shareVault_ == address(0)) revert ZeroAddress();
        if (binaryVault_.code.length == 0 || shareVault_.code.length == 0) revert NotAContract();
        binaryVault = IBinarySettle(binaryVault_);
        shareVault = IShareSettle(shareVault_);
    }

    function setDisputeGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        disputeGuardian = guardian_;
        emit DisputeGuardianUpdated(guardian_);
    }

    function isSettlementPending() external view returns (bool) {
        return pendingSettlement.queued;
    }

    function queueSettlement(bool eventYes_, uint256 settlementValue6_) external onlyOwner {
        if (eventResolved || priceFixed) revert AlreadyPublished();
        if (pendingSettlement.queued) revert SettlementAlreadyQueued();

        uint256 executeAfter = block.timestamp + TIMELOCK_DELAY;
        pendingSettlement = PendingSettlement({
            queued: true,
            eventYes: eventYes_,
            settlementValue6: settlementValue6_,
            executeAfter: executeAfter
        });
        emit SettlementQueued(eventYes_, settlementValue6_, executeAfter);
    }

    function cancelSettlement() external {
        if (msg.sender != owner && msg.sender != disputeGuardian) revert Unauthorized();
        if (!pendingSettlement.queued) revert NoPendingSettlement();
        delete pendingSettlement;
        emit SettlementCancelled();
    }

    function executeSettlement() external onlyOwner {
        if (!pendingSettlement.queued) revert NoPendingSettlement();
        if (block.timestamp < pendingSettlement.executeAfter) revert TimelockNotExpired();

        bool outcome = pendingSettlement.eventYes;
        uint256 val6 = pendingSettlement.settlementValue6;
        delete pendingSettlement;
        _settle(outcome, val6);
    }

    function publishAndSettle(bool eventYes_, uint256 settlementValue6_) external onlyOwner {
        if (!pendingSettlement.queued) revert NoPendingSettlement();
        if (block.timestamp < pendingSettlement.executeAfter) revert TimelockNotExpired();
        if (pendingSettlement.eventYes != eventYes_ || pendingSettlement.settlementValue6 != settlementValue6_) {
            revert InvalidSettlementParams();
        }

        delete pendingSettlement;
        _settle(eventYes_, settlementValue6_);
    }

    function resolveEvent(bool) external pure {
        revert DirectResolutionDisabled();
    }

    function fixPrice(uint256) external pure {
        revert DirectResolutionDisabled();
    }

    function _settle(bool eventYes_, uint256 settlementValue6_) internal {
        if (eventResolved || priceFixed) revert AlreadyPublished();
        eventResolved = true;
        priceFixed = true;
        eventYes = eventYes_;
        settlementValue6 = settlementValue6_;

        binaryVault.settle(eventYes_);
        shareVault.settle(eventYes_, settlementValue6_);

        emit EventOutcomePublished(eventYes_);
        emit SettlementPricePublished(settlementValue6_);
    }

    function published() external view returns (bool) {
        return priceFixed;
    }
}
