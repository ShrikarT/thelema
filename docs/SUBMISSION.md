# THELEMA Hackathon Submission Package

This document consolidates the complete submission texts, partner bounty mappings, and technical track descriptions for THELEMA.

- **Project Name**: THELEMA (Autonomous Synthetic Prediction-and-Impact Market)
- **Tagline**: The world's first synthetic prediction-and-impact market for correlated world events and asset outcomes on Arc, with Chainlink CRE confidential size clipping and The Graph decentralized market intelligence.
- **Repository**: `https://github.com/ShrikarT/thelema`
- **Competition Tracks**: Exactly three partners (Arc, Chainlink, The Graph) + Global Track.
- **AI Attribution**: Documented in `AI.md` per competition rules.

---

## 1. Track 1: Arc — Best DeFi Stablecoin-Native Pool

### Bounty Category
- **Partner**: Arc Network
- **Bounty Title**: Best DeFi stablecoin-native Pool
- **Target Network**: Arc Testnet (Chain ID `5042002`)
- **RPC Endpoint**: `https://rpc.testnet.arc.io`

### Submission Description
THELEMA builds an autonomous two-stage prediction-and-impact market native to Arc's single-balance USDC architecture. Unlike traditional prediction markets that only trade binary outcomes, THELEMA couples binary event probability with continuous asset payoff curves ($500.00 cap) within a single conserved collateral vault ($C \to Y + N + R$).

**Load-Bearing Arc Features**:
1. **Direct Precompile Integration**: All vaults (`BinaryVault`, `ShareVault`) and AMMs (`BinaryAMM`, `ShareAMM`) interact directly with Arc's native USDC precompile at `0x3600000000000000000000000000000000000000` using standard 6-decimal fixed-point accounting.
2. **Single-Balance Preflight**: Deployment and user flows recognize Arc's dual-representation USDC (18 decimals for gas, 6 decimals for collateral on the same ledger), never double-counting funds.
3. **Solvency Invariant**: Complete sets guarantee absolute vault conservation: depositing $C$ USDC mints 1 YES + 1 NO + 1 Residual ($R$). For any settlement index $S \ge 0$, total payoff $X + 0 + (C - X) \equiv C$, eliminating insolvency risk without liquidation engines.

### On-Chain Contract Architecture
- `DemoOracle`: Two-stage market resolution (Stage 1: YES/NO event outcome; Stage 2: continuous index price).
- `BinaryVault`: 1:1 YES/NO binary outcome collateral vault.
- `ShareVault`: Capped continuous asset payoff vault ($500.00 USDC cap) with residual claim token ($R$).
- `BinaryAMM`: Constant-product automated market maker for binary tokens.
- `ShareAMM (YES)`: Automated market maker for conditional yesShare tokens.
- `ShareAMM (NO)`: Automated market maker for conditional noShare tokens.

---

## 2. Track 2: Chainlink — Best Confidential Workflow

### Bounty Category
- **Partner**: Chainlink
- **Bounty Title**: Best Confidential Workflow ($2k track)
- **Target Subsystem**: Chainlink Confidential Runtime Environment (CRE) in `packages/cre`

### Submission Description
High-value orders in synthetic and prediction markets are notoriously vulnerable to front-running, toxic MEV, and adverse selection. THELEMA integrates Chainlink CRE (Confidential Runtime Environment) to execute confidential size-clipping policies inside a hardware-isolated Trusted Execution Environment (TEE).

**Confidential Architecture & TEE Workflow**:
1. **Confidential Policy (`packages/cre/policy.ts`)**: The trader's requested order size is submitted into the confidential enclave. Inside the TEE, a private threshold (`MAX_NOTIONAL`) evaluates the trade. If the trade exceeds the confidential cap, the enclave clips the size to the authorized boundary, returning an attested authorization envelope.
2. **Enclave Entry (`handlerInTee` in `packages/cre/workflow.ts`)**: Built with `@chainlink/cre-sdk` following the official confidential workflow TypeScript template. Uses `HTTPClient` with `TeeRuntime` for secure execution.
3. **Bytecode Verification**: Compiled to WASM (`packages/cre/dist/clipping.wasm`), validated with WebAssembly bytecode checks, and verified against SHA-256 source digests.
4. **Authenticity & Replay Protection**: Enclave callbacks are authenticated via dedicated ephemeral EIP-191 signer recovery, HMAC-SHA256 integrity checks, and single-use replay protection tokens.

---

## 3. Track 3: The Graph — From Scratch (AI Use Case)

