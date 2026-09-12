# THELEMA Verification & Integration Evidence

## 1. Executive Summary & Source Provenance

THELEMA is an autonomous prediction-and-impact market application designed for Arc Testnet (Chain ID `5042002`). This document provides comprehensive, auditable evidence of verification across local EVM smart contract economics, connected browser user journeys, cryptographic confidentiality bridges, and external sponsor boundaries.

- **Repository**: `https://github.com/ShrikarT/thelema`
- **Accepted Deployment Milestone Commit**: `47a9710`
- **Controlled Launch & Sponsor Milestone Commit**: `1130771`
- **GitHub Actions CI Link**: [Run #34076666501](https://github.com/ShrikarT/thelema/actions/runs/34076666501)
- **All Required CI Jobs Passing**:
  - `prepare`
  - `validate (contracts)`
  - `validate (arc-public)`
  - `validate (node)`
  - `validate (cre)`
  - `publish-evidence`

---

## 2. Test Evidence Breakdown

### A. Local EVM Contract Economics & Lifecycle (`tests/arc-evm.integration.mjs`)
- **Execution Command**: `npm run test:evm` (or `node --test tests/arc-evm.integration.mjs`)
- **Results**: 1 parent test + 14 nested subtests (= 15 TAP tests, 15 passing) against compiled Solidity contracts on Anvil (Chain ID `5042002`).
- **Verified Invariants**:
  1. **Two-Stage Settlement Economics & Collateral Accounting**:
     - BinaryVault collateral invariant: $C = \text{max}(S_{\text{yes}}, S_{\text{no}})$.
     - ShareVault continuous collateral invariant: $C = \sum q_i \times \text{cap}$.
     - Complete-set conservation: Depositing $C = 500$ USDC mints 1 YES + 1 NO + 1 Residual ($R$). For any settlement index $S \ge 0$, total payoff $X + 0 + (C - X) \equiv C$, guaranteeing absolute vault solvency.
     - Initial collateral requirements: 20.00 USDC for BinaryVault sets, 50.00 USDC for ShareVault sets (0.1 complete sets at $500.00 cap), plus initial AMM seed collateral (11.655 USDC for yesShareAMM, 4.366 USDC for noShareAMM), totaling 86.021 USDC initial collateral.
     - Remaining locked collateral dynamically tracks outstanding unredeemed sets.
     - Correct payoff calculation at $200.00 settlement price:
       - $0.1 \times 200 = 20.00 \text{ USDC}$ (0.1 yesShare)
       - $0.1 \times (500 - 200) = 30.00 \text{ USDC}$ (0.1 residualShare)
       - Binary outcome is strictly separate (1:1 payout on winning outcome tokens).
  2. **Single-Balance Shared-USDC Preflight**:
     - Enforces that native USDC (18 decimals, gas) and ERC-20 USDC (6 decimals, collateral) reflect the same underlying balance on Arc.
     - Never adds native and ERC-20 balances together.
     - Dynamic gas estimation includes a `30%` safety reserve and accounts for approval transactions.
     - Halts before broadcast if wallet is underfunded (zero transactions sent).
  3. **Proposed 100.00 USDC Spending Ceiling & Cumulative Accounting**:
     - Strict verification that `incurred_spending + remaining_spending <= 100.00 USDC`.
     - Retains and counts every transaction attempt, including gas consumed by reverted transactions.
     - Retrieves actual historical fees (`effectiveGasPrice` from receipt or tx) and halts on unresolvable history.
     - Pre-broadcast rechecks bound transaction fees (`maxFeeBound = 130%` of RPC gas price) and prevent broadcasts if the ceiling would be breached.
  4. **Unconditionally Read-Only Address Preflight**:
     - Verifies `--address <0x...>` mode is strictly read-only even when `RELEASE_APPROVED=true` or private keys are in the environment.
     - Broadcasts 0 transactions (deployer nonce unchanged).
     - Does not call `anvil_setCode`, `anvil_setBalance`, or mint MockUSDC.
     - Reconciles receipts in memory without modifying the active manifest on disk.
     - Enforces matching `APPROVED_DEPLOYER_ADDRESS` for non-local write operations.
  5. **Crash-Safe Atomic Journaling & Resume**:
     - Simulates process termination immediately after transaction broadcast and after block mining.
     - On restart, reconciles transaction receipts from the mempool/chain and avoids duplicate broadcasts.
     - Preserves step hashes and nonces across recoveries.
  6. **RPC Secret Redaction & Local Identity Verification**:
     - Redacts URL paths, credentials, and query parameters to the safe origin across logs, manifests, and error messages.
     - Verifies local node identity via `web3_clientVersion` (must contain `anvil`) and `anvil_nodeInfo`, failing closed on loopback proxies to unverified nodes.
  7. **Cutoff Timing & Operator Enforcement**:
     - Timing defaults documented: 1h event deadline / 2h cutoff on local EVM; 24h event deadline / 48h cutoff on public targets.
     - Splits and trades succeed before trading cutoff; revert immediately after trading cutoff (`TradingFrozen`).
     - Operator commands enforce strict price formatting (decimal with $\le 6$ decimals) and stage ordering (`EVENT_RESOLVED` before `PRICE_FIXED`).

### B. Connected Consumer Browser Verification (`tests/arc-evm-browser.integration.mjs` & `tests/browser.mjs`)
- **Execution Command**: `npm run test:ui`
- **Results**: 18 Playwright unit checks in `tests/browser.mjs` + 13-step connected wallet browser flow in `tests/arc-evm-browser.integration.mjs` (all passing).
- **Verified Journeys**:
  1. Consumer wallet connection to Arc EVM network.
  2. Real-time balance and pricing synchronization from contract read calls.
  3. Collateral split into fractional sets (0.1 complete sets: 0.1 YES, 0.1 NO, 0.1 Residual).
  4. Outcome trading on BinaryAMM (YES/NO tokens).
  5. Continuous impact share trading on ShareAMM (yesShare/noShare).
  6. Operator event resolution (`YES`) and price fixing ($200.00).
  7. Binary outcome claim: separate 1:1 redemption of winning YES tokens.
  8. Continuous Share & Residual claim: exact redemption of `63.627665 USDC` collateral (`33.627665 USDC` from continuous asset-share holding + `30.000000 USDC` from backed 0.1 residual share holding). Total collateral payout confirmed on-chain.
  9. Negative rejection verification: browser UI throws with 0 broadcast transactions when positions are exhausted; direct contract redemption reverts on-chain.

### C. Core Math & Financial Invariants (`npm test`)
- **Execution Command**: `npm test`
- **Results**: 212 tests (0 suites, 212 passing).
- **Verified Functions**: BigInt fixed-point arithmetic, ceiling clamps, fee deductions (30 bps), strict decimal conversion (6 vs 18 decimals), API response schemas, HTTP security headers, CSRF guards, Graph mock adapters, sanitized live Graph evidence logging, and CRE policy logic.

### D. Foundry Smart Contracts (`packages/contracts`)
- **Execution Command**: `cd packages/contracts && forge test -vvv`
- **Results**: 24 tests (24 passing in CI).
- **Verified Invariants**: Complete-set minting and merging, invariant conservation ($C \to Y + N + R$), AMM pricing, fee accounting, oracle stages, and trading cutoffs.

### E. CRE Bridge & Crypto Verifications (`tests/bridge.test.mjs`, `services/cre-bridge/crypto.test.mjs`)
- **Execution Command**: `npm run test:bridge; npm run test:bridge:crypto`
- **Results**: 37 bridge tests and 2 real cryptographic signature tests passing.
- **Verified Features**: EIP-191 JWT recovery of dedicated ephemeral signer key, single-use replay protection tokens, HMAC-SHA256 callback integrity, constant-time token comparisons, and fail-closed timeout cleanup.

---

## 3. Sponsor Integration Verification Tiers & Trust Boundaries

THELEMA strictly demarcates verified local/automated capabilities from external boundaries requiring operator credentials or live networks:

### A. Chainlink CRE Sponsor Verification (4 Distinct Tiers)
Chainlink Confidential Runtime Environment (CRE) verification is categorized into four distinct, non-overlapping tiers evaluated by `scripts/verify-cre.mjs` (`npm run verify:cre`):

1. **Tier 1: Deterministic Policy Tests** (`policy`): **VERIFIED**
   - Verified via pure unit tests in `packages/cre/policy.test.mjs`. Confirms confidential clip arithmetic, bounds checking, and JSON envelope serialization without external dependencies.
2. **Tier 2: Source-Linked Enclave Build Evidence** (`build`): **RECORDED / NOT REBUILT**
   - Verified via `docs/evidence/cre-build.json` and on-disk `packages/cre/dist/workflow.wasm`.
   - Validates that the WASM binary exists, passes `WebAssembly.validate()`, matches the recorded SHA-256 hash (`2ff6...8b8b`), exports a 0-argument `main` function, and matches the recorded `sourceDigests` of `packages/cre/workflow.ts`, `packages/cre/project.yaml`, `packages/cre/policy.ts`, and `packages/cre/package.json`.
   - Explicitly notes that the WASM artifact is recorded in repository source control and is not freshly recompiled locally during test execution.
3. **Tier 3: Official CRE Simulation Transcript** (`simulation`): **NOT_RUN**
   - Evaluates `packages/cre/cre-sim.txt`. Fails closed if the transcript contains `NOT RUN` markers, failed simulation logs, missing artifacts, or malformed evidence.
   - Accurately reports `NOT_RUN` because official simulation requires authenticated Chainlink CRE CLI credentials.
4. **Tier 4: Live Execution Bridge Connectivity** (`live`): **UNCONFIGURED / STANDBY**
   - Requires explicit operator opt-in (`--execute-live`). The mere presence of credentials (`CRE_CLIP_URL`, `CRE_CLIP_TOKEN`) does not automatically trigger network requests.
   - When opt-in is provided, performs health checks and signed test clips against the authenticated HTTPS bridge. Standby when unconfigured.

**Trust Boundary Assumptions for CRE HTTP Bridge**:
- The client/consumer verifies the dedicated ephemeral signer's EIP-191 signature on callbacks.
- The client does **NOT** directly verify hardware enclave attestation measurements (SGX/TDX quote verification). Trust in enclave execution relies on the authenticated bridge boundary.

---

### B. The Graph Sponsor Verification Tiers
The Graph integration is evaluated by `scripts/verify-graph.mjs` (`npm run verify:graph`):

1. **Tier 1: Unit & Schema Verification** (`schema`): **VERIFIED**
   - Unit tests in `tests/verify-graph.test.mjs` (9/9 passing) verify schema normalization, entity extraction (`fixedProductMarketMaker`, `liquidityPool`), error handling (HTTP 500/401, GraphQL errors, null entities), and stale block timestamp enforcement (< 900s).
2. **Tier 2: Live Gateway Query Verification** (`live`): **UNCONFIGURED / STANDBY**
   - When run without `--require-configured`, exits `0` with informative status indicating that live queries require environment credentials (`GRAPH_API_KEY`, subgraph IDs).
   - When run with `--require-configured` or when credentials are provided, queries The Graph Decentralized Gateway and fails closed (`exit 1`) if the API key is missing, endpoints fail, or data is stale.

**Trust Boundary Assumptions for The Graph**:
- Graph references represent correlated event and asset market pricing for comparability analysis.
- Unconfigured references are treated as honest STANDBY, never substituted with mocked or synthetic values.

---

## 4. Proven vs Blocked External Boundaries

| Domain | Boundary Component | Status | Audited Proof / Blocked Reason |
| :--- | :--- | :--- | :--- |
| **Arc Network** | Local EVM Contracts & Economics | **PROVEN** | Full lifecycle and settlement verified on Anvil (Chain ID 5042002). |
| **Arc Network** | Address-Only Preflight & Plan | **PROVEN** | `scripts/deploy-demo.mjs --address` verified read-only under 100-USDC ceiling. |
| **Arc Network** | Live Public Testnet Broadcast | **BLOCKED (BY DESIGN)** | Requires owner funding and explicit `RELEASE_APPROVED=true` authorization. |
| **The Graph** | Normalized Query Projections | **PROVEN** | Schemas for `fixedProductMarketMaker` and `liquidityPool` verified with `<900s` freshness. |
| **The Graph** | Opt-In Verification Tool | **PROVEN** | `npm run verify:graph` checks schemas and exits gracefully if unconfigured; fails closed if configured queries fail. |
| **The Graph** | Live Gateway Data Feed | **BLOCKED (CREDENTIALS)** | Awaiting production Graph API Key and indexed market ID from operator. |
| **Chainlink CRE** | Enclave Code WASM Validation | **PROVEN** | `packages/cre/dist/workflow.wasm` validated on disk and against `docs/evidence/cre-build.json` source digests. |
| **Chainlink CRE** | Local Deterministic Policy | **PROVEN** | Pure policy and callback envelope simulation verified in unit test suites. |
| **Chainlink CRE** | 4-Tier Verification Tool | **PROVEN** | `npm run verify:cre` validates Policy, Build, Simulation, and Live tiers independently. |
| **Chainlink CRE** | Live Confidential Execution | **BLOCKED (HOST/TOKEN)** | Requires operator HTTPS bridge (`CRE_CLIP_URL`, `CRE_CLIP_ALLOWED_HOST`, `CRE_CLIP_TOKEN`) and explicit `--execute-live` opt-in. |

> [!NOTE]
> *Notice on Chainlink CRE Architecture*: On-chain contracts such as `CRE_FORWARDER` are not substitutes for the HTTP confidential bridge required for live enclave callbacks. Live execution requires an authenticated HTTPS bridge endpoint terminating TLS.
