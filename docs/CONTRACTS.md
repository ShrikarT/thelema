# Contract Implementation and Architecture Review

## Status

**Compiled and verified in Foundry (24/24 tests passing) and Local EVM integration (1 parent + 14 subtests = 15 TAP tests). NOT deployed to public mainnet. Unaudited research prototype.**

All contracts are self-contained Solidity 0.8.24 without external dependency downloads. Foundry tests execute against explicit interfaces and cheat codes. Local EVM integration runs on an ephemeral Anvil node (Chain ID `5042002`). Zero public transactions have been broadcast (`releaseApproved: false`).

---

## Financial Model & Complete-Set Conservation ($C \to Y + N + R$)

THELEMA uses a strictly solvent, fully-collateralized complete-set model for continuous conditional impact assets:

### 1. Complete-Set Minting & Merging
- **Minting**: Depositing $C$ USDC of collateral ($C = 500.00$ USDC per set) mints three distinct ERC-20 tokens:
  $$\text{Deposit } C \text{ USDC} \longrightarrow 1 \text{ YES Share} + 1 \text{ NO Share} + 1 \text{ Residual Share } (R)$$
- **Merging**: Merging back to $C$ USDC collateral requires returning all three tokens:
  $$1 \text{ YES Share} + 1 \text{ NO Share} + 1 \text{ Residual Share } (R) \longrightarrow C \text{ USDC}$$
  Attempting to merge only YES and NO shares without Residual is rejected on-chain (`InsufficientBalance`).

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
For every possible state of the world ($\text{YES}$ or $\text{NO}$) and for all index values $S \ge 0$, the aggregate payout across one complete set is identically equal to $C$. The vault's collateral balance always satisfies $\text{balance} \ge \text{remainingLiabilities}$, ensuring mathematical solvency with zero shortfall risk.

---

## Settlement-Horizon Comparability Labeling: Capped Horizon Index vs Spot Price

It is critical to distinguish between an unconstrained spot asset price and THELEMA's conditional settlement payoffs:
- **Capped Horizon Index ($S \le \text{cap}$)**:
  The conditional share payoffs $q_Y$ and $q_N$ reflect the market's expectation of the settlement price **capped at $C = 500$ USDC** at the future settlement horizon.
- **Not Spot Asset Price**:
  An external spot asset (e.g. NVDA equity) can trade freely without a ceiling (e.g. $\$600$, $\$800$, $\$1,200$). In contrast, THELEMA shares can never pay more than $C = \$500.00$ per share.
- **Comparability Labeling**:
  All market displays, API endpoints, and documentation explicitly label implied index valuations as **Capped Horizon Index ($S \le \text{cap}$)**. The sum $q_Y + q_N$ is a horizon-comparability metric under the capped contract payoff, not an assertion of spot equity equivalence.

---

## Components

- `src/vault/BinaryVault.sol`: six-decimal collateral -> 18-decimal complete sets; merge before settlement; winning-token redemption afterward.
- `src/vault/ShareVault.sol`: 500-USDC collateral per complete set ($C \to Y + N + R$); cap at settlement; residual redemption.
- `src/amm/BinaryAMM.sol`: complete-set-mint constant-product buys, LP accounting and separated protocol fees.
- `src/amm/ShareAMM.sol`: independent USDC/share CPMMs, buy/sell and LP operations.
- `src/token/ImpactToken.sol`: vault/pool-controlled mint/burn ERC20.
- `src/DemoOracle.sol`: owner-controlled, two-stage publication and settlement of both vaults with strict timing cutoffs.
- `script/Deploy.s.sol`: Arc-only deployment script; uses real owner/fee-recipient inputs and requires the expected 30-basis-point fee.
- `src/interfaces/IImpact.sol` and `abi/IImpact.json`: interface/source mirror only.

---

## Key Invariants & Hardened Logic

1. **Fractional winning tokens can redeem.** AMMs produce fractional balances. Binary payout is `amount18 / 1e12`; share payout is `shares18 * cappedValue6 / 1e18`.
2. **Fractional share sets.** Split costs $\lceil\text{units} \times 500\text{ USDC}\rceil$; merge returns the floor. Residual is computed from actual vault collateral minus aggregate winning liability at settlement.
3. **Six-decimal collateral validation.** Vault constructors require a successful `decimals()` response equal to six.
4. **Positive trade outputs/minimums.** Buy/sell paths reject zero output and zero minimum output. Deployment uses the UI's 0.30% fee.
5. **Dust burns.** Positive winning token balances with a zero micro-USDC payout can still be burned; zero transfers are skipped. Per-holder rounding dust remains in the vault.
6. **Execution Evidence**: 24/24 Foundry unit tests pass (`forge test -vvv`) and 15/15 local EVM integration tests pass (`npm run test:evm`).

## Differences to the simulator

- On-chain binary `split` takes collateral in micro-USDC and mints multiples of `1e12` token wei. The simulator permits finer pair quantities and rounds collateral upward. The wallet UI restricts live binary splits to six decimal places of pairs.
- The simulator clears both winning and losing local positions at claim. On-chain redemption accepts only the winning token; losing tokens remain worthless balances. The UI does not promise a losing-token payout.
- A zero-value on-chain dust burn is allowed. The simulator refuses zero-collateral pair operations.
- Read-only contract quote methods may still return a price after settlement; execution is frozen. The app rejects settled-market quotes before requesting a wallet transaction.
- Post-settlement LP removal is available in the source. LP administration and share sells are not exposed in the current web UI.

## Security & Verification Guidance

```sh
cd packages/contracts
forge build
forge test -vvv
```

All 24 smart contract unit and regression tests pass in Foundry and run in CI on every push. Invariant edge cases, arithmetic bounds, donation/rounding behavior, fee-on-transfer/rebasing token exclusions, oracle controls, initialization and LP ownership are verified in code. Independent external security audit is required before any meaningful funds are used on public mainnet.

The demo oracle can decide the event/index; there is no dispute window or independent policy/news feed in this demo prototype. This is a deliberate trust assumption, not decentralized resolution.

