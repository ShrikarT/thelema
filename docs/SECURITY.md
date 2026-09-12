# Security and trust boundaries

This is a research build, not a security certification.

## Implemented local defenses

- Loopback binding by default; unexpected Host headers rejected to reduce DNS-rebinding exposure.
- Opaque random per-session IDs; HttpOnly/SameSite=Strict cookie; four-hour expiry and bounded session count.
- Separate CSRF token for mutations; origin and cross-site checks; JSON content type; 16 KiB body limit; request/header timeouts.
- Per-session request limiting and a tighter clipping limit. This is not a distributed anti-abuse system.
- Static public-path/extension allowlist; no source, `.env`, source maps or arbitrary proxy URLs exposed.
- CSP, nosniff, no-referrer, anti-framing and noindex headers for the local server.
- BigInt monetary updates; bounds on malformed sizes, slippage, balances, revisions and deadlines.
- No server signing key. Wallet account/network/decimal guards, exact new allowance rather than unlimited approval, preflight simulation, receipt status and pending-transaction warnings.
- Graph/CRE keys stay on the server; fixed/allowlisted HTTPS hosts and disabled redirects; live failures do not fall back to demo output.
- No request-body/access logging in the server. Unit test examples are public fixtures, not real private orders.

## Important limitations

- Sandbox balances are not financial accounts. A process restart loses state; the standalone file is intentionally resettable and client-controlled.
- The site is not authenticated production trading infrastructure. Do not expose it publicly without a separate deployment/auth/rate-limit review.
- Origin/host controls assume a reviewed exact `APP_ORIGIN` and `APP_HOST`; configure HTTPS and secure cookies before hosted use. The app does not blindly trust forwarded headers.
- Mock wallet checks are not real-chain verification. A configured address is not proof of correct bytecode or ownership.
- Approvals and fills are separate transactions. If the fill fails after approval, the allowance may remain. Inspect receipts before resending any pending transaction.
- Multi-book claims can partially succeed; the client reports the number confirmed and instructs a refresh before retrying.
- Contracts and CRE code remain uncompiled here, unaudited and not production-ready.
- The demo oracle is fully trusted and can settle a market. Production timing/event-resolution rules require another design.
- The backend/bridge can see a requested clip size. A returned clipped size can reveal the threshold. Do not claim absolute secrecy or end-to-end private transport.
- Graph references need real schema/unit/freshness verification. Different assets and capped payoffs are not a guaranteed dollar identity.
- The n8n gate stores submitted evidence, including its raw form submission. Never submit secrets, private order sizes or `MAX_NOTIONAL`. Review retention/access before publishing it.
- The n8n gate checks reported statuses and presence of references, not their authenticity, complete URL syntax, commit validity, chain proofs or actual CI execution. A malicious or mistaken submission can say PASS; a human must inspect the artifacts.
- Dependency lockfile, full TypeScript checks, broader browser coverage and independent audits remain release prerequisites.

## Do not include in exports

Private keys, seed phrases, `.env`, real credentials, private order payloads, auth cookies, raw provider debug output or personal session identifiers. `automation/evidence/release-evidence.json` intentionally contains no live receipts or fabricated private execution.
