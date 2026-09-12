# Integration setup and verification

## Arc Testnet

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.io`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com`
- Collateral facade: `0x3600000000000000000000000000000000000000`
- ERC20 units: **6** decimals. Native gas USDC: **18** decimals. Do not interchange them.

1. Foundry tests run automatically in CI via `.github/workflows/validate.yml` (`forge test -vvv`, 24/24 passing). Locally, install Foundry to run `forge build` and `forge test -vvv` from `packages/contracts`.
2. Review `script/Deploy.s.sol`, `src/`, the source-level corrections in `docs/CONTRACTS.md`, ownership and fee recipient. Supply real `OWNER`, `FEE_RECIPIENT` and `FEE_BPS=30`. Do not add a private key to `.env` or this repository.
3. Use a user-controlled wallet/Foundry keystore. Simulate the deployment first. Broadcast only with explicit owner approval. No deployment was broadcast here.
4. Record the six emitted addresses, compiler version, source commit, bytecode and explorer receipts. Verify the compiled contracts and token wiring against the source before trusting addresses.
5. Seed the binary pool and each share pool using the contract LP methods. Initial sandbox liquidity is not an automatically deployed pool. The web UI does not currently expose LP controls.
6. Put addresses into `ARC_BINARY_AMM`, `ARC_YES_SHARE_AMM`, `ARC_NO_SHARE_AMM`, `ARC_BINARY_VAULT`, `ARC_SHARE_VAULT`, `ARC_ORACLE`. Restart the server.
7. Connect the wallet, confirm Arc chain and six-decimal token balance, then perform a small authorized testnet trade. The adapter rejects wrong chain, wrong fee, wrong decimals, missing liquidity and mismatched settled/open state.
8. Save a genuine receipt and demonstrate split, merge, both outcome books, settlement and fractional-token redemption. Mocked wallet tests do not satisfy this gate.

Wallet code supports only the declared static ABI subset. Its Keccak selectors have independent known-vector tests; no custom signing cryptography is implemented. Replace with a mature, audited ABI/wallet library if desired after dependency access is available, while retaining the same guards.

## The Graph

The supplied Polymarket subgraph ID is preserved: `Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp`.

**An ID is not a verified schema.** `packages/graph/index.mjs` contains candidate normalized projections for an FPMM event (`fixedProductMarketMaker(id: $market)`) and a Messari-style pool (`liquidityPool(id: $pool)`). Before calling this a live integration:

1. Obtain a server-only Graph API key. Do not put it in the HTML, React bundle or a client URL.
2. Inspect the actual deployed schema and select a real event/pool and outcome mapping. Query entities:
   - Event reference: `fixedProductMarketMaker(id: $market) { id values: outcomeTokenPrices }`
   - Spot reference: `liquidityPool(id: $pool) { id tokens: inputTokens { id symbol } values: inputTokenPricesUSD }`
3. Supply `GRAPH_PROBABILITY_MARKET_ID`, `GRAPH_YES_INDEX`, and the spot subgraph/pool/token values in `.env`.
4. Verify block metadata timestamp, price units, token identity, and event relevance. The adapter rejects references older than `GRAPH_MAX_AGE_SECONDS` (default 900 seconds: `maxAge = 900s`).
5. Run the opt-in verification tool:
   ```bash
   npm run verify:graph
   ```
   When unconfigured, this command gracefully exits 0 and reports the required environment variables without fabricating mock data or failing CI.
6. Keep `GRAPH_SPOT_COMPARABLE=false` for ETH/WETH or any other analog. Only opt in after matching the exact sNVDA unit/source; even then disclose the capped-payoff difference.
7. Save a sanitized real query response, query document, source IDs, block/timestamp and result evidence. Never save the API key or its gateway URL containing the key.

Mock tests exercise normalization and rejection behavior, not live schemas or data. Missing/failed data remains unavailable in the UI.

## Chainlink CRE confidential workflow

Grounding references:

- https://docs.chain.link/cre/reference/sdk/confidential-workflows-client-ts
- https://docs.chain.link/cre/reference/sdk/triggers/http-trigger-ts
- https://docs.chain.link/cre-templates/hello-confidential-workflows
- https://docs.chain.link/cre/account/confidential-workflows-access

The authored `packages/cre/workflow.ts` uses `handlerInTee`, `TeeRuntime`, an authorized HTTP trigger and `runtime.getSecret({id: 'MAX_NOTIONAL'}).result()`. It computes `{allowed, clippedSize}` inside the enclave and delivers it with one outbound `HTTPClient` TeeRuntime call (not `ConfidentialHTTPClient`) to the exact configured `/v1/callback` bridge endpoint, authenticated with the single-use callback token from the invocation envelope. Gateway ACCEPTED is never treated as the result. Only the zero-argument `main` is exported: `cre-compile` turns module exports into WASM exports and Javy rejects exported functions with parameters. Only non-secret output may be passed to `usingTheDons()`.

