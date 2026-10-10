# Contract Implementation and Architecture Review

## Status

**Hardened for Arc Mainnet deployment readiness.**
- **Foundry unit & invariant tests**: 49 / 49 passing (`npm run test:contracts`).
- **TAP regression suite**: 239 / 239 passing (`npm test`).
- **Local EVM integration**: 15 / 15 passing (`npm run test:evm`).
- **Browser UI EVM integration**: 100% verified (`npm run test:ui:evm`).
- **TypeScript & Build**: Clean compilation, zero lint or type errors (`npm run typecheck && npm run build`).

All contracts are self-contained Solidity 0.8.24 without unverified external dependencies. Tests execute against explicit interfaces and cheat codes. Zero unauthorized mainnet funds have been risked.

---

## Thelema Positioning & Intuition

> **"What does an event do to an asset's price? Trade the impact, not just the odds — trade both worlds in one conserved vault."**

THELEMA is a synthetic impact-market research protocol and conditional market mechanism based on futarchy principles. It is **not** a gambling venue, betting exchange, or leveraged CFD platform:
1. **Fully-Collateralized Solvency**: 100% backed in native 6-decimal USDC (`0x3600000000000000000000000000000000000000`). Zero leverage, zero rehypothecation, zero fractional reserves.
2. **Futarchy Mechanism**: Prices continuous conditional expectations $\mathbb{E}[S \mid \text{YES}]$ and $\mathbb{E}[S \mid \text{NO}]$ against event probability $P(\text{event})$ within a single conserved vault.
3. **Mathematical Solvency Invariant**: Complete set minting $C \to \text{YES} + \text{NO} + R$ satisfies $X + 0 + (C - X) \equiv C$ identically across all states of the world.

---

## Financial Model & Complete-Set Conservation ($C \to Y + N + R$)

### 1. Complete-Set Minting & Merging
- **Minting**: Depositing $C$ USDC collateral ($C = 500.00$ USDC per set) mints three distinct ERC-20 tokens:
  $$\text{Deposit } C \text{ USDC} \longrightarrow 1 \text{ YES Share} + 1 \text{ NO Share} + 1 \text{ Residual Share } (R)$$
- **Merging**: Merging back to $C$ USDC collateral requires returning all three tokens:
  $$1 \text{ YES Share} + 1 \text{ NO Share} + 1 \text{ Residual Share } (R) \longrightarrow C \text{ USDC}$$
  Attempting to merge only YES and NO shares without Residual reverts on-chain.
- **Dust-Free Arithmetic**: Split and merge enforce exact divisibility (`InexactAmount` revert on non-zero remainder) to ensure lossless roundtrips.

### 2. Settlement Payoffs & Absolute Solvency
At settlement, the oracle determines the event outcome ($\text{YES}$ or $\text{NO}$) and fixes the settlement price $S \ge 0$. The payout index is capped at $C$:
$$X = \min(S, C)$$

The three tokens pay out according to the realized world:
- **If Event resolves YES**:
  - Each YES Share pays: $X = \min(S, C)$ USDC
  - Each NO Share pays: $0$ USDC
  - Each Residual Share ($R$) pays: $C - X$ USDC
- **If Event resolves NO**:
  - Each NO Share pays: $X = \min(S, C)$ USDC
  - Each YES Share pays: $0$ USDC
  - Each Residual Share ($R$) pays: $C - X$ USDC

**Solvency Invariant**:
$$\text{Total Payout} = X + 0 + (C - X) \equiv C$$
For every possible state of the world ($\text{YES}$ or $\text{NO}$) and for all index values $S \ge 0$, the aggregate payout across one complete set is identically equal to $C$.

---

## Security Audit Hardening Matrix (Oct 8 Audit Findings)

