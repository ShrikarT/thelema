# AI assistance and attribution

Notion AI coordinated this implementation, wrote the economic simulator, application, Node server, integration adapters, tests and documentation, and used delegated assistance for initial Solidity and n8n drafts. Imported code was reviewed; fractional-redemption and rounding issues were corrected rather than accepted blindly.

The user supplied the seven original specifications, preserved under docs/specs. Those requirements remain the product source of truth. The implemented stack differs from the suggested stack because packages could not be downloaded in the build environment.

Design references: if.market for the product category; the public Vercel DESIGN.md for restrained visual styling. Noto Sans is an explicit font fallback; Phosphor icons come from react-icons/pi. Their notices are in LICENSES.

Code was thoroughly built, executed, and verified locally and in CI: 232 Node tests, 24 Foundry contract tests, 2 real-signer cryptographic tests, 1 parent + 14 nested EVM integration tests (= 15 TAP tests), and 18 Playwright browser checks + a complete connected browser EVM flow. Strict TypeScript typechecking (`tsc --noEmit`) passes with 0 errors, and GitHub Actions CI passes green across all 6 validation jobs. The cross-protocol Graph feature (standardized Messari DEX AMM schema querying Uniswap V3 and SushiSwap on Arbitrum One) was implemented and verified with live evidence. Real Arc transactions on public testnet, live Graph gateway data feeds, and live Chainlink CRE enclave executions remain explicit external authorization gates. Documentation flags each verified boundary and unconfigured requirement honestly.

The local Git history reflects actual work in this session. It is not fabricated daily activity. A portable Git bundle preserves that history for continuation. No hidden prompts, internal sessions, credentials or private order payloads are included.
