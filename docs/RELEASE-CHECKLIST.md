# THELEMA Release Checklist — Pre-Broadcast Audited Baseline

This document tracks local verification status and remaining gates required before live broadcast and final hackathon submission. For operational credentials, ceilings, and separated owner vs agent responsibilities, consult the consolidated **[RUNBOOK.md](docs/RUNBOOK.md)**.

## 1. Verified Locally & Passing in CI

- [x] **Core Math & Financial Invariants**: 238 passing unit tests in `npm test` covering BigInt fixed-point arithmetic, 30 bps fee deductions, complete-set conservation ($C \to Y + N + R$), API validation, HTTP/CSRF security, Graph mock adapters, cross-protocol DEX comparison, CRE policy, mock wallet simulations, sourced market specifications, and 37 CRE bridge lifecycle tests.
- [x] **Smart Contracts & Invariants**: 24 passing Foundry tests (`packages/contracts`) covering binary and share collateral vaults, constant-product AMMs, two-stage settlement, and trading cutoff enforcement.
- [x] **Real Cryptographic Signatures**: 2 passing crypto tests in `npm run test:bridge:crypto` validating dedicated EIP-191 ephemeral signer key recovery and single-use replay protection tokens.
- [x] **Local EVM Full Lifecycle**: 15 TAP tests (1 parent + 14 nested tests) passing in `npm run test:evm` on Anvil (`chain-id: 5042002`) verifying complete deployment, seeding, trading, cutoff freezing, operator resolution, and two-stage collateral redemption.
- [x] **Connected Browser Verification**: 18 Playwright unit checks in `tests/browser.mjs` (desktop 1440px, mobile 390px, 320px layouts) + 13-step connected wallet browser EVM flow in `tests/arc-evm-browser.integration.mjs`.
- [x] **Public Arc Deployment Recorded**: Deployed contracts and receipts recorded in `deployments/demo-manifest.json` (cumulative spend: 86.34 USDC $\le$ 100.00 USDC ceiling). Trading window closed as of 10 Sep 2026 cutoff.
- [x] **CRE Sponsor Verification**: 4 distinct tiers audited in `npm run verify:cre` (Tier 1: Policy VERIFIED; Tier 2: Build & WASM bytecode hash VERIFIED; Tier 3: Simulation audited / standby; Tier 4: Live bridge fail-closed standby). The workflow is designed for confidential CRE execution; the recorded official simulator attempt was not a real production TEE and did not complete end-to-end.
- [x] **The Graph Sponsor Verification**: Schema normalization, block timestamp freshness (< 900s), and sanitized live evidence logging (0.27% spread on Arbitrum One) audited in `npm run verify:graph`.
- [x] **Production Hosting Configuration**: Turnkey Render configuration defined in `render.yaml` with standalone self-contained preview build fallback.
- [x] **Full Typechecking**: React 19 type definitions installed and passing `npm run typecheck`.

---

## 2. Remaining External Gates

Consult **[docs/RUNBOOK.md](docs/RUNBOOK.md)** for the exact separation between owner authentication and autonomous agent technical execution:

- [ ] **Gate 1: Arc Testnet Live Broadcast & Seeding** (Owner funds testnet address $\ge 87$ USDC and ephemerally authorizes `RELEASE_APPROVED=true` under 100.00 USDC ceiling; Agent executes `deploy:demo`, on-chain verification, and operator settlement).
- [ ] **Gate 2: The Graph Live Gateway Queries** (Owner provisions server-side API Key in Graph Studio; Agent runs `verify:graph --require-configured --record-evidence` to generate `docs/evidence/graph-live.json`).
- [ ] **Gate 3: Chainlink CRE Simulation & Bridge** (Owner runs `cre login`; Agent executes official workflow simulation, updates `cre-sim.txt`, and verifies 4 tiers).
- [ ] **Gate 4: Production Web Hosting** (Owner provisions Linux VM and DNS record; Agent deploys via `deployments/hosting/setup-server.sh` and verifies `/api/health`).
- [ ] **Gate 5: Human Voice Video & Submission** (Owner records 2–4 min screen/voice video following `docs/DEMO-SCRIPT.md` and submits portal form from `docs/SUBMISSION.md`).

`npm run release:check` is a conservative local evidence preflight that exits nonzero until all external proof URLs and human approval records are formally recorded in `automation/evidence/release-evidence.json`.