| ID | Severity | Vulnerability Description | Applied Hardening Fix | Test Coverage |
| :--- | :--- | :--- | :--- | :--- |
| **C1** | Critical | Single-EOA oracle control over settlement; single-step ownership | Multisig Safe requirement for Arc Mainnet; 24h timelocked settlement (`queueSettlement` $\to$ `executeSettlement`); cancellation path; dispute guardian challenge window | `test_C1_SettlementTimelockEnforced`, `test_C1_DisputeGuardianCanCancelSettlement` |
| **H1** | High | Settlement front-running in public mempool | Atomic settlement path only (`publishAndSettle` / `settle`); direct `resolveEvent` and `fixPrice` disabled | `test_H1_M2_AtomicSettlementOnly` |
| **H2** | High | Vault addresses passed as per-call parameters | Vaults bound immutably in `DemoOracle` constructor with bytecode existence checks (`code.length > 0`) | `test_H2_DeployingOracleWithZeroOrEOAReverts`, `test_H2_SettlementTargetsStoredVaults` |
| **H3** | High | No escape hatch if oracle fails / bricks | 180-day post-cutoff par refund escape hatch (`refundAfter = tradingCutoff + 180 days`) in `BinaryVault` and `ShareVault` | `test_H3_RefundWorksAtParAfterRefundAfterWithoutSettlement`, `test_H3_RefundRevertsIfAlreadySettled` |
| **M1** | Medium | Chain ID and precompiles hardcoded inconsistently | Single source of truth in `packages/core/chain.ts` supporting Arc Mainnet (`5042`) and Arc Testnet (`5042002`) | TAP chain verification |
| **M2** | Medium | Insider-trading window between event resolution and price fixing | Trading frozen immediately upon event resolution (`ShareVault.assertShareTradingAllowed()` reverts if `lifecycle != OPEN`) | `test_H1_M2_ShareTradingFrozenPostResolution` |
| **M3** | Medium | Untracked stray tokens in AMMs | Added `sweep(address token, address to)` in `BinaryAMM` and `ShareAMM` restricted to guardian | `test_M3_SweepStrayCollateralAndTokens` |
| **M4** | Medium | Dust loss on merge / floor-ceil asymmetry | Exact rounding with `InexactAmount` revert on dust in binary & share split/merge; zero skim accumulation | `test_M4_BinaryMergeRevertsOnDust`, `test_M4_ShareSplitMergeExactRoundtripIsLossless` |
| **L1** | Low | Donation-based AMM price skew | Internal tracked reserves (`reserveYes18`, `reserveNo18`, `reserveStable6`, `reserveShares18`) in AMMs; donation immune | `test_L1_DonationDoesNotDistortBinaryPrice`, `test_L1_DonationDoesNotDistortSharePrice` |
| **L2** | Low | `SafeTransferLib` silent no-op on EOAs | Added explicit `token.code.length == 0` validation before calling `transfer`/`transferFrom` | `test_L2_SafeTransferLibRevertsOnEOA` |
| **L3** | Low | Single-step ownership typo bricking | Two-step ownership transfer (`transferOwnership` + `acceptOwnership`) implemented in `Ownable.sol` | `test_C1_TwoStepOwnershipRoundTrip` |
| **L4** | Low | Lack of emergency incident response | Pause-only guardian multisig (`paused`, `setPaused`, `setGuardian`) on AMMs halting trading/deposits while preserving LP exits | `test_L4_PauseGuardianHaltsTradingOnly` |

---

## Contract Inventory

- `src/vault/BinaryVault.sol`: 6-decimal collateral $\to$ 18-decimal complete sets ($1.00 \to 1\text{ YES} + 1\text{ NO}$); exact split/merge; immutable oracle binding; 180-day par refund.
- `src/vault/ShareVault.sol`: 500-USDC complete sets ($C \to \text{YES} + \text{NO} + R$); atomic settlement; trading frozen at resolution; exact split/merge; 180-day par refund.
- `src/amm/BinaryAMM.sol`: Tracked internal reserves, constant-product binary pool, pause guardian, stray token sweep, minimum initial liquidity.
- `src/amm/ShareAMM.sol`: Tracked internal reserves, constant-product share pool, pause guardian, stray token sweep, minimum initial liquidity.
- `src/DemoOracle.sol`: 24h timelocked settlement queue, dispute guardian, two-step ownership, immutable vault bindings.
- `src/oracle/DataStreamsAdapter.sol`: Chainlink Data Streams pull-oracle adapter with on-chain cryptographic verification and normalized 6-decimal spot output.
- `src/interfaces/IDataStreamsVerifier.sol`: Interface for Chainlink Data Streams report verifier contracts.
- `src/lib/Ownable.sol`: Hardened two-step ownership pattern (`pendingOwner`).
- `src/lib/SafeTransferLib.sol`: Bytecode-verified safe ERC-20 transfer wrapper.
- `script/Deploy.s.sol`: Production deployment script with Arc Mainnet multisig Safe checks, gas limits, and one-time vault-oracle initialization.

---

## Verification Commands

```bash
# Run Foundry contract suite (49 tests)
npm run test:contracts

# Run TAP test suite (239 tests)
npm test

# Run Local EVM integration (15 tests)
npm run test:evm

# Run Browser UI EVM integration
npm run test:ui:evm

# Run typecheck & build
npm run typecheck && npm run build
```
