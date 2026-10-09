// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// Copy this diagnostic into packages/contracts/test/AuditFindings.t.sol to run it.
import {DemoOracle} from "../src/DemoOracle.sol";
import {BinaryVault} from "../src/vault/BinaryVault.sol";
import {ShareVault} from "../src/vault/ShareVault.sol";
import {ShareAMM} from "../src/amm/ShareAMM.sol";
import {MockUSDC} from "./MockUSDC.sol";

interface AuditVm {function warp(uint256) external; function expectRevert() external;}
contract AcceptsAnyOracleCall {fallback() external {}}

// These tests PASS when they reproduce an audit limitation in the current implementation.
// They are diagnostics, not approval criteria for mainnet.
contract AuditFindings {
    AuditVm constant vm=AuditVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC usdc; DemoOracle oracle; BinaryVault binary; ShareVault shares;
    function setUp() public {
        vm.warp(1);
        usdc=new MockUSDC(); oracle=new DemoOracle(address(this));
        binary=new BinaryVault(address(usdc),address(oracle),100,200);
        shares=new ShareVault(address(usdc),address(oracle),500e6,100,200,200);
        usdc.mint(address(this),10000e6);
        usdc.approve(address(binary),type(uint256).max);
        usdc.approve(address(shares),type(uint256).max);
    }
    function testCompleteSetsRemainLockedAfterCutoffWithoutOracle() public {
        binary.split(1e6,address(this)); shares.split(1e18,address(this));
        vm.warp(200+365 days);
        vm.expectRevert(); binary.merge(1e18,address(this));
        vm.expectRevert(); shares.merge(1e18,address(this));
        address b=address(binary.yesToken()); address s=address(shares.yesShare());
        vm.expectRevert(); binary.redeem(b,1e18,address(this));
        vm.expectRevert(); shares.redeem(s,1e18,address(this));
        require(usdc.balanceOf(address(binary))==1e6,"unexpected binary payout");
        require(usdc.balanceOf(address(shares))==500e6,"unexpected share payout");
    }
    function testWrongOracleTargetsConsumeOneShotState() public {
        AcceptsAnyOracleCall sink=new AcceptsAnyOracleCall();
        oracle.resolveEvent(address(sink),address(sink),true);
        oracle.fixPrice(address(sink),200e6);
        require(oracle.eventResolved() && oracle.priceFixed(),"oracle flags not consumed");
        require(!binary.settled() && shares.lifecycle()==ShareVault.Lifecycle.OPEN,"legitimate vault changed");
        vm.expectRevert(); oracle.resolveEvent(address(binary),address(shares),true);
        vm.expectRevert(); oracle.fixPrice(address(shares),200e6);
    }
    function testBuyAboveMaximumPayoutIsAccepted() public {
        shares.split(0.1e18,address(this));
        ShareAMM amm=new ShareAMM(address(usdc),address(shares.yesShare()),address(shares),30,"auditLP");
        usdc.approve(address(amm),type(uint256).max);
        shares.yesShare().approve(address(amm),type(uint256).max);
        amm.addLiquidity(11.655e6,0.1e18,1,block.timestamp);
        uint256 purchased=amm.buyShares(50e6,1,block.timestamp);
        require(purchased*shares.cap6()/1e18 < 50e6,"expected above-cap execution");
    }
    function testResidualShareCannotTradeThroughShareAMM() public {
        shares.split(1e18,address(this));
        ShareAMM amm=new ShareAMM(address(usdc),address(shares.residualShare()),address(shares),30,"auditRLP");
        usdc.approve(address(amm),type(uint256).max);
        shares.residualShare().approve(address(amm),type(uint256).max);
        vm.expectRevert(); amm.addLiquidity(100e6,1e18,1,block.timestamp);
    }
}
