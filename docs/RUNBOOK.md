# THELEMA Operations Runbook: Arc Testnet Launch & Settlement

## 1. Architectural Safety & Financial Limits

THELEMA is a synthetic prediction-and-impact market prototype designed for Arc Testnet (Chain ID `5042002`).

### Immutable Operational Boundaries
- **Default Broadcast Gate**: `RELEASE_APPROVED=false`. No transactions, seed broadcasts, or contract creations are transmitted to any network without explicit approval.
- **Spending Ceiling**: A proposed hard ceiling of **100.00 USDC** (covering 86.021 USDC collateral plus dynamic gas allowances and a 30% safety reserve). Deployment will halt immediately before broadcasting if total spending exceeds 100.00 USDC.
- **Shared-USDC Balance**: On Arc Testnet, native USDC (18 decimals, used for gas) and ERC-20 USDC (`0x3600000000000000000000000000000000000000`, 6 decimals, used for collateral) share the same underlying on-chain balance. Never add them together.
- **Zero Key Leaks**: Private keys must never be committed to git, written to `.env`, logged to stdout, or stored in plaintext shell history. Web servers must run read-only with zero private keys.

---

## 2. Secure Operator Key Management

Always load private keys ephemerally in memory during deployment or settlement sessions. Never pass private keys as inline command-line arguments or write them to persistent files.

### Option A: PowerShell (Windows)
Use `try / finally` to guarantee cleanup of credentials and environment variables even if errors occur:
```powershell
$secureKey = Read-Host "Enter Operator/Deployer Private Key" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $env:DEPLOYER_KEY = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    $env:RELEASE_APPROVED = "true"
    $env:APPROVED_DEPLOYER_ADDRESS = "0xYourApprovedSignerAddress"
    
    # Execute authorized deployment or operator action
    npm run deploy:demo
} finally {
    # Guaranteed cleanup of in-memory BSTR and environment variables
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Item Env:\DEPLOYER_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\RELEASE_APPROVED -ErrorAction SilentlyContinue
    Remove-Item Env:\APPROVED_DEPLOYER_ADDRESS -ErrorAction SilentlyContinue
}
```

### Option B: Bash (macOS / Linux)
Use a `trap` on EXIT, INT, and TERM to guarantee immediate cleanup:
```bash
cleanup() {
    unset DEPLOYER_KEY
    unset RELEASE_APPROVED
    unset APPROVED_DEPLOYER_ADDRESS
    history -d $((HISTCMD-1)) 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Read key silently into memory without shell history capture
read -s -p "Enter Operator/Deployer Private Key: " DEPLOYER_KEY
echo ""
export DEPLOYER_KEY
export RELEASE_APPROVED="true"
export APPROVED_DEPLOYER_ADDRESS="0xYourApprovedSignerAddress"

# Execute authorized deployment or operator action
npm run deploy:demo
```

---

## 3. Read-Only Address Funding Preflight

Before committing any private key or broadcasting any transactions, execute the unconditionally read-only address preflight. This mode requires only the public 20-byte address (`--address 0x...`), deriving zero keys and creating zero signers. It calculates remaining deployment costs against active RPC gas pricing and enforces the proposed 100.00 USDC spending ceiling.

```bash
# Direct node execution with target address:
node scripts/deploy-demo.mjs --address 0xYourDeployerAddress

# Or via npm script:
npm run preflight -- --address 0xYourDeployerAddress
```

### What the Preflight Verifies:
1. **Selected Chain**: Enforces Chain ID `5042002` (Arc Testnet).
2. **Current Balances**:
   - Single native USDC balance (18 decimals, gas).
   - ERC-20 precompile balance (`0x3600...0000`, 6 decimals, collateral).
3. **Remaining Costs**:
   - Collateral requirement: remaining uncompleted split & seeding operations (up to 86.021 USDC initially).
   - Dynamic gas budget: calculated from active RPC gas price + `30%` safety reserve across all remaining operations.
4. **Gas Provenance**:
   - Each gas estimate is classified honestly as `MINED_RECEIPT`, `UNVERIFIED_ALLOWANCE` (if completed without receipt), or `CONSERVATIVE_ALLOWANCE` (for undeployed contract dependencies with explicit Foundry gas trace baselines).
5. **Proposed 100.00 USDC Ceiling Check**:
   - Verifies `incurred_spending + remaining_spending <= 100.00 USDC`. Halts with an error if ceiling is exceeded.
6. **Readiness Report**:
   - Outputs dynamic surplus or actionable shortfall. Exits `0` if ready, or `1` if underfunded.

---

## 4. Market Deployment & Initial Liquidity Seeding

### Owner Checklist for Public Testnet Launch

#### Phase 1: Address-Only Preflight Verification (Unconditionally Read-Only)
- [ ] Dedicated deployer address generated and verified.
- [ ] Address funded via Circle Arc Testnet Faucet (`https://faucet.circle.com`).
- [ ] Address-only preflight executed: `npm run preflight -- --address 0xYourDeployerAddress`.
- [ ] Preflight confirms `READY` status with `SURPLUS` in both native USDC (gas) and ERC-20 USDC (collateral).
- [ ] Preflight confirms planned spending (incurred + remaining) is strictly within the proposed 100.00 USDC hard ceiling.
- [ ] Zero private keys, signers, or credentials loaded during Phase 1.

