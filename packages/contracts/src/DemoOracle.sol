// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "./lib/Ownable.sol";

interface IBinarySettle { function settle(bool eventYes) external; }
interface IShareSettle {
    function resolveEvent(bool eventYes) external;
    function fixPrice(uint256 settlementValue6) external;
    function settle(bool eventYes, uint256 settlementValue6) external;
}

contract DemoOracle is Ownable {
    bool public eventResolved;
    bool public priceFixed;
    bool public eventYes;
    uint256 public settlementValue6;

    error AlreadyPublished();
    error InvalidOrder();
    event EventOutcomePublished(bool indexed eventYes);
    event SettlementPricePublished(uint256 settlementValue6);

    constructor(address owner_) Ownable(owner_) {}

    function resolveEvent(address binaryVault, address shareVault, bool eventYes_) external onlyOwner {
        if (eventResolved) revert AlreadyPublished();
        if (binaryVault == address(0) || shareVault == address(0)) revert ZeroAddress();
        eventResolved = true;
        eventYes = eventYes_;
        IBinarySettle(binaryVault).settle(eventYes_);
        IShareSettle(shareVault).resolveEvent(eventYes_);
        emit EventOutcomePublished(eventYes_);
    }

    function fixPrice(address shareVault, uint256 settlementValue6_) external onlyOwner {
        if (!eventResolved) revert InvalidOrder();
        if (priceFixed) revert AlreadyPublished();
        if (shareVault == address(0)) revert ZeroAddress();
        priceFixed = true;
        settlementValue6 = settlementValue6_;
        IShareSettle(shareVault).fixPrice(settlementValue6_);
        emit SettlementPricePublished(settlementValue6_);
    }

    function publishAndSettle(address binaryVault, address shareVault, bool eventYes_, uint256 settlementValue6_) external onlyOwner {
        if (eventResolved || priceFixed) revert AlreadyPublished();
        if (binaryVault == address(0) || shareVault == address(0)) revert ZeroAddress();
        eventResolved = true;
        priceFixed = true;
        eventYes = eventYes_;
        settlementValue6 = settlementValue6_;
        IBinarySettle(binaryVault).settle(eventYes_);
        IShareSettle(shareVault).settle(eventYes_, settlementValue6_);
        emit EventOutcomePublished(eventYes_);
        emit SettlementPricePublished(settlementValue6_);
    }

    function published() external view returns (bool) {
        return priceFixed;
    }
}
