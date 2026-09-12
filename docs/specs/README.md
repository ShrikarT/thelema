# THELEMA

Impact markets on Circle Arc.

Prediction markets tell you if an event happens.
THELEMA tells you what that event does to an **asset** — stock, BTC, ETH, oil, gold, FX — before it resolves.

One event. Two worlds. Four numbers: chance it happens, asset if yes, asset if no, the gap.

```
impliedSpot ≈ P · E[S|yes] + (1−P) · E[S|no]
impact      = E[S|yes] − E[S|no]
```

ETHOnline 2026 · Arc + Chainlink CRE + The Graph · From Scratch

Demo market is one synthetic underlying (default sNVDA). Contracts are asset-agnostic. Not a real security. Not [if.market](https://if.market) — they already ship this category; this is the open Arc AMM + live Graph identity + TEE size clip.

Agent: read `CLAUDE.md`, then `plan.md`.

| | |
|---|---|
| Chain | Arc Testnet `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |
| USDC (collateral, 6 dp) | `0x3600000000000000000000000000000000000000` |

```bash
cp .env.example .env
cd packages/contracts && forge test
cd apps/web && npm i && npm run dev
cre workflow simulate <workflow> --target staging-settings --non-interactive --trigger-index 0
```

Starter: [circlefin/arc-prediction-markets](https://github.com/circlefin/arc-prediction-markets) (replace ARCT).

Testnet only. Unaudited.