#### Phase 2: Ephemeral Credential Provisioning & Market Deployment
- [ ] Environment configured with explicit opt-in: `RELEASE_APPROVED=true`.
- [ ] Dedicated deployer address bound: `APPROVED_DEPLOYER_ADDRESS=0xYourDeployerAddress`.
- [ ] Ephemeral key loaded in memory (`DEPLOYER_KEY`) using secure session patterns (PowerShell `try/finally` or Bash `trap`).
- [ ] Deploy script executed: `npm run deploy:demo`.
- [ ] Deployment manifest verified at `deployments/demo-manifest.json` with all contract addresses and bindings recorded.
- [ ] Ephemeral credentials immediately wiped from memory/environment.

#### Phase 3: Post-Launch Operator Controls & Settlement
- [ ] Dedicated operator address bound: `APPROVED_OPERATOR_ADDRESS=0xYourOperatorAddress`.
- [ ] Status inspected: `npm run demo:operator status`.
- [ ] Two-stage lifecycle executed when deadlines and observation conditions are satisfied:
  - Event resolution: `npm run demo:operator resolve-event <YES|NO>`.
  - Final price fixing: `npm run demo:operator fix-price <priceInUSDC>`.
  - Or atomic combined execution: `npm run demo:operator publish-and-settle <YES|NO> <priceInUSDC>`.
- [ ] Ephemeral operator credentials wiped immediately following settlement operations.

### Executing Deployment
Follow the secure session instructions in **Section 2** to load `DEPLOYER_KEY`, `RELEASE_APPROVED=true`, and `APPROVED_DEPLOYER_ADDRESS` in memory before running:
```bash
npm run deploy:demo
```

### What Happens During Deployment:
1. **Core Contracts Deployment**:
   - `DemoOracle`: Market resolution and price fixing oracle.
   - `BinaryVault`: 1:1 YES/NO binary collateral vault.
   - `ShareVault`: Capped continuous payoff vault ($500.00 cap).
2. **AMM Deployments**:
   - `BinaryAMM`: Constant-product AMM for YES and NO outcome tokens.
   - `ShareAMM (YES)`: AMM for yesShare continuous impact tokens.
   - `ShareAMM (NO)`: AMM for noShare continuous impact tokens.
3. **Collateral Splitting & Seeding**:
   - `20.00 USDC` split into 20 YES + 20 NO; seeds BinaryAMM with 10 YES + 10 NO.
   - `50.00 USDC` split into 0.1 complete sets (0.1 yesShare, 0.1 noShare, 0.1 residualShare).
   - `11.655 USDC` + 0.1 yesShare seeds YesShareAMM ($116.55 implied price).
   - `4.366 USDC` + 0.1 noShare seeds NoShareAMM ($43.66 implied price).
   - Deployer retains 10 YES, 10 NO, and 0.1 residualShare ($50.00 max payout).
   - Incurred collateral locks: 20.00 (binary) + 50.00 (share) + 11.655 (yes seed) + 4.366 (no seed) = 86.021 USDC initial collateral.

### Crash-Safe Recovery & Fee Bounds
If deployment is interrupted (network timeout, process killed, gas spike):
- THELEMA uses an atomic transaction journal (`deployments/demo-manifest.json`).
- Re-running checks the on-chain status of every submitted transaction before resending.
- Mined transactions are promoted to `COMPLETED` without rebroadcasting.
- Cumulative spending accounts for all attempts, including reverted transactions.
- Bounded gas prices (`maxFeeBound = 130%` of RPC gas price) protect against in-flight fee gouging.
- Pre-broadcast rechecks re-verify budget and proposed ceiling before each transaction.

---

## 5. Demo Calendar & Lifecycle Settlement Operations

### Demo Calendar Configuration
Market duration defaults depend on deployment target:
- **Local EVM** (default when testing on loopback):
  - `eventDeadline`: +3,600s (1 hour)
  - `tradingCutoff`: +7,200s (2 hours)
  - `earliestPriceFixTime`: +7,200s (2 hours)
- **Arc Testnet / Public Targets** (configured via environment):
  - `DEMO_CALENDAR_EVENT_OFFSET`: default `86400` (24 hours)
  - `DEMO_CALENDAR_CUTOFF_OFFSET`: default `172800` (48 hours)
  - `DEMO_CALENDAR_PRICE_FIX_OFFSET`: default `172800` (48 hours)

### Operator Settlement Commands

#### 1. Check Market & Settlement Status
```bash
npm run demo:operator status
```

#### 2. Resolve the Event (Stage 1)
Resolves whether the underlying condition occurred (`YES`) or not (`NO`):
```bash
# Can resolve YES at any time before or after deadline
npm run demo:operator resolve-event YES

# Can resolve NO only after eventDeadline has passed
npm run demo:operator resolve-event NO
```

