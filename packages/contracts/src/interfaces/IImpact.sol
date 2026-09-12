// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Impact {
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function allowance(address,address) external view returns (uint256);
    function approve(address,uint256) external returns (bool);
    function transfer(address,uint256) external returns (bool);
    function transferFrom(address,address,uint256) external returns (bool);
}

interface IBinaryVault {
    function collateral() external view returns(address);
    function yesToken() external view returns(address);
    function noToken() external view returns(address);
    function settled() external view returns(bool);
    function eventYes() external view returns(bool);
    function eventDeadline() external view returns(uint256);
    function tradingCutoff() external view returns(uint256);
    function isTradingAllowed() external view returns(bool);
    function split(uint256 collateral6,address receiver) external returns(uint256 tokenAmount18);
    function merge(uint256 tokenAmount18,address receiver) external returns(uint256 collateral6);
    function redeem(address token,uint256 tokenAmount18,address receiver) external returns(uint256 collateral6);
    function settle(bool eventYes) external;
}

interface IShareVault {
    function collateral() external view returns(address);
    function yesShare() external view returns(address);
    function noShare() external view returns(address);
    function residualShare() external view returns(address);
    function cap6() external view returns(uint256);
    function eventDeadline() external view returns(uint256);
    function tradingCutoff() external view returns(uint256);
    function earliestPriceFixTime() external view returns(uint256);
    function settled() external view returns(bool);
    function eventYes() external view returns(bool);
    function settlementValue6() external view returns(uint256);
    function residualValue6() external view returns(uint256);
    function residualLocked6() external view returns(uint256);
    function remainingLiabilities6() external view returns(uint256);
    function isTradingAllowed(address token) external view returns(bool);
    function collateralForPairs(uint256 pairs18) external view returns(uint256 collateral6);
    function split(uint256 pairs18,address receiver) external returns(uint256 collateral6);
    function merge(uint256 pairs18,address receiver) external returns(uint256 collateral6);
    function resolveEvent(bool eventYes) external;
    function fixPrice(uint256 settlementValue6) external;
    function settle(bool eventYes,uint256 settlementValue6) external;
    function redeem(address token,uint256 shares18,address receiver) external returns(uint256 collateral6);
}

interface IBinaryAMM {
    function reserves() external view returns(uint256 reserveYes18,uint256 reserveNo18);
    function binaryPriceUSDC6(bool priceYes) external view returns(uint256);
    function quoteBuy(bool buyYes,uint256 collateralIn6) external view returns(uint256 outcomeOut18,uint256 fee6);
    function buyOutcome(bool buyYes,uint256 collateralIn6,uint256 minOutcomeOut18,uint256 deadline) external returns(uint256 outcomeOut18);
    function addLiquidity(uint256 maxYes18,uint256 maxNo18,uint256 minLp18,uint256 deadline) external returns(uint256 yesIn18,uint256 noIn18,uint256 lpOut18);
    function removeLiquidity(uint256 lpIn18,uint256 minYes18,uint256 minNo18,uint256 deadline) external returns(uint256 yesOut18,uint256 noOut18);
    function withdrawFees() external returns(uint256 amount6);
}

interface IShareAMM {
    function reserves() external view returns(uint256 stableReserve6,uint256 tokenReserve18);
    function sharePriceUSDC6() external view returns(uint256);
    function quoteBuyShares(uint256 stableIn6) external view returns(uint256 sharesOut18,uint256 fee6);
    function quoteSellShares(uint256 sharesIn18) external view returns(uint256 stableOut6,uint256 feeShares18);
    function buyShares(uint256 stableIn6,uint256 minSharesOut18,uint256 deadline) external returns(uint256 sharesOut18);
    function sellShares(uint256 sharesIn18,uint256 minStableOut6,uint256 deadline) external returns(uint256 stableOut6);
    function addLiquidity(uint256 maxStable6,uint256 maxShares18,uint256 minLp18,uint256 deadline) external returns(uint256 lpOut18);
    function removeLiquidity(uint256 lpIn18,uint256 minStable6,uint256 minShares18,uint256 deadline) external returns(uint256 stableOut6,uint256 sharesOut18);
}

interface IDemoOracle {
    function published() external view returns(bool);
    function eventResolved() external view returns(bool);
    function priceFixed() external view returns(bool);
    function eventYes() external view returns(bool);
    function settlementValue6() external view returns(uint256);
    function resolveEvent(address binaryVault,address shareVault,bool eventYes) external;
    function fixPrice(address shareVault,uint256 settlementValue6) external;
    function publishAndSettle(address binaryVault,address shareVault,bool eventYes,uint256 settlementValue6) external;
}
