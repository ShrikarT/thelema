# Human-recorded demo outline (about 3 minutes)

This is a script, not a produced video. Record your own narration at >=720p, and label demonstrations accurately.

**0:00–0:20 — The question & timing clocks.**
Introduce THELEMA: simultaneous pricing of an event probability and conditional asset valuations in YES and NO worlds.
- State that sNVDA is a synthetic index demonstration, not a stock-custody claim.
- Point out the timing clocks: the real macroeconomic resolution event is 31 December 2026, while the deployed Arc Testnet contracts run on a dedicated September 9/10 testnet schedule (event deadline: 9 Sep 2026, trading cutoff: 10 Sep 2026).
- Emphasize that the real December event is not prematurely resolved on-chain.

**0:20–0:55 — Prices that respond & independent pools.**
Open the market in Sandbox and switch to Arc mode.
- Explain the four numbers: Probability $P = 50\%$, $E[S \mid \text{YES}] = \$233.10$, $E[S \mid \text{NO}] = \$87.32$, and conditional impact $\Delta = \$145.78$.
- Note that seeded market prices ($P \cdot E[S \mid \text{YES}] + (1-P) \cdot E[S \mid \text{NO}] = \$160.21$, based on $\$116.55$ YES share + $\$43.66$ NO share midprices) are set by independent AMM liquidity, not pegged to external indexes.
- Review a small trade and confirm it, demonstrating that conditional prices and pool reserves respond to trading.

**0:55–1:25 — Confidential size policy & CRE boundary.**
Enable the size clip option in the trade ticket, request 1,000 USDC and show the public 50-USDC fill.
- Explicitly explain the architecture: the client sends orders to an authenticated bridge (`services/cre-bridge`).
- Distinguish the local demonstration from official CRE CLI simulation: show the genuine simulation transcript where the official CRE CLI simulator runs in AWS Nitro TEE runtime (us-west-2), compiles `binary.wasm`, enforces `MAX_NOTIONAL_ENV=50`, and attempts callback delivery.
- State honestly that live production DON execution requires provider deploy access (`cre whoami: Deploy Access: Not enabled`).

**1:25–1:55 — Collateral backing & Complete sets.**
Open the Positions tab and show Collateral Pairs.
- Demonstrate complete-set conservation: 1 USDC mints 1 YES + 1 NO binary pair; 500 USDC (the payout cap) mints 1 YES + 1 NO + 1 Residual (R) complete share set.
- Explain that every outcome is fully collateralized on Arc Testnet without counterparty promises.

**1:55–2:25 — Two-stage resolution demonstration.**
Switch to Sandbox to demonstrate settlement without prematurely resolving the active Arc Testnet contracts.
- Show Stage 1: Oracle resolves the event as YES; binary claims unlock immediately ($1 for YES, $0 for NO), while asset shares enter price observation.
- Show Stage 2: Oracle fixes the reported spot at $700. Show that the $500 cap bounds the winning share payout at $500, losing share pays $0, and the remaining $0 residual is claimable.

**2:25–2:45 — The Graph live references & Non-comparable scope.**
Navigate to the Independent Reference Check in the UI.
- Show the live Graph spot reference ($2,480+ USD fetched from Uniswap v3 on Ethereum Mainnet).
- Explain that this reference proves live decentralized gateway connectivity, but is an ETH analog labeled "non-comparable context only"—it is not confused with the synthetic Nvidia index.

**2:45–3:00 — Verification & Delivery.**
Show the terminal running `npm test` (224 passing tests), the verified Arcscan deployment receipts within the 100 TEST-USDC ceiling, and the honest documentation in `docs/RUNBOOK.md`.
- Conclude by stating the exact remaining live gates: production TLS bridge hosting, provider TEE deploy authorization, and video submission.