`packages/cre` is a complete CRE project folder: `project.yaml`, `workflow.yaml` (`staging-settings` and `production-settings` targets), `secrets.yaml` (logical name `MAX_NOTIONAL` mapped to `MAX_NOTIONAL_ENV`), `config.simulation.json` (placeholder signer `0x…dEaD`, unreachable `bridge.example.com` callback) and `config.example.json`. Run CLI commands with `-R packages/cre`. Compilation with both `cre-compile` and `cre workflow build` passes; see `docs/evidence/cre-build.json`.

### Four-Category Sponsor Verification Architecture

Verification is divided into four distinct, non-overlapping categories in `scripts/verify-cre.mjs`:
1. **Local Policy & Invariants (Tier 1)**: Pure deterministic policy unit tests (`packages/cre/policy.test.mjs`). Verifies bounds and math without external dependencies.
2. **Compilation & Provenance (Tier 2)**: Verifies WASM format validity, `WebAssembly.validate()`, matching SHA-256 hash, and source file digests for `workflow.ts`, `project.yaml`, `policy.ts`, and `package.json` against `docs/evidence/cre-build.json`.
3. **Official Simulation (Tier 3)**: Evaluates `packages/cre/cre-sim.txt`. Fails closed if the transcript contains `NOT RUN` markers, missing artifacts, or simulation failures.
4. **Live Confidential Execution (Tier 4)**: Requires an operator-hosted HTTPS bridge. Standby by default; requires explicit opt-in (`--execute-live` or `CRE_LIVE_EXECUTE=true`) before initiating network requests.
   *Runtime Configuration Requirements:*
   - `CRE_CLIP_URL`: Approved HTTPS endpoint for the confidential bridge.
   - `CRE_CLIP_ALLOWED_HOST`: Hostname whitelist for TLS pinning.
   - `CRE_CLIP_TOKEN`: High-entropy authentication bearer token.
   *CRITICAL ARCHITECTURAL NOTE: `CRE_FORWARDER` is NOT an on-chain substitute for this HTTP bridge configuration.*

Run the runnable verification command:
```bash
npm run verify:cre
```
When unconfigured, this command validates Tiers 1 and 2, cleanly reports Tier 3 as NOT_RUN and Tier 4 as awaiting credentials, and exits 0 without fabricating signatures or network calls.

### Operational Workflow for Live Activation:
1. Obtain the required confidential-workflow/private-beta access. Install the CRE CLI with its official installer; the installer verifies the release GPG signature. CLI v1.32.0 gates `cre init` and `cre workflow simulate` behind `cre login` or `CRE_API_KEY`; `cre workflow build` and `cre workflow hash` do not need login.
2. Create an untracked `packages/cre/config.json` from `config.example.json` with the real authorized EVM trigger signer and the exact approved HTTPS `/v1/callback` URL. Provision `MAX_NOTIONAL` through `cre secrets`. Never log the requested size or the secret. Never commit `.env`, `config.json` or secret values.
3. Simulate: In PowerShell, `$env:MAX_NOTIONAL_ENV = "50"; & "$env:LOCALAPPDATA\Programs\cre\cre.exe" workflow simulate packages/cre -R packages/cre --target staging-settings --non-interactive --trigger-index 0 --http-payload '<fresh-envelope-json>'` (or in POSIX: `MAX_NOTIONAL_ENV=50 cre workflow simulate packages/cre -R packages/cre --target staging-settings --non-interactive --trigger-index 0 --http-payload '<fresh-envelope-json>'`). The trigger envelope must be generated fresh for each execution bound to the pending request and satisfy `policy.mjs` `callbackEnvelope` (expires within 120s). With the staging placeholder config, expect a clip to 50 followed by a callback failure, because `bridge.example.com` is unreachable by design. This placeholder run is NOT an end-to-end run.
4. For a complete end-to-end run, host `services/cre-bridge` behind TLS on an approved public DNS name and use `--target production-settings`.
5. Retain genuine sanitized evidence. `docs/cre-sim.txt` is NOT RUN, not a fabricated simulator transcript.
6. Verify the actual trust/attestation boundary. Local tests and an HTTPS 200 response do not prove enclave execution.

### Privacy limitation

The backend/bridge may see the requested input. A public clipped fill can reveal `MAX_NOTIONAL`, especially when the request is above the cap. This mechanism is not a guarantee of absolute policy secrecy or end-to-end private transport. A boolean-only decision or a different protocol would be needed for a stronger secrecy goal.

## n8n and CI

See `docs/AUTOMATION.md`. The actual n8n workflow is saved, inactive and unpublished. Its tests used pinned fixtures with table writes bypassed. It does not run the build itself. Importing the export into another n8n instance requires recreating/remapping its data table and reviewing permissions; do not reuse another instance's IDs blindly.

The corrected GitHub Actions template is an authored file, not an executed CI run. Do not publish workflows, attach production secrets or create deployment triggers without owner approval.
