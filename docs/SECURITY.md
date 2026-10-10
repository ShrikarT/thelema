# Security Architecture and Audit Remediation

## Overview

THELEMA is an on-chain synthetic impact-market and futarchy research protocol on Arc.
This document details the security mitigations, threat model, and trust boundaries implemented following the comprehensive October 8 security audit.

---

## Audit Hardening Summary (Findings C1 through L4)

### 1. Oracle Settlement Architecture (C1, H1, H2, M2, L3)
- **Two-Step Ownership Transfer (C1, L3)**: `Ownable.sol` requires a two-step handshake (`transferOwnership` sets `pendingOwner`, and only `pendingOwner` can call `acceptOwnership`). A typo cannot brick oracle governance.
- **24-Hour Settlement Timelock (C1)**:
  - All settlements must be queued via `queueSettlement(eventYes, spotPrice6)` on `DemoOracle.sol`.
  - Execution via `executeSettlement()` is locked until `block.timestamp >= queuedUnlockTimestamp` (24 hours after queueing).
  - The oracle owner or an independent `disputeGuardian` can call `cancelSettlement()` during the timelock window if false or compromised data is submitted.
- **Multisig Governance Requirement (C1)**: On Arc Mainnet (`chainId: 5042`), `Deploy.s.sol` strictly enforces that the contract owner is a multisig Safe contract (`safeAddress.code.length > 0` and distinct from deployer EOA).
- **Atomic Settlement Only (H1, M2)**:
  - Direct individual resolution calls (`resolveEvent` / `fixPrice`) are disabled (`DirectResolutionDisabled`).
  - Settlement executes in a single atomic transaction through `publishAndSettle` / `executeSettlement`, eliminating public mempool front-running windows.
  - Trading on `ShareVault` is immediately frozen upon event resolution (`ShareVault.assertShareTradingAllowed()` checks `lifecycle == OPEN`), closing any insider trading opportunities.
- **Immutable Vault Binding (H2)**: Vault addresses (`binaryVault` and `shareVault`) are stored immutably in the `DemoOracle` constructor with bytecode existence checks (`code.length > 0`), preventing silent misdirection to unverified sinks or stale addresses.

### 2. Vault Solvency & Par Refund Escape Hatch (H3, M4)
- **180-Day Par Refund Escape Hatch (H3)**:
  - If the oracle keys are lost, inactive, or bricked post-cutoff, complete-set holders can invoke `refund(pairs, receiver)` after `refundAfter` (`tradingCutoff + 180 days`).
  - Redemptions occur at par ($1.00$ USDC per binary pair; $C = 500.00$ USDC per share pair $Y + N + R$).
  - Conservation is 100% preserved. The escape hatch reverts if settlement is pending or already finalized.
- **Exact Rounding & Dust Reverts (M4)**:
  - Split and merge operations enforce exact divisibility (`InexactAmount` revert on any non-zero remainder).
  - Eliminates fractional skim accumulation across split/merge roundtrips.

### 3. AMM Resilience & Guardian Controls (L1, L2, L4, M3)
- **Tracked Internal Reserves (L1)**: `BinaryAMM` and `ShareAMM` track internal token balances (`reserveYes18`, `reserveNo18`, `reserveStable6`, `reserveShares18`) in storage rather than querying raw `balanceOf`. Direct ERC-20 donations do not alter pricing or skew probability/spot ratios.
- **Contract Existence Checks (L2)**: `SafeTransferLib.sol` verifies `token.code.length > 0` prior to calling low-level transfers, protecting against silent success on non-contract addresses.
- **Emergency Pause Guardian (L4)**:
  - A pause guardian can invoke `setPaused(true)` on `BinaryAMM` and `ShareAMM`.
  - Halts all trading and new liquidity deposits immediately.
  - Critically, LP liquidity withdrawals (`removeLiquidity`) and vault par redemptions (`redeem` / `merge`) remain fully functional during pause to guarantee users can exit.
- **Stray Token Sweeping (M3)**: `BinaryAMM` and `ShareAMM` provide a `sweep(token, to)` function restricted to the guardian to safely recover collateral in excess of tracked reserves or extraneous tokens.

---

## Chain Configuration & Precompiles (M1)

- **Unified Single Source of Truth**: All components (`packages/core/chain.ts`, `packages/arc/client.ts`, `apps/web/src/wallet.ts`, `script/Deploy.s.sol`) reference a centralized chain definition.
- **Chain Profiles**:
  - Arc Mainnet: `chainId: 5042`, RPC: `https://rpc.arc.io`, Explorer: `https://arcscan.app`
  - Arc Testnet: `chainId: 5042002`, RPC: `https://rpc.testnet.arc.io`, Explorer: `https://testnet.arcscan.app`
- **Native USDC Precompile**: `0x3600000000000000000000000000000000000000` (6 decimals). Verified on Arc.

---

## Operator Best Practices & Runbook Controls

1. **Private Mempool Settlement**: When submitting settlement transactions to Arc, operators should submit via a private mempool endpoint where supported to prevent front-running attempts.
2. **Preflight Balance & Ceiling Checks**: Deployers and operators run automated preflight balance validations enforcing strict spending ceilings (e.g. 100 USDC testnet ceiling) before broadcasting.
3. **Multi-signature Sign-off**: Production mainnet operations must be initiated and executed through a Gnosis Safe multisig with at least 2-of-3 threshold.