### Bounty Category
- **Partner**: The Graph
- **Bounty Title**: From Scratch (AI use case)
- **Target Subsystem**: `packages/graph` & Application UI

### Submission Description
Autonomous market makers and predictive agents require real-time, tamper-resistant external benchmarks to correlate asset prices and event probabilities across markets. THELEMA integrates The Graph's Decentralized Gateway to ingest live reference data without intermediate caching or mocked proxies.

**The Graph Integration Architecture**:
1. **Polymarket Prediction Reference**: Normalized GraphQL queries against the Polymarket subgraph (`Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp`) extract live probability data for correlated world events from `fixedProductMarketMaker` entities.
2. **Uniswap / Messari Spot DEX Reference**: Queries decentralized liquidity pool entities (`liquidityPool`) to extract live spot pricing for the underlying synthetic benchmark asset.
3. **Standardized Cross-Protocol DEX Comparison**: Queries two independent DEX protocol subgraphs — Uniswap V3 (`FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX`) and SushiSwap (`9tSS5FaePZnjmnXnSKCCqKVLAqA6eGg6jA2oRojsXUbP`) — on Arbitrum One through the same **Messari DEX AMM Standardized Schema** (`liquidityPool` entities). Computes real-time consensus pricing, relative disagreement (spread), and 4-state health classification (`agreeing` / `disagreeing` / `single_source` / `unavailable`). Verified live with 0.27% spread between Uniswap V3 ($2,479.92) and SushiSwap ($2,473.15). Evidence: `docs/evidence/graph-cross-protocol.json`.
4. **Rigorous Freshness & Error Envelopes**: Enforces maximum block timestamp age ($\le 900$ seconds) directly from `_meta { block { timestamp } }`. Missing entities, stale data, or HTTP gateway errors fail closed, guaranteeing that UI reference badges honestly report `live` vs `unavailable` rather than fabricating synthetic data.
5. **Automated Evidence Logging**: The `verify:graph` utility produces sanitized, secret-free JSON audit logs (`docs/evidence/graph-live.json`, `docs/evidence/graph-cross-protocol.json`) capturing live gateway timestamps and entity values.

---

## 4. Global Track & Project Narrative

### Problem
Traditional prediction markets force a binary choice: either an event occurs or it doesn't. However, real-world events have continuous economic impact (e.g. an election outcome impacts FX rates, semiconductor restrictions impact chipmaker valuations). Conversely, trading stocks directly introduces massive custody, regulatory, and capital efficiency barriers.

### Solution
THELEMA unifies prediction and continuous payoff into a single synthetic market:
1. Traders speculate on whether a specific geopolitical/regulatory condition occurs (`YES`/`NO`).
2. Simultaneously, traders take exposure on the continuous asset price ($S$) in that specific world state.
3. Collateral is strictly bounded and conserved ($C \to Y + N + R$), allowing instant settlement on Arc Testnet without counterparty risk.

### Exact Test Metrics & Verification Suite
- **232 Node Tests** (`npm test`): BigInt invariant math, fee deductions (30 bps), ceiling clamps, API validation, HTTP/CSRF security, Graph mock adapters, cross-protocol DEX comparison, CRE policy, and mock wallet simulations.
- **24 Foundry Contract Tests** (`packages/contracts`): Solidity unit and invariant tests covering complete-set conservation, AMM pricing, fee bounds, and oracle lifecycle.
- **2 Real Cryptographic Tests** (`npm run test:bridge:crypto`): EIP-191 ephemeral key recovery and single-use replay protection tokens.
- **15 TAP Tests on Local EVM** (`npm run test:evm`): 1 parent + 14 nested tests verifying full contract lifecycles on Anvil (`chain-id: 5042002`).
- **18 Playwright UI Tests** (`tests/browser.mjs`): Responsive viewports (1440px desktop, 390px mobile, 320px ultra-compact), accessibility, keyboard navigation.
- **13-Step Connected Browser EVM Flow** (`tests/arc-evm-browser.integration.mjs`): End-to-end browser wallet connection, token swaps, pair splitting, pair merging, time progression, two-stage settlement, binary claims, continuous asset claims, and client/contract negative rejection checks.
- **4-Tier CRE Sponsor Verifier** (`scripts/verify-cre.mjs`): Policy, Build evidence, Simulation transcript, and Live bridge standby.
- **Audited Graph Verifier** (`scripts/verify-graph.mjs`): Schema validation, block timestamp freshness, cross-protocol standardized DEX comparison, and sanitized live evidence logging.
