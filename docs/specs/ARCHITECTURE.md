# Architecture

```
UI  ── Arc txs ──►  BinarySplit / ShareSplit / BinaryAMM / ShareAMM / Oracle
    ── GraphQL ──►  pRef (Polymarket analog) + spotRef (DEX analog for S)
    ── HTTP   ──►  CRE handlerInTee  → { allowed, clippedSize }
                   user wallet then sends clipped fill on Arc
```

| Zone | Public | Private |
|---|---|---|
| Arc | mids, net fills, USDC, settlement | — |
| CRE | that a handler ran | size, max notional, optional band |
| Graph | pRef, spotRef | API key (server) |

No Arc Privacy Sector. CRE write-to-Arc is optional and likely unsupported; public fill is a normal user tx. Simulator is not a real TEE; it still qualifies.

`S` is an oracle-reported index for **any** asset class. Graph `spotRef` is a reference, not settlement, unless you explicitly wire it.

## Failure

| Fail | UI |
|---|---|
| Graph down | “ref unavailable”, not a fake number |
| CRE timeout | public trade still works; private path errors |
| P < 2% | hide E[S\|yes] |
| S > C | pay C, show capped |
