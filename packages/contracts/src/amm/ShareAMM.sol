// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ImpactToken} from "../token/ImpactToken.sol";
import {SafeTransferLib} from "../lib/SafeTransferLib.sol";
import {ReentrancyGuard} from "../lib/ReentrancyGuard.sol";

interface IShareVault { function isTradingAllowed(address token) external view returns (bool); }

contract ShareAMM is ReentrancyGuard {
    using SafeTransferLib for address;
    uint256 public constant BPS = 10_000;
    address public immutable stable;
    address public immutable shareToken;
    address public immutable settlementVault;
    uint256 public immutable feeBps;
    ImpactToken public immutable lpToken;

    // L1: Tracked internal reserves immune to donation skew
    uint256 public reserveStable6;
    uint256 public reserveShares18;

    // L4: Pause-only guardian with no fund-moving powers
    address public guardian;
    bool public paused;

    error InvalidAmount(); error DeadlineExpired(); error Slippage(); error TradingFrozen(); error InvalidFee(); error Paused(); error Unauthorized();
    event LiquidityAdded(address indexed provider, uint256 stable6, uint256 shares18, uint256 lp18);
    event LiquidityRemoved(address indexed provider, uint256 stable6, uint256 shares18, uint256 lp18);
    event SharesBought(address indexed buyer, uint256 stableIn6, uint256 fee6, uint256 sharesOut18);
    event SharesSold(address indexed seller, uint256 sharesIn18, uint256 feeShares18, uint256 stableOut6);
    event Sweep(address indexed token, address indexed to, uint256 amount);
    event PausedSet(bool paused);
    event GuardianUpdated(address indexed newGuardian);

    constructor(address stable_, address shareToken_, address settlementVault_, uint256 feeBps_, string memory lpSymbol) {
        if(stable_ == address(0) || shareToken_ == address(0) || settlementVault_ == address(0)) revert InvalidAmount();
        if(feeBps_ > 1_000) revert InvalidFee();
        stable = stable_; shareToken = shareToken_; settlementVault = settlementVault_; feeBps = feeBps_; guardian = msg.sender;
        lpToken = new ImpactToken("THELEMA Share LP", lpSymbol, address(this));
    }

    function setPaused(bool paused_) external {
        if(msg.sender != guardian) revert Unauthorized();
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setGuardian(address newGuardian) external {
        if(msg.sender != guardian) revert Unauthorized();
        if(newGuardian == address(0)) revert Unauthorized();
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function reserves() public view returns (uint256 stableReserve6, uint256 tokenReserve18) {
        return (reserveStable6, reserveShares18);
    }

    function sharePriceUSDC6() external view returns (uint256) {
        (uint256 s, uint256 t) = reserves();
        return t == 0 ? 0 : s * 1e18 / t;
    }

    function quoteBuyShares(uint256 stableIn6) public view returns (uint256 sharesOut18, uint256 fee6) {
        if(stableIn6 == 0) revert InvalidAmount();
        (uint256 s, uint256 t) = reserves();
        if(s == 0 || t == 0) revert InvalidAmount();
        fee6 = stableIn6 * feeBps / BPS;
        uint256 net = stableIn6 - fee6;
        sharesOut18 = t * net / (s + net);
    }

    function quoteSellShares(uint256 sharesIn18) public view returns (uint256 stableOut6, uint256 feeShares18) {
        if(sharesIn18 == 0) revert InvalidAmount();
        (uint256 s, uint256 t) = reserves();
        if(s == 0 || t == 0) revert InvalidAmount();
        feeShares18 = sharesIn18 * feeBps / BPS;
        uint256 net = sharesIn18 - feeShares18;
        stableOut6 = s * net / (t + net);
    }

    function buyShares(uint256 stableIn6, uint256 minSharesOut18, uint256 deadline) external nonReentrant returns (uint256 sharesOut18) {
        if(paused) revert Paused();
        _active(deadline);
        uint256 fee6;
        (sharesOut18, fee6) = quoteBuyShares(stableIn6);
        if(sharesOut18 == 0 || minSharesOut18 == 0 || sharesOut18 < minSharesOut18) revert Slippage();
        reserveStable6 += stableIn6;
        reserveShares18 -= sharesOut18;
        stable.safeTransferFrom(msg.sender, address(this), stableIn6);
        shareToken.safeTransfer(msg.sender, sharesOut18);
        emit SharesBought(msg.sender, stableIn6, fee6, sharesOut18);
    }

    function sellShares(uint256 sharesIn18, uint256 minStableOut6, uint256 deadline) external nonReentrant returns (uint256 stableOut6) {
        if(paused) revert Paused();
        _active(deadline);
        uint256 fee18;
        (stableOut6, fee18) = quoteSellShares(sharesIn18);
        if(stableOut6 == 0 || minStableOut6 == 0 || stableOut6 < minStableOut6) revert Slippage();
        reserveShares18 += sharesIn18;
        reserveStable6 -= stableOut6;
        shareToken.safeTransferFrom(msg.sender, address(this), sharesIn18);
        stable.safeTransfer(msg.sender, stableOut6);
        emit SharesSold(msg.sender, sharesIn18, fee18, stableOut6);
    }

    function addLiquidity(uint256 maxStable6, uint256 maxShares18, uint256 minLp18, uint256 deadline) external nonReentrant returns (uint256 lpOut18) {
        if(paused) revert Paused();
        _active(deadline);
        if(maxStable6 == 0 || maxShares18 == 0) revert InvalidAmount();
        (uint256 s, uint256 t) = reserves();
        uint256 supply = lpToken.totalSupply();
        uint256 stableUsed6;
        uint256 sharesUsed18;
        if(supply == 0){
            stableUsed6 = maxStable6;
            sharesUsed18 = maxShares18;
            lpOut18 = _sqrt(maxStable6 * 1e12 * maxShares18);
            reserveStable6 = stableUsed6;
            reserveShares18 = sharesUsed18;
        } else {
            lpOut18 = _min(maxStable6 * supply / s, maxShares18 * supply / t);
            if(lpOut18 != 0){
                stableUsed6 = _ceilDiv(lpOut18 * s, supply);
                sharesUsed18 = _ceilDiv(lpOut18 * t, supply);
                reserveStable6 += stableUsed6;
                reserveShares18 += sharesUsed18;
            }
        }
        if(lpOut18 == 0 || lpOut18 < minLp18) revert Slippage();
        stable.safeTransferFrom(msg.sender, address(this), stableUsed6);
        shareToken.safeTransferFrom(msg.sender, address(this), sharesUsed18);
        lpToken.mint(msg.sender, lpOut18);
        emit LiquidityAdded(msg.sender, stableUsed6, sharesUsed18, lpOut18);
    }

    function removeLiquidity(uint256 lpIn18, uint256 minStable6, uint256 minShares18, uint256 deadline) external nonReentrant returns (uint256 stableOut6, uint256 sharesOut18) {
        if(block.timestamp > deadline) revert DeadlineExpired();
        if(lpIn18 == 0) revert InvalidAmount();
        (uint256 s, uint256 t) = reserves();
        uint256 supply = lpToken.totalSupply();
        stableOut6 = s * lpIn18 / supply;
        sharesOut18 = t * lpIn18 / supply;
        if(stableOut6 < minStable6 || sharesOut18 < minShares18) revert Slippage();
        reserveStable6 -= stableOut6;
        reserveShares18 -= sharesOut18;
        lpToken.burn(msg.sender, lpIn18);
        stable.safeTransfer(msg.sender, stableOut6);
        shareToken.safeTransfer(msg.sender, sharesOut18);
        emit LiquidityRemoved(msg.sender, stableOut6, sharesOut18, lpIn18);
    }

    function sweep(address token, address to) external nonReentrant returns (uint256 amount) {
        if(msg.sender != guardian) revert Unauthorized();
        if(to == address(0)) revert Unauthorized();
        if (token == stable) {
            uint256 bal = _balance(stable);
            if (bal > reserveStable6) {
                amount = bal - reserveStable6;
                stable.safeTransfer(to, amount);
            }
        } else if (token == shareToken) {
            uint256 bal = _balance(shareToken);
            if (bal > reserveShares18) {
                amount = bal - reserveShares18;
                shareToken.safeTransfer(to, amount);
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

    function _active(uint256 deadline) internal view {
        if(block.timestamp > deadline) revert DeadlineExpired();
        if(!IShareVault(settlementVault).isTradingAllowed(shareToken)) revert TradingFrozen();
    }
    function _balance(address token) internal view returns (uint256 v) {
        (bool ok, bytes memory d) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if(!ok || d.length < 32) revert InvalidAmount();
        v = abi.decode(d, (uint256));
    }
    function _min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) { return a == 0 ? 0 : (a - 1) / b + 1; }
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if(y > 3){ z = y; uint256 x = y / 2 + 1; while(x < z){ z = x; x = (y / x + x) / 2; } } else if(y != 0){ z = 1; }
    }
}
