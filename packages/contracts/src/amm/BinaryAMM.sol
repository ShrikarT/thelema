// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ImpactToken} from "../token/ImpactToken.sol";
import {BinaryVault} from "../vault/BinaryVault.sol";
import {SafeTransferLib} from "../lib/SafeTransferLib.sol";
import {ReentrancyGuard} from "../lib/ReentrancyGuard.sol";

contract BinaryAMM is ReentrancyGuard {
    using SafeTransferLib for address;
    uint256 public constant BPS = 10_000;
    BinaryVault public immutable vault;
    address public immutable collateral;
    address public immutable yesToken;
    address public immutable noToken;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;
    uint256 public accruedFees6;
    ImpactToken public immutable lpToken;

    // L1: Tracked internal reserves immune to donation skew
    uint256 public reserveYes18;
    uint256 public reserveNo18;

    // L4: Pause-only guardian with no fund-moving powers
    address public guardian;
    bool public paused;

    error InvalidAmount(); error DeadlineExpired(); error Slippage(); error TradingFrozen(); error Unauthorized(); error InvalidFee(); error Paused();
    event LiquidityAdded(address indexed provider, uint256 yes18, uint256 no18, uint256 lp18);
    event LiquidityRemoved(address indexed provider, uint256 yes18, uint256 no18, uint256 lp18);
    event OutcomeBought(address indexed buyer, bool indexed buyYes, uint256 collateralIn6, uint256 fee6, uint256 outcomeOut18);
    event FeesWithdrawn(address indexed recipient, uint256 amount6);
    event Sweep(address indexed token, address indexed to, uint256 amount);
    event PausedSet(bool paused);
    event GuardianUpdated(address indexed newGuardian);

    constructor(BinaryVault vault_, address feeRecipient_, uint256 feeBps_) {
        if (address(vault_) == address(0) || feeRecipient_ == address(0)) revert Unauthorized();
        if (feeBps_ > 1_000) revert InvalidFee();
        vault = vault_; collateral = vault_.collateral(); yesToken = address(vault_.yesToken()); noToken = address(vault_.noToken());
        feeRecipient = feeRecipient_; feeBps = feeBps_; guardian = feeRecipient_;
        lpToken = new ImpactToken("THELEMA Binary LP", "bLP", address(this));
        (bool ok, bytes memory data) = collateral.call(abi.encodeWithSelector(0x095ea7b3, address(vault_), type(uint256).max));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert Unauthorized();
    }

    function setPaused(bool paused_) external {
        if (msg.sender != guardian) revert Unauthorized();
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setGuardian(address newGuardian) external {
        if (msg.sender != guardian) revert Unauthorized();
        if (newGuardian == address(0)) revert Unauthorized();
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function reserves() public view returns (uint256, uint256) {
        return (reserveYes18, reserveNo18);
    }

    function binaryPriceUSDC6(bool priceYes) external view returns (uint256) {
        (uint256 rY, uint256 rN) = reserves();
        uint256 sum = rY + rN; if (sum == 0) return 0;
        return (priceYes ? rN : rY) * 1e6 / sum;
    }

    function quoteBuy(bool buyYes, uint256 collateralIn6) public view returns (uint256 outcomeOut18, uint256 fee6) {
        if (collateralIn6 == 0) revert InvalidAmount();
        (uint256 rY, uint256 rN) = reserves(); if (rY == 0 || rN == 0) revert InvalidAmount();
        fee6 = collateralIn6 * feeBps / BPS;
        uint256 minted = (collateralIn6 - fee6) * 1e12;
        uint256 other = buyYes ? rN : rY;
        uint256 selected = buyYes ? rY : rN;
        uint256 newOther = other + minted;
        uint256 newSelected = _ceilDiv(selected * other, newOther);
        outcomeOut18 = selected + minted - newSelected;
    }

    function buyOutcome(bool buyYes, uint256 collateralIn6, uint256 minOutcomeOut18, uint256 deadline) external nonReentrant returns (uint256 outcomeOut18) {
        if (paused) revert Paused();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (!vault.isTradingAllowed()) revert TradingFrozen();
        uint256 fee6; (outcomeOut18, fee6) = quoteBuy(buyYes, collateralIn6);
        if (outcomeOut18 == 0 || minOutcomeOut18 == 0 || outcomeOut18 < minOutcomeOut18) revert Slippage();
        collateral.safeTransferFrom(msg.sender, address(this), collateralIn6);
        uint256 net6 = collateralIn6 - fee6;
        accruedFees6 += fee6;
        vault.split(net6, address(this));
        uint256 minted = net6 * 1e12;
        if (buyYes) {
            reserveNo18 += minted;
            reserveYes18 = reserveYes18 + minted - outcomeOut18;
        } else {
            reserveYes18 += minted;
            reserveNo18 = reserveNo18 + minted - outcomeOut18;
        }
        (buyYes ? yesToken : noToken).safeTransfer(msg.sender, outcomeOut18);
        emit OutcomeBought(msg.sender, buyYes, collateralIn6, fee6, outcomeOut18);
    }

    function addLiquidity(uint256 maxYes18, uint256 maxNo18, uint256 minLp18, uint256 deadline) external nonReentrant returns (uint256 yesIn18, uint256 noIn18, uint256 lpOut18) {
        if (paused) revert Paused();
        if (block.timestamp > deadline) revert DeadlineExpired(); if (!vault.isTradingAllowed()) revert TradingFrozen();
        (uint256 rY, uint256 rN) = reserves(); uint256 supply = lpToken.totalSupply();
        if (supply == 0) {
            if (maxYes18 == 0 || maxYes18 != maxNo18) revert InvalidAmount();
            yesIn18 = maxYes18; noIn18 = maxNo18; lpOut18 = maxYes18;
            reserveYes18 = yesIn18; reserveNo18 = noIn18;
        } else {
            lpOut18 = _min(maxYes18 * supply / rY, maxNo18 * supply / rN);
            if (lpOut18 == 0) revert InvalidAmount();
            yesIn18 = _ceilDiv(lpOut18 * rY, supply);
            noIn18 = _ceilDiv(lpOut18 * rN, supply);
            reserveYes18 += yesIn18;
            reserveNo18 += noIn18;
        }
        if (lpOut18 < minLp18) revert Slippage();
        yesToken.safeTransferFrom(msg.sender, address(this), yesIn18);
        noToken.safeTransferFrom(msg.sender, address(this), noIn18);
        lpToken.mint(msg.sender, lpOut18);
        emit LiquidityAdded(msg.sender, yesIn18, noIn18, lpOut18);
    }

    function removeLiquidity(uint256 lpIn18, uint256 minYes18, uint256 minNo18, uint256 deadline) external nonReentrant returns (uint256 yesOut18, uint256 noOut18) {
        if (block.timestamp > deadline) revert DeadlineExpired(); if (lpIn18 == 0) revert InvalidAmount();
        (uint256 rY, uint256 rN) = reserves(); uint256 supply = lpToken.totalSupply();
        yesOut18 = rY * lpIn18 / supply; noOut18 = rN * lpIn18 / supply;
        if (yesOut18 < minYes18 || noOut18 < minNo18) revert Slippage();
        reserveYes18 -= yesOut18;
        reserveNo18 -= noOut18;
        lpToken.burn(msg.sender, lpIn18);
        yesToken.safeTransfer(msg.sender, yesOut18); noToken.safeTransfer(msg.sender, noOut18);
        emit LiquidityRemoved(msg.sender, yesOut18, noOut18, lpIn18);
    }

    function withdrawFees() external nonReentrant returns (uint256 amount6) {
        if (msg.sender != feeRecipient) revert Unauthorized();
        amount6 = accruedFees6; accruedFees6 = 0;
        collateral.safeTransfer(feeRecipient, amount6);
        emit FeesWithdrawn(feeRecipient, amount6);
    }

    function sweep(address token, address to) external nonReentrant returns (uint256 amount) {
        if (msg.sender != feeRecipient) revert Unauthorized();
        if (to == address(0)) revert Unauthorized();
        if (token == collateral) {
            (bool ok, bytes memory d) = collateral.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
            if (!ok || d.length < 32) revert InvalidAmount();
            uint256 bal = abi.decode(d, (uint256));
            if (bal > accruedFees6) {
                amount = bal - accruedFees6;
                collateral.safeTransfer(to, amount);
            }
        } else if (token == yesToken) {
            uint256 bal = ImpactToken(yesToken).balanceOf(address(this));
            if (bal > reserveYes18) {
                amount = bal - reserveYes18;
                yesToken.safeTransfer(to, amount);
            }
        } else if (token == noToken) {
            uint256 bal = ImpactToken(noToken).balanceOf(address(this));
            if (bal > reserveNo18) {
                amount = bal - reserveNo18;
                noToken.safeTransfer(to, amount);
            }
        } else {
            (bool ok, bytes memory d) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
            if (ok && d.length >= 32) {
                amount = abi.decode(d, (uint256));
                if (amount > 0) token.safeTransfer(to, amount);
            }
        }
        emit Sweep(token, to, amount);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) { return a == 0 ? 0 : (a - 1) / b + 1; }
    function _min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
}
