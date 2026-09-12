import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../apps/web/server.mjs';
import { runDeploy } from '../scripts/deploy-demo.mjs';
import { main as runOperator } from '../scripts/demo-operator.mjs';

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function mint(address, uint256) returns (bool)'
]);

const ARC_USDC = '0x3600000000000000000000000000000000000000';

function getFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function findAnvil() {
  if (process.env.ANVIL_PATH && existsSync(process.env.ANVIL_PATH)) return process.env.ANVIL_PATH;
  try {
    const cmd = process.platform === 'win32' ? 'where anvil' : 'which anvil';
    const found = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (found && existsSync(found)) return found;
  } catch {}
  const homeBin = path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
  if (existsSync(homeBin)) return homeBin;
  return null;
}

async function main() {
  console.log('Testing Connected Consumer Flow in Browser with Local EVM...');
  const anvilBin = findAnvil();
  assert.ok(anvilBin, 'Anvil binary required for EVM integration testing');

  const anvilPort = await getFreePort();
  const rpcUrl = `http://127.0.0.1:${anvilPort}`;
  const proc = spawn(anvilBin, ['--port', String(anvilPort), '--chain-id', '5042002', '--silent'], { stdio: 'ignore' });

  const testManifestPath = path.join(os.tmpdir(), `thelema-browser-manifest-${Date.now()}.json`);
  let server;
  let browser;

  try {
    // Wait for anvil RPC
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
        });
        if (res.ok) break;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    const client = createPublicClient({ transport: http(rpcUrl) });

    // Deployer account (Account 0)
    const deployerKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const deployerAccount = privateKeyToAccount(deployerKey);
    const deployerWallet = createWalletClient({ account: deployerAccount, transport: http(rpcUrl) });

    // Trader account (Account 1 - distinct from deployer/operator)
    const traderAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    const traderAddress = traderAccount.address;
    console.log(`Deployer / Operator: ${deployerAccount.address}`);
    console.log(`Connected Trader:    ${traderAddress}`);
    assert.notEqual(deployerAccount.address.toLowerCase(), traderAddress.toLowerCase(), 'Trader must be distinct from deployer');

    const prevApproved = process.env.APPROVED_DEPLOYER_ADDRESS;
    const prevDeployerKey = process.env.DEPLOYER_KEY;
    process.env.APPROVED_DEPLOYER_ADDRESS = deployerAccount.address;
    delete process.env.DEPLOYER_KEY;

    let deployed;
    try {
      deployed = await runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: deployerKey,
        manifestPath: testManifestPath
      });
    } finally {
      if (prevApproved) process.env.APPROVED_DEPLOYER_ADDRESS = prevApproved;
      else delete process.env.APPROVED_DEPLOYER_ADDRESS;
      if (prevDeployerKey) process.env.DEPLOYER_KEY = prevDeployerKey;
    }

    // Fund Trader with 500 USDC collateral
    console.log('Funding Trader with 500.00 USDC collateral...');
    const mintHash = await deployerWallet.writeContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'mint',
      args: [traderAddress, 500_000_000n]
    });
    await client.waitForTransactionReceipt({ hash: mintHash });

    const serverEnv = {
      ARC_RPC_URL: rpcUrl,
      ARC_ORACLE: deployed.contracts.oracle,
      ARC_BINARY_VAULT: deployed.contracts.binaryVault,
      ARC_SHARE_VAULT: deployed.contracts.shareVault,
      ARC_BINARY_AMM: deployed.contracts.binaryAmm,
      ARC_YES_SHARE_AMM: deployed.contracts.yesShareAmm,
      ARC_NO_SHARE_AMM: deployed.contracts.noShareAmm
    };

    const base = await new Promise(resolve => {
      server = createApp({ env: serverEnv });
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    });

    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    // Track all transactions submitted through browser wallet
    const recordedTxs = [];
    await context.exposeFunction('__thelema_record_tx__', (tx) => {
      recordedTxs.push(tx);
    });

    await context.exposeFunction('__thelema_rpc__', async (method, params) => {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'RPC Error');
      return data.result;
    });

    await context.addInitScript(({ accountAddress }) => {
      window.ethereum = {
        isMetaMask: true,
        request: async ({ method, params = [] }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            return [accountAddress];
          }
          if (method === 'eth_chainId') {
            return '0x4cef52'; // 5042002
          }
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
            return null;
          }
          const res = await window.__thelema_rpc__(method, params);
          if (method === 'eth_sendTransaction' && typeof res === 'string' && res.startsWith('0x')) {
            await window.__thelema_record_tx__({ hash: res, to: params[0]?.to, from: accountAddress });
          }
          return res;
        },
        on: () => {},
        removeListener: () => {}
      };
    }, { accountAddress: traderAddress });

    async function waitForTransaction(index, description) {
      const start = Date.now();
      while (recordedTxs.length <= index) {
        if (Date.now() - start > 20000) {
          throw new Error(`Timed out waiting for ${description} transaction (index ${index}) submission. Recorded count: ${recordedTxs.length}`);
        }
        await new Promise(r => setTimeout(r, 100));
      }
      const record = recordedTxs[index];
      const receipt = await client.waitForTransactionReceipt({ hash: record.hash });
      assert.equal(receipt.status, 'success', `${description} transaction ${record.hash} must succeed`);
      return { record, receipt };
    }

    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    // 1. Navigate to market
    await page.goto(`${base}/market`);
    console.log('1. Navigated to market');

    // 2. Switch to Arc Testnet mode
    await page.getByRole('button', { name: 'Arc Testnet', exact: true }).click();
    console.log('2. Switched to Arc Testnet mode');

    // 3. Connect Trader Wallet
    const connectBtn = page.getByRole('button', { name: 'Connect Arc wallet' });
    await connectBtn.click();
    await page.waitForFunction(() => document.querySelector('.site-header')?.textContent?.includes('0x7099…79C8'));
    const balText = await page.locator('.balance-box').innerText();
    assert.match(balText, /\$500\.00/, 'Trader USDC balance should show $500.00');
    console.log('3. Distinct Trader wallet connected and verified ($500.00 collateral balance)');

    // 4. Verify review button is enabled (time-unit normalization: cutoff is in the future)
    const reviewBtn = page.getByRole('button', { name: 'Review Arc trade', exact: true });
    await reviewBtn.waitFor({ state: 'visible' });
    assert.equal(await reviewBtn.isDisabled(), false, 'Review Arc trade button should be enabled');
    console.log('4. Review button is enabled (time-unit normalization verified)');

    // 5. Review and confirm trade on Arc (Asset YES - sNVDA share)
    const assetTradeTxStart = recordedTxs.length;
    await reviewBtn.click();
    await page.getByRole('dialog', { name: 'Review your trade' }).waitFor();
    await page.getByRole('button', { name: 'Sign in wallet', exact: true }).click();

    // Distinguish approval receipt from execution receipt
    const { receipt: assetAppReceipt } = await waitForTransaction(assetTradeTxStart, 'Asset Trade Approval');
    assert.equal(assetAppReceipt.to?.toLowerCase(), ARC_USDC.toLowerCase(), 'Approval transaction must interact with ARC_USDC');

    const { receipt: assetTradeReceipt } = await waitForTransaction(assetTradeTxStart + 1, 'Asset Trade Execution');
    assert.equal(assetTradeReceipt.to?.toLowerCase(), deployed.contracts.yesShareAmm.toLowerCase(), 'Trade transaction must interact with YesShareAMM');

    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Arc transaction confirmed'));
    console.log('5. Arc asset trade: verified distinct approval and trade execution receipts');

    // 5b. Buy Binary YES (Event share) on Arc
    await page.getByRole('button', { name: 'The event', exact: true }).click();
    await page.locator('#trade-amount').fill('10');
    const binTradeTxStart = recordedTxs.length;
    await reviewBtn.click();
    await page.getByRole('dialog', { name: 'Review your trade' }).waitFor();
    await page.getByRole('button', { name: 'Sign in wallet', exact: true }).click();

    // Distinguish approval receipt from execution receipt
    const { receipt: binAppReceipt } = await waitForTransaction(binTradeTxStart, 'Binary Trade Approval');
    assert.equal(binAppReceipt.to?.toLowerCase(), ARC_USDC.toLowerCase(), 'Approval transaction must interact with ARC_USDC');

    const { receipt: binTradeReceipt } = await waitForTransaction(binTradeTxStart + 1, 'Binary Trade Execution');
    assert.equal(binTradeReceipt.to?.toLowerCase(), deployed.contracts.binaryAmm.toLowerCase(), 'Trade transaction must interact with BinaryAMM');

    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Arc transaction confirmed'));
    console.log('5b. Arc binary trade: verified distinct approval and trade execution receipts');

    // 6. Check Positions tab
    await page.locator('.desktop-nav').getByRole('link', { name: 'Positions', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.portfolio-layout table'));
    const tableContent = await page.locator('.portfolio-layout table').innerText();
    assert.match(tableContent, /sNVDA share/);
    assert.match(tableContent, /Event share/);
    console.log('6. Positions tab loaded both asset and binary holding rows');

    // 7a. Test Pairs on Arc: Split & Merge 1 binary pair
    const binSplitTxStart = recordedTxs.length;
    await page.getByLabel('Book', { exact: true }).selectOption('binary');
    await page.locator('#pair-quantity').fill('1');
    await page.getByRole('button', { name: 'Split pair', exact: true }).click();

    // Distinguish approval from split execution
    const { receipt: binSplitApp } = await waitForTransaction(binSplitTxStart, 'Binary Split Approval');
    assert.equal(binSplitApp.to?.toLowerCase(), ARC_USDC.toLowerCase(), 'Binary split approval must interact with ARC_USDC');

    const { receipt: binSplitExec } = await waitForTransaction(binSplitTxStart + 1, 'Binary Split Execution');
    assert.equal(binSplitExec.to?.toLowerCase(), deployed.contracts.binaryVault.toLowerCase(), 'Binary split execution must interact with BinaryVault');

    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Split 1 pair'));
    console.log('7a. Arc binary pair split confirmed with distinct approval and split receipts');

    const binMergeTxStart = recordedTxs.length;
    await page.locator('#pair-quantity').fill('1');
    await page.getByRole('button', { name: 'Merge pair', exact: true }).click();
    const { receipt: binMergeExec } = await waitForTransaction(binMergeTxStart, 'Binary Merge Execution');
    assert.equal(binMergeExec.to?.toLowerCase(), deployed.contracts.binaryVault.toLowerCase(), 'Binary merge execution must interact with BinaryVault');
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Merged 1 pair'));
    console.log('7b. Arc binary pair merge confirmed with verified receipt');

    // 7c. Split Asset Pair on Arc (gives distinct trader a real, backed nonzero R holding)
    const assetSplitTxStart = recordedTxs.length;
    await page.getByLabel('Book', { exact: true }).selectOption('asset');
    await page.locator('#pair-quantity').fill('0.1');
    await page.getByRole('button', { name: 'Split pair', exact: true }).click();

    // Distinguish approval from asset split execution
    const { receipt: assetSplitApp } = await waitForTransaction(assetSplitTxStart, 'Asset Split Approval');
    assert.equal(assetSplitApp.to?.toLowerCase(), ARC_USDC.toLowerCase(), 'Asset split approval must interact with ARC_USDC');

    const { receipt: assetSplitExec } = await waitForTransaction(assetSplitTxStart + 1, 'Asset Split Execution');
    assert.equal(assetSplitExec.to?.toLowerCase(), deployed.contracts.shareVault.toLowerCase(), 'Asset split execution must interact with ShareVault');

    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Split 0.1 pair'));
    console.log('7c. Arc asset pair split confirmed with distinct approval and ShareVault receipts');

    // Verify trader on-chain backed nonzero R and noShare holdings
    const traderRBeforeClaim = await client.readContract({
      address: deployed.contracts.residualShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(traderRBeforeClaim, 100_000_000_000_000_000n, 'Trader must hold backed nonzero R (0.1 tokens) from asset pair split');

    const traderNoBeforeClaim = await client.readContract({
      address: deployed.contracts.noShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(traderNoBeforeClaim, 100_000_000_000_000_000n, 'Trader must hold 0.1 noShare tokens from asset pair split');

    // Verify Positions tab shows Residual claim (R) row
    await page.waitForFunction(
      () => document.querySelector('.portfolio-layout table')?.textContent?.includes('Residual claim (R)'),
      { timeout: 15000 }
    );
    const tableWithR = await page.locator('.portfolio-layout table').innerText();
    assert.match(tableWithR, /Residual claim \(R\)/, 'Positions table must show Residual claim (R) row');
    assert.match(tableWithR, /sNVDA share/, 'Positions table must show sNVDA share row');
    assert.match(tableWithR, /Event share/, 'Positions table must show Event share row');
    console.log('    Verified: Trader holds 0.1 backed R on-chain and UI renders Residual claim (R) row');

    // 8. Advance EVM time past cutoff & earliestPriceFixTime
    await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'evm_increaseTime', params: [7500] })
    });
    await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'evm_mine', params: [] })
    });

    // 9. Operator resolves event to YES
    const operatorConfig = {
      rpcUrl,
      isLocal: true,
      manifestPath: testManifestPath,
      oracle: deployed.contracts.oracle,
      binaryVault: deployed.contracts.binaryVault,
      shareVault: deployed.contracts.shareVault,
      binaryAmm: deployed.contracts.binaryAmm,
      yesShareAmm: deployed.contracts.yesShareAmm,
      noShareAmm: deployed.contracts.noShareAmm,
      privateKey: deployerKey
    };
    await runOperator(['resolve-event', 'YES'], operatorConfig);
    console.log('9. Operator resolved event to YES on-chain');

    // Pre-binary-claim checks: read on-chain balances
    const preBinYes = await client.readContract({
      address: deployed.contracts.yesToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.ok(preBinYes > 0n, 'Trader must hold binary YES tokens before binary claim');

    const preBinShares = await client.readContract({
      address: deployed.contracts.yesShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.ok(preBinShares > 0n, 'Trader must hold yesShare asset tokens before binary claim');

    const preBinR = await client.readContract({
      address: deployed.contracts.residualShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(preBinR, 100_000_000_000_000_000n, 'Trader must hold 0.1 R before binary claim');

    const preBinCollateral = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });

    // 10. Verify binary claim in browser (reactive refresh without page reload)
    const claimBtn = page.getByRole('button', { name: 'Claim on Arc', exact: true });
    await claimBtn.waitFor({ state: 'visible', timeout: 15000 });

    const binClaimTxIndex = recordedTxs.length;
    await claimBtn.click();
    const { receipt: binClaimReceipt } = await waitForTransaction(binClaimTxIndex, 'Binary claim');
    assert.equal(binClaimReceipt.status, 'success');
    assert.equal(
      binClaimReceipt.to?.toLowerCase(),
      deployed.contracts.binaryVault.toLowerCase(),
      'Binary claim receipt must interact directly with BinaryVault'
    );
    console.log(`10. Binary claim confirmed with receipt: ${binClaimReceipt.transactionHash}`);

    // Wait for browser claim action to finish
    await page.waitForFunction(() => !document.querySelector('.claim-button')?.textContent?.includes('Claiming'));
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Arc claim confirmed'));

    // Verify on-chain binary YES tokens redeemed
    const postBinYes = await client.readContract({
      address: deployed.contracts.yesToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(postBinYes, 0n, 'Binary YES tokens must be 0 after binary claim redemption');

    // Verify on-chain collateral increased
    const postBinCollateral = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.ok(postBinCollateral > preBinCollateral, 'Collateral balance must increase after binary claim');

    // Verify asset and R balances strictly untouched!
    const postBinShares = await client.readContract({
      address: deployed.contracts.yesShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(postBinShares, preBinShares, 'Asset shares must remain strictly untouched during binary claim');

    const postBinR = await client.readContract({
      address: deployed.contracts.residualShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(postBinR, preBinR, 'Residual claim (R) tokens must remain strictly untouched during binary claim');

    // Wait for UI reactive refresh: binary row disappears, BOTH sNVDA share AND Residual claim (R) rows remain
    await page.waitForFunction(
      () => {
        const text = document.querySelector('.portfolio-layout table')?.textContent || '';
        return text.includes('sNVDA share') && text.includes('Residual claim (R)') && !text.includes('Event share');
      },
      { timeout: 15000 }
    );
    const tableAfterBin = await page.locator('.portfolio-layout table').innerText();
    assert.match(tableAfterBin, /sNVDA share/, 'Asset row (sNVDA share) must remain in table after binary claim');
    assert.match(tableAfterBin, /Residual claim \(R\)/, 'Residual row must remain in table after binary claim');
    assert.doesNotMatch(tableAfterBin, /Event share/, 'Binary row must no longer appear after binary claim');
    console.log('    Verified: Binary redeemed while asset and R balances remain strictly unchanged');

    // 11. Operator fixes price to $200.00 (strictly below $500.00 cap)
    await runOperator(['fix-price', '200.00'], operatorConfig);
    console.log('11. Operator fixed price to $200.00 on-chain (below-cap fixing: $200 index + $300 residual = $500 cap)');

    // Reload Positions to update state to PRICE_FIXED
    await page.locator('.desktop-nav').getByRole('link', { name: 'Market', exact: true }).click();
    await page.locator('.desktop-nav').getByRole('link', { name: 'Positions', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.portfolio-layout table')?.textContent?.includes('Residual claim (R)')
    );

    // Pre-asset-claim on-chain reads & exact payout calculations
    const preAssetShares = await client.readContract({
      address: deployed.contracts.yesShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    const preAssetR = await client.readContract({
      address: deployed.contracts.residualShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    const preAssetCollateral = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });

    assert.ok(preAssetShares > 0n, 'Trader must hold yesShare tokens before settlement claim');
    assert.ok(preAssetR > 0n, 'Trader must hold residualShare (R) tokens before settlement claim');

    // Settlement payouts:
    // cap = 500.00 USDC, price = 200.00 USDC
    // yesShare unit payout = 200.00 USDC (200_000_000 micro-USDC per 10^18 shares)
    // residualShare unit payout = 300.00 USDC (300_000_000 micro-USDC per 10^18 shares)
    const expectedYesPayout = (preAssetShares * 200_000_000n) / 10n**18n;
    const expectedRPayout = (preAssetR * 300_000_000n) / 10n**18n;
    const expectedTotalPayout = expectedYesPayout + expectedRPayout;
    console.log(`    Expected asset payout: ${expectedYesPayout} micro-USDC`);
    console.log(`    Expected R payout:     ${expectedRPayout} micro-USDC`);
    console.log(`    Expected total payout: ${expectedTotalPayout} micro-USDC`);

    // 12. Verify asset & residual claim in browser (two separate redemptions on ShareVault)
    await claimBtn.waitFor({ state: 'visible', timeout: 15000 });
    const assetClaimTxIndex = recordedTxs.length;
    await claimBtn.click();

    const { receipt: yesClaimReceipt } = await waitForTransaction(assetClaimTxIndex, 'yesShare settlement claim');
    assert.equal(yesClaimReceipt.status, 'success');
    assert.equal(
      yesClaimReceipt.to?.toLowerCase(),
      deployed.contracts.shareVault.toLowerCase(),
      'yesShare claim receipt must interact directly with ShareVault'
    );

    const { receipt: rClaimReceipt } = await waitForTransaction(assetClaimTxIndex + 1, 'residualShare settlement claim');
    assert.equal(rClaimReceipt.status, 'success');
    assert.equal(
      rClaimReceipt.to?.toLowerCase(),
      deployed.contracts.shareVault.toLowerCase(),
      'residualShare claim receipt must interact directly with ShareVault'
    );
    console.log(`12. Asset & R claims confirmed with receipts: ${yesClaimReceipt.transactionHash}, ${rClaimReceipt.transactionHash}`);

    await page.waitForFunction(() => !document.querySelector('.claim-button')?.textContent?.includes('Claiming'));
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Arc claim confirmed'));

    // Verify on-chain asset and R tokens redeemed to 0
    const postAssetShares = await client.readContract({
      address: deployed.contracts.yesShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(postAssetShares, 0n, 'Asset yesShare tokens must be 0 after settlement claim');

    const postAssetR = await client.readContract({
      address: deployed.contracts.residualShare,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    assert.equal(postAssetR, 0n, 'Residual claim (R) tokens must be 0 after settlement claim');

    // Verify on-chain collateral increased by exact total payout
    const postAssetCollateral = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [traderAddress]
    });
    const actualPayout = postAssetCollateral - preAssetCollateral;
    assert.equal(actualPayout, expectedTotalPayout, `Exact collateral payout must match sum of yesShare and residualShare payouts (${expectedTotalPayout} micro-USDC)`);
    console.log(`    Verified: Exact collateral payout received (${actualPayout} micro-USDC), token balances reduced to 0`);

    // Verify UI reactive refresh: winning rows removed from table
    await page.waitForFunction(
      () => {
        const text = document.querySelector('.portfolio-layout table')?.textContent || '';
        return !text.includes('Residual claim (R)') && !text.includes('YES');
      },
      { timeout: 15000 }
    );
    console.log('    Verified: UI table updated reactively, winning rows removed');

    // 13. Negative Case Verification:
    // A. Browser UI: attempting redemption when no winning positions remain throws and broadcasts 0 transactions
    const countBeforeNegative = recordedTxs.length;
    await claimBtn.click();
    await page.waitForFunction(
      () => document.querySelector('.error-inline, [role="alert"]')?.textContent?.includes('No winning positions are claimable'),
      { timeout: 10000 }
    );
    assert.equal(recordedTxs.length, countBeforeNegative, 'Zero transactions must be broadcast when no winning positions are claimable');
    console.log('13a. Negative case (Client): claim button correctly rejected with "No winning positions are claimable" and 0 transactions broadcast');

    // B. Contract-side: direct redemption calls on exhausted positions revert
    await assert.rejects(
      () => client.simulateContract({
        account: traderAccount,
        address: deployed.contracts.shareVault,
        abi: parseAbi(['function redeem(address token, uint256 shares, address recipient) returns (uint256)']),
        functionName: 'redeem',
        args: [deployed.contracts.residualShare, 1n, traderAddress]
      }),
      /revert|transfer/i,
      'Direct ShareVault.redeem for residualShare must revert when balance is 0'
    );

    await assert.rejects(
      () => client.simulateContract({
        account: traderAccount,
        address: deployed.contracts.shareVault,
        abi: parseAbi(['function redeem(address token, uint256 shares, address recipient) returns (uint256)']),
        functionName: 'redeem',
        args: [deployed.contracts.yesShare, 1n, traderAddress]
      }),
      /revert|transfer/i,
      'Direct ShareVault.redeem for yesShare must revert when balance is 0'
    );
    console.log('13b. Negative case (Contract): direct contract redemptions for exhausted positions revert on-chain');

    console.log('\n>>> All connected consumer browser flow assertions passed successfully! <<<');
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      server.close();
    }
    proc.kill();
    try {
      if (existsSync(testManifestPath)) unlinkSync(testManifestPath);
    } catch {}
  }
}

main().catch(err => {
  console.error('Browser EVM test failed:', err);
  process.exit(1);
});
