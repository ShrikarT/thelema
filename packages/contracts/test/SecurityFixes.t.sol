// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DemoOracle} from "../src/DemoOracle.sol";
import {BinaryVault} from "../src/vault/BinaryVault.sol";
import {ShareVault} from "../src/vault/ShareVault.sol";
import {BinaryAMM} from "../src/amm/BinaryAMM.sol";
import {ShareAMM} from "../src/amm/ShareAMM.sol";
import {ImpactToken} from "../src/token/ImpactToken.sol";
import {Ownable} from "../src/lib/Ownable.sol";
import {SafeTransferLib} from "../src/lib/SafeTransferLib.sol";
import {MockUSDC} from "./MockUSDC.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}

contract SecurityFixesTest {
    using SafeTransferLib for address;

    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockUSDC usdc;
    DemoOracle oracle;
    BinaryVault binary;
    ShareVault shares;
    BinaryAMM binaryAmm;
    ShareAMM yesAmm;
    ShareAMM noAmm;

    address alice = address(0xA11CE);
    address attacker = address(0xBAD);
    address carol = address(0xCA801);
    address safeMultisig = address(0x5AFE);

    function setUp() public {
        vm.warp(1);
        usdc = new MockUSDC();

        // 1. Deploy vaults first with uninitialized oracle (H2 architecture)
        binary = new BinaryVault(address(usdc), address(0), 100, 200);
        shares = new ShareVault(address(usdc), address(0), 500e6, 100, 200, 200);

        // 2. Deploy DemoOracle binding vaults immutably
        oracle = new DemoOracle(address(this), address(binary), address(shares));

        // 3. Post-deploy init: wire oracle to vaults
        binary.setOracle(address(oracle));
        shares.setOracle(address(oracle));

        // 4. Deploy AMMs
        binaryAmm = new BinaryAMM(binary, address(this), 30);
        yesAmm = new ShareAMM(address(usdc), address(shares.yesShare()), address(shares), 30, "ysLP");
        noAmm = new ShareAMM(address(usdc), address(shares.noShare()), address(shares), 30, "nsLP");

        // Fund test accounts
        usdc.mint(address(this), 1_000_000e6);
        usdc.mint(alice, 100_000e6);
        usdc.mint(attacker, 100_000e6);

        usdc.approve(address(binary), type(uint256).max);
        usdc.approve(address(shares), type(uint256).max);
        usdc.approve(address(binaryAmm), type(uint256).max);
        usdc.approve(address(yesAmm), type(uint256).max);
        usdc.approve(address(noAmm), type(uint256).max);

        vm.startPrank(alice);
        usdc.approve(address(binary), type(uint256).max);
        usdc.approve(address(shares), type(uint256).max);
        usdc.approve(address(binaryAmm), type(uint256).max);
        usdc.approve(address(yesAmm), type(uint256).max);
        usdc.approve(address(noAmm), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(attacker);
        usdc.approve(address(binary), type(uint256).max);
        usdc.approve(address(shares), type(uint256).max);
        usdc.approve(address(binaryAmm), type(uint256).max);
        usdc.approve(address(yesAmm), type(uint256).max);
        usdc.approve(address(noAmm), type(uint256).max);
        vm.stopPrank();
    }

    // =========================================================================
    // Phase 1 — C1 & L3: Two-step ownership & settlement timelock
    // =========================================================================

    function test_C1_TwoStepOwnershipRoundTrip() public {
        require(oracle.owner() == address(this), "owner mismatch");
        require(oracle.pendingOwner() == address(0), "pending owner not zero");

        // Step 1: propose new owner
        oracle.transferOwnership(safeMultisig);
        require(oracle.owner() == address(this), "owner changed prematurely");
        require(oracle.pendingOwner() == safeMultisig, "pending owner mismatch");

        // Unauthorized address cannot accept
        vm.prank(attacker);
        vm.expectRevert(Ownable.NotPendingOwner.selector);
        oracle.acceptOwnership();

        // Step 2: pending owner accepts
        vm.prank(safeMultisig);
        oracle.acceptOwnership();

        require(oracle.owner() == safeMultisig, "new owner not set");
        require(oracle.pendingOwner() == address(0), "pending owner not cleared");
    }

    function test_C1_UnauthorizedCannotQueueSettlement() public {
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        oracle.queueSettlement(true, 100e6);
    }

    function test_C1_SettlementTimelockEnforced() public {
        vm.warp(200); // Past event deadline and cutoff

        oracle.queueSettlement(true, 300e6);
        require(oracle.isSettlementPending(), "settlement not pending");

        // Execution attempt before timelock delay reverts
        vm.expectRevert(DemoOracle.TimelockNotExpired.selector);
        oracle.executeSettlement();

        vm.expectRevert(DemoOracle.TimelockNotExpired.selector);
        oracle.publishAndSettle(true, 300e6);

        // Advance 23h 59m (still under 24 hours)
        vm.warp(200 + 24 hours - 1);
        vm.expectRevert(DemoOracle.TimelockNotExpired.selector);
        oracle.executeSettlement();

        // Advance past timelock (24 hours)
        vm.warp(200 + 24 hours);
        oracle.executeSettlement();

        require(oracle.eventResolved(), "not resolved");
        require(oracle.priceFixed(), "not price fixed");
        require(binary.settled(), "binary not settled");
        require(shares.settled(), "shares not settled");
        require(!oracle.isSettlementPending(), "still pending");
    }

    function test_C1_SettlementCancelPath() public {
        vm.warp(200);
        oracle.queueSettlement(true, 300e6);
        require(oracle.isSettlementPending(), "not pending");

        // Owner cancels
        oracle.cancelSettlement();
        require(!oracle.isSettlementPending(), "not cancelled");

        // Advance past timelock delay
        vm.warp(200 + 24 hours + 1);

        // Execution reverts because queue was cleared
        vm.expectRevert(DemoOracle.NoPendingSettlement.selector);
        oracle.executeSettlement();
    }

    // =========================================================================
    // Phase 2 — H1 & M2: Atomic settlement only & trading freeze from EVENT_RESOLVED
    // =========================================================================

    function test_H1_M2_AtomicSettlementOnly() public {
        vm.expectRevert(DemoOracle.DirectResolutionDisabled.selector);
        oracle.resolveEvent(true);

        vm.expectRevert(DemoOracle.DirectResolutionDisabled.selector);
        oracle.fixPrice(200e6);
    }

    function test_H1_M2_ShareTradingFrozenPostResolution() public {
        // Alice deposits liquidity to ShareAMM
        shares.split(10e18, address(this));
        shares.yesShare().approve(address(yesAmm), 5e18);
        yesAmm.addLiquidity(100e6, 5e18, 1, block.timestamp);

        // Advance and settle atomically via oracle
        vm.warp(200);
        oracle.queueSettlement(true, 250e6);
        vm.warp(200 + 24 hours);
        oracle.executeSettlement();

        // AMM trading is now permanently frozen
        vm.startPrank(attacker);
        vm.expectRevert(ShareAMM.TradingFrozen.selector);
        yesAmm.buyShares(10e6, 1, block.timestamp);

        vm.expectRevert(ShareAMM.TradingFrozen.selector);
        yesAmm.sellShares(1e18, 1, block.timestamp);
        vm.stopPrank();
    }

    // =========================================================================
    // Phase 3 — H2: Constructor vault binding and zero/EOA validation
    // =========================================================================

    function test_H2_DeployingOracleWithZeroOrEOAReverts() public {
        // Zero address reverts
        vm.expectRevert(Ownable.ZeroAddress.selector);
        new DemoOracle(address(this), address(0), address(shares));

        vm.expectRevert(Ownable.ZeroAddress.selector);
        new DemoOracle(address(this), address(binary), address(0));

        // EOA with no bytecode reverts NotAContract
        vm.expectRevert(DemoOracle.NotAContract.selector);
        new DemoOracle(address(this), address(0x1234), address(shares));

        vm.expectRevert(DemoOracle.NotAContract.selector);
        new DemoOracle(address(this), address(binary), address(0x5678));
    }

    function test_H2_SettlementTargetsStoredVaults() public view {
        require(address(oracle.binaryVault()) == address(binary), "wrong binary vault");
        require(address(oracle.shareVault()) == address(shares), "wrong share vault");
    }

    // =========================================================================
    // Phase 4 — H3: Far-future refund escape hatch at par
    // =========================================================================

    function test_H3_RefundRevertsBeforeRefundAfter() public {
        binary.split(10e6, address(this));
        shares.split(10e18, address(this));

        // Time is after tradingCutoff (200) but before refundAfter (200 + 180 days)
        vm.warp(200 + 1 days);

        vm.expectRevert(BinaryVault.RefundNotActive.selector);
        binary.refund(10e18, address(this));

        vm.expectRevert(ShareVault.RefundNotActive.selector);
        shares.refund(10e18, address(this));
    }

    function test_H3_RefundWorksAtParAfterRefundAfterWithoutSettlement() public {
        uint256 beforeUsdc = usdc.balanceOf(address(this));

        uint256 binTokens = binary.split(50e6, address(this)); // Costs 50 USDC
        uint256 sharePairs = 2e18; // 2 pairs @ cap 500 = 1000 USDC
        uint256 shareCost = shares.split(sharePairs, address(this));
        require(shareCost == 1000e6, "cost mismatch");

        // Warp past refundAfter (cutoff + 180 days)
        vm.warp(binary.refundAfter() + 1);

        // Binary vault refund at par
        uint256 binRefunded = binary.refund(binTokens, address(this));
        require(binRefunded == 50e6, "binary refund not at par");

        // Share vault refund at par (requires complete set: YES + NO + RESIDUAL)
        uint256 shareRefunded = shares.refund(sharePairs, address(this));
        require(shareRefunded == 1000e6, "share refund not at par");

        // Invariant holds: total out == total in!
        require(usdc.balanceOf(address(this)) == beforeUsdc, "conservation broken");
    }

    function test_H3_RefundRevertsIfAlreadySettled() public {
        binary.split(10e6, address(this));
        shares.split(10e18, address(this));

        vm.warp(200);
        oracle.queueSettlement(true, 250e6);
        vm.warp(200 + 24 hours);
        oracle.executeSettlement();

        // Warp past refundAfter
        vm.warp(binary.refundAfter() + 10 days);

        vm.expectRevert(BinaryVault.AlreadySettled.selector);
        binary.refund(10e18, address(this));

        vm.expectRevert(ShareVault.AlreadySettled.selector);
        shares.refund(10e18, address(this));
    }

    function test_H3_RefundRevertsIfSettlementPendingInOracle() public {
        binary.split(10e6, address(this));
        shares.split(10e18, address(this));

        // Warp past refundAfter
        vm.warp(binary.refundAfter() + 1);

        // Oracle queues settlement
        oracle.queueSettlement(true, 250e6);
        require(oracle.isSettlementPending(), "not pending");

        // Refund must be blocked while settlement is pending
        vm.expectRevert(BinaryVault.SettlementPending.selector);
        binary.refund(10e18, address(this));

        vm.expectRevert(ShareVault.SettlementPending.selector);
        shares.refund(10e18, address(this));
    }

    // =========================================================================
    // Phase 6 — M4: Revert on dust and lossless split-merge roundtrip
    // =========================================================================

    function test_M4_BinaryMergeRevertsOnDust() public {
        binary.split(10e6, address(this)); // Mints 10e18 tokens

        // Try merging an inexact amount with fractional 1e12 dust
        uint256 dustAmount = 1e18 + 500; // 500 wei remainder
        vm.expectRevert(BinaryVault.InexactAmount.selector);
        binary.merge(dustAmount, address(this));

        // Merging exact multiple of 1e12 succeeds
        uint256 exactAmount = 1e18;
        uint256 collateralOut = binary.merge(exactAmount, address(this));
        require(collateralOut == 1e6, "exact merge failed");
    }

    function test_M4_ShareSplitAndMergeRevertOnInexactDust() public {
        // Try splitting an inexact pair count where (pairs * 500e6) % 1e18 != 0
        uint256 inexactPairs = 123456789012345678; // Fractional wei dust
        vm.expectRevert(ShareVault.InexactAmount.selector);
        shares.split(inexactPairs, address(this));

        // Split exact pairs (e.g. 1e18)
        shares.split(1e18, address(this));

        // Try merging an inexact amount
        vm.expectRevert(ShareVault.InexactAmount.selector);
        shares.merge(123456789012345678, address(this));
    }

    function test_M4_ShareSplitMergeExactRoundtripIsLossless() public {
        uint256 beforeBal = usdc.balanceOf(address(this));
        uint256 pairs = 25e17; // 2.5 shares @ 500 = 1250 USDC exactly

        uint256 cost = shares.split(pairs, address(this));
        require(cost == 1250e6, "cost not exact");

        uint256 returned = shares.merge(pairs, address(this));
        require(returned == 1250e6, "returned not exact");

        // Exact lossless roundtrip: 0 wei lost
        require(cost == returned, "skim accumulated");
        require(usdc.balanceOf(address(this)) == beforeBal, "balance changed");
    }

    // =========================================================================
    // Phase 7 — L2: SafeTransferLib extcodesize validation
    // =========================================================================

    function externalSafeTransfer(address token, address to, uint256 amount) external {
        token.safeTransfer(to, amount);
    }

    function externalSafeTransferFrom(address token, address from, address to, uint256 amount) external {
        token.safeTransferFrom(from, to, amount);
    }

    function test_L2_SafeTransferLibRevertsOnEOA() public {
        address emptyEoa = address(0xDEADBEEF);
        vm.expectRevert(SafeTransferLib.TransferFailed.selector);
        this.externalSafeTransfer(emptyEoa, alice, 100);

        vm.expectRevert(SafeTransferLib.TransferFailed.selector);
        this.externalSafeTransferFrom(emptyEoa, alice, address(this), 100);
    }

    // =========================================================================
    // Phase 8 — L1: Donation Immunity (Internal Reserve Tracking)
    // =========================================================================

    function test_L1_DonationDoesNotDistortBinaryPrice() public {
        // Seed BinaryAMM liquidity (50 YES + 50 NO)
        binary.split(50e6, address(this));
        ImpactToken(binary.yesToken()).approve(address(binaryAmm), 50e18);
        ImpactToken(binary.noToken()).approve(address(binaryAmm), 50e18);
        binaryAmm.addLiquidity(50e18, 50e18, 50e18, block.timestamp);

        uint256 priceBefore = binaryAmm.binaryPriceUSDC6(true);
        require(priceBefore == 500_000, "initial price not 50%");

        // Attacker mints and donates 500 YES tokens directly to BinaryAMM
        binary.split(500e6, attacker);
        vm.startPrank(attacker);
        ImpactToken(binary.yesToken()).transfer(address(binaryAmm), 500e18);
        vm.stopPrank();

        // Price signal must remain strictly unaffected
        uint256 priceAfter = binaryAmm.binaryPriceUSDC6(true);
        require(priceAfter == priceBefore, "price signal distorted by donation");
    }

    function test_L1_DonationDoesNotDistortSharePrice() public {
        // Seed YesAMM liquidity (100 USDC + 1 share)
        shares.split(1e18, address(this));
        usdc.approve(address(yesAmm), 100e6);
        ImpactToken(shares.yesShare()).approve(address(yesAmm), 1e18);
        yesAmm.addLiquidity(100e6, 1e18, 1, block.timestamp);

        uint256 priceBefore = yesAmm.sharePriceUSDC6();
        require(priceBefore == 100e6, "initial price not 100 USDC");

        // Attacker donates 500 USDC directly to YesAMM
        usdc.transfer(attacker, 500e6);
        vm.startPrank(attacker);
        usdc.transfer(address(yesAmm), 500e6);
        vm.stopPrank();

        // Price signal must remain strictly unaffected
        uint256 priceAfter = yesAmm.sharePriceUSDC6();
        require(priceAfter == priceBefore, "share price signal distorted by donation");
    }

    // =========================================================================
    // Phase 9 — M3: Fee Accounting Consistency and Stray Token Sweep
    // =========================================================================

    function test_M3_SweepStrayCollateralAndTokens() public {
        // Stray USDC sent to BinaryAMM
        usdc.transfer(address(binaryAmm), 25e6);

        // Attacker cannot sweep
        vm.prank(attacker);
        vm.expectRevert(BinaryAMM.Unauthorized.selector);
        binaryAmm.sweep(address(usdc), attacker);

        // Fee recipient sweeps stray USDC
        uint256 carolBefore = usdc.balanceOf(carol);
        uint256 swept = binaryAmm.sweep(address(usdc), carol);
        require(swept == 25e6, "sweep amount incorrect");
        require(usdc.balanceOf(carol) == carolBefore + 25e6, "carol balance incorrect");
    }

    // =========================================================================
    // Phase 10 — L4: Pause Guardian Emergency Trade Halting
    // =========================================================================

    function test_L4_PauseGuardianHaltsTradingOnly() public {
        // Non-guardian cannot pause
        vm.prank(attacker);
        vm.expectRevert(BinaryAMM.Unauthorized.selector);
        binaryAmm.setPaused(true);

        // Guardian pauses trading
        binaryAmm.setPaused(true);
        require(binaryAmm.paused(), "not paused");

        // Buy outcome reverts
        usdc.approve(address(binaryAmm), 10e6);
        vm.expectRevert(BinaryAMM.Paused.selector);
        binaryAmm.buyOutcome(true, 10e6, 1, block.timestamp);

        // Add liquidity reverts
        binary.split(10e6, address(this));
        ImpactToken(binary.yesToken()).approve(address(binaryAmm), 10e18);
        ImpactToken(binary.noToken()).approve(address(binaryAmm), 10e18);
        vm.expectRevert(BinaryAMM.Paused.selector);
        binaryAmm.addLiquidity(10e18, 10e18, 1, block.timestamp);

        // Guardian unpauses
        binaryAmm.setPaused(false);
        require(!binaryAmm.paused(), "still paused");
    }

    // =========================================================================
    // Phase 11 — C1: Dispute Guardian Timelock Cancellation
    // =========================================================================

    function test_C1_DisputeGuardianCanCancelSettlement() public {
        oracle.setDisputeGuardian(carol);
        require(oracle.disputeGuardian() == carol, "guardian not set");

        oracle.queueSettlement(true, 300e6);
        require(oracle.isSettlementPending(), "settlement not queued");

        // Attacker cannot cancel
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        oracle.cancelSettlement();

        // Dispute guardian successfully cancels within the 24-hour timelock window
        vm.prank(carol);
        oracle.cancelSettlement();
        require(!oracle.isSettlementPending(), "settlement still pending after dispute");
    }
}
