# Prize map

Submit **exactly three partners:** Arc, Chainlink, The Graph. From Scratch.
Selecting a partner covers all of that partner’s tracks. Still name the bounty in the form.

## Arc — Best DeFi stablecoin-native Pool

| Need | Where |
|---|---|
| UI + contracts | `apps/web`, `packages/contracts` |
| Diagram | README mermaid or `docs/ARCHITECTURE.md` |
| USDC load-bearing | splits/AMMs use `0x3600…0000` (6 dp) |
| Arc Testnet | chain `5042002` |

Skip Continuity / mainnet-by-30-Sep. Agent Stack only after the core loop.

## Chainlink — Best Confidential Workflow ($2k, up to 2×$1k)

| Need | Where |
|---|---|
| Confidential workflow | `packages/cre` |
| `handlerInTee` | workflow entry |
| Secret changes the fill | `MAX_NOTIONAL` clips size |
| Evidence | `docs/cre-sim.txt` and/or video |

Access: https://docs.chain.link/cre/account/confidential-workflows-access  
Template: `cre init --template=hello-confidential-workflows-ts`  
Inside TEE: `HTTPClient` + TeeRuntime, not `ConfidentialHTTPClient`.

Skip Continuity $500 unless core is already filmed.

## The Graph — Standardized Cross-Protocol Reference Feature

| Need | Where | Details |
|---|---|---|
| Live gateway queries | `packages/graph/index.ts`, `apps/web/server.ts` | Authenticated queries through official Gateway (`https://gateway.thegraph.com/api/...`) |
| Standardized DEX Schema | `STANDARDIZED_MESSARI_DEX_QUERY` (`liquidityPool`) | Published Messari DEX AMM schema queried across ≥2 distinct protocols |
| Protocol 1: Uniswap V3 | `FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX` | Arbitrum One WETH/USDC 0.05% (`0xc31e54c7a869b9fcbecc14363cf510d1c41fa443`), TVL ~$1.05M |
| Protocol 2: SushiSwap | `9tSS5FaePZnjmnXnSKCCqKVLAqA6eGg6jA2oRojsXUbP` | Arbitrum One WETH/USDC (`0x905dfcd5649217c42684f23958568e533c711aa3`), TVL ~$170K |
| Asset contract matching | WETH: `0x82af...` / USDC: `0xff97...` | Verified identical token contracts on Arbitrum One |
| Cross-Protocol Analysis | $\frac{\|S_1 - S_2\|}{(S_1 + S_2) / 2}$ | Relative disagreement evaluated against 1.5% threshold (live observed spread: ~0.27%) |
| 4 Discrete Health States | `agreeing` \| `disagreeing` \| `single_source` \| `unavailable` | Enforces freshness (< 900s), consensus pricing, and graceful single-source fallback |
| UI integration | `apps/web/src/main.tsx` (`Identity` component) | Dual protocol cards with TVL, volume, prices, spread badge, and health status |
| Zero mock data | `packages/graph`, `apps/web/server.ts` | Explicit unavailable states on errors; zero mock or fabricated prices |
| Evidence & Verification | `docs/evidence/graph-cross-protocol.json` | `node scripts/verify-graph.mjs --record-evidence` validates and records sanitized telemetry |

Polymarket subgraph for probability context: `Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp` (remains unconfigured; no fabricated event odds). ETH reference labeled non-comparable external context.

## Global

Video 2–4 min, ≥720p, human voice. Git history throughout. AI in `AI.md`.
Deadline **13 Sep 2026 12:00pm EDT**. Rules: https://ethglobal.com/rules
