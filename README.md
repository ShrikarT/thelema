# THELEMA

**One event. Two possible worlds.**

A working local synthetic impact-market research app, with an Arc Testnet wallet path, contract source, Graph/CRE adapters, and an inactive n8n release-evidence gate. Inspired by the category and clarity of if.market; branding, copy and interface were built for THELEMA, not copied from that product.

> **Delivery status: local demo implemented and tested; live release is NO-GO.** No real stock is held, no real funds were moved, no public repository or deployment was created, and no competition submission was made. Solidity compilation, live integrations, and full TypeScript checking remain explicit follow-up gates.

## Open it now

### No installation

Open **THELEMA-preview.html** in a modern browser. It includes its own application code, CSS and font and makes no server calls in sandbox mode. It supports trades, local size clipping, positions, split/merge, settlement and claims. Its state resets when the file is reloaded. Arc mode in this file is unavailable by design.

### Run the prebuilt application

Use Node **22 or newer**:

```sh
cd thelema
npm start
```

Open `http://127.0.0.1:3000`. No dependency installation is needed to run the included prebuilt assets and native Node server. The server binds to loopback by default. A server restart clears all sandbox sessions; an inactive session expires after four hours. These are simulations, not production account balances.

### Develop and rebuild

In an environment with approved internet access:

```sh
npm install
npm run build
npm run typecheck
npm test
npx playwright install chromium
npm run test:ui
npm run dev
```

A lockfile was **not fabricated**. Create and review `package-lock.json` after the first real dependency installation, then use `npm ci`. This build used available React/React DOM 19.2.8, react-icons 5.7.0 and esbuild 0.25.0. The original suggested Next/viem stack could not be installed in the offline environment; React + esbuild + native Node is the implemented stack.

## What works

- Original responsive landing page, market console, positions, methodology guide and custom 404.
- Reserve-derived probability, conditional YES/NO asset prices, impact, and capped horizon index ($S \le \text{cap}$).
- Complete-set conservation ($C \to Y + N + R$): Depositing $C = 500$ USDC mints 1 YES Share + 1 NO Share + 1 Residual Share ($R$). At settlement, for any outcome and index $S \ge 0$, aggregate payout $X + 0 + (C - X) \equiv C$, guaranteeing mathematical vault solvency.
- Settlement-horizon comparability labeling: $q_Y + q_N$ is explicitly labeled as the Capped Horizon Index ($S \le \text{cap}$), representing expected settlement horizon payoffs under the contract cap, not an unconstrained spot asset price.
- Two books: binary event outcomes and conditional synthetic asset shares.
- Quote review, 0.30% fee, bounded slippage, minimum output, stale/expired quote rejection and atomic local fills.
- Explicit sandbox USDC, local activity, split/merge complete sets, owner-style demo resolution, cap/residual display and claims.
- Clearly separate Arc mode; no silent replacement of missing live values with sandbox numbers.
- EIP-1193 wallet connection, chain/decimals/account checks, exact approvals, transaction simulation, wallet signatures and receipt checks. Connected browser flow verified on local EVM.
- Server-only Graph and CRE adapters with fail-closed responses and explicit unavailable states.
- A saved, inactive n8n workflow, its SDK/JSON export, fixtures and a corrected GitHub Actions template.
- Comprehensive project documentation and original specifications in `docs/` and `docs/specs/`.

The app currently focuses on buying, collateral pair operations and settlement exits. The share AMM contract includes sells and LP operations; those are not exposed in the local UI. There is no orderbook, real-stock custody, production persistence, guaranteed exit liquidity, decentralized oracle or refund product.

## Test evidence

| Check | Result in current build | Evidence |
|---|---|---|
| Browser bundle + self-contained preview | PASS | `scripts/build.mjs` / `dist` |
| Full TypeScript check (`npm run typecheck`) | **PASS (0 errors)** | Full strict typecheck across web, core, arc, graph, cre, bridge |
| Economics, ABI/RPC, Graph/CRE adapters, HTTP security, wallet mocks | **211 / 211 PASS** | `npm test` |
| Mandatory Local EVM contract integration (`npm run test:evm`) | **1 parent + 14 nested subtests (= 15 TAP tests, 15 PASS)** | Anvil EVM, full split/merge/buy/claim lifecycle, timing cutoff, seeding |
| Browser flows, responsive layouts, connected EVM flow | **18 Playwright unit tests + live connected browser flow** | `npm run test:ui` (Playwright Chromium) |
| Desktop, 390px and 320px layouts | Checked in Chromium; no horizontal overflow | `docs/evidence/*.png` and browser results |
| Real signer EIP-191 JWT crypto | **2 / 2 PASS** | `npm run test:bridge:crypto` |
| CRE confidential bridge suite | **37 / 37 PASS** | `npm run test:bridge` |
| Solidity/Foundry unit tests | **24 / 24 PASS** | `packages/contracts` (`forge test -vvv`) |
| Graph sponsor verification tool (`npm run verify:graph`) | **VERIFIED (schemas/mock) / UNCONFIGURED (live)** | Schema normalization, entity IDs, < 900s freshness |
| CRE sponsor verification tool (`npm run verify:cre`) | **4 Tiers: Policy VERIFIED, Build RECORDED, Sim NOT_RUN, Live STANDBY** | WASM byte validation, SHA-256 source digests, fail-closed CLI simulation check |
| Arc Testnet public RPC probe | **PASS** | `node scripts/validate-live.mjs --public-only` (Chain ID 5042002) |
| Demo deployment preflight & launch plan | **PASS** | `npm run deploy:demo` (outputs `deployments/demo-manifest.json`) |
| Actual public Arc Testnet deployment & funds | BLOCKED (pending owner approval) | Safety boundary preserved: `releaseApproved: false` |

