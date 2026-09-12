#!/usr/bin/env node
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../apps/web/server.mjs';

const manifestPath = path.resolve('deployments/submission-market.json');
if (!existsSync(manifestPath)) {
  throw new Error(`Manifest not found at ${manifestPath}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const env = {
  ARC_ORACLE: manifest.contracts.oracle,
  ARC_BINARY_VAULT: manifest.contracts.binaryVault,
  ARC_SHARE_VAULT: manifest.contracts.shareVault,
  ARC_BINARY_AMM: manifest.contracts.binaryAmm,
  ARC_YES_SHARE_AMM: manifest.contracts.yesShareAmm,
  ARC_NO_SHARE_AMM: manifest.contracts.noShareAmm,
  ARC_RPC_URL: 'https://rpc.testnet.arc.io'
};

const app = createApp({ env });
const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Ephemeral server running at ${baseUrl}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    const exceptions = [];
    page.on('pageerror', (err) => exceptions.push(err.message));

    console.log('Navigating to /market...');
    await page.goto(`${baseUrl}/market`);

    console.log('Switching to Arc Testnet mode...');
    await page.getByRole('button', { name: 'Arc Testnet', exact: true }).click();

    // Wait for the Arc data to load and display the real on-chain probability (~54.7%)
    console.log('Waiting for Arc on-chain statistics...');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="stat-0"]');
      return el && el.textContent && el.textContent !== '—' && el.textContent.includes('%');
    }, { timeout: 15000 });

    const probText = await page.locator('[data-testid="stat-0"]').innerText();
    console.log(`On-chain probability displayed: ${probText}`);

    const stat1 = await page.locator('[data-testid="stat-1"]').innerText();
    const stat2 = await page.locator('[data-testid="stat-2"]').innerText();
    const stat3 = await page.locator('[data-testid="stat-3"]').innerText();
    console.log(`On-chain metrics: stat1=${stat1}, stat2=${stat2}, stat3=${stat3}`);

    const outPath = path.resolve('docs/evidence/market-arc-desktop.png');
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`Saved screenshot to ${outPath}`);

    if (exceptions.length > 0) {
      console.error('Page errors encountered:', exceptions);
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
});