#### 3. Fix the Final Settlement Price (Stage 2)
Fixes the continuous index settlement price in USDC ($0.00 to $500.00 cap) after event resolution and earliest price fix time:
```bash
# Price must be formatted as decimal with at most 6 decimals:
npm run demo:operator fix-price 220.50
```

#### 4. Combined Atomic Execution
Executes both stages in a single command once all timing conditions are satisfied:
```bash
npm run demo:operator publish-and-settle YES 220.50
```

---

## 6. Sponsor Integration Verification

Verify sponsor integrations without external dependencies or secrets:

```bash
# Verify The Graph schemas, entity IDs, and freshness boundaries:
npm run verify:graph

# Verify Chainlink CRE WASM bytecode, simulation, and live TEE bridge boundaries:
npm run verify:cre
```

---

## 7. Production Web Hosting & Server Configuration

### Security Rules for Web Hosting
1. **Read-Only Server**: The web server (`apps/web/server.mjs`) reads on-chain data directly from the public RPC. It holds **NO private keys** and performs **NO write operations**.
2. **Reverse Proxy**: Always run behind TLS termination (Nginx, Caddy, or Cloudflare) with HTTP/2 and rate limiting enabled.
3. **Public Host & Origin**: Specify `APP_HOST` and HTTPS `APP_ORIGIN` to enforce DNS rebinding protection and set `SameSite=Strict; Secure` session cookies.
4. **Port Binding**: Bind Node.js server strictly to loopback: `127.0.0.1:3000`.

### Systemd Service Configuration (`/etc/systemd/system/thelema.service`)
```ini
[Unit]
Description=THELEMA Web Application
After=network.target

[Service]
Type=simple
User=thelema
WorkingDirectory=/var/www/thelema
ExecStart=/usr/bin/node apps/web/server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=APP_HOST=thelema.example.com
Environment=APP_ORIGIN=https://thelema.example.com
Environment=ARC_RPC_URL=https://rpc.testnet.arc.io

# Deployed Contract Addresses (from demo-manifest.json)
Environment=ARC_ORACLE=0x...
Environment=ARC_BINARY_VAULT=0x...
Environment=ARC_SHARE_VAULT=0x...
Environment=ARC_BINARY_AMM=0x...
Environment=ARC_YES_SHARE_AMM=0x...
Environment=ARC_NO_SHARE_AMM=0x...
Environment=ARC_USDC=0x3600000000000000000000000000000000000000

# Sandboxing & Security
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Nginx Reverse Proxy Configuration (`/etc/nginx/sites-available/thelema.conf`)
```nginx
server {
    listen 80;
    server_name thelema.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name thelema.example.com;

    ssl_certificate /etc/letsencrypt/live/thelema.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/thelema.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/health {
        proxy_pass http://127.0.0.1:3000/api/health;
        access_log off;
    }
}
```

---

## 8. Complete Test Taxonomy & Exact Verification Suite

All local test suites are automated and reproducible. Use the commands below to verify each subsystem:

| Test Suite | Execution Command | Test Taxonomy & Exact Count | Scope & Coverage |
| :--- | :--- | :--- | :--- |
| **Node Unit & Integration** | `npm test` | **212 tests (0 suites, 212 passing)** | BigInt market economics, API validation, HTTP/CSRF security, Graph mock adapters, sanitized live Graph evidence logging, CRE policy & negative verifier tests, wallet mock simulation. |
| **Foundry Smart Contracts** | `cd packages/contracts && forge test -vvv` | **24 tests (24 passing)** | Solidity contracts (`BinaryVault`, `ShareVault`, `BinaryAMM`, `ShareAMM`, `DemoOracle`), complete-set conservation ($C \to Y + N + R$), math invariants, fee bounds, lifecycle cutoffs. |
| **Real Cryptographic Signatures** | `npm run test:bridge:crypto` | **2 tests (2 passing)** | Dedicated EIP-191 ephemeral signer key recovery and request replay token independence. |
| **Local EVM Integration** | `npm run test:evm` or `node --test tests/arc-evm.integration.mjs` | **1 parent test + 14 nested subtests (= 15 TAP tests, 15 passing)** | Full end-to-end lifecycle on local Anvil EVM (`chain-id: 5042002`), real bytecode execution, binary & share AMM trades, YES/NO two-stage settlements, cutoff timing, preflight fee bounds, and journal recovery. Note: Reported as 15 tests in Node TAP output. |
| **Playwright Browser Suite** | `npm run test:ui` | **18 Playwright tests + live connected browser flow** | Headless Chromium tests in `tests/browser.mjs` (18 passing) plus complete 13-step connected wallet browser flow in `tests/arc-evm-browser.integration.mjs`. |
| **Graph Sponsor Verification** | `npm run verify:graph` | **Opt-in tool (exits 0 unconfigured, validates when configured)** | Graph schema validation, entity ID checks, and freshness window verification (< 900s). |
| **CRE Sponsor Verification** | `npm run verify:cre` | **4-tier verification (Policy: VERIFIED, Build: RECORDED, Sim: NOT_RUN, Live: UNCONFIGURED)** | WASM byte validation, SHA-256 source digests, CLI simulation transcript analysis, and fail-closed live bridge standby. |

