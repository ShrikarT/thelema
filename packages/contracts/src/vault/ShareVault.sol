// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ImpactToken} from "../token/ImpactToken.sol";
import {SafeTransferLib} from "../lib/SafeTransferLib.sol";
import {ReentrancyGuard} from "../lib/ReentrancyGuard.sol";

contract ShareVault is ReentrancyGuard {
    using SafeTransferLib for address;

    uint256 public constant ONE_SHARE_18 = 1e18;

    address public immutable collateral;
    address public immutable oracle;
    uint256 public immutable cap6;
    uint256 public immutable eventDeadline;
    uint256 public immutable tradingCutoff;
    uint256 public immutable earliestPriceFixTime;

    ImpactToken public immutable yesShare;
    ImpactToken public immutable noShare;
    ImpactToken public immutable residualShare;

    enum Lifecycle { OPEN, EVENT_RESOLVED, PRICE_FIXED }
    Lifecycle public lifecycle;

    bool public eventYes;
    uint256 public settlementValue6;
    uint256 public residualValue6;

    uint256 public totalSets18;
    uint256 public totalDeposited6;
    uint256 public totalRefunded6;
    uint256 public totalRedeemed6;
    uint256 public redeemedWinning18;
    uint256 public redeemedResidual18;

    error Unauthorized();
    error InvalidAmount();
    error AlreadySettled();
    error NotSettled();
    error WrongToken();
    error TradingFrozen();
    error EventDeadlineNotPassed();
    error ObservationWindowNotReached();
    error InvalidLifecycle();

    event Split(address indexed caller, address indexed receiver, uint256 pairs18, uint256 collateral6);
    event Merge(address indexed caller, address indexed receiver, uint256 pairs18, uint256 collateral6);
    event EventResolved(bool indexed eventYes);
    event PriceFixed(uint256 publishedValue6, uint256 settlementValue6, uint256 residualValue6);
    event Redeemed(address indexed caller, address indexed receiver, address indexed token, uint256 shares18, uint256 collateral6);

    constructor(
        address collateral_,
        address oracle_,
        uint256 cap6_,
        uint256 eventDeadline_,
        uint256 tradingCutoff_,
        uint256 earliestPriceFixTime_
    ) {
        if (collateral_ == address(0) || oracle_ == address(0) || cap6_ == 0) revert InvalidAmount();
        if (tradingCutoff_ < eventDeadline_ || earliestPriceFixTime_ < tradingCutoff_) revert InvalidAmount();
        (bool ok, bytes memory data) = collateral_.staticcall(abi.encodeWithSelector(0x313ce567));
        if (!ok || data.length != 32 || abi.decode(data, (uint256)) != 6) revert InvalidAmount();

        collateral = collateral_;
        oracle = oracle_;
        cap6 = cap6_;
        eventDeadline = eventDeadline_;
        tradingCutoff = tradingCutoff_;
        earliestPriceFixTime = earliestPriceFixTime_;

        yesShare = new ImpactToken("THELEMA Share YES", "sYES", address(this));
        noShare = new ImpactToken("THELEMA Share NO", "sNO", address(this));
        residualShare = new ImpactToken("THELEMA Share RESIDUAL", "sRES", address(this));
    }

    function collateralForPairs(uint256 pairs18) public view returns (uint256) {
        if (pairs18 == 0) revert InvalidAmount();
        return (pairs18 * cap6 - 1) / ONE_SHARE_18 + 1;
    }

    function isTradingAllowed(address token) external view returns (bool) {
        if (block.timestamp > tradingCutoff) return false;
        if (lifecycle == Lifecycle.PRICE_FIXED) return false;
        if (lifecycle == Lifecycle.EVENT_RESOLVED) {
            return token == (eventYes ? address(yesShare) : address(noShare));
        }
        if (lifecycle == Lifecycle.OPEN) {
            return token == address(yesShare) || token == address(noShare);
        }
        return false;
    }

    function settled() external view returns (bool) {
        return lifecycle == Lifecycle.PRICE_FIXED;
    }

    function residualLocked6() external view returns (uint256) {
        if (lifecycle != Lifecycle.PRICE_FIXED) return 0;
        return (totalSets18 - redeemedResidual18) * residualValue6 / ONE_SHARE_18;
    }

    function remainingLiabilities6() public view returns (uint256) {
        if (lifecycle != Lifecycle.PRICE_FIXED) {
            return totalSets18 * cap6 / ONE_SHARE_18;
        }
        uint256 winningRem = (totalSets18 - redeemedWinning18) * settlementValue6 / ONE_SHARE_18;
        uint256 residualRem = (totalSets18 - redeemedResidual18) * residualValue6 / ONE_SHARE_18;
        return winningRem + residualRem;
    }

    function split(uint256 pairs18, address receiver) external nonReentrant returns (uint256 collateral6) {
        if (lifecycle != Lifecycle.OPEN || block.timestamp > tradingCutoff) revert TradingFrozen();
        if (receiver == address(0) || pairs18 == 0) revert InvalidAmount();
        collateral6 = collateralForPairs(pairs18);
        collateral.safeTransferFrom(msg.sender, address(this), collateral6);
        totalSets18 += pairs18;
        totalDeposited6 += collateral6;
        yesShare.mint(receiver, pairs18);
        noShare.mint(receiver, pairs18);
        residualShare.mint(receiver, pairs18);
        emit Split(msg.sender, receiver, pairs18, collateral6);
    }

    function merge(uint256 pairs18, address receiver) external nonReentrant returns (uint256 collateral6) {
        if (lifecycle != Lifecycle.OPEN || block.timestamp > tradingCutoff) revert TradingFrozen();
        if (receiver == address(0) || pairs18 == 0) revert InvalidAmount();
        collateral6 = pairs18 * cap6 / ONE_SHARE_18;
        yesShare.burn(msg.sender, pairs18);
        noShare.burn(msg.sender, pairs18);
        residualShare.burn(msg.sender, pairs18);
        totalSets18 -= pairs18;
        totalRefunded6 += collateral6;
        if (collateral6 != 0) collateral.safeTransfer(receiver, collateral6);
        emit Merge(msg.sender, receiver, pairs18, collateral6);
    }

    function resolveEvent(bool eventYes_) external {
        if (msg.sender != oracle) revert Unauthorized();
        if (lifecycle != Lifecycle.OPEN) revert AlreadySettled();
        if (!eventYes_ && block.timestamp < eventDeadline) revert EventDeadlineNotPassed();
        eventYes = eventYes_;
        lifecycle = Lifecycle.EVENT_RESOLVED;
        emit EventResolved(eventYes_);
    }

    function fixPrice(uint256 publishedValue6) external {
        if (msg.sender != oracle) revert Unauthorized();
        if (lifecycle != Lifecycle.EVENT_RESOLVED) revert InvalidLifecycle();
        if (block.timestamp < earliestPriceFixTime) revert ObservationWindowNotReached();
        settlementValue6 = publishedValue6 > cap6 ? cap6 : publishedValue6;
        residualValue6 = cap6 - settlementValue6;
        lifecycle = Lifecycle.PRICE_FIXED;
        emit PriceFixed(publishedValue6, settlementValue6, residualValue6);
    }

    function settle(bool eventYes_, uint256 publishedValue6) external {
        if (msg.sender != oracle) revert Unauthorized();
        if (lifecycle != Lifecycle.OPEN) revert AlreadySettled();
        if (!eventYes_ && block.timestamp < eventDeadline) revert EventDeadlineNotPassed();
        if (block.timestamp < earliestPriceFixTime) revert ObservationWindowNotReached();
        eventYes = eventYes_;
        settlementValue6 = publishedValue6 > cap6 ? cap6 : publishedValue6;
        residualValue6 = cap6 - settlementValue6;
        lifecycle = Lifecycle.PRICE_FIXED;
        emit EventResolved(eventYes_);
        emit PriceFixed(publishedValue6, settlementValue6, residualValue6);
    }

    function redeem(address token, uint256 shares18, address receiver) external nonReentrant returns (uint256 collateral6) {
        if (lifecycle != Lifecycle.PRICE_FIXED) revert NotSettled();
        if (shares18 == 0 || receiver == address(0)) revert InvalidAmount();
        uint256 unitPayout6;
        if (token == address(yesShare)) {
            if (!eventYes) revert WrongToken();
            unitPayout6 = settlementValue6;
            redeemedWinning18 += shares18;
        } else if (token == address(noShare)) {
            if (eventYes) revert WrongToken();
            unitPayout6 = settlementValue6;
            redeemedWinning18 += shares18;
        } else if (token == address(residualShare)) {
            unitPayout6 = residualValue6;
            redeemedResidual18 += shares18;
        } else {
            revert WrongToken();
        }
        collateral6 = shares18 * unitPayout6 / ONE_SHARE_18;
        ImpactToken(token).burn(msg.sender, shares18);
        totalRedeemed6 += collateral6;
        if (collateral6 != 0) collateral.safeTransfer(receiver, collateral6);
        emit Redeemed(msg.sender, receiver, token, shares18, collateral6);
    }
}
