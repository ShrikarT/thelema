# THELEMA

> **ETHOnline 2026 Submission Export**:  
> This public repository is the curated ETHOnline submission export. Development and validation were performed in a private workspace; relevant source, tests, deployment receipts, and sanitized evidence are included here.

**Trade the impact. Not just the odds.**

An autonomous synthetic prediction-and-impact market application for Arc Testnet (Chain ID `5042002`), coupling binary world-event outcomes with continuous asset payoff curves within a conserved collateral vault ($C \to Y + N + R$). Features Chainlink CRE confidential order-size clipping workflow design (@chainlink/cre-sdk WASM build, simulated via CLI) and The Graph decentralized market intelligence across standardized DEX protocols.

---

## Limitations & Research Boundaries

Judges and evaluators should note the following explicit boundaries:
- **Unaudited Research Prototype**: Contracts and circuits are unaudited research code; not a production financial service.
- **Arc Testnet Trading Window Closed**: The deployed demo market recorded a trading cutoff of 10 Sep 2026 (`1789020327`). Because this cutoff has passed on-chain, contracts enforce closed trading; market statistics, contract state, and historical receipts remain viewable on Arcscan in read-only mode.
- **Chainlink CRE Execution Boundary**: The official CRE CLI simulator was executed against compiled WASM (`packages/cre/cre-sim.txt`), validating size-clipping arithmetic and halting at the staging callback DNS boundary (`bridge.example.com`, exit=1). No live production TEE enclave exists; organization deploy authorization is pending.
- **The Graph Reference Context**: Standardized dual-DEX comparison queries WETH on Arbitrum One across Uniswap V3 and SushiSwap as external market context; it does not price synthetic sNVDA, and is not a settlement oracle.
- **Synthetic Asset Index**: sNVDA is a synthetic prediction-and-impact index, not NVIDIA stock, equity custody, or an investment product.
- **Zero-Installation Standalone Preview**: `THELEMA-preview.html` runs an in-memory client-side sandbox; Arc transactions require running the application server with RPC connectivity.

---

## Quick Start

### 1. Zero Installation Standalone Preview
Open **`THELEMA-preview.html`** directly in any modern browser. It is a completely self-contained single-file build with inlined CSS, typography, images, and full local sandbox trading logic (trades, size clipping, split/merge, settlement, claims). No server or network required.

### 2. Run Local Application Server
Requires Node **22 or newer**:

```sh
git clone https://github.com/ShrikarT/thelema.git
cd thelema
npm ci
npm start
```

Open `http://127.0.0.1:3000` to access the interactive web application.

### 3. Developer & Verification Commands
```sh
npm run build          # Compile TypeScript, browser bundle, and preview file
npm run typecheck      # Full strict TypeScript verification (0 errors)
npm test               # Run all 238 unit, invariant, and market catalog tests
npm run test:contracts # Run 24 Foundry smart contract invariant tests
npm run test:bridge    # Run 37 CRE confidential bridge lifecycle tests
npm run test:bridge:crypto # Run 2 real EIP-191 signer recovery tests
npm run test:ui        # Run 18 Playwright tests + 13-step connected wallet EVM flow
npm run verify:cre     # Audit 4 CRE sponsor verification tiers
npm run verify:graph   # Verify live Graph decentralized gateway queries
npm run dev            # Start development watch runner
```

---

## Core Architecture & Sponsor Tracks

### 1. Track 1: Arc — Best DeFi Stablecoin-Native Pool
- **Network**: Arc Testnet (Chain ID `5042002`, RPC: `https://rpc.testnet.arc.io`)
- **Deployed Contracts**: 6 contracts verified on-chain:
  - `DemoOracle`: `0x8548bd8633de8efd7d5a0327d6a51f8e5d74100f`
  - `BinaryVault`: `0x9aa21d72378a36fa107129c87f17b0a42680ecb7`
  - `ShareVault`: `0x81fad3ec2d7e841cda7e1504e1bdd23f794c8e3d`
  - `BinaryAMM`: `0x7afff3698a2f5b58b9ebac8405a7a903e482a4ab`
  - `ShareAMM (YES)`: `0x0708437945bbba6dcc72d7a271347c88a1c26cab`
  - `ShareAMM (NO)`: `0xee27dd6502956c98ddc56575960f178a3e757eb2`
- **Precompile Integration**: Direct interaction with Arc native USDC precompile (`0x3600000000000000000000000000000000000000`).
- **Mathematical Vault Solvency**: Complete sets guarantee $C \to Y + N + R$. For payout cap $C = 500$ USDC and index $S \ge 0$, total payoff $X + 0 + (C - X) \equiv C$, eliminating insolvency risk without liquidation engines.
- **Trading Window Lifecycle**: The deployed testnet market recorded a trading cutoff of 10 Sep 2026. Because the cutoff has passed on-chain, contracts enforce closed trading; market statistics, contract state, and historical receipts remain viewable on Arcscan in read-only mode.
- **Deployment Evidence**: Public transaction receipts in `deployments/demo-manifest.json` (cumulative spend: 86.34 USDC $\le$ 100.00 USDC hard ceiling).

