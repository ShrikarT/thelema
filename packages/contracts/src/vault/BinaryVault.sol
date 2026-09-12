// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ImpactToken} from "../token/ImpactToken.sol";
import {SafeTransferLib} from "../lib/SafeTransferLib.sol";
import {ReentrancyGuard} from "../lib/ReentrancyGuard.sol";

contract BinaryVault is ReentrancyGuard {
    using SafeTransferLib for address;

    uint256 public constant COLLATERAL_PER_PAIR_6 = 1e6;
    uint256 public constant TOKEN_SCALE = 1e12;

    address public immutable collateral;
    address public immutable oracle;
    uint256 public immutable eventDeadline;
    uint256 public immutable tradingCutoff;

    ImpactToken public immutable yesToken;
    ImpactToken public immutable noToken;

    bool public settled;
    bool public eventYes;

    error Unauthorized();
    error InvalidAmount();
    error AlreadySettled();
    error NotSettled();
    error WrongToken();
    error TradingFrozen();
    error EventDeadlineNotPassed();

    event Split(address indexed caller, address indexed receiver, uint256 collateral6, uint256 tokenAmount18);
    event Merge(address indexed caller, address indexed receiver, uint256 tokenAmount18, uint256 collateral6);
    event Settled(bool eventYes);
    event Redeemed(address indexed caller, address indexed receiver, address indexed token, uint256 tokenAmount18, uint256 collateral6);

    constructor(
        address collateral_,
        address oracle_,
        uint256 eventDeadline_,
        uint256 tradingCutoff_
    ) {
        if (collateral_ == address(0) || oracle_ == address(0)) revert Unauthorized();
        if (tradingCutoff_ < eventDeadline_) revert InvalidAmount();
        (bool ok, bytes memory data) = collateral_.staticcall(abi.encodeWithSelector(0x313ce567));
        if (!ok || data.length != 32 || abi.decode(data, (uint256)) != 6) revert InvalidAmount();

        collateral = collateral_;
        oracle = oracle_;
        eventDeadline = eventDeadline_;
        tradingCutoff = tradingCutoff_;

        yesToken = new ImpactToken("THELEMA Binary YES", "tYES", address(this));
        noToken = new ImpactToken("THELEMA Binary NO", "tNO", address(this));
    }

    function isTradingAllowed() external view returns (bool) {
        return !settled && block.timestamp <= tradingCutoff;
    }

    function split(uint256 collateral6, address receiver) external nonReentrant returns (uint256 tokenAmount18) {
        return _split(msg.sender, collateral6, receiver);
    }

    function _split(address payer, uint256 collateral6, address receiver) internal returns (uint256 tokenAmount18) {
        if (settled || block.timestamp > tradingCutoff) revert TradingFrozen();
        if (collateral6 == 0 || receiver == address(0)) revert InvalidAmount();
        tokenAmount18 = collateral6 * TOKEN_SCALE;
        collateral.safeTransferFrom(payer, address(this), collateral6);
        yesToken.mint(receiver, tokenAmount18);
        noToken.mint(receiver, tokenAmount18);
        emit Split(payer, receiver, collateral6, tokenAmount18);
    }

    function merge(uint256 tokenAmount18, address receiver) external nonReentrant returns (uint256 collateral6) {
        if (settled || block.timestamp > tradingCutoff) revert TradingFrozen();
        if (tokenAmount18 == 0 || receiver == address(0)) revert InvalidAmount();
        collateral6 = tokenAmount18 / TOKEN_SCALE;
        yesToken.burn(msg.sender, tokenAmount18);
        noToken.burn(msg.sender, tokenAmount18);
        if (collateral6 != 0) collateral.safeTransfer(receiver, collateral6);
        emit Merge(msg.sender, receiver, tokenAmount18, collateral6);
    }

    function settle(bool eventYes_) external {
        if (msg.sender != oracle) revert Unauthorized();
        if (settled) revert AlreadySettled();
        if (!eventYes_ && block.timestamp < eventDeadline) revert EventDeadlineNotPassed();
        eventYes = eventYes_;
        settled = true;
        emit Settled(eventYes_);
    }

    function redeem(address token, uint256 tokenAmount18, address receiver) external nonReentrant returns (uint256 collateral6) {
        if (!settled) revert NotSettled();
        if (tokenAmount18 == 0 || receiver == address(0)) revert InvalidAmount();
        address winner = eventYes ? address(yesToken) : address(noToken);
        if (token != winner) revert WrongToken();
        collateral6 = tokenAmount18 / TOKEN_SCALE;
        ImpactToken(token).burn(msg.sender, tokenAmount18);
        if (collateral6 != 0) collateral.safeTransfer(receiver, collateral6);
        emit Redeemed(msg.sender, receiver, token, tokenAmount18, collateral6);
    }
}
