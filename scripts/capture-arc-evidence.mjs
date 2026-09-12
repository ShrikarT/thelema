#!/usr/bin/env node
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../apps/web/server.mjs';

const manifestPath = path.resolve('deployments/submission-market.json');
if (!existsSync(manifestPath)) {
  throw new Error('Manifest not found at ' + manifestPath);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

let renderRefs = null;
try {
  const cRes = await fetch('https://thelema.onrender.com/api/config');
  const cookie = cRes.headers.get('set-cookie');
  const rRes = await fetch('https://thelema.onrender.com/api/references', {
    headers: { cookie: cookie || '' }
  });
  renderRefs = await rRes.json();
  console.log('Fetched Render references. Cross-protocol status:', renderRefs?.crossProtocol?.status);
} catch (err) {
  console.error('Failed to fetch Render references:', err);
}

const env = {
  ...process.env,
  ARC_ORACLE: manifest.contracts.oracle,
  ARC_BINARY_VAULT: manifest.contracts.binaryVault,
  ARC_SHARE_VAULT: manifest.contracts.shareVault,
  ARC_BINARY_AMM: manifest.contracts.binaryAmm,
  ARC_YES_SHARE_AMM: manifest.contracts.yesShareAmm,
  ARC_NO_SHARE_AMM: manifest.contracts.noShareAmm,
  ARC_RPC_URL: 'https://rpc.testnet.arc.network',
  ARC_USE_SUBMISSION: 'true'
};

const app = createApp({ env });
const originalListeners = app.listeners('request');
app.removeAllListeners('request');
app.on('request', async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/references' && renderRefs) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(renderRefs));
  }
  if (url.pathname === '/api/rpc-proxy' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const rpcRes = await fetch('https://rpc.testnet.arc.network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const data = await rpcRes.text();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(data);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  for (const l of originalListeners) {
    l.call(app, req, res);
  }
});

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const baseUrl = 'http://127.0.0.1:' + port;
  console.log('Server running at', baseUrl);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/local/bin/chromium') ? '/usr/local/bin/chromium' : undefined),
    args: ['--no-sandbox']
  });

  const outputDir = path.resolve('docs/evidence');
  mkdirSync(outputDir, { recursive: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce'
    });

    await context.addInitScript(() => {
      const account = '0x7eCdBAe811359ee95Dae97213EbEB48E99af920d';
      window.ethereum = {
        isMetaMask: true,
        request: async ({ method, params }) => {
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
            return [account];
          }
          if (method === 'eth_chainId') {
            return '0x4cef52';
          }
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
            return null;
          }
          const res = await fetch('/api/rpc-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error.message || 'RPC Error');
          return data.result;
        },
        on: () => {},
        removeListener: () => {}
      };
    });

    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    // Screenshot A: submission-01-arc-market.png
    console.log('Capturing Screenshot A: submission-01-arc-market.png...');
    await page.goto(baseUrl + '/market');
    await page.getByRole('button', { name: 'Arc Testnet', exact: true }).click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="stat-0"]');
      return el && el.textContent && el.textContent.includes('54.7%');
    }, { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(outputDir, 'submission-01-arc-market.png'),
      fullPage: false
    });
    console.log('Captured submission-01-arc-market.png');

    // Screenshot B: submission-02-arc-trade.png
    console.log('Capturing Screenshot B: submission-02-arc-trade.png...');
    await page.locator('.site-header').getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.waitForFunction(() => document.body.textContent.includes('0x7eCd…920d'), { timeout: 10000 });
    console.log('Wallet connected in UI!');
    await page.getByLabel('Amount to spend').fill('1');
    await page.getByRole('button', { name: 'Review Arc trade', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review your trade' }).waitFor();
    await page.waitForFunction(() => {
      const d = document.querySelector('dialog');
      return d && d.textContent.includes('Sign in wallet') && d.textContent.includes('0.0030');
    }, { timeout: 10000 });
    await page.screenshot({
      path: path.join(outputDir, 'submission-02-arc-trade.png'),
      fullPage: false
    });
    console.log('Captured submission-02-arc-trade.png');

    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });

    // Screenshot C: submission-03-position.png
    console.log('Capturing Screenshot C: submission-03-position.png...');
    await page.locator('.desktop-nav').getByRole('link', { name: 'Positions', exact: true }).click();
    await page.waitForFunction(() => {
      const table = document.querySelector('.portfolio-layout table');
      return table && table.textContent.includes('11.9036') && table.textContent.includes('10');
    }, { timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(outputDir, 'submission-03-position.png'),
      fullPage: false
    });
    console.log('Captured submission-03-position.png');

    // Screenshot E: submission-05-integrations.png
    console.log('Capturing Screenshot E: submission-05-integrations.png...');
    await page.locator('.desktop-nav').getByRole('link', { name: 'Market', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.identity-panel') !== null);
    await page.locator('.identity-panel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(outputDir, 'submission-05-integrations.png'),
      fullPage: false
    });
    console.log('Captured submission-05-integrations.png');

    // Screenshot D: submission-04-onchain-proof.png
    console.log('Capturing Screenshot D: submission-04-onchain-proof.png...');
    const arcscanUrl = 'https://testnet.arcscan.app/tx/0xe4208cc844dbfec21d18e38c20630388c2a7c7083bb17583fbe6dfc5a55190a6';
    const arcscanPage = await context.newPage();
    arcscanPage.setDefaultTimeout(30000);
    try {
      await arcscanPage.goto(arcscanUrl, { waitUntil: 'networkidle' });
    } catch (e) {
      console.log('Networkidle timeout, proceeding with current state:', e.message);
    }
    await arcscanPage.waitForTimeout(3000);
    await arcscanPage.screenshot({
      path: path.join(outputDir, 'submission-04-onchain-proof.png'),
      fullPage: false
    });
    console.log('Captured submission-04-onchain-proof.png');
    await arcscanPage.close();

    console.log('SUCCESS: All 5 evidence screenshots captured!');
  } finally {
    await browser.close();
    server.close();
  }
});
