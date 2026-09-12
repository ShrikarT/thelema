> Historical delegated review. Superseded by docs/CONTRACTS.md and the later main-agent corrections. It is not audit or execution evidence.

# Contract review notes

## Status

**Uncompiled and untested in this delivery environment.** `forge`, native `solc`, and Node `solc` were unavailable. No package installation or network workaround was attempted. Treat all artifacts as review candidates, not deployable binaries.

## Manual review findings

### Intended protections

- Reentrancy lock on all token-moving vault and AMM entrypoints.
- Low-level safe transfer wrappers support ERC-20 tokens that return either `true` or no data.
- Immutable collateral, oracle, fee recipient, fee rate, settlement vault, and pool token references.
- One-shot owner oracle; settlement is one-shot at each vault.
- Deadline and minimum-output checks on trades and liquidity operations.
- Binary fees are separately accounted; withdrawals are limited to the fee recipient.
- Share AMM fees remain in reserves and accrue pro rata to LP holders.
- No residual-skimming method in `ShareVault`.
- Removed any delegated binary `splitFrom` API; a caller can only split its own approved collateral.

### Known limitations / production blockers

1. **No compiler/test evidence.** Resolve every compiler, formatter, and test failure before any deployment.
2. **Demo oracle centralization.** A single owner chooses the boolean event and `S`. Use multisig, timelock, or a production oracle for real value.
3. **Residual is permanently stranded.** `ShareVault` intentionally locks `C-min(S,C)` forever. Confirm this product/accounting treatment and legal disclosures.
4. **Whole-share constraint.** `ShareVault` only mints/redeems multiples of `1e18`; share AMMs may trade fractions, but fractional winning shares cannot be redeemed directly. They can be aggregated/transferred until whole. Confirm desired UX.
5. **Reserve multiplication bounds.** Constant-product and LP calculations use checked Solidity multiplication. Extreme reserves can revert from overflow, producing denial of service rather than loss. For production, replace with audited 512-bit `mulDiv` math and fuzz boundary values.
6. **Token assumptions.** Deployment assumes canonical USDC has 6 decimals, no transfer fee, no rebasing, and conventional `approve`. The contracts do not query/validate decimals.
7. **Donation-sensitive pools.** Reserve reads use token balances. Direct token transfers to AMMs are donations that alter price and LP value. This is normal for simple balance-based pools but should be documented.
8. **Initial liquidity pricing.** First LP chooses pool ratio. Deployers need guarded launch procedures; otherwise initial price can be manipulated.
9. **No pause or migration.** Immutability is deliberate, but bugs cannot be paused or rescued. Use only after audit or add a narrowly-scoped, timelocked emergency design.
10. **Oracle target binding.** `DemoOracle` is not constructed with fixed vault addresses; the owner chooses the two targets on the one publish call. Frontend/deployment must verify the emitted deployment graph. A production version should bind targets immutably.
11. **LP minimum liquidity.** No permanently locked minimum LP supply exists. Last LP can remove all liquidity. Quotes then revert until reseeded.
12. **Rounding.** Binary selected reserve uses ceiling division to prevent invariant decrease. Other payouts/quotes round down. Fuzz conservation and dust behavior.

## Required predeployment verification

- Compile with Solidity 0.8.24 and inspect warnings.
- Run all included tests and add invariant/fuzz tests for collateral solvency, AMM `k`, and rounding.
- Differential-test quote functions against frontend bigint implementations.
- Confirm Arc canonical USDC behavior and code at the supplied address on chain 5042002.
- Run Slither and an independent manual audit.
- Simulate oracle YES/NO and `S` values 0, below cap, equal cap, and above cap.
- Confirm all production owner/fee recipient addresses and deployment output before any broadcast.