### 2. Track 2: Chainlink — Best Confidential Workflow
- **Subsystem**: Confidential Runtime Environment (CRE) in `packages/cre` & `services/cre-bridge`
- **Confidential Size Clipping Design**: Large synthetic market orders are evaluated against private threshold `MAX_NOTIONAL` inside a confidential workflow (`@chainlink/cre-sdk`) compiled to WASM. The workflow is designed for confidential CRE execution. The recorded official simulator attempt was not a real production TEE and did not complete end-to-end.
- **Cryptographic Security**: Authenticated callbacks via dedicated ephemeral EIP-191 signer recovery, single-use replay protection tokens, and canonical JSON SHA-256 digest validation.
- **Status**: The official CRE CLI simulator was executed against compiled WASM (`packages/cre/cre-sim.txt`). The simulation validated size-clipping arithmetic and halted at the staging callback DNS boundary (`bridge.example.com`, exit=1). Live deployment remains on standby pending Chainlink organization Deploy Access.

### 3. Track 3: The Graph — From Scratch (AI Use Case)
- **Subsystem**: `packages/graph`
- **Standardized Cross-Protocol DEX Comparison**: Queries two independent DEX protocols — **Uniswap V3** (`FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX`) and **SushiSwap** (`9tSS5FaePZnjmnXnSKCCqKVLAqA6eGg6jA2oRojsXUbP`) — on Arbitrum One using the shared **Messari DEX AMM Standardized Schema** (`liquidityPool` entities).
- **Consensus & Disagreement Engine**: Computes real-time consensus prices and percentage spread (verified live at 0.27% spread).
- **Honest Freshness Bounds**: Block age $\le 900$s enforced; fails closed to `unavailable` if unconfigured or stale. Live audit logs in `docs/evidence/graph-cross-protocol.json`.
- **Contextual Asset Reference**: The Graph provides standardized WETH price comparisons across Uniswap V3 and SushiSwap as external market context; it does not price synthetic sNVDA, and is not a settlement oracle.

---

## Test Verification Summary

| Suite | Metric | Verification Command | Notes |
|---|---|---|---|
| Node Core, Invariants & Markets | **238 / 238 PASS** | `npm test` | Includes core math, markets catalog, and 37 bridge tests |
| Solidity Contract Invariants | **24 / 24 PASS** | `npm run test:contracts` | 24 Foundry invariant & unit tests |
| CRE Confidential Bridge Lifecycle | **37 / 37 PASS** | `npm run test:bridge` | HTTP bridge & gateway tests (also run in `npm test`) |
| Real EIP-191 Signer Recovery | **2 / 2 PASS** | `npm run test:bridge:crypto` | Ephemeral key recovery and replay digest isolation |
| Local EVM Lifecycle (TAP) | **15 / 15 PASS** | `npm run test:evm` | Full deployment, seeding, and settlement on Anvil |
| Browser UI & Responsive Layouts | **18 / 18 PASS** | `npm run test:ui` | Playwright checks at 1440px, 390px, and 320px |
| Connected Wallet EVM Journey | **13 / 13 Steps PASS** | `npm run test:ui:evm` | End-to-end browser consumer trades and claims |
| Strict TypeScript Typecheck | **PASS (0 errors)** | `npm run typecheck` | Strict compiler validation |

---

## Project Structure

```text
apps/web/              React trading console, art-led Landing page, client API, and server
packages/core/         BigInt impact-market economics engine and math invariants
packages/contracts/    Solidity vaults, constant-product AMMs, DemoOracle, and Foundry tests
packages/arc/          Arc RPC adapter, precompile ABI bindings, and transaction helper
packages/graph/        Decentralized Gateway adapter and standardized cross-protocol DEX comparison
packages/cre/          Confidential size-clipping workflow (@chainlink/cre-sdk) and WASM build
packages/markets/      Sourced market specification catalog without invented data
services/cre-bridge/   Authenticated HTTP bridge gateway for TEE callback lifecycle
deployments/           Public Arc Testnet deployment manifest and spending journal
docs/                  Architecture, submission package, demo script, runbook, and audit evidence
```

---

## Licensing & Attribution

See `LICENSES/` for third-party licenses:
- **Manrope**: SIL Open Font License 1.1 (`LICENSES/OFL-Manrope.txt`)
- **Noto Sans**: SIL Open Font License 1.1 (`LICENSES/OFL-NotoSans.txt`)
- **React & react-icons**: MIT License
- **Elaya Design Skills**: MIT License (`LICENSES/elaya-ai-design-skills-MIT.txt`)
- **AI Attribution**: Documented in `AI.md` per hackathon requirements.
