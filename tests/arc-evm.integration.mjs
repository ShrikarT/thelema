import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { configuration, readArc, quoteArc, makeRpc } from '../packages/arc/client.mjs';
import { runDeploy, redactRpcUrl, sanitizeErrorMessage, verifyLocalNodeIdentity } from '../scripts/deploy-demo.mjs';

const execFileAsync = promisify(execFile);

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

function findForge() {
  if (process.env.FORGE_PATH && existsSync(process.env.FORGE_PATH)) return process.env.FORGE_PATH;
  try {
    const cmd = process.platform === 'win32' ? 'where forge' : 'which forge';
    const found = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (found && existsSync(found)) return found;
  } catch {}
  const homeBin = path.join(os.homedir(), '.foundry', 'bin', process.platform === 'win32' ? 'forge.exe' : 'forge');
  if (existsSync(homeBin)) return homeBin;
  return null;
}

function assertPrerequisites() {
  const anvilBin = findAnvil();
  if (!anvilBin) {
    throw new Error('Anvil binary not found in PATH or standard Foundry locations. Install Foundry or set ANVIL_PATH.');
  }
  const forgeBin = findForge();
  if (!forgeBin) {
    throw new Error('Forge binary not found in PATH or standard Foundry locations. Install Foundry or set FORGE_PATH.');
  }

  const contractsDir = path.resolve('packages/contracts');
  const outDir = path.join(contractsDir, 'out');
  const required = [
    'MockUSDC.sol/MockUSDC.json',
    'DemoOracle.sol/DemoOracle.json',
    'BinaryVault.sol/BinaryVault.json',
    'ShareVault.sol/ShareVault.json',
    'BinaryAMM.sol/BinaryAMM.json',
    'ShareAMM.sol/ShareAMM.json'
  ];

  const allExist = required.every(r => existsSync(path.join(outDir, r)));
  if (!allExist) {
    try {
      execSync(`"${forgeBin}" build`, { cwd: contractsDir, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      throw new Error(`Failed to compile Solidity contracts: ${err.message}`);
    }
  }

  for (const r of required) {
    if (!existsSync(path.join(outDir, r))) {
      throw new Error(`Required compiled artifact missing after build: ${r}`);
    }
  }

  return { anvilBin, forgeBin, outDir };
}

test('Local EVM: End-to-end economic and lifecycle verification against compiled Solidity contracts', { timeout: 150000 }, async (t) => {
  const { anvilBin, outDir } = assertPrerequisites();
  const port = await getFreePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(anvilBin, ['--port', String(port), '--chain-id', '5042002', '--silent'], {
    stdio: 'ignore'
  });

  t.after(() => {
    proc.kill();
  });

  // Wait for anvil to accept connections
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  assert.ok(ready, 'Anvil EVM process should become ready');

  const adminAccount = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  const userAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

  const client = createPublicClient({ transport: http(rpcUrl) });
  const adminWallet = createWalletClient({ account: adminAccount, transport: http(rpcUrl) });
  const userWallet = createWalletClient({ account: userAccount, transport: http(rpcUrl) });

  async function sendTx(wallet, label, args) {
    const hash = await wallet.writeContract(args);
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', `${label} transaction should succeed (status === 'success')`);
    return receipt;
  }

  const readArtifact = async (contract, name) => {
    const raw = await readFile(path.join(outDir, contract, `${name}.json`), 'utf8');
    return JSON.parse(raw);
  };

  const mockUsdcArtifact = await readArtifact('MockUSDC.sol', 'MockUSDC');
  const oracleArtifact = await readArtifact('DemoOracle.sol', 'DemoOracle');
  const binaryVaultArtifact = await readArtifact('BinaryVault.sol', 'BinaryVault');
  const shareVaultArtifact = await readArtifact('ShareVault.sol', 'ShareVault');
  const binaryAmmArtifact = await readArtifact('BinaryAMM.sol', 'BinaryAMM');
  const shareAmmArtifact = await readArtifact('ShareAMM.sol', 'ShareAMM');

  const erc20Abi = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function approve(address, uint256) returns (bool)',
    'function transfer(address, uint256) returns (bool)',
    'function mint(address, uint256)'
  ]);

  const ARC_USDC = '0x3600000000000000000000000000000000000000';

  // Inject MockUSDC runtime bytecode at the exact Arc USDC precompile address
  await client.request({
    method: 'anvil_setCode',
    params: [ARC_USDC, mockUsdcArtifact.deployedBytecode.object]
  });

  const usdcCode = await client.getBytecode({ address: ARC_USDC });
  assert.ok(usdcCode && usdcCode !== '0x', 'MockUSDC must be deployed at Arc USDC address');

  // Helper to deploy a fresh market instance with EVM block-derived timestamps
  async function deployMarket({ cap6 = 500_000_000n, eventDeadlineOffset = 1000, tradingCutoffOffset = 2000, earliestPriceFixOffset = 2000 } = {}) {
    const block = await client.getBlock({ blockTag: 'latest' });
    const blockTime = Number(block.timestamp);
    const eventDeadline = BigInt(blockTime + eventDeadlineOffset);
    const tradingCutoff = BigInt(blockTime + tradingCutoffOffset);
    const earliestPriceFixTime = BigInt(blockTime + earliestPriceFixOffset);

    // Deploy DemoOracle
    const oracleTx = await adminWallet.deployContract({
      abi: oracleArtifact.abi,
      bytecode: oracleArtifact.bytecode.object,
      args: [adminAccount.address]
    });
    const oracleReceipt = await client.waitForTransactionReceipt({ hash: oracleTx });
    assert.equal(oracleReceipt.status, 'success');
    const oracleAddress = oracleReceipt.contractAddress;

    // Deploy BinaryVault
    const binVaultTx = await adminWallet.deployContract({
      abi: binaryVaultArtifact.abi,
      bytecode: binaryVaultArtifact.bytecode.object,
      args: [ARC_USDC, oracleAddress, eventDeadline, tradingCutoff]
    });
    const binVaultReceipt = await client.waitForTransactionReceipt({ hash: binVaultTx });
    assert.equal(binVaultReceipt.status, 'success');
    const binVaultAddress = binVaultReceipt.contractAddress;

    // Deploy ShareVault
    const shareVaultTx = await adminWallet.deployContract({
      abi: shareVaultArtifact.abi,
      bytecode: shareVaultArtifact.bytecode.object,
      args: [ARC_USDC, oracleAddress, cap6, eventDeadline, tradingCutoff, earliestPriceFixTime]
    });
    const shareVaultReceipt = await client.waitForTransactionReceipt({ hash: shareVaultTx });
    assert.equal(shareVaultReceipt.status, 'success');
    const shareVaultAddress = shareVaultReceipt.contractAddress;

    // Deploy BinaryAMM (30 bps fee)
    const binAmmTx = await adminWallet.deployContract({
      abi: binaryAmmArtifact.abi,
      bytecode: binaryAmmArtifact.bytecode.object,
      args: [binVaultAddress, adminAccount.address, 30n]
    });
    const binAmmReceipt = await client.waitForTransactionReceipt({ hash: binAmmTx });
    assert.equal(binAmmReceipt.status, 'success');
    const binAmmAddress = binAmmReceipt.contractAddress;

    // Read token addresses from vaults
    const yesTokenAddress = await client.readContract({
      address: binVaultAddress,
      abi: binaryVaultArtifact.abi,
      functionName: 'yesToken'
    });
    const noTokenAddress = await client.readContract({
      address: binVaultAddress,
      abi: binaryVaultArtifact.abi,
      functionName: 'noToken'
    });
    const yesShareAddress = await client.readContract({
      address: shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'yesShare'
    });
    const noShareAddress = await client.readContract({
      address: shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'noShare'
    });
    const residualShareAddress = await client.readContract({
      address: shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'residualShare'
    });

    // Deploy yesShareAMM & noShareAMM
    const yesAmmTx = await adminWallet.deployContract({
      abi: shareAmmArtifact.abi,
      bytecode: shareAmmArtifact.bytecode.object,
      args: [ARC_USDC, yesShareAddress, shareVaultAddress, 30n, 'ysLP']
    });
    const yesAmmReceipt = await client.waitForTransactionReceipt({ hash: yesAmmTx });
    assert.equal(yesAmmReceipt.status, 'success');
    const yesAmmAddress = yesAmmReceipt.contractAddress;

    const noAmmTx = await adminWallet.deployContract({
      abi: shareAmmArtifact.abi,
      bytecode: shareAmmArtifact.bytecode.object,
      args: [ARC_USDC, noShareAddress, shareVaultAddress, 30n, 'nsLP']
    });
    const noAmmReceipt = await client.waitForTransactionReceipt({ hash: noAmmTx });
    assert.equal(noAmmReceipt.status, 'success');
    const noAmmAddress = noAmmReceipt.contractAddress;

    // Verify all bytecodes exist
    for (const [name, addr] of Object.entries({ oracleAddress, binVaultAddress, shareVaultAddress, binAmmAddress, yesAmmAddress, noAmmAddress })) {
      const code = await client.getBytecode({ address: addr });
      assert.ok(code && code !== '0x', `${name} must have deployed bytecode`);
    }

    // Verify bindings
    const boundOracle = await client.readContract({ address: binVaultAddress, abi: binaryVaultArtifact.abi, functionName: 'oracle' });
    assert.equal(boundOracle.toLowerCase(), oracleAddress.toLowerCase());

    return {
      blockTime,
      eventDeadline,
      tradingCutoff,
      earliestPriceFixTime,
      cap6,
      oracleAddress,
      binVaultAddress,
      shareVaultAddress,
      binAmmAddress,
      yesAmmAddress,
      noAmmAddress,
      yesTokenAddress,
      noTokenAddress,
      yesShareAddress,
      noShareAddress,
      residualShareAddress
    };
  }

  // Helper to seed initial AMM liquidity
  async function seedLiquidity(market) {
    const farDeadline = BigInt(market.blockTime + 100000);

    // 1. Mint 200,000 USDC to admin
    await sendTx(adminWallet, 'mint USDC to admin', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'mint',
      args: [adminAccount.address, 200_000_000_000n]
    });

    // 2. Approve vaults
    await sendTx(adminWallet, 'approve binary vault', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'approve',
      args: [market.binVaultAddress, 100_000_000_000n]
    });
    await sendTx(adminWallet, 'approve share vault', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'approve',
      args: [market.shareVaultAddress, 100_000_000_000n]
    });

    // 3. Binary Split: 2,000 USDC -> 2,000 Yes/No
    await sendTx(adminWallet, 'binary split', {
      address: market.binVaultAddress,
      abi: binaryVaultArtifact.abi,
      functionName: 'split',
      args: [2_000_000_000n, adminAccount.address]
    });

    // 4. Approve binAMM for 1,000 YES and 1,000 NO
    await sendTx(adminWallet, 'approve YES for binAMM', {
      address: market.yesTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [market.binAmmAddress, 1000n * 10n ** 18n]
    });
    await sendTx(adminWallet, 'approve NO for binAMM', {
      address: market.noTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [market.binAmmAddress, 1000n * 10n ** 18n]
    });

    // 5. Seed BinaryAMM (1,000 YES, 1,000 NO)
    await sendTx(adminWallet, 'addLiquidity binaryAMM', {
      address: market.binAmmAddress,
      abi: binaryAmmArtifact.abi,
      functionName: 'addLiquidity',
      args: [1000n * 10n ** 18n, 1000n * 10n ** 18n, 100n * 10n ** 18n, farDeadline]
    });

    // 6. Share Split: 100 sets -> 100 yesShare, 100 noShare, 100 residualShare (50,000 USDC)
    await sendTx(adminWallet, 'share split', {
      address: market.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'split',
      args: [100n * 10n ** 18n, adminAccount.address]
    });

    // 7. Approve Share AMMs
    await sendTx(adminWallet, 'approve USDC for yesAMM', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'approve',
      args: [market.yesAmmAddress, 20_000_000_000n]
    });
    await sendTx(adminWallet, 'approve USDC for noAMM', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'approve',
      args: [market.noAmmAddress, 20_000_000_000n]
    });
    await sendTx(adminWallet, 'approve yesShare for yesAMM', {
      address: market.yesShareAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [market.yesAmmAddress, 100n * 10n ** 18n]
    });
    await sendTx(adminWallet, 'approve noShare for noAMM', {
      address: market.noShareAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [market.noAmmAddress, 100n * 10n ** 18n]
    });

    // 8. Seed yesShareAMM (11,655 USDC, 100 yesShare) and noShareAMM (4,366 USDC, 100 noShare)
    await sendTx(adminWallet, 'addLiquidity yesShareAMM', {
      address: market.yesAmmAddress,
      abi: shareAmmArtifact.abi,
      functionName: 'addLiquidity',
      args: [11_655_000_000n, 100n * 10n ** 18n, 100n * 10n ** 18n, farDeadline]
    });
    await sendTx(adminWallet, 'addLiquidity noShareAMM', {
      address: market.noAmmAddress,
      abi: shareAmmArtifact.abi,
      functionName: 'addLiquidity',
      args: [4_366_000_000n, 100n * 10n ** 18n, 100n * 10n ** 18n, farDeadline]
    });
  }

  // =========================================================================
  // SUBTEST 1: OPEN State: Read, Quote, Complete Set Split/Merge Math & Backing
  // =========================================================================
  await t.test('OPEN state: readArc, quoteArc, and complete-set split/merge economics', async () => {
    const market = await deployMarket({ cap6: 500_000_000n, eventDeadlineOffset: 1000, tradingCutoffOffset: 2000, earliestPriceFixOffset: 2000 });
    await seedLiquidity(market);

    const config = configuration({
      ARC_BINARY_AMM: market.binAmmAddress,
      ARC_YES_SHARE_AMM: market.yesAmmAddress,
      ARC_NO_SHARE_AMM: market.noAmmAddress,
      ARC_BINARY_VAULT: market.binVaultAddress,
      ARC_SHARE_VAULT: market.shareVaultAddress,
      ARC_ORACLE: market.oracleAddress
    });
    const rpc = makeRpc({ endpoint: rpcUrl });

    // 1. readArc in OPEN state
    const snapOpen = await readArc(config, { rpc });
    assert.equal(snapOpen.lifecycle, 'OPEN');
    assert.equal(snapOpen.status, 'open');
    assert.equal(snapOpen.stats.p, 0.5);
    assert.equal(snapOpen.stats.yesSharePrice, 116.55);
    assert.equal(snapOpen.stats.noSharePrice, 43.66);
    // Implied spot in OPEN = 116.55 + 43.66 = 160.21
    assert.ok(Math.abs(snapOpen.stats.impliedSpot - 160.21) < 1e-4);
    assert.equal(snapOpen.vaults.remainingLiabilities, '50000');

    // 2. quoteArc in OPEN state
    const quoteOpenAsset = await quoteArc(config, { book: 'asset', side: 'yes', amount: '25', slippageBps: 50 }, { rpc });
    assert.equal(quoteOpenAsset.book, 'asset');
    assert.equal(quoteOpenAsset.side, 'yes');
    assert.equal(quoteOpenAsset.amount, '25');
    assert.equal(quoteOpenAsset.fee, '0.075');
    assert.equal(quoteOpenAsset.quantity, '0.2134');
    assert.ok(BigInt(quoteOpenAsset.outUnits) > 0n);

    // 3. User 2 complete set split and merge math
    // Mint 5,000 USDC to User 2
    await sendTx(adminWallet, 'mint USDC to user2', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'mint',
      args: [userAccount.address, 5_000_000_000n]
    });

    // Approve share vault for 5,000 USDC
    await sendTx(userWallet, 'user2 approve shareVault', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'approve',
      args: [market.shareVaultAddress, 5_000_000_000n]
    });

    // Split 10 complete sets (10 * 500 = 5,000 USDC)
    await sendTx(userWallet, 'user2 split 10 share sets', {
      address: market.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'split',
      args: [10n * 10n ** 18n, userAccount.address]
    });

    // Verify User 2 received 10 yesShare, 10 noShare, 10 residualShare
    const userYesShare = await client.readContract({ address: market.yesShareAddress, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    const userNoShare = await client.readContract({ address: market.noShareAddress, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    const userResidual = await client.readContract({ address: market.residualShareAddress, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.equal(userYesShare, 10n * 10n ** 18n);
    assert.equal(userNoShare, 10n * 10n ** 18n);
    assert.equal(userResidual, 10n * 10n ** 18n);

    // Merge 2 complete sets: burns 2 yes, 2 no, 2 residual -> receives 1,000 USDC back
    await sendTx(userWallet, 'user2 merge 2 share sets', {
      address: market.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'merge',
      args: [2n * 10n ** 18n, userAccount.address]
    });

    const userUsdcAfterMerge = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.equal(userUsdcAfterMerge, 1_000_000_000n); // exactly 1,000 USDC returned

    const userYesAfter = await client.readContract({ address: market.yesShareAddress, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.equal(userYesAfter, 8n * 10n ** 18n); // 8 sets remaining

    // Collateral conservation: ShareVault collateral balance = (100 initial + 8 user) * 500 = 54,000 USDC
    const vaultCollateral = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [market.shareVaultAddress] });
    assert.equal(vaultCollateral, 54_000_000_000n);
  });

  // =========================================================================
  // SUBTEST 2: Actual Wallet Purchases (buyOutcome, buyShares) on Local EVM
  // =========================================================================
  await t.test('Actual wallet purchases: buyOutcome on BinaryAMM and buyShares on ShareAMM', async () => {
    const market = await deployMarket();
    await seedLiquidity(market);

    const farDeadline = BigInt(market.blockTime + 100000);

    // Mint 100 USDC to User 2
    await sendTx(adminWallet, 'mint USDC to user2', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'mint',
      args: [userAccount.address, 100_000_000n]
    });

    // 1. User 2 buys Binary YES tokens
    await sendTx(userWallet, 'user2 approve binaryAMM', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'approve',
      args: [market.binAmmAddress, 10_000_000n]
    });

    const buyBinaryReceipt = await sendTx(userWallet, 'user2 buyOutcome YES', {
      address: market.binAmmAddress,
      abi: binaryAmmArtifact.abi,
      functionName: 'buyOutcome',
      args: [true, 10_000_000n, 1n, farDeadline]
    });
    assert.equal(buyBinaryReceipt.status, 'success');

    const userYesTokens = await client.readContract({
      address: market.yesTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [userAccount.address]
    });
    assert.ok(userYesTokens > 0n, 'User2 must receive binary YES tokens');

    // 2. User 2 buys Conditional YES shares on ShareAMM
    await sendTx(userWallet, 'user2 approve yesShareAMM', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'approve',
      args: [market.yesAmmAddress, 25_000_000n]
    });

    const buyShareReceipt = await sendTx(userWallet, 'user2 buyShares YES', {
      address: market.yesAmmAddress,
      abi: shareAmmArtifact.abi,
      functionName: 'buyShares',
      args: [25_000_000n, 1n, farDeadline]
    });
    assert.equal(buyShareReceipt.status, 'success');

    const userYesShares = await client.readContract({
      address: market.yesShareAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [userAccount.address]
    });
    assert.ok(userYesShares > 0n, 'User2 must receive conditional YES shares');

    // Accrued fees should be tracked on BinaryAMM and reserves increased on ShareAMM
    const binFees = await client.readContract({ address: market.binAmmAddress, abi: binaryAmmArtifact.abi, functionName: 'accruedFees6' });
    assert.ok(binFees > 0n, 'BinaryAMM must accrue fees');
    const shareReserves = await client.readContract({ address: market.yesAmmAddress, abi: shareAmmArtifact.abi, functionName: 'reserves' });
    assert.ok(shareReserves[0] > 11_655_000_000n, 'ShareAMM stable reserves must increase with purchase + fee');
  });

  // =========================================================================
  // SUBTEST 3: YES Lifecycle — Resolution, Freeze, Binary Claim, Above-Cap Fix, Payouts
  // =========================================================================
  await t.test('YES Lifecycle: surviving-leg trading, binary claim, above-cap fix (S=600), and final payouts', async () => {
    const market = await deployMarket({ cap6: 500_000_000n, eventDeadlineOffset: 1000, tradingCutoffOffset: 2000, earliestPriceFixOffset: 2000 });
    await seedLiquidity(market);

    const farDeadline = BigInt(market.blockTime + 100000);
    const config = configuration({
      ARC_BINARY_AMM: market.binAmmAddress,
      ARC_YES_SHARE_AMM: market.yesAmmAddress,
      ARC_NO_SHARE_AMM: market.noAmmAddress,
      ARC_BINARY_VAULT: market.binVaultAddress,
      ARC_SHARE_VAULT: market.shareVaultAddress,
      ARC_ORACLE: market.oracleAddress
    });
    const rpc = makeRpc({ endpoint: rpcUrl });

    // User 2 prepares positions:
    // Mint USDC, split 2 complete sets, buy 10 USDC of binary YES, buy 25 USDC of yesShare
    await sendTx(adminWallet, 'mint USDC to user2', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'mint', args: [userAccount.address, 2_000_000_000n] });
    await sendTx(userWallet, 'approve shareVault', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.shareVaultAddress, 1_000_000_000n] });
    await sendTx(userWallet, 'split 2 sets', { address: market.shareVaultAddress, abi: shareVaultArtifact.abi, functionName: 'split', args: [2n * 10n ** 18n, userAccount.address] });
    await sendTx(userWallet, 'approve binaryAMM', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.binAmmAddress, 10_000_000n] });
    await sendTx(userWallet, 'buy binary YES', { address: market.binAmmAddress, abi: binaryAmmArtifact.abi, functionName: 'buyOutcome', args: [true, 10_000_000n, 1n, farDeadline] });

    await sendTx(userWallet, 'approve yesShareAMM', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.yesAmmAddress, 25_000_000n] });
    await sendTx(userWallet, 'buy yesShare', { address: market.yesAmmAddress, abi: shareAmmArtifact.abi, functionName: 'buyShares', args: [25_000_000n, 1n, farDeadline] });

    // Early NO resolution attempt before eventDeadline must revert
    await assert.rejects(
      () => adminWallet.writeContract({
        address: market.oracleAddress,
        abi: oracleArtifact.abi,
        functionName: 'resolveEvent',
        args: [market.binVaultAddress, market.shareVaultAddress, false]
      }),
      /EventDeadlineNotPassed|0xbe0d6bfd/
    );

    // Resolve event to YES
    await sendTx(adminWallet, 'resolveEvent YES', {
      address: market.oracleAddress,
      abi: oracleArtifact.abi,
      functionName: 'resolveEvent',
      args: [market.binVaultAddress, market.shareVaultAddress, true]
    });

    const snapResolved = await readArc(config, { rpc });
    assert.equal(snapResolved.lifecycle, 'EVENT_RESOLVED');
    assert.equal(snapResolved.resolvedOutcome, 'YES');
    assert.equal(snapResolved.stats.p, 1.0);
    assert.equal(snapResolved.stats.impliedSpot, snapResolved.stats.yesSharePrice);
    assert.ok(snapResolved.stats.impliedSpot > 116.55, 'Implied spot reflects price impact of User 2 purchase');

    // Surviving leg trade succeeds
    await sendTx(userWallet, 'approve yesShareAMM for surviving trade', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.yesAmmAddress, 10_000_000n] });
    const survivingTrade = await sendTx(userWallet, 'buy surviving yesShare', {
      address: market.yesAmmAddress,
      abi: shareAmmArtifact.abi,
      functionName: 'buyShares',
      args: [10_000_000n, 1n, farDeadline]
    });
    assert.equal(survivingTrade.status, 'success');

    // Binary and losing leg trading must revert
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.binAmmAddress,
        abi: binaryAmmArtifact.abi,
        functionName: 'buyOutcome',
        args: [true, 5_000_000n, 1n, farDeadline]
      }),
      /TradingFrozen/
    );
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.noAmmAddress,
        abi: shareAmmArtifact.abi,
        functionName: 'buyShares',
        args: [5_000_000n, 1n, farDeadline]
      }),
      /TradingFrozen/
    );

    // BINARY-FIRST CLAIM before price fixing
    const userYesTokenBal = await client.readContract({ address: market.yesTokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.ok(userYesTokenBal > 0n);
    const usdcBeforeBinClaim = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });

    await sendTx(userWallet, 'redeem winning binary YES tokens', {
      address: market.binVaultAddress,
      abi: binaryVaultArtifact.abi,
      functionName: 'redeem',
      args: [market.yesTokenAddress, userYesTokenBal, userAccount.address]
    });

    const usdcAfterBinClaim = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    const expectedBinPayout = userYesTokenBal / 10n ** 12n; // 1 token = 1 USDC6
    assert.equal(usdcAfterBinClaim - usdcBeforeBinClaim, expectedBinPayout);

    // Asset and residual positions remain intact after binary claim!
    const userYesSharesAfterBin = await client.readContract({ address: market.yesShareAddress, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    const userResidualAfterBin = await client.readContract({ address: market.residualShareAddress, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.ok(userYesSharesAfterBin > 0n);
    assert.equal(userResidualAfterBin, 2n * 10n ** 18n);

    // Advance EVM timestamp past earliestPriceFixTime
    await client.request({
      method: 'evm_setNextBlockTimestamp',
      params: [Number(market.earliestPriceFixTime) + 10]
    });
    await client.request({ method: 'evm_mine', params: [] });

    // Fix price above cap: S = 600 USDC (600_000_000n), Cap = 500 USDC
    await sendTx(adminWallet, 'fixPrice S=600', {
      address: market.oracleAddress,
      abi: oracleArtifact.abi,
      functionName: 'fixPrice',
      args: [market.shareVaultAddress, 600_000_000n]
    });

    const snapSettled = await readArc(config, { rpc });
    assert.equal(snapSettled.lifecycle, 'PRICE_FIXED');
    assert.equal(snapSettled.status, 'settled');
    assert.equal(snapSettled.settlement.spot, '600');
    assert.equal(snapSettled.settlement.payout, '500'); // capped at 500
    assert.equal(snapSettled.settlement.residual, '0'); // 500 - 500 = 0
    assert.equal(snapSettled.settlement.capped, true);

    // Claim winning yesShare tokens on ShareVault
    const usdcBeforeAssetClaim = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    await sendTx(userWallet, 'redeem winning yesShare', {
      address: market.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'redeem',
      args: [market.yesShareAddress, userYesSharesAfterBin, userAccount.address]
    });
    const usdcAfterAssetClaim = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    // Payout = shares * 500 / 1e18
    const expectedAssetPayout = (userYesSharesAfterBin * 500_000_000n) / (10n ** 18n);
    assert.equal(usdcAfterAssetClaim - usdcBeforeAssetClaim, expectedAssetPayout);

    // Claim residual shares when S >= Cap (residual = 0)
    await sendTx(userWallet, 'redeem residualShare with S >= Cap', {
      address: market.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'redeem',
      args: [market.residualShareAddress, userResidualAfterBin, userAccount.address]
    });
    const usdcAfterResidual = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.equal(usdcAfterResidual, usdcAfterAssetClaim); // 0 USDC added

    // Zero amount claim attempt reverts with InvalidAmount
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.shareVaultAddress,
        abi: shareVaultArtifact.abi,
        functionName: 'redeem',
        args: [market.yesShareAddress, 0n, userAccount.address]
      }),
      /InvalidAmount/
    );

    // Duplicate claim attempt with zero remaining balance reverts with InsufficientBalance
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.shareVaultAddress,
        abi: shareVaultArtifact.abi,
        functionName: 'redeem',
        args: [market.yesShareAddress, 1n, userAccount.address]
      }),
      /InsufficientBalance|0xf4d678b8/
    );
  });

  // =========================================================================
  // SUBTEST 4: NO Lifecycle — Below-Cap Price (S=150), Residual Payouts & Empty-Liquidity Reads
  // =========================================================================
  await t.test('NO Lifecycle: below-cap fix (S=150), residual payouts (R=350), and empty-liquidity reads', async () => {
    const market = await deployMarket({ cap6: 500_000_000n, eventDeadlineOffset: 100, tradingCutoffOffset: 200, earliestPriceFixOffset: 200 });
    await seedLiquidity(market);

    const config = configuration({
      ARC_BINARY_AMM: market.binAmmAddress,
      ARC_YES_SHARE_AMM: market.yesAmmAddress,
      ARC_NO_SHARE_AMM: market.noAmmAddress,
      ARC_BINARY_VAULT: market.binVaultAddress,
      ARC_SHARE_VAULT: market.shareVaultAddress,
      ARC_ORACLE: market.oracleAddress
    });
    const rpc = makeRpc({ endpoint: rpcUrl });

    // User 2 splits 2 complete sets (1,000 USDC)
    await sendTx(adminWallet, 'mint USDC to user2', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'mint', args: [userAccount.address, 1_000_000_000n] });
    await sendTx(userWallet, 'approve shareVault', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.shareVaultAddress, 1_000_000_000n] });
    await sendTx(userWallet, 'split 2 sets', { address: market.shareVaultAddress, abi: shareVaultArtifact.abi, functionName: 'split', args: [2n * 10n ** 18n, userAccount.address] });

    // Advance EVM timestamp past eventDeadline
    await client.request({
      method: 'evm_setNextBlockTimestamp',
      params: [Number(market.eventDeadline) + 10]
    });
    await client.request({ method: 'evm_mine', params: [] });

    // Oracle resolves event to NO
    await sendTx(adminWallet, 'resolveEvent NO', {
      address: market.oracleAddress,
      abi: oracleArtifact.abi,
      functionName: 'resolveEvent',
      args: [market.binVaultAddress, market.shareVaultAddress, false]
    });

    const snapResolved = await readArc(config, { rpc });
    assert.equal(snapResolved.lifecycle, 'EVENT_RESOLVED');
    assert.equal(snapResolved.resolvedOutcome, 'NO');
    assert.equal(snapResolved.stats.p, 0.0);

    // Advance past earliestPriceFixTime
    await client.request({
      method: 'evm_setNextBlockTimestamp',
      params: [Number(market.earliestPriceFixTime) + 10]
    });
    await client.request({ method: 'evm_mine', params: [] });

    // Fix price at S = 150 USDC (below cap 500 USDC)
    await sendTx(adminWallet, 'fixPrice S=150', {
      address: market.oracleAddress,
      abi: oracleArtifact.abi,
      functionName: 'fixPrice',
      args: [market.shareVaultAddress, 150_000_000n]
    });

    const snapSettled = await readArc(config, { rpc });
    assert.equal(snapSettled.lifecycle, 'PRICE_FIXED');
    assert.equal(snapSettled.status, 'settled');
    assert.equal(snapSettled.settlement.spot, '150');
    assert.equal(snapSettled.settlement.payout, '150'); // X = 150
    assert.equal(snapSettled.settlement.residual, '350'); // R = 500 - 150 = 350 USDC per unit
    assert.equal(snapSettled.settlement.capped, false);

    // User 2 claims winning noShare: 2 shares * 150 = 300 USDC
    const usdcBeforeClaims = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    await sendTx(userWallet, 'redeem winning noShare', {
      address: market.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'redeem',
      args: [market.noShareAddress, 2n * 10n ** 18n, userAccount.address]
    });
    const usdcAfterNoClaim = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.equal(usdcAfterNoClaim - usdcBeforeClaims, 300_000_000n); // 300 USDC

    // User 2 claims residual shares: 2 shares * 350 = 700 USDC
    await sendTx(userWallet, 'redeem residualShare (R=350)', {
      address: market.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'redeem',
      args: [market.residualShareAddress, 2n * 10n ** 18n, userAccount.address]
    });
    const usdcAfterResClaim = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.equal(usdcAfterResClaim - usdcAfterNoClaim, 700_000_000n); // 700 USDC

    // Total received = 300 + 700 = 1,000 USDC (exact conservation of complete sets!)
    assert.equal(usdcAfterResClaim - usdcBeforeClaims, 1_000_000_000n);

    // Losing yesShare reverts with WrongToken (losing leg pays 0 and cannot be redeemed)
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.shareVaultAddress,
        abi: shareVaultArtifact.abi,
        functionName: 'redeem',
        args: [market.yesShareAddress, 2n * 10n ** 18n, userAccount.address]
      }),
      /WrongToken/
    );
    const usdcAfterLosingClaim = await client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] });
    assert.equal(usdcAfterLosingClaim, usdcAfterResClaim); // USDC balance unchanged

    // Actually remove all LP liquidity to test settled read with empty pools
    const farDeadline = BigInt(market.blockTime + 100000);
    const binLpToken = await client.readContract({ address: market.binAmmAddress, abi: binaryAmmArtifact.abi, functionName: 'lpToken' });
    const binLpBalance = await client.readContract({ address: binLpToken, abi: erc20Abi, functionName: 'balanceOf', args: [adminAccount.address] });
    await sendTx(adminWallet, 'remove all BinaryAMM liquidity', {
      address: market.binAmmAddress,
      abi: binaryAmmArtifact.abi,
      functionName: 'removeLiquidity',
      args: [binLpBalance, 1n, 1n, farDeadline]
    });

    const yesLpToken = await client.readContract({ address: market.yesAmmAddress, abi: shareAmmArtifact.abi, functionName: 'lpToken' });
    const yesLpBalance = await client.readContract({ address: yesLpToken, abi: erc20Abi, functionName: 'balanceOf', args: [adminAccount.address] });
    await sendTx(adminWallet, 'remove all YesShareAMM liquidity', {
      address: market.yesAmmAddress,
      abi: shareAmmArtifact.abi,
      functionName: 'removeLiquidity',
      args: [yesLpBalance, 1n, 1n, farDeadline]
    });

    const noLpToken = await client.readContract({ address: market.noAmmAddress, abi: shareAmmArtifact.abi, functionName: 'lpToken' });
    const noLpBalance = await client.readContract({ address: noLpToken, abi: erc20Abi, functionName: 'balanceOf', args: [adminAccount.address] });
    await sendTx(adminWallet, 'remove all NoShareAMM liquidity', {
      address: market.noAmmAddress,
      abi: shareAmmArtifact.abi,
      functionName: 'removeLiquidity',
      args: [noLpBalance, 1n, 1n, farDeadline]
    });

    // Assert that reserves are now strictly 0
    const binRes = await client.readContract({ address: market.binAmmAddress, abi: binaryAmmArtifact.abi, functionName: 'reserves' });
    const yesRes = await client.readContract({ address: market.yesAmmAddress, abi: shareAmmArtifact.abi, functionName: 'reserves' });
    const noRes = await client.readContract({ address: market.noAmmAddress, abi: shareAmmArtifact.abi, functionName: 'reserves' });
    assert.equal(binRes[0], 0n, 'BinaryAMM YES reserve must be 0 after liquidity removal');
    assert.equal(binRes[1], 0n, 'BinaryAMM NO reserve must be 0 after liquidity removal');
    assert.equal(yesRes[0], 0n, 'YesShareAMM stable reserve must be 0 after liquidity removal');
    assert.equal(yesRes[1], 0n, 'YesShareAMM share reserve must be 0 after liquidity removal');
    assert.equal(noRes[0], 0n, 'NoShareAMM stable reserve must be 0 after liquidity removal');
    assert.equal(noRes[1], 0n, 'NoShareAMM share reserve must be 0 after liquidity removal');

    // Settled read with zero/empty AMM liquidity succeeds
    const snapEmpty = await readArc(config, { rpc });
    assert.equal(snapEmpty.lifecycle, 'PRICE_FIXED');
    assert.equal(snapEmpty.status, 'settled');
    assert.equal(snapEmpty.settlement.spot, '150');
    assert.equal(snapEmpty.settlement.payout, '150');
    assert.equal(snapEmpty.settlement.residual, '350');
  });

  // =========================================================================
  // SUBTEST 5: Trading Cutoff Independently Enforced when Oracle is Late
  // =========================================================================
  await t.test('Trading cutoff stops trading even if oracle is late', async () => {
    const market = await deployMarket({ cap6: 500_000_000n, eventDeadlineOffset: 100, tradingCutoffOffset: 200, earliestPriceFixOffset: 500 });
    await seedLiquidity(market);

    const farDeadline = BigInt(market.blockTime + 100000);

    // Advance EVM timestamp past tradingCutoff (200s offset) without resolving or fixing price
    await client.request({
      method: 'evm_setNextBlockTimestamp',
      params: [Number(market.tradingCutoff) + 10]
    });
    await client.request({ method: 'evm_mine', params: [] });

    // Check on-chain trading allowed flag
    const allowed = await client.readContract({
      address: market.binVaultAddress,
      abi: binaryVaultArtifact.abi,
      functionName: 'isTradingAllowed'
    });
    assert.equal(allowed, false, 'Trading must be disallowed past cutoff');

    // Mint USDC to user2 and attempt purchases
    await sendTx(adminWallet, 'mint USDC to user2', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'mint', args: [userAccount.address, 50_000_000n] });
    await sendTx(userWallet, 'approve binaryAMM', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.binAmmAddress, 10_000_000n] });

    // Binary purchase past cutoff reverts
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.binAmmAddress,
        abi: binaryAmmArtifact.abi,
        functionName: 'buyOutcome',
        args: [true, 10_000_000n, 1n, farDeadline]
      }),
      /TradingFrozen/
    );

    // Share purchase past cutoff reverts
    await sendTx(userWallet, 'approve yesShareAMM', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.yesAmmAddress, 10_000_000n] });
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.yesAmmAddress,
        abi: shareAmmArtifact.abi,
        functionName: 'buyShares',
        args: [10_000_000n, 1n, farDeadline]
      }),
      /TradingFrozen/
    );
  });

  // =========================================================================
  // SUBTEST 6: Deployment Script Verification & Safe Resume (deploy-demo.mjs)
  // =========================================================================
  await t.test('Deployment script: runDeploy executes, seeds fractional profile, safely resumes, and is idempotent', async () => {
    const testManifestPath = path.join(os.tmpdir(), `thelema-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const deployedManifest = await runDeploy({
      rpcUrl,
      isLocal: true,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      manifestPath: testManifestPath
    });

    assert.equal(deployedManifest.status, 'ACTIVE_DEMO');
    assert.ok(deployedManifest.contracts.oracle);
    assert.ok(deployedManifest.contracts.binaryVault);
    assert.ok(deployedManifest.contracts.shareVault);
    assert.ok(deployedManifest.contracts.binaryAmm);
    assert.ok(deployedManifest.contracts.yesShareAmm);
    assert.ok(deployedManifest.contracts.noShareAmm);

    const config = configuration({
      ARC_BINARY_AMM: deployedManifest.contracts.binaryAmm,
      ARC_YES_SHARE_AMM: deployedManifest.contracts.yesShareAmm,
      ARC_NO_SHARE_AMM: deployedManifest.contracts.noShareAmm,
      ARC_BINARY_VAULT: deployedManifest.contracts.binaryVault,
      ARC_SHARE_VAULT: deployedManifest.contracts.shareVault,
      ARC_ORACLE: deployedManifest.contracts.oracle
    });
    const rpc = makeRpc({ endpoint: rpcUrl });
    const snap = await readArc(config, { rpc });
    assert.equal(snap.lifecycle, 'OPEN');
    assert.equal(snap.status, 'open');
    assert.equal(snap.stats.p, 0.5);
    assert.equal(snap.stats.yesSharePrice, 116.55);
    assert.equal(snap.stats.noSharePrice, 43.66);

    // Second run: safe resume / idempotency check
    const secondRun = await runDeploy({
      rpcUrl,
      isLocal: true,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      manifestPath: testManifestPath
    });
    assert.equal(secondRun.status, 'ACTIVE_DEMO');
    assert.equal(secondRun.contracts.oracle, deployedManifest.contracts.oracle);
    assert.equal(secondRun.contracts.shareVault, deployedManifest.contracts.shareVault);

    // Check reserves did not double on resume
    const snap2 = await readArc(config, { rpc });
    assert.equal(snap2.stats.p, 0.5);
    assert.equal(snap2.stats.yesSharePrice, 116.55);
  });

  // =========================================================================
  // SUBTEST 6b: Real Funding Preflight Validation (deploy-demo.mjs)
  // =========================================================================
  await t.test('Deployment preflight: underfunded account throws before any broadcast and account nonce remains 0', async () => {
    // 1. Fresh unfunded deployer
    const unfundedKey = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const unfundedAccount = privateKeyToAccount(unfundedKey);
    const initialNonce = await client.getTransactionCount({ address: unfundedAccount.address });
    assert.equal(initialNonce, 0);

    const testManifestPath = path.join(os.tmpdir(), `unfunded-manifest-${Date.now()}.json`);
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: unfundedKey,
        autoFund: false,
        manifestPath: testManifestPath
      }),
      /Insufficient single native USDC balance/
    );

    const postNonce = await client.getTransactionCount({ address: unfundedAccount.address });
    assert.equal(postNonce, 0, 'Zero deployment or seeding transactions must be broadcast on underfunded run');

    // 2. Shared-USDC test: wallet with enough for collateral (86.021 USDC) or gas (~0.03 USDC) individually,
    // but NOT both together.
    const partialKey = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const partialAccount = privateKeyToAccount(partialKey);

    // Set native balance to exactly 86.021 USDC in 18 decimals
    const native86_021 = 86_021_000n * 10n**12n;
    await client.request({
      method: 'anvil_setBalance',
      params: [partialAccount.address, '0x' + native86_021.toString(16)]
    });

    // Mint 86.021 USDC in precompile
    await adminWallet.writeContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: 'mint',
      args: [partialAccount.address, 86_021_000n]
    });

    const partialPreNonce = await client.getTransactionCount({ address: partialAccount.address });
    assert.equal(partialPreNonce, 0);

    // This MUST reject because the single native balance cannot cover both 86.021 collateral and the gas budget
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: partialKey,
        autoFund: false,
        manifestPath: path.join(os.tmpdir(), `partial-manifest-${Date.now()}.json`)
      }),
      /Insufficient single native USDC balance/
    );

    const partialPostNonce = await client.getTransactionCount({ address: partialAccount.address });
    assert.equal(partialPostNonce, 0, 'Zero transactions must be broadcast when single native balance cannot cover both');
  });

  // =========================================================================
  // SUBTEST 6c: Crash-Safe Recovery & Failure Injection (deploy-demo.mjs)
  // =========================================================================
  await t.test('Crash-safe recovery: reconciles submitted and mined transactions without duplicate broadcasts, rejects corrupted manifest', async () => {
    const crashManifestPath = path.join(os.tmpdir(), `crash-manifest-${Date.now()}.json`);

    // Injection 1: Crash immediately AFTER_BROADCAST on oracle deployment
    let broadcastHash = null;
    let failureTriggered = false;
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: crashManifestPath,
        testFailureHook: (stage, stepKey, hash) => {
          if (stage === 'AFTER_BROADCAST' && stepKey === 'oracle') {
            broadcastHash = hash;
            failureTriggered = true;
            throw new Error('SIMULATED_CRASH_AFTER_BROADCAST');
          }
        }
      }),
      /SIMULATED_CRASH_AFTER_BROADCAST/
    );
    assert.ok(failureTriggered, 'Failure hook after broadcast must have fired');
    assert.ok(broadcastHash, 'Transaction must have been submitted before crash');

    // Verify manifest and journal recorded SUBMITTED state atomically
    const rawManifest1 = JSON.parse(await readFile(crashManifestPath, 'utf8'));
    const oracleJournalEntry = rawManifest1.journal.find(j => j.step === 'oracle');
    assert.ok(oracleJournalEntry);
    assert.equal(oracleJournalEntry.status, 'SUBMITTED');
    assert.equal(oracleJournalEntry.hash, broadcastHash);

    // Resume deployment with AFTER_MINING crash on binaryVault
    let miningTriggered = false;
    let binaryVaultHash = null;
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: crashManifestPath,
        testFailureHook: (stage, stepKey, hash) => {
          if (stage === 'AFTER_MINING' && stepKey === 'binaryVault') {
            binaryVaultHash = hash;
            miningTriggered = true;
            throw new Error('SIMULATED_CRASH_AFTER_MINING');
          }
        }
      }),
      /SIMULATED_CRASH_AFTER_MINING/
    );
    assert.ok(miningTriggered, 'Failure hook after mining must have fired');
    assert.ok(binaryVaultHash, 'binaryVault must have been mined before crash');

    // Verify oracle was reconciled to COMPLETED and NOT rebroadcast
    const rawManifest2 = JSON.parse(await readFile(crashManifestPath, 'utf8'));
    assert.equal(rawManifest2.steps.oracle.status, 'COMPLETED');
    assert.equal(rawManifest2.steps.oracle.txHash, broadcastHash);

    // Final run: complete deployment without errors
    const completed = await runDeploy({
      rpcUrl,
      isLocal: true,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      manifestPath: crashManifestPath
    });
    assert.equal(completed.status, 'ACTIVE_DEMO');
    assert.equal(completed.steps.oracle.txHash, broadcastHash, 'Oracle transaction hash preserved across crash recoveries');
    assert.equal(completed.steps.binaryVault.txHash, binaryVaultHash, 'BinaryVault transaction hash preserved across crash recoveries');

    // Verify actual supplies, reserves, and balances after recovery
    const binAmmRes = await client.readContract({ address: completed.contracts.binaryAmm, abi: binaryAmmArtifact.abi, functionName: 'reserves' });
    assert.equal(binAmmRes[0], 10n * 10n**18n, 'BinaryAMM YES reserve must be exactly 10 tokens');
    assert.equal(binAmmRes[1], 10n * 10n**18n, 'BinaryAMM NO reserve must be exactly 10 tokens');

    const yesAmmRes = await client.readContract({ address: completed.contracts.yesShareAmm, abi: shareAmmArtifact.abi, functionName: 'reserves' });
    assert.equal(yesAmmRes[0], 11_655_000n, 'YesShareAMM USDC reserve must be 11.655 USDC');
    assert.equal(yesAmmRes[1], 100_000_000_000_000_000n, 'YesShareAMM yesShare reserve must be 0.1 share');

    const noAmmRes = await client.readContract({ address: completed.contracts.noShareAmm, abi: shareAmmArtifact.abi, functionName: 'reserves' });
    assert.equal(noAmmRes[0], 4_366_000n, 'NoShareAMM USDC reserve must be 4.366 USDC');
    assert.equal(noAmmRes[1], 100_000_000_000_000_000n, 'NoShareAMM noShare reserve must be 0.1 share');

    const deployerResidual = await client.readContract({
      address: completed.contracts.residualShare,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [adminAccount.address]
    });
    assert.equal(deployerResidual, 100_000_000_000_000_000n, 'Deployer must retain 0.1 residual share');

    const binVaultBalance = await client.readContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [completed.contracts.binaryVault]
    });
    assert.equal(binVaultBalance, 20_000_000n, 'BinaryVault must hold 20 USDC collateral');

    const shareVaultBalance = await client.readContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [completed.contracts.shareVault]
    });
    assert.equal(shareVaultBalance, 50_000_000n, 'ShareVault must hold 50 USDC collateral');

    // 4. Incomplete MINED entry test: journal has step in MINED status; must promote to COMPLETED without rebroadcast
    const minedManifestPath = path.join(os.tmpdir(), `mined-manifest-${Date.now()}.json`);
    const minedManifestData = {
      status: 'IN_PROGRESS',
      network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
      contracts: {},
      timing: {},
      steps: {},
      journal: [
        {
          step: 'oracle',
          description: 'Deploy DemoOracle',
          status: 'MINED',
          hash: completed.steps.oracle.txHash,
          nonce: 0,
          receipt: completed.steps.oracle.receipt
        }
      ],
      owner: adminAccount.address
    };
    await writeFile(minedManifestPath, JSON.stringify(minedManifestData));
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: minedManifestPath,
        testFailureHook: (_stage, step) => {
          if (step === 'binaryVault') throw new Error('HALT_AFTER_MINED_RECONCILE');
        }
      }),
      /HALT_AFTER_MINED_RECONCILE/
    );
    const reloadedMined = JSON.parse(await readFile(minedManifestPath, 'utf8'));
    assert.equal(reloadedMined.steps.oracle.status, 'COMPLETED', 'MINED entry must be reconciled to COMPLETED');
    assert.equal(reloadedMined.steps.oracle.txHash, completed.steps.oracle.txHash);

    // 5. INTENT with uncertain broadcast test: journal has INTENT with nonce 0, but account nonce has advanced
    const intentManifestPath = path.join(os.tmpdir(), `intent-manifest-${Date.now()}.json`);
    const intentManifestData = {
      status: 'IN_PROGRESS',
      network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
      contracts: {},
      timing: {},
      steps: {},
      journal: [
        {
          step: 'oracle',
          description: 'Deploy DemoOracle',
          status: 'INTENT',
          nonce: 0,
          startedAt: new Date().toISOString()
        }
      ],
      owner: adminAccount.address
    };
    await writeFile(intentManifestPath, JSON.stringify(intentManifestData));
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: intentManifestPath
      }),
      /Uncertain broadcast outcome for step "oracle"/
    );

    // 6. Corrupted manifest check: tampering with contract address causes rejection on reuse
    const tamperedManifestPath = path.join(os.tmpdir(), `tampered-manifest-${Date.now()}.json`);
    const validManifestContent = JSON.parse(await readFile(crashManifestPath, 'utf8'));
    validManifestContent.contracts.oracle = '0x1111111111111111111111111111111111111111'; // invalid address without code
    await writeFile(tamperedManifestPath, JSON.stringify(validManifestContent));

    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: tamperedManifestPath
      }),
      /Recorded DemoOracle 0x1111111111111111111111111111111111111111 has no on-chain bytecode/
    );
  });

  // =========================================================================
  // SUBTEST 6d: Network, Approval, and Secret Boundaries
  // =========================================================================
  await t.test('Safety & boundary enforcement: rejects misclassified local, enforces dry-run read-only, redacts RPC secrets, executes CLI', async () => {
    // 1. isLocal=true with remote endpoint rejected
    await assert.rejects(
      () => runDeploy({
        rpcUrl: 'https://rpc.testnet.arc.io',
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      }),
      /Safety violation: isLocal=true specified but RPC endpoint is not a loopback address/
    );

    // 2. Running against loopback WITHOUT isLocal: true rejects Anvil dev key fallback
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: false,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      }),
      /SAFETY VIOLATION: Anvil development key cannot be used outside explicit local development/
    );

    // 3. dryRun across any target produces unsigned plan and broadcasts 0 transactions
    const testManifestPath = path.join(os.tmpdir(), `dryrun-manifest-${Date.now()}.json`);
    const testPlanPath = path.join(os.tmpdir(), `dryrun-plan-${Date.now()}.json`);
    const plan = await runDeploy({
      rpcUrl,
      isLocal: true,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      dryRun: true,
      manifestPath: testManifestPath,
      planPath: testPlanPath
    });
    assert.equal(plan.status, 'PENDING_APPROVAL');
    assert.ok(plan.budgetRequirements);
    assert.equal(existsSync(testManifestPath), false, 'Dry run must not create active manifest');
    assert.equal(existsSync(testPlanPath), true, 'Dry run must write unsigned launch plan');

    // 4. Subprocess CLI invocation test on current OS (Windows/Linux)
    const { stdout: cliStdout } = await execFileAsync(process.execPath, [
      path.resolve('scripts/deploy-demo.mjs'),
      '--dry-run'
    ]);
    assert.match(cliStdout, /Unsigned launch plan written to/, 'CLI subprocess must execute and write launch plan');

    // 5. RPC URL credential and path secret redaction (origin only)
    const redacted = redactRpcUrl('https://myuser:mypassword@rpc.testnet.arc.io/v1/projects/secret_token_123?apiKey=secret_key_123');
    assert.equal(redacted, 'https://rpc.testnet.arc.io');

    // 6. Error message credential and URL redaction (origin only)
    const sanitizedError = sanitizeErrorMessage('Connection failed: https://admin:supersecret@myrpc.net/v1/secret_token?key=sensitive_token');
    assert.equal(sanitizedError, 'Connection failed: https://myrpc.net');
  });

  // =========================================================================
  // SUBTEST 6e: Verified Local Node Identity & Loopback Proxy Rejection
  // =========================================================================
  await t.test('Local node identity verification: passes on genuine Anvil, fails closed on unverified nodes and proxies', async () => {
    // 1. Genuine Anvil client verification passes
    const isVerified = await verifyLocalNodeIdentity(client);
    assert.equal(isVerified, true, 'verifyLocalNodeIdentity must succeed on genuine Anvil');

    // 2. Mock client returning non-anvil clientVersion fails closed
    const fakeGethClient = {
      request: async ({ method }) => {
        if (method === 'web3_clientVersion') return 'Geth/v1.13.14-omnibus/linux-amd64/go1.21.8';
        if (method === 'anvil_nodeInfo') return {};
        throw new Error('Unsupported method');
      }
    };
    await assert.rejects(
      () => verifyLocalNodeIdentity(fakeGethClient),
      /Expected Anvil node. Refusing write operations on unverified or non-Anvil node/
    );

    // 3. Mock client failing on anvil_nodeInfo capability check fails closed
    const loopbackProxyClient = {
      request: async ({ method }) => {
        if (method === 'web3_clientVersion') return 'anvil/v0.2.0 (proxy)';
        if (method === 'anvil_nodeInfo') throw new Error('Method not found: anvil_nodeInfo');
        throw new Error('Unsupported method');
      }
    };
    await assert.rejects(
      () => verifyLocalNodeIdentity(loopbackProxyClient),
      /anvil_nodeInfo capability check failed/
    );

    // 4. Mock client failing on web3_clientVersion fails closed
    const errorClient = {
      request: async () => {
        throw new Error('Connection refused');
      }
    };
    await assert.rejects(
      () => verifyLocalNodeIdentity(errorClient),
      /Failed to query web3_clientVersion from local node/
    );
  });

  // =========================================================================
  // SUBTEST 6f: Unconditionally Read-Only Address Preflight & 100-USDC Ceiling
  // =========================================================================
  await t.test('Address-only preflight: unconditionally read-only with keys in env, checks 100-USDC ceiling', async () => {
    // Create an arbitrary un-funded address
    const unFundedAddress = '0x1111111111111111111111111111111111111111';
    // Create a funded test address on local Anvil
    const fundedAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'); // Anvil Account #1
    // Mint 100 USDC collateral and native balance to fundedAccount
    await client.request({
      method: 'anvil_setBalance',
      params: [fundedAccount.address, '0x56BC75E2D63100000'] // 100 ETH / USDC in wei
    });
    await sendTx(adminWallet, 'mint USDC to fundedAccount', {
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'mint',
      args: [fundedAccount.address, 100_000_000n]
    });

    const preflightManifestPath = path.join(os.tmpdir(), `preflight-manifest-${Date.now()}.json`);
    const preflightPlanPath = path.join(os.tmpdir(), `preflight-plan-${Date.now()}.json`);

    // Set keys & approval in env to ensure address-only mode ignores them
    const originalApproved = process.env.RELEASE_APPROVED;
    const originalKey = process.env.DEPLOYER_KEY;
    process.env.RELEASE_APPROVED = 'true';
    process.env.DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    const nonceBefore = await client.getTransactionCount({ address: adminAccount.address });
    const targetNonceBefore = await client.getTransactionCount({ address: fundedAccount.address });

    try {
      // 1. Run address-only preflight for funded address
      const fundedReport = await runDeploy({
        rpcUrl,
        isLocal: true,
        address: fundedAccount.address,
        manifestPath: preflightManifestPath,
        planPath: preflightPlanPath
      });

      assert.equal(fundedReport.mode, 'ADDRESS_ONLY_PREFLIGHT');
      assert.equal(fundedReport.status, 'READY');
      assert.equal(fundedReport.fundingCheck.isFunded, true);
      assert.equal(fundedReport.spendingCeiling.isCeilingExceeded, false);
      assert.ok(fundedReport.gasProvenance.length > 0);
      assert.equal(fundedReport.gasProvenance[0].provenance, 'CONSERVATIVE_ALLOWANCE');

      // Assert unconditionally read-only: zero transactions broadcast, no manifest created
      const nonceAfter = await client.getTransactionCount({ address: adminAccount.address });
      const targetNonceAfter = await client.getTransactionCount({ address: fundedAccount.address });
      assert.equal(nonceAfter, nonceBefore, 'Admin account nonce must not change during address-only preflight');
      assert.equal(targetNonceAfter, targetNonceBefore, 'Target address nonce must not change during address-only preflight');
      assert.equal(existsSync(preflightManifestPath), false, 'Address-only preflight must not write manifest to disk');

      // 2. Run address-only preflight for underfunded address
      const underfundedReport = await runDeploy({
        rpcUrl,
        isLocal: true,
        address: unFundedAddress,
        manifestPath: preflightManifestPath,
        planPath: preflightPlanPath
      });

      assert.equal(underfundedReport.mode, 'ADDRESS_ONLY_PREFLIGHT');
      assert.equal(underfundedReport.status, 'ACTION_REQUIRED');
      assert.equal(underfundedReport.fundingCheck.isFunded, false);
      assert.match(underfundedReport.fundingCheck.nativeSurplusOrShortfallFormatted, /SHORTFALL/);

      // 3. Proposed 100-USDC Ceiling Check: halt if past spending + remaining exceeds 100.00 USDC
      const ceilingManifestPath = path.join(os.tmpdir(), `ceiling-manifest-${Date.now()}.json`);
      // Simulate an existing journal that already spent 95 USDC collateral + gas
      const ceilingManifestData = {
        status: 'IN_PROGRESS',
        network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
        contracts: {},
        timing: {},
        steps: {
          binary_split: { status: 'COMPLETED' },
          share_split: { status: 'COMPLETED' },
          yes_share_seed: { status: 'COMPLETED' } // 20 + 50 + 11.655 = 81.655 USDC collateral already incurred
        },
        journal: [
          {
            step: 'huge_gas_step',
            status: 'MINED',
            receipt: {
              blockNumber: 1,
              gasUsed: '20000000',
              effectiveGasPrice: '1000000000000' // 1000 gwei -> 20.00 USDC gas
            }
          }
        ],
        owner: adminAccount.address
      };
      await writeFile(ceilingManifestPath, JSON.stringify(ceilingManifestData));

      // Attempting to run deployment with existing spending exceeding 100 USDC halts before broadcast
      await assert.rejects(
        () => runDeploy({
          rpcUrl,
          isLocal: true,
          privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
          manifestPath: ceilingManifestPath
        }),
        /Proposed deployment spending ceiling exceeded/
      );
    } finally {
      if (originalApproved !== undefined) process.env.RELEASE_APPROVED = originalApproved;
      else delete process.env.RELEASE_APPROVED;
      if (originalKey !== undefined) process.env.DEPLOYER_KEY = originalKey;
      else delete process.env.DEPLOYER_KEY;
    }
  });

  // =========================================================================
  // SUBTEST 6g: Preflight Hardening, Cumulative Spending & Fee Bounds
  // =========================================================================
  await t.test('Preflight hardening, cumulative spending & fee bounds: validates address, preserves manifest, enforces approved deployer, accounts for reverted gas', async () => {
    // 1. Address-only preflight strictly requires a valid 20-byte address; no private-key derivation fallback
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        preflightOnly: true
      }),
      /Address-only preflight mode requires a public 20-byte hex address/
    );

    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        preflightOnly: true,
        address: '0xnotanaddress'
      }),
      /Invalid address/
    );

    // 2. Existing manifest file on disk is preserved completely unmodified during preflight
    const existingDiskManifestPath = path.join(os.tmpdir(), `disk-manifest-${Date.now()}.json`);
    const initialManifestData = {
      status: 'IN_PROGRESS',
      network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
      contracts: {},
      timing: {},
      steps: {},
      journal: [],
      owner: adminAccount.address
    };
    const serializedOriginal = JSON.stringify(initialManifestData, null, 2);
    await writeFile(existingDiskManifestPath, serializedOriginal);

    await runDeploy({
      rpcUrl,
      isLocal: true,
      address: adminAccount.address,
      manifestPath: existingDiskManifestPath
    });

    const afterContent = await readFile(existingDiskManifestPath, 'utf8');
    assert.equal(afterContent, serializedOriginal, 'Manifest file on disk must remain strictly unmodified during address-only preflight');

    // 3. Foreign manifest owner mismatch rejection in address-only preflight
    const foreignManifestPath = path.join(os.tmpdir(), `foreign-manifest-${Date.now()}.json`);
    const foreignManifestData = {
      ...initialManifestData,
      owner: '0x2222222222222222222222222222222222222222'
    };
    await writeFile(foreignManifestPath, JSON.stringify(foreignManifestData));

    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        address: adminAccount.address,
        manifestPath: foreignManifestPath
      }),
      /Manifest owner mismatch: manifest .* is owned by 0x2222222222222222222222222222222222222222/
    );

    // 4. Non-local writes strictly require matching APPROVED_DEPLOYER_ADDRESS
    const nonLocalKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
    const origApproved = process.env.RELEASE_APPROVED;
    const origDeployerAddr = process.env.APPROVED_DEPLOYER_ADDRESS;
    try {
      process.env.RELEASE_APPROVED = 'true';

      // 4a. Missing APPROVED_DEPLOYER_ADDRESS rejected
      delete process.env.APPROVED_DEPLOYER_ADDRESS;
      await assert.rejects(
        () => runDeploy({
          rpcUrl: 'https://rpc.testnet.arc.io',
          isLocal: false,
          privateKey: nonLocalKey
        }),
        /Safety violation: Non-local deployment requires an explicit APPROVED_DEPLOYER_ADDRESS/
      );

      // 4b. Mismatched APPROVED_DEPLOYER_ADDRESS rejected
      process.env.APPROVED_DEPLOYER_ADDRESS = '0x1111111111111111111111111111111111111111';
      await assert.rejects(
        () => runDeploy({
          rpcUrl: 'https://rpc.testnet.arc.io',
          isLocal: false,
          privateKey: nonLocalKey
        }),
        /Safety violation: signer address .* does not match APPROVED_DEPLOYER_ADDRESS/
      );
    } finally {
      if (origApproved !== undefined) process.env.RELEASE_APPROVED = origApproved;
      else delete process.env.RELEASE_APPROVED;
      if (origDeployerAddr !== undefined) process.env.APPROVED_DEPLOYER_ADDRESS = origDeployerAddr;
      else delete process.env.APPROVED_DEPLOYER_ADDRESS;
    }

    // 5. Reverted transaction gas is retained in journal and counts towards spending ceiling
    const revertCeilingManifestPath = path.join(os.tmpdir(), `revert-ceiling-manifest-${Date.now()}.json`);
    const revertCeilingData = {
      status: 'IN_PROGRESS',
      network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
      contracts: {},
      timing: {},
      steps: {
        binary_split: { status: 'COMPLETED' },
        share_split: { status: 'COMPLETED' },
        yes_share_seed: { status: 'COMPLETED' } // 81.655 USDC collateral
      },
      journal: [
        {
          step: 'failed_reverted_attempt',
          status: 'REVERTED',
          receipt: {
            blockNumber: 1,
            gasUsed: '20000000',
            effectiveGasPrice: '1000000000000' // 20.00 USDC gas spent
          }
        }
      ],
      owner: adminAccount.address
    };
    await writeFile(revertCeilingManifestPath, JSON.stringify(revertCeilingData));

    // Total = 81.655 collateral + 20.00 gas = 101.655 USDC > 100 USDC ceiling -> rejects
    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: revertCeilingManifestPath
      }),
      /Proposed deployment spending ceiling exceeded/
    );

    // 6. Safe halt on unresolvable fee history (missing receipt gas and unresolvable tx price)
    const brokenFeeManifestPath = path.join(os.tmpdir(), `broken-fee-manifest-${Date.now()}.json`);
    const brokenFeeData = {
      status: 'IN_PROGRESS',
      network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
      contracts: {},
      timing: {},
      steps: {},
      journal: [
        {
          step: 'unresolvable_step',
          status: 'MINED'
          // Missing receipt and missing hash
        }
      ],
      owner: adminAccount.address
    };
    await writeFile(brokenFeeManifestPath, JSON.stringify(brokenFeeData));

    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: brokenFeeManifestPath
      }),
      /Unresolved spending history/
    );

    // 7. Genuinely empty UNCONFIGURED manifest is accepted cleanly in address-only preflight
    const unconfiguredManifestPath = path.join(os.tmpdir(), `unconfigured-manifest-${Date.now()}.json`);
    await writeFile(unconfiguredManifestPath, JSON.stringify({
      status: 'UNCONFIGURED',
      network: { name: 'Arc Testnet', chainId: 5042002 },
      contracts: {},
      steps: {},
      journal: []
    }));

    const unconfPreflight = await runDeploy({
      rpcUrl,
      isLocal: true,
      address: adminAccount.address,
      manifestPath: unconfiguredManifestPath
    });
    assert.equal(unconfPreflight.readiness.deploymentIntegrity, 'CLEAN');
    assert.equal(unconfPreflight.readiness.ownerAuthorization, 'REQUIRED_FOR_BROADCAST');

    // 8. Completed step lacking receipt in journal is flagged UNVERIFIED_ALLOWANCE and retained in remaining gas budget
    const unverifiedStepManifestPath = path.join(os.tmpdir(), `unverified-step-manifest-${Date.now()}.json`);
    await writeFile(unverifiedStepManifestPath, JSON.stringify({
      status: 'IN_PROGRESS',
      network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
      contracts: {},
      steps: {
        oracle: { status: 'COMPLETED' }
      },
      journal: [],
      owner: adminAccount.address
    }));

    const unverifiedPreflight = await runDeploy({
      rpcUrl,
      isLocal: true,
      address: adminAccount.address,
      manifestPath: unverifiedStepManifestPath
    });
    assert.equal(unverifiedPreflight.readiness.deploymentIntegrity, 'UNVERIFIED_STEPS_DETECTED');
    const oracleProv = unverifiedPreflight.gasProvenance.find(p => p.step === 'oracle');
    assert.equal(oracleProv?.status, 'UNVERIFIED');
    assert.equal(oracleProv?.provenance, 'UNVERIFIED_ALLOWANCE');
    assert.ok(oracleProv?.notes.includes('conservatively retained in remaining gas budget'));

    // 9. Fail closed on unresolvable fee when gas price cannot be determined
    const noGasPriceManifestPath = path.join(os.tmpdir(), `nogasprice-manifest-${Date.now()}.json`);
    await writeFile(noGasPriceManifestPath, JSON.stringify({
      status: 'IN_PROGRESS',
      network: { name: 'Local EVM', chainId: 5042002, rpcUrl },
      contracts: {},
      steps: {},
      journal: [
        {
          step: 'broken_step',
          status: 'MINED',
          receipt: {
            blockNumber: 1,
            gasUsed: '100000'
          }
        }
      ],
      owner: adminAccount.address
    }));

    await assert.rejects(
      () => runDeploy({
        rpcUrl,
        isLocal: true,
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        manifestPath: noGasPriceManifestPath
      }),
      /Unresolved spending history: missing effectiveGasPrice and hash for step broken_step/
    );
  });

  // =========================================================================
  // SUBTEST 7: Operator CLI Verification & Strict Input Validation
  // =========================================================================
  await t.test('Operator CLI: validates strict pricing, timing constraints, and executes settlement commands', async () => {
    const { parsePrice6, main: operatorMain } = await import('../scripts/demo-operator.mjs');
    assert.equal(parsePrice6('250'), 250_000_000n);
    assert.equal(parsePrice6('250.50'), 250_500_000n);
    assert.equal(parsePrice6('0.000001'), 1n);
    assert.throws(() => parsePrice6('-10'), /Invalid settlement price/);
    assert.throws(() => parsePrice6('abc'), /Invalid settlement price/);
    assert.throws(() => parsePrice6('100.1234567'), /Invalid settlement price/);
    assert.throws(() => parsePrice6('1e5'), /Invalid settlement price/);

    // Deploy an accelerated market for operator testing
    const opMarket = await deployMarket({ cap6: 500_000_000n, eventDeadlineOffset: 60, tradingCutoffOffset: 120, earliestPriceFixOffset: 120 });
    await seedLiquidity(opMarket);

    const opConfig = {
      rpcUrl,
      isLocal: true,
      oracle: opMarket.oracleAddress,
      binaryVault: opMarket.binVaultAddress,
      shareVault: opMarket.shareVaultAddress,
      binaryAmm: opMarket.binAmmAddress,
      yesShareAmm: opMarket.yesAmmAddress,
      noShareAmm: opMarket.noAmmAddress,
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    };

    // Operator fix-price before event resolution throws
    await assert.rejects(
      () => operatorMain(['fix-price', '200'], opConfig),
      /must be EVENT_RESOLVED/
    );

    // Operator resolve-event NO before eventDeadline throws
    await assert.rejects(
      () => operatorMain(['resolve-event', 'NO'], opConfig),
      /cannot resolve NO before eventDeadline/
    );

    // Operator resolve-event YES succeeds early
    await operatorMain(['resolve-event', 'YES'], opConfig);

    // Resolving event again throws
    await assert.rejects(
      () => operatorMain(['resolve-event', 'YES'], opConfig),
      /already at lifecycle stage/
    );

    // Advance time past earliestPriceFixTime
    await client.request({
      method: 'evm_setNextBlockTimestamp',
      params: [Number(opMarket.earliestPriceFixTime) + 10]
    });
    await client.request({ method: 'evm_mine', params: [] });

    // Operator fix-price succeeds
    await operatorMain(['fix-price', '220.50'], opConfig);

    // Check shareVault lifecycle
    const lc = await client.readContract({
      address: opMarket.shareVaultAddress,
      abi: shareVaultArtifact.abi,
      functionName: 'lifecycle'
    });
    assert.equal(lc, 2, 'Lifecycle should be PRICE_FIXED (2)');

    // Operator safety checks: unapproved non-local execution rejected
    await assert.rejects(
      () => operatorMain(['resolve-event', 'YES'], {
        ...opConfig,
        isLocal: false,
        rpcUrl: 'https://rpc.testnet.arc.io',
        privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234'
      }),
      /SAFETY VIOLATION: Non-local operator actions require explicit approval/
    );

    // Operator safety checks: approved non-local execution requires APPROVED_OPERATOR_ADDRESS
    const opOrigApproved = process.env.RELEASE_APPROVED;
    const opOrigAddress = process.env.APPROVED_OPERATOR_ADDRESS;
    try {
      process.env.RELEASE_APPROVED = 'true';
      delete process.env.APPROVED_OPERATOR_ADDRESS;
      delete process.env.APPROVED_DEPLOYER_ADDRESS;

      // Missing approved address throws
      await assert.rejects(
        () => operatorMain(['resolve-event', 'YES'], {
          ...opConfig,
          isLocal: false,
          rpcUrl: 'https://rpc.testnet.arc.io',
          privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
        }),
        /SAFETY ENFORCEMENT: Non-local operator writes require an explicit approved address/
      );

      // Mismatched approved address throws
      process.env.APPROVED_OPERATOR_ADDRESS = '0x1111111111111111111111111111111111111111';
      await assert.rejects(
        () => operatorMain(['resolve-event', 'YES'], {
          ...opConfig,
          isLocal: false,
          rpcUrl: 'https://rpc.testnet.arc.io',
          privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
        }),
        /SAFETY ENFORCEMENT: Signer address .* does not match approved address/
      );
    } finally {
      if (opOrigApproved !== undefined) process.env.RELEASE_APPROVED = opOrigApproved;
      else delete process.env.RELEASE_APPROVED;
      if (opOrigAddress !== undefined) process.env.APPROVED_OPERATOR_ADDRESS = opOrigAddress;
      else delete process.env.APPROVED_OPERATOR_ADDRESS;
    }

    // Operator safety checks: isLocal specified on non-loopback rejected
    await assert.rejects(
      () => operatorMain(['resolve-event', 'YES'], {
        ...opConfig,
        isLocal: true,
        rpcUrl: 'https://rpc.testnet.arc.io',
        privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234'
      }),
      /Safety violation: isLocal specified but RPC endpoint is not a loopback address/
    );
  });

  // =========================================================================
  // SUBTEST 8: Cutoff Boundary & Split/Merge Check
  // =========================================================================
  await t.test('Trading cutoff boundary: trade and split/merge allowed before cutoff, frozen immediately after', async () => {
    const market = await deployMarket({ cap6: 500_000_000n, eventDeadlineOffset: 100, tradingCutoffOffset: 200, earliestPriceFixOffset: 300 });
    await seedLiquidity(market);

    const cutoff = Number(market.tradingCutoff);
    const farDeadline = BigInt(market.blockTime + 100000);

    // Mint USDC to user
    await sendTx(adminWallet, 'mint USDC', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'mint', args: [userAccount.address, 200_000_000n] });

    // Set block time to cutoff - 10 (still before cutoff)
    await client.request({ method: 'evm_setNextBlockTimestamp', params: [cutoff - 10] });
    await client.request({ method: 'evm_mine', params: [] });

    // Split allowed before cutoff
    await sendTx(userWallet, 'approve shareVault before cutoff', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.shareVaultAddress, 50_000_000n] });
    await sendTx(userWallet, 'split 0.1 sets before cutoff', { address: market.shareVaultAddress, abi: shareVaultArtifact.abi, functionName: 'split', args: [100_000_000_000_000_000n, userAccount.address] });

    // Trade allowed before cutoff
    await sendTx(userWallet, 'approve yesAmm before cutoff', { address: ARC_USDC, abi: mockUsdcArtifact.abi, functionName: 'approve', args: [market.yesAmmAddress, 10_000_000n] });
    await sendTx(userWallet, 'buyShares before cutoff', { address: market.yesAmmAddress, abi: shareAmmArtifact.abi, functionName: 'buyShares', args: [10_000_000n, 1n, farDeadline] });

    // Set block time to cutoff + 1 (past cutoff)
    await client.request({ method: 'evm_setNextBlockTimestamp', params: [cutoff + 1] });
    await client.request({ method: 'evm_mine', params: [] });

    // Split reverts past cutoff
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.shareVaultAddress,
        abi: shareVaultArtifact.abi,
        functionName: 'split',
        args: [100_000_000_000_000_000n, userAccount.address]
      }),
      /TradingFrozen/
    );

    // Trade reverts past cutoff
    await assert.rejects(
      () => userWallet.writeContract({
        address: market.yesAmmAddress,
        abi: shareAmmArtifact.abi,
        functionName: 'buyShares',
        args: [10_000_000n, 1n, farDeadline]
      }),
      /TradingFrozen/
    );
  });
});