A passing mock or sandbox test is **not** evidence of a public testnet deployment or confidential execution. Preflight scripts and local EVM tests are distinct from public testnet execution.

## Build workflow

1. Read `CLAUDE.md`, the original specifications, and `agenthanoff.md`.
2. Implement a small task; run the relevant unit checks.
3. Run `npm run build`, `npm run typecheck`, `npm test` and `npm run test:ui`.
4. Inspect screenshots, including mobile and actual success/error states.
5. Append the outcome, evidence and next step:
   ```sh
   npm run handoff -- "Completed task; commands and results; remaining blockers; next step"
   ```
6. Commit the actual work. Do not invent historical commits or label unexecuted checks as passing.
7. Compile/test the contracts and collect real Arc, Graph and CRE evidence in an authorized environment.
8. Submit **public evidence references only** to the n8n gate. A release owner still reviews all evidence and explicitly approves any release.

Saved n8n workflow: **THELEMA — Build and Release Gate**

https://shrikar.app.n8n.cloud/workflow/FNDL5ToiOk1LGrol

It is inactive and unpublished. It evaluates submitted evidence and does not itself run CI, deploy, send transactions, or independently verify links. The GitHub template performs the build/test portion once attached to a real repository. No repository credentials were configured here.

## Demonstration and Operator Guide

### 1. Local EVM Verification (Automated)
Run the complete end-to-end integration test against real compiled contracts:
```sh
npm run test:evm
```
This deploys all 6 contracts onto an ephemeral Anvil node (`chain-id: 5042002`), runs 1 parent test with 14 nested subtests (= 15 TAP tests), seeds liquidity, executes split/merge, runs wallet buy transactions on BinaryAMM and ShareAMM, tests YES and NO resolution paths, timing cutoffs, above-cap ($600) and below-cap ($150) settlement, claims, address-only preflight hardening, 130% fee bounding, and crash-safe journal recovery.

### 2. Demo Deployment & Seeding Script
To run preflight checks or prepare an accelerated synthetic demo market:
```sh
npm run deploy:demo
```
- On public Arc Testnet without explicit approval (`RELEASE_APPROVED=true`), it safely enforces safety boundaries, runs the chain preflight, and generates an **Unsigned Launch Plan** in `deployments/demo-manifest.json` detailing exact faucet budget requirements.
- On local/ephemeral EVM, it deploys and seeds the demo contracts, binds the oracle, and outputs the contract addresses and manifest.

### 3. Demo Operator CLI
Trigger oracle lifecycle actions securely from the CLI without exposing private keys in the browser:
```sh
# Check market status (lifecycle, prices, remaining liabilities, cutoff)
npm run demo:operator status

# Resolve event outcome (YES or NO)
npm run demo:operator resolve-event YES

# Fix asset settlement price (e.g. $250.00)
npm run demo:operator fix-price 250

# Settle event and price in one atomic operation
npm run demo:operator publish-and-settle YES 250
```

## Live setup

Copy `.env.example` to `.env` and follow `docs/INTEGRATIONS.md`. Never put private keys, Graph keys, CRE tokens or `MAX_NOTIONAL` in browser files, screenshots, n8n submissions or Git.

Before any public/testnet launch, complete `docs/RELEASE-CHECKLIST.md`. `npm run release:check` is intentionally NO-GO with the delivered manifest.

## Project map

```text
apps/web/src/          React interface, client API and wallet adapter
apps/web/public/       Ready-to-serve bundle, CSS and local assets
apps/web/server.mjs    Native Node HTTP server and isolated sandbox sessions
packages/core/        BigInt economics engine
packages/arc/         Narrow static ABI encoder and read-only RPC adapter
packages/contracts/   Solidity vaults, AMMs, owner demo oracle and Foundry tests
packages/graph/       Server-only Graph query templates and mocked tests
packages/cre/         Clip adapter, pure demo policy and grounded CRE source scaffold
automation/           n8n exports, fixtures, evidence schema and CI template
docs/                 Architecture, boundaries, continuation and test evidence
agenthanoff.md         Canonical handoff (intentional requested spelling)
THELEMA-preview.html  Portable interactive sandbox
```

See `LICENSES/` for third-party notices. No project-wide license was selected for your original specifications. Contract files retain their declared SPDX licenses; review the final licensing decision before publishing.

## Continue with the included history

The ZIP contains `thelema-history.bundle`. To get a working Git repository without a remote URL:

```sh
git clone thelema-history.bundle thelema-repo
cd thelema-repo
```

The bundle reflects the final verified local snapshot. Intermediate checkpoint persistence was unreliable in this environment; nonexistent commits were not reconstructed or claimed as preserved. See agenthanoff.md.
