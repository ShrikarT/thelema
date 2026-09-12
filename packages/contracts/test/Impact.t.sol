// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DemoOracle} from "../src/DemoOracle.sol";
import {BinaryVault} from "../src/vault/BinaryVault.sol";
import {ShareVault} from "../src/vault/ShareVault.sol";
import {BinaryAMM} from "../src/amm/BinaryAMM.sol";
import {ShareAMM} from "../src/amm/ShareAMM.sol";
import {ImpactToken} from "../src/token/ImpactToken.sol";
import {MockUSDC} from "./MockUSDC.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function warp(uint256) external;
}

contract ImpactTest {
    Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC usdc; DemoOracle oracle; BinaryVault binary; ShareVault shares; BinaryAMM binaryAmm;
    address alice=address(0xA11CE); address attacker=address(0xBAD); address carol=address(0xCA801);

    function setUp() public {
        usdc=new MockUSDC(); oracle=new DemoOracle(address(this));
        // eventDeadline = 100, tradingCutoff = 200, earliestPriceFixTime = 200
        binary=new BinaryVault(address(usdc),address(oracle),100,200);
        shares=new ShareVault(address(usdc),address(oracle),500e6,100,200,200);
        binaryAmm=new BinaryAMM(binary,address(this),30);
        usdc.mint(address(this),200_000e6); usdc.mint(alice,10_000e6); usdc.mint(attacker,10_000e6); usdc.mint(carol,10_000e6);
        usdc.approve(address(binary),type(uint256).max); usdc.approve(address(shares),type(uint256).max);
        vm.prank(alice); usdc.approve(address(binaryAmm),type(uint256).max);
    }

    function testBinarySplitMergeAndSixDecimals() public {
        uint256 beforeBal=usdc.balanceOf(address(this));
        uint256 minted=binary.split(3_500_001,address(this));
        _eq(minted,3_500_001e12); _eq(binary.yesToken().balanceOf(address(this)),minted); _eq(binary.noToken().balanceOf(address(this)),minted);
        uint256 returned=binary.merge(minted,address(this)); _eq(returned,3_500_001); _eq(usdc.balanceOf(address(this)),beforeBal);
    }

    function testConditionalIdentity() public {
        binary.split(1e6,address(this));
        require(address(binary.yesToken())!=address(binary.noToken()),"same token");
        _eq(binary.yesToken().totalSupply(),1e18); _eq(binary.noToken().totalSupply(),1e18);
        require(keccak256(bytes(binary.yesToken().symbol()))!=keccak256(bytes(binary.noToken().symbol())),"same symbol");
    }

    function testBuyYesMovesProbabilityUpAndPreservesInvariant() public {
        binary.split(100e6,address(this));
        binary.yesToken().approve(address(binaryAmm),50e18); binary.noToken().approve(address(binaryAmm),50e18);
        binaryAmm.addLiquidity(50e18,50e18,50e18,block.timestamp);
        uint256 p0=binaryAmm.binaryPriceUSDC6(true); (uint256 y0,uint256 n0)=binaryAmm.reserves(); uint256 k0=y0*n0;
        vm.prank(alice); uint256 out=binaryAmm.buyOutcome(true,10e6,1,block.timestamp);
        require(out>10e18,"no cp bonus"); uint256 p1=binaryAmm.binaryPriceUSDC6(true); require(p1>p0,"price did not rise");
        (uint256 y1,uint256 n1)=binaryAmm.reserves(); require(y1*n1>=k0,"invariant fell"); _eq(binaryAmm.accruedFees6(),30_000);
    }

    function testBinarySettlementYesAndLoserRejected() public {
        binary.split(2e6,address(this)); shares.split(1e18,address(this));
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,125e6);
        uint256 beforeBal=usdc.balanceOf(address(this)); uint256 paid=binary.redeem(address(binary.yesToken()),2e18,address(this));
        _eq(paid,2e6); _eq(usdc.balanceOf(address(this)),beforeBal+2e6);
        address loser=address(binary.noToken());
        vm.expectRevert(BinaryVault.WrongToken.selector); binary.redeem(loser,2e18,address(this));
    }

    function testBinarySettlementNoPaysNoLeg() public {
        binary.split(1e6,address(this)); shares.split(1e18,address(this));
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),false,200e6);
        uint256 paid=binary.redeem(address(binary.noToken()),1e18,address(this)); _eq(paid,1e6);
        address loser=address(binary.yesToken());
        vm.expectRevert(BinaryVault.WrongToken.selector); binary.redeem(loser,1e18,address(this));
    }

    function testShareCapAndResidualRedemption() public {
        shares.split(2e18,address(this)); binary.split(1e6,address(this));
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,700e6);
        _eq(shares.settlementValue6(),500e6); _eq(shares.residualValue6(),0);
        uint256 paid=shares.redeem(address(shares.yesShare()),2e18,address(this)); _eq(paid,1_000e6);
        uint256 residualPaid=shares.redeem(address(shares.residualShare()),2e18,address(this)); _eq(residualPaid,0);
        _eq(usdc.balanceOf(address(shares)),0);
    }

    function testSharePayoutMinAndResidualRedemption() public {
        shares.split(1e18,address(this)); binary.split(1e6,address(this));
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),false,123e6);
        _eq(shares.settlementValue6(),123e6); _eq(shares.residualValue6(),377e6);
        uint256 paid=shares.redeem(address(shares.noShare()),1e18,address(this)); _eq(paid,123e6);
        uint256 resPaid=shares.redeem(address(shares.residualShare()),1e18,address(this)); _eq(resPaid,377e6);
        _eq(usdc.balanceOf(address(shares)),0);
    }

    function testCompleteSetMintMintsResidualAndMergeRequiresResidual() public {
        uint256 cost=shares.split(1e18,address(this));
        _eq(cost,500e6);
        _eq(shares.yesShare().balanceOf(address(this)),1e18);
        _eq(shares.noShare().balanceOf(address(this)),1e18);
        _eq(shares.residualShare().balanceOf(address(this)),1e18);
        ImpactToken res=shares.residualShare();
        // Transfer residual away to simulate holding only YES and NO
        res.transfer(carol,1e18);
        // Merging without residual must revert with InsufficientBalance
        vm.expectRevert(); shares.merge(1e18,address(this));
        // Carol transfers residual back (cache res before prank)
        vm.prank(carol); res.transfer(address(this),1e18);
        uint256 returned=shares.merge(1e18,address(this));
        _eq(returned,500e6);
    }

    function testOriginalBug166To500ExploitBlocked() public {
        // Setup AMM pools with 100e18 liquidity like JS sandbox
        shares.split(200e18,address(this));
        ShareAMM yesAmm=new ShareAMM(address(usdc),address(shares.yesShare()),address(shares),30,"ysLP");
        ShareAMM noAmm=new ShareAMM(address(usdc),address(shares.noShare()),address(shares),30,"nsLP");
        usdc.approve(address(yesAmm),type(uint256).max);
        usdc.approve(address(noAmm),type(uint256).max);
        shares.yesShare().approve(address(yesAmm),type(uint256).max);
        shares.noShare().approve(address(noAmm),type(uint256).max);
        yesAmm.addLiquidity(11_655e6,100e18,1,block.timestamp);
        noAmm.addLiquidity(4_366e6,100e18,1,block.timestamp);

        // Attacker buys yes and no shares from AMM for 120 and 46 USDC
        vm.startPrank(attacker);
        usdc.approve(address(yesAmm),type(uint256).max);
        usdc.approve(address(noAmm),type(uint256).max);
        uint256 yBought=yesAmm.buyShares(120e6,1,block.timestamp);
        uint256 nBought=noAmm.buyShares(46e6,1,block.timestamp);
        require(yBought>=1e18 && nBought>=1e18,"insufficient bought");

        // Attacker attempts to merge YES and NO for 500 USDC without R. It MUST revert!
        vm.expectRevert(); shares.merge(1e18,attacker);
        vm.stopPrank();
    }

    function testCeilDepositFloorRedemptionFractionalAccounting() public {
        // 100 tiny splits of 1 wei each
        for(uint256 i=0;i<100;i++){
            shares.split(1,address(this));
        }
        _eq(shares.yesShare().balanceOf(address(this)),100);
        _eq(shares.noShare().balanceOf(address(this)),100);
        _eq(shares.residualShare().balanceOf(address(this)),100);
        // Each 1 wei split cost ceil(1 * 500e6 / 1e18) = 1 micro USDC
        _eq(usdc.balanceOf(address(shares)),100); // 100 micro USDC
        require(usdc.balanceOf(address(shares))>=shares.remainingLiabilities6(),"vault undercollateralized");

        // Merging 100 wei returns floor(100 * 500e6 / 1e18) = 0 micro USDC
        uint256 refunded=shares.merge(100,address(this));
        _eq(refunded,0);
        // Vault keeps the 100 micro USDC dust safely
        _eq(usdc.balanceOf(address(shares)),100);
    }

    function testSeparateEventAndPriceClocks() public {
        shares.split(2e18,address(this)); binary.split(2e6,address(this));
        ShareAMM yesAmm=new ShareAMM(address(usdc),address(shares.yesShare()),address(shares),30,"ysLP");
        ShareAMM noAmm=new ShareAMM(address(usdc),address(shares.noShare()),address(shares),30,"nsLP");
        usdc.approve(address(yesAmm),type(uint256).max); usdc.approve(address(noAmm),type(uint256).max);
        shares.yesShare().approve(address(yesAmm),type(uint256).max); shares.noShare().approve(address(noAmm),type(uint256).max);
        yesAmm.addLiquidity(100e6,0.5e18,1,block.timestamp); noAmm.addLiquidity(100e6,0.5e18,1,block.timestamp);

        // Advance past eventDeadline (100) but before earliestPriceFixTime (200)
        vm.warp(150);

        // Resolve event to YES
        oracle.resolveEvent(address(binary),address(shares),true);
        require(binary.settled(),"binary not settled");
        require(shares.lifecycle()==ShareVault.Lifecycle.EVENT_RESOLVED,"not event resolved");

        // Binary claims immediately claimable!
        address binWin=address(binary.yesToken());
        uint256 binPaid=binary.redeem(binWin,2e18,address(this));
        _eq(binPaid,2e6);

        // Asset claims CANNOT redeem before price fixing!
        address yesTok=address(shares.yesShare());
        vm.expectRevert(ShareVault.NotSettled.selector);
        shares.redeem(yesTok,1e18,address(this));

        // Binary AMM trading is frozen
        vm.startPrank(alice);
        vm.expectRevert(); binaryAmm.buyOutcome(true,1e6,1,block.timestamp);

        // Impossible asset leg (NO) is frozen
        shares.noShare().approve(address(noAmm),type(uint256).max);
        vm.expectRevert(ShareAMM.TradingFrozen.selector); noAmm.buyShares(1e6,1,block.timestamp);

        // Surviving asset leg (YES) can still trade before cutoff!
        usdc.approve(address(yesAmm),type(uint256).max);
        shares.yesShare().approve(address(yesAmm),type(uint256).max);
        uint256 bought=yesAmm.buyShares(1e6,1,block.timestamp);
        require(bought>0,"surviving leg trade failed");
        vm.stopPrank();

        // Try fixing price before earliestPriceFixTime (200) -> reverts
        vm.expectRevert(); oracle.fixPrice(address(shares),260e6);

        // Advance past earliestPriceFixTime (200)
        vm.warp(200);
        oracle.fixPrice(address(shares),260e6);
        require(shares.lifecycle()==ShareVault.Lifecycle.PRICE_FIXED,"not price fixed");

        // Now surviving leg is also frozen
        vm.prank(alice); vm.expectRevert(ShareAMM.TradingFrozen.selector); yesAmm.buyShares(1e6,1,block.timestamp);

        // Asset claims and residual claims redeem cleanly!
        uint256 yPaid=shares.redeem(address(shares.yesShare()),1e18,address(this));
        _eq(yPaid,260e6);
        uint256 rPaid=shares.redeem(address(shares.residualShare()),1e18,address(this));
        _eq(rPaid,240e6);
        _eq(yPaid+rPaid,500e6);
    }

    function testTradingCutoffEnforcedWhenOracleLate() public {
        shares.split(2e18,address(this));
        ShareAMM yesAmm=new ShareAMM(address(usdc),address(shares.yesShare()),address(shares),30,"ysLP");
        usdc.approve(address(yesAmm),type(uint256).max); shares.yesShare().approve(address(yesAmm),type(uint256).max);
        yesAmm.addLiquidity(100e6,0.5e18,1,block.timestamp);

        // Time passes tradingCutoff (200), but oracle has NOT called resolveEvent or fixPrice
        vm.warp(201);
        require(shares.lifecycle()==ShareVault.Lifecycle.OPEN,"not open");
        // AMM trading must still be frozen!
        vm.prank(alice); vm.expectRevert(ShareAMM.TradingFrozen.selector); yesAmm.buyShares(1e6,1,block.timestamp);
    }

    function testCannotResolveNOBeforeDeadline() public {
        // block.timestamp is 1, deadline is 100
        vm.expectRevert(); oracle.resolveEvent(address(binary),address(shares),false);
        // Warp past deadline
        vm.warp(101);
        oracle.resolveEvent(address(binary),address(shares),false);
        require(shares.lifecycle()==ShareVault.Lifecycle.EVENT_RESOLVED,"not resolved");
    }

    function testUnauthorizedOracleAndImmutableSettlement() public {
        vm.warp(200);
        vm.prank(attacker); vm.expectRevert(); binary.settle(true);
        vm.prank(attacker); vm.expectRevert(); shares.settle(true,1);
        vm.prank(attacker); vm.expectRevert(); oracle.publishAndSettle(address(binary),address(shares),true,1);
        oracle.publishAndSettle(address(binary),address(shares),true,1);
        vm.expectRevert(); oracle.publishAndSettle(address(binary),address(shares),false,2);
        vm.expectRevert(); oracle.resolveEvent(address(binary),address(shares),true);
    }

    function testZeroInvalidAndSlippageGuards() public {
        vm.expectRevert(); binary.split(0,address(this));
        vm.expectRevert(); shares.split(0,address(this));
        binary.split(100e6,address(this)); binary.yesToken().approve(address(binaryAmm),50e18); binary.noToken().approve(address(binaryAmm),50e18);
        binaryAmm.addLiquidity(50e18,50e18,1,block.timestamp);
        vm.prank(alice); vm.expectRevert(); binaryAmm.buyOutcome(true,1e6,type(uint256).max,block.timestamp);
        vm.warp(10); vm.prank(alice); vm.expectRevert(); binaryAmm.buyOutcome(true,1e6,0,9);
    }

    function testTradingFreezesAfterSettlement() public {
        binary.split(100e6,address(this)); binary.yesToken().approve(address(binaryAmm),50e18); binary.noToken().approve(address(binaryAmm),50e18);
        binaryAmm.addLiquidity(50e18,50e18,1,block.timestamp); shares.split(1e18,address(this));
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,100e6);
        vm.prank(alice); vm.expectRevert(); binaryAmm.buyOutcome(true,1e6,0,block.timestamp);
    }

    function testShareAmmUnitsRoundTripChargesFee() public {
        shares.split(1e18,address(this)); ShareAMM amm=new ShareAMM(address(usdc),address(shares.yesShare()),address(shares),30,"ysLP");
        usdc.approve(address(amm),type(uint256).max); shares.yesShare().approve(address(amm),type(uint256).max);
        amm.addLiquidity(100e6,0.2e18,1,block.timestamp); _eq(amm.sharePriceUSDC6(),500e6);
        vm.startPrank(alice); usdc.approve(address(amm),type(uint256).max);
        uint256 bought=amm.buyShares(10e6,1,block.timestamp); shares.yesShare().approve(address(amm),bought);
        uint256 returned=amm.sellShares(bought,1,block.timestamp); vm.stopPrank(); require(returned<10e6,"fees absent");
    }

    function testFractionalSharePairsSplitMerge() public {
        uint256 beforeBal=usdc.balanceOf(address(this));
        uint256 pairs=123456789012345678;
        uint256 cost=shares.split(pairs,address(this));
        uint256 returned=shares.merge(pairs,address(this));
        require(cost>=returned && cost-returned<=1,"bad rounding");
        _eq(shares.yesShare().balanceOf(address(this)),0);
        _eq(shares.residualShare().balanceOf(address(this)),0);
        _eq(usdc.balanceOf(address(this)),beforeBal-cost+returned);
    }

    function testFractionalBinaryPurchaseSettlesAndRedeems() public {
        binary.split(100e6,address(this));
        binary.yesToken().approve(address(binaryAmm),50e18); binary.noToken().approve(address(binaryAmm),50e18);
        binaryAmm.addLiquidity(50e18,50e18,1,block.timestamp);
        vm.prank(alice); uint256 bought=binaryAmm.buyOutcome(true,10e6,1,block.timestamp);
        require(bought%1e12!=0,"expected fractional purchase");
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,200e6);
        address winner=address(binary.yesToken()); uint256 beforeBalance=usdc.balanceOf(alice);
        vm.prank(alice); uint256 paid=binary.redeem(winner,bought,alice);
        _eq(paid,bought/1e12); _eq(binary.yesToken().balanceOf(alice),0); _eq(usdc.balanceOf(alice),beforeBalance+paid);
    }

    function testFractionalAssetPurchaseSettlesAndRedeems() public {
        shares.split(1e18,address(this));
        ShareAMM amm=new ShareAMM(address(usdc),address(shares.yesShare()),address(shares),30,"ysLP");
        usdc.approve(address(amm),type(uint256).max); shares.yesShare().approve(address(amm),type(uint256).max);
        amm.addLiquidity(100e6,0.2e18,1,block.timestamp);
        vm.startPrank(alice); usdc.approve(address(amm),10e6);
        uint256 bought=amm.buyShares(10e6,1,block.timestamp); vm.stopPrank();
        require(bought%1e18!=0,"expected fractional share");
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,200e6);
        address winner=address(shares.yesShare()); uint256 beforeBalance=usdc.balanceOf(alice);
        vm.prank(alice); uint256 paid=shares.redeem(winner,bought,alice);
        _eq(paid,bought*200e6/1e18); _eq(shares.yesShare().balanceOf(alice),0); _eq(usdc.balanceOf(alice),beforeBalance+paid);
    }

    function testCollateralMustImplementSixDecimals() public {
        vm.expectRevert(); new BinaryVault(address(0xBAD),address(oracle),100,200);
        vm.expectRevert(); new ShareVault(address(0xBAD),address(oracle),500e6,100,200,200);
    }

    function testRedeemCannotBurnAnotherAccountOrDoubleSpend() public {
        binary.split(2e6,alice);
        ImpactToken token=binary.yesToken();
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,200e6);
        vm.prank(attacker); vm.expectRevert(); binary.redeem(address(token),2e18,attacker);
        _eq(token.balanceOf(alice),2e18); _eq(usdc.balanceOf(address(binary)),2e6);
        vm.prank(alice); uint256 paid=binary.redeem(address(token),2e18,alice);
        _eq(paid,2e6); _eq(token.balanceOf(alice),0);
        vm.prank(alice); vm.expectRevert(); binary.redeem(address(token),2e18,alice);
        _eq(usdc.balanceOf(address(binary)),0);
    }

    function testBinaryDustBurnDoesNotTransferCollateral() public {
        binary.split(1e6,address(this));
        ImpactToken token=binary.yesToken(); token.transfer(alice,1);
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,200e6);
        uint256 beforeBalance=usdc.balanceOf(alice);
        vm.prank(alice); uint256 paid=binary.redeem(address(token),1,alice);
        _eq(paid,0); _eq(token.balanceOf(alice),0); _eq(usdc.balanceOf(alice),beforeBalance);
    }

    function testShareDustBurnDoesNotTransferCollateral() public {
        shares.split(1e18,address(this));
        ImpactToken token=shares.yesShare(); token.transfer(alice,1);
        vm.warp(200);
        oracle.publishAndSettle(address(binary),address(shares),true,200e6);
        uint256 beforeBalance=usdc.balanceOf(alice);
        vm.prank(alice); uint256 paid=shares.redeem(address(token),1,alice);
        _eq(paid,0); _eq(token.balanceOf(alice),0); _eq(usdc.balanceOf(alice),beforeBalance);
    }

    function _eq(uint256 a,uint256 b) internal pure {require(a==b,"not equal");}
}
