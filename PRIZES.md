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

## The Graph — From Scratch (AI use case)

| Need | Where |
|---|---|
| Live data | `packages/graph` + UI |
| Does work | pRef / spotRef vs our P / impliedSpot |
| No mocks | error if fetch fails |

Composable extra: same Messari DEX query on ≥2 protocols.
Polymarket subgraph: `Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp`

## Global

Video 2–4 min, ≥720p, human voice. Git history throughout. AI in `AI.md`.
Deadline **13 Sep 2026 12:00pm EDT**. Rules: https://ethglobal.com/rules
