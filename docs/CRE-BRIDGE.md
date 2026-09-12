# Authenticated CRE bridge

Separate service: web server -> authenticated /v1/clip -> signed CRE JSON-RPC -> TEE policy -> one-time authenticated /v1/callback -> result. ACCEPTED is not a result. See services/cre-bridge/.env.example; inject secrets through the operator secret manager. The web server must never receive the signing key.

Run behind a TLS proxy preserving the public Host. Default bind: loopback port 8787. Web-to-bridge token must match BRIDGE_AUTH_TOKEN. Workflow config publicKey and callbackUrl must match the real authorized signer and the exact approved HTTPS /v1/callback endpoint. MAX_NOTIONAL remains only in CRE secret storage.

Limits: 2 KiB bodies, 32 pending requests, 30 authenticated requests/minute, 45-second callbacks. Multi-instance hosting needs shared correlation storage or sticky routing. Redact payloads and authorization at the proxy and hosting layers too.

The bridge operator and authorized workflow are trusted. The app does not independently verify enclave attestation. Backend/bridge can see sizes; clipped output can reveal the cap. No absolute privacy claim.

npm run test:bridge uses mocks. npm run test:bridge:crypto uses genuine viem with fresh, unfunded ephemeral keys. Compilation is not a confidential execution. Private-beta access, deployment and real execution evidence are still required.

Protocol: https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/triggering-deployed-workflows
TEE API: https://docs.chain.link/cre/reference/sdk/confidential-workflows-client-ts
SDK pin: upstream 1.19.1 at b4dbdc0780a7397481686f4d7d3b7438b9c76260. Review its BUSL-1.1 terms and beta access.
