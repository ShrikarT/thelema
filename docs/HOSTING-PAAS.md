# Deploying THELEMA on Render or Vercel

You do **not** need to manage manual Linux VMs, Nginx, or systemd services. THELEMA can be deployed directly to modern PaaS hosting providers in minutes.

---

## Recommended: Render (1-Click Native Node.js Deployment)

Render is the recommended hosting platform for THELEMA because it natively runs the persistent Node.js application server (`apps/web/server.mjs`), serving both the Single Page Application and the `/api/*` routes with automatic SSL, custom domains, and health monitoring.

### 1-Click Setup via Blueprint
1. Push your changes to GitHub (`ShrikarT/thelema`).
2. Log in to [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** -> **Blueprint**.
4. Select your `thelema-validation` repository.
5. Render will automatically detect `render.yaml` with two web services:
   - **`thelema`** (Web Application & Client API):
     - **Build Command**: `npm ci --include=dev && npm run build`
     - **Start Command**: `node apps/web/server.mjs`
     - **Health Check**: `/api/health`
     - **Host & Origin**: `thelema.onrender.com` / `https://thelema.onrender.com`
     - **Pre-configured Contracts**: Includes all 6 deployed Arc Testnet contract addresses (`ARC_ORACLE`, `ARC_BINARY_VAULT`, `ARC_SHARE_VAULT`, `ARC_BINARY_AMM`, `ARC_YES_SHARE_AMM`, `ARC_NO_SHARE_AMM`).
     - **Egress to Bridge**: `CRE_CLIP_URL: https://thelema-bridge.onrender.com/v1/clip`
   - **`thelema-bridge`** (Authenticated CRE Enclave Bridge):
     - **Build Command**: `npm ci --include=dev && npm run build`
     - **Start Command**: `node services/cre-bridge/server.mjs`
     - **Health Check**: `/healthz`
     - **Public Callback Ingress**: `https://thelema-bridge.onrender.com/v1/callback` routes directly to the bridge behind Render managed TLS (not merely the web app).
6. In the environment variables prompt, supply optional/required secrets:
   - `GRAPH_API_KEY`: Your Graph Gateway API key (for live decentralized Uniswap spot queries).
   - `BRIDGE_AUTH_TOKEN` & `CRE_CLIP_TOKEN`: Matching 32-byte secret string linking web app to bridge.
   - `CRE_TRIGGER_SIGNER` & `CRE_TRIGGER_PRIVATE_KEY`: Dedicated trigger signing key for CRE TEE invocations.
   - *(Note: The deployer key `DEPLOYER_KEY` is NEVER uploaded or needed by the hosting servers).*
7. Click **Apply Blueprint**. Render builds and deploys both services on free-tier instances with automatic TLS.

---

## Alternative: Vercel

If you deploy frontend-only on Vercel:
1. Import your GitHub repository into [Vercel](https://vercel.com/).
2. Under **Build and Output Settings**:
   - **Build Command**: `npm run build`
   - **Output Directory**: `apps/web/public`
3. Add Environment Variables:
   - `GRAPH_API_KEY`: `<your_graph_api_key>`
4. Deploy.

> [!NOTE]
> **Architectural Distinction**: Vercel static deployment serves the compiled SPA client bundle from `apps/web/public`. However, THELEMA's real `/api/*` endpoints (including `/api/health`, `/api/config`, `/api/market?mode=sandbox`, `/api/references`, `/api/sandbox/quote`, `/api/sandbox/trade`, `/api/sandbox/pairs`, `/api/sandbox/settle`, `/api/sandbox/claim`, and `/api/clip`) run in the native Node.js HTTP server (`apps/web/server.mjs`). Therefore, **Render** is the primary recommended platform for full-stack operation with active session isolation, CSRF protection, confidential clipping policy evaluation, and backend quote endpoints.

---

## Why PaaS Replaces Manual Server Maintenance
- **Automatic SSL/TLS**: Managed Let's Encrypt certificates without Certbot renewal cron jobs.
- **DDoS & Reverse Proxy Protection**: Built-in edge routing and DDoS mitigation replace custom Nginx configurations.
- **Zero-Secret Server**: The application holds no private keys or signing authority; all on-chain interactions are signed directly by the user's browser wallet.
