# Live validation

node scripts/validate-live.mjs --public-only --output docs/evidence/arc-public-probe.json performs public chain/decimals reads only, never deployment or fund movement.

node --env-file=/secure/path/web.env scripts/validate-live.mjs --output docs/evidence/live-validation.json additionally checks configured contract reads, Graph references and a one-USDC authenticated clipping probe. An endpoint response is not independent TEE attestation or release approval.

Owner prerequisites: approved Arc owner and securely controlled testnet signer; verified deployed contracts and genuine receipts; Graph server API key and real relevant subgraph/market/pool/token IDs; CRE account with Confidential Workflows access, authorized signer, secure MAX_NOTIONAL, deployed workflow and operator-owned HTTPS bridge. Do not paste keys into chat. Validate actual schema, asset comparability, TLS, callback routing, persistence, logging and security before live use.

The n8n workflow is an optional submitted-evidence gate, not the app backend or CI runner. It checks reported statuses/references and reports READY/NO-GO; it does not independently authenticate evidence, build, deploy or move funds. This continuation does not activate it. GitHub Actions is the separate private compiler/test runner.
