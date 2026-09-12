#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  parseUnits
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ARC_CHAIN_ID = 5042002;
const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.io';
const ANVIL_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

if (existsSync('.env')) {
  try {
    const rawEnv = readFileSync('.env', 'utf8');
    for (const line of rawEnv.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

export function isLocalRpc(rpcUrl) {
  try {
    const parsed = new URL(rpcUrl);
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0' || host === '::1';
  } catch {
    return false;
  }
}

export function redactRpcUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch {
    return '[INVALID_RPC_URL]';
  }
}

export function sanitizeErrorMessage(message) {
  if (!message || typeof message !== 'string') return String(message || '');
  return message
    .replace(/https?:\/\/[^\s"'<>)]+/g, (matched) => {
      try {
        const parsed = new URL(matched);
        return parsed.origin;
      } catch {
        return '[REDACTED_RPC_ENDPOINT]';
      }
    })
    .replace(/(https?:\/\/)?([^:@\s]+):([^@\s]+)@/g, '$1***:***@')
    .replace(/([?&](?:key|token|secret|auth|apikey|api_key)=)[^&\s]+/gi, '$1REDACTED');
}

export function sanitizeRpcError(err) {
  if (!err) return err;
  const msg = sanitizeErrorMessage(err.message || String(err));
  const sanitizedErr = new Error(msg);
  if (err.stack) sanitizedErr.stack = sanitizeErrorMessage(err.stack);
  return sanitizedErr;
}

export async function verifyLocalNodeIdentity(client) {
  let clientVersion = '';
  try {
    clientVersion = await client.request({ method: 'web3_clientVersion' });
  } catch (err) {
    throw new Error(`Failed to query web3_clientVersion from local node: ${err.message}. Local write operations fail closed.`);
  }

  if (typeof clientVersion !== 'string' || !clientVersion.toLowerCase().includes('anvil')) {
    throw new Error(`Local development verification failed: web3_clientVersion is "${clientVersion}". Expected Anvil node. Refusing write operations on unverified or non-Anvil node.`);
  }

  try {
    await client.request({ method: 'anvil_nodeInfo' });
  } catch (err) {
    throw new Error(`Local development verification failed: anvil_nodeInfo capability check failed (${err.message}). Node is not a verified Anvil development instance.`);
  }
  return true;
}

export function parsePrice6(str) {
  if (typeof str !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(str.trim())) {
    throw new Error(`Invalid settlement price "${str}". Enter a non-negative decimal with at most 6 decimal places.`);
  }
  return parseUnits(str.trim(), 6);
}

function loadArtifact(contractName) {
  const p = path.resolve('packages/contracts/out', `${contractName}.sol`, `${contractName}.json`);
  if (!existsSync(p)) {
    throw new Error(`Artifact ${contractName} not found at ${p}. Run "forge build" in packages/contracts.`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function loadConfig() {
  const defaultManifest = existsSync(path.resolve('deployments/submission-market.json'))
    ? path.resolve('deployments/submission-market.json')
    : path.resolve('deployments/demo-manifest.json');
  const manifestPath = process.env.MANIFEST_PATH ? path.resolve(process.env.MANIFEST_PATH) : defaultManifest;
  let manifest = {};
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {}
  }

  const contracts = manifest.contracts || {};
  return {
    rpcUrl: process.env.ARC_RPC_URL || process.env.RPC_URL || manifest.network?.rpcUrl || ARC_TESTNET_RPC,
    oracle: process.env.ARC_ORACLE || contracts.oracle,
    binaryVault: process.env.ARC_BINARY_VAULT || contracts.binaryVault,
    shareVault: process.env.ARC_SHARE_VAULT || contracts.shareVault,
    binaryAmm: process.env.ARC_BINARY_AMM || contracts.binaryAmm,
    yesShareAmm: process.env.ARC_YES_SHARE_AMM || contracts.yesShareAmm,
    noShareAmm: process.env.ARC_NO_SHARE_AMM || contracts.noShareAmm,
    privateKey: process.env.OPERATOR_KEY || process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY
  };
}

export async function main(customArgs, customConfig) {
  const args = customArgs || process.argv.slice(2);
  const command = args[0] || 'help';

  const config = customConfig || loadConfig();
  const safeRpcUrl = redactRpcUrl(config.rpcUrl);
  const isExplicitLocal = Boolean(config.isLocal || process.env.THELEMA_LOCAL === 'true' || args.includes('--local'));
  const isLoopback = isLocalRpc(config.rpcUrl);

  if (isExplicitLocal && !isLoopback) {
    throw new Error('Safety violation: isLocal specified but RPC endpoint is not a loopback address.');
  }

  const isLocalDev = isExplicitLocal && isLoopback;

  const transport = http(config.rpcUrl);
  const client = createPublicClient({ transport });

  const oracleArtifact = loadArtifact('DemoOracle');
  const binVaultArtifact = loadArtifact('BinaryVault');
  const shareVaultArtifact = loadArtifact('ShareVault');

  if (command === 'help') {
    console.log(`
THELEMA Demo Operator CLI
=========================
Usage:
  node scripts/demo-operator.mjs status
  node scripts/demo-operator.mjs resolve-event <YES|NO>
  node scripts/demo-operator.mjs fix-price <priceInUSDC>
  node scripts/demo-operator.mjs publish-and-settle <YES|NO> <priceInUSDC>

Configuration:
  ARC_ORACLE:        ${config.oracle || '(not configured)'}
  ARC_BINARY_VAULT:  ${config.binaryVault || '(not configured)'}
  ARC_SHARE_VAULT:   ${config.shareVault || '(not configured)'}
  RPC_URL:           ${safeRpcUrl}
`);
    return;
  }

  if (command === 'status') {
    if (!config.oracle || !config.binaryVault || !config.shareVault) {
      console.error('Error: Incomplete deployment configuration. Check deployments/demo-manifest.json or set env vars.');
      process.exit(1);
    }

    console.log('--- THELEMA Demo Market Status ---');
    const block = await client.getBlock({ blockTag: 'latest' });
    const blockTime = Number(block.timestamp);
    console.log(`Current Block Time: ${blockTime} (${new Date(blockTime * 1000).toISOString()})`);

    // Oracle status
    const eventResolved = await client.readContract({ address: config.oracle, abi: oracleArtifact.abi, functionName: 'eventResolved' });
    const priceFixed = await client.readContract({ address: config.oracle, abi: oracleArtifact.abi, functionName: 'priceFixed' });
    const eventYes = await client.readContract({ address: config.oracle, abi: oracleArtifact.abi, functionName: 'eventYes' });
    const oracleOwner = await client.readContract({ address: config.oracle, abi: oracleArtifact.abi, functionName: 'owner' });

    console.log('\n[Oracle]');
    console.log(`  Address:        ${config.oracle}`);
    console.log(`  Owner:          ${oracleOwner}`);
    console.log(`  Event Resolved: ${eventResolved} ${eventResolved ? `(Outcome: ${eventYes ? 'YES' : 'NO'})` : ''}`);
    console.log(`  Price Fixed:    ${priceFixed}`);

    // Binary Vault status
    const binSettled = await client.readContract({ address: config.binaryVault, abi: binVaultArtifact.abi, functionName: 'settled' });
    const binTrading = await client.readContract({ address: config.binaryVault, abi: binVaultArtifact.abi, functionName: 'isTradingAllowed' });
    const binDeadline = await client.readContract({ address: config.binaryVault, abi: binVaultArtifact.abi, functionName: 'eventDeadline' });
    const binCutoff = await client.readContract({ address: config.binaryVault, abi: binVaultArtifact.abi, functionName: 'tradingCutoff' });

    console.log('\n[Binary Vault]');
    console.log(`  Settled:        ${binSettled}`);
    console.log(`  Trading Allowed:${binTrading}`);
    console.log(`  Event Deadline: ${binDeadline} (${binDeadline <= BigInt(blockTime) ? 'PASSED' : 'PENDING'})`);
    console.log(`  Trading Cutoff: ${binCutoff} (${binCutoff <= BigInt(blockTime) ? 'REACHED' : 'ACTIVE'})`);

    // Share Vault status
    const lifecycle = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'lifecycle' });
    const lifecycleNames = ['OPEN', 'EVENT_RESOLVED', 'PRICE_FIXED'];
    const cap6 = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'cap6' });
    const settlementValue6 = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'settlementValue6' });
    const residualValue6 = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'residualValue6' });
    const liabilities6 = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'remainingLiabilities6' });

    console.log('\n[Share Vault]');
    console.log(`  Lifecycle:      ${lifecycleNames[lifecycle] || lifecycle}`);
    console.log(`  Cap:            $${formatUnits(cap6, 6)}`);
    console.log(`  Settlement Val: $${formatUnits(settlementValue6, 6)}`);
    console.log(`  Residual Val:   $${formatUnits(residualValue6, 6)}`);
    console.log(`  Remaining Liab: $${formatUnits(liabilities6, 6)}`);
    return;
  }

  // Pre-Transaction Validation: key, chain, authorization
  const chainId = await client.getChainId();
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Unsupported chain ID ${chainId}. THELEMA operations are strictly restricted to chain ${ARC_CHAIN_ID} (Arc Testnet / local Arc fork).`);
  }

  // Verified local node identity check: fail closed on loopback proxies that cannot be verified as Anvil
  if (isLocalDev) {
    await verifyLocalNodeIdentity(client);
  }

  if (!isLocalDev && process.env.RELEASE_APPROVED !== 'true') {
    throw new Error('SAFETY VIOLATION: Non-local operator actions require explicit approval. Set RELEASE_APPROVED=true.');
  }

  const effectiveKey = config.privateKey || (isLocalDev ? ANVIL_DEV_KEY : null);
  if (!effectiveKey) {
    throw new Error('Operator private key required for settlement actions. Set OPERATOR_KEY or DEPLOYER_KEY.');
  }

  if (!isLocalDev && effectiveKey.toLowerCase() === ANVIL_DEV_KEY.toLowerCase()) {
    throw new Error('SAFETY VIOLATION: Anvil dev key cannot be used on public network!');
  }

  const account = privateKeyToAccount(effectiveKey);

  // Require explicit matching approved address for non-local operator writes
  if (!isLocalDev) {
    const approvedAddress = process.env.APPROVED_OPERATOR_ADDRESS || process.env.APPROVED_DEPLOYER_ADDRESS;
    if (!approvedAddress) {
      throw new Error('SAFETY ENFORCEMENT: Non-local operator writes require an explicit approved address in APPROVED_OPERATOR_ADDRESS or APPROVED_DEPLOYER_ADDRESS.');
    }
    if (account.address.toLowerCase() !== approvedAddress.toLowerCase()) {
      throw new Error(`SAFETY ENFORCEMENT: Signer address ${account.address} does not match approved address ${approvedAddress}. Refusing unauthorized operator broadcast.`);
    }
  }

  const wallet = createWalletClient({ account, transport });
  console.log(`Operating with Account: ${account.address}`);

  // Pre-transaction checks: owner & contract bindings
  const oracleOwner = await client.readContract({ address: config.oracle, abi: oracleArtifact.abi, functionName: 'owner' });
  if (oracleOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Unauthorized: Account ${account.address} is not the owner of DemoOracle at ${config.oracle} (owner: ${oracleOwner})`);
  }

  const boundOracleBin = await client.readContract({ address: config.binaryVault, abi: binVaultArtifact.abi, functionName: 'oracle' });
  const boundOracleShare = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'oracle' });
  if (boundOracleBin.toLowerCase() !== config.oracle.toLowerCase() || boundOracleShare.toLowerCase() !== config.oracle.toLowerCase()) {
    throw new Error(`Oracle binding mismatch: vaults bind binary=${boundOracleBin}, share=${boundOracleShare}; operator configured=${config.oracle}`);
  }

  // Dynamic fee query & bounding (130% ceiling on gas price)
  const curGasPrice = await client.getGasPrice();
  if (typeof curGasPrice !== 'bigint' || curGasPrice <= 0n) {
    throw new Error(`Non-positive gas price from RPC: ${curGasPrice}`);
  }
  const maxFeeBound = (curGasPrice * 130n) / 100n;

  async function executeOperatorTx(description, writeCall) {
    const hash = await writeCall(maxFeeBound);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`Operator transaction ${description} reverted on-chain: ${hash}`);
    }
    let resolvedEffectiveGasPrice = receipt.effectiveGasPrice;
    if (!resolvedEffectiveGasPrice) {
      const tx = await client.getTransaction({ hash }).catch(() => null);
      if (tx?.gasPrice) {
        resolvedEffectiveGasPrice = tx.gasPrice;
      } else {
        throw new Error(`Unresolved historical fee: cannot determine actual gas price for operator transaction ${hash}. Halting to preserve auditability.`);
      }
    }

    const defaultManifest = existsSync(path.resolve('deployments/submission-market.json'))
      ? path.resolve('deployments/submission-market.json')
      : path.resolve('deployments/demo-manifest.json');
    const manifestPath = config.manifestPath ? path.resolve(config.manifestPath) : (
      process.env.MANIFEST_PATH ? path.resolve(process.env.MANIFEST_PATH) : defaultManifest
    );
    if (existsSync(manifestPath)) {
      try {
        const raw = readFileSync(manifestPath, 'utf8').trim();
        if (raw) {
          const m = JSON.parse(raw);
          if (Array.isArray(m.journal)) {
            m.journal.push({
              step: `operator_${command}`,
              description,
              status: 'MINED',
              hash,
              receipt: {
                blockNumber: Number(receipt.blockNumber),
                gasUsed: receipt.gasUsed.toString(),
                effectiveGasPrice: resolvedEffectiveGasPrice.toString()
              },
              timestamp: new Date().toISOString()
            });
            const tmp = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
            writeFileSync(tmp, JSON.stringify(m, null, 2));
            renameSync(tmp, manifestPath);
          }
        }
      } catch (err) {
        console.warn(`Warning: Could not record operator transaction in manifest journal: ${err.message}`);
      }
    }
    return receipt;
  }

  const block = await client.getBlock({ blockTag: 'latest' });
  const blockTime = Number(block.timestamp);

  if (command === 'resolve-event') {
    const outcomeArg = (args[1] || '').toUpperCase();
    if (outcomeArg !== 'YES' && outcomeArg !== 'NO') {
      throw new Error('Invalid outcome argument. Must specify YES or NO (e.g. resolve-event YES)');
    }
    const isYes = outcomeArg === 'YES';

    // Verify current lifecycle
    const currentLifecycle = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'lifecycle' });
    if (currentLifecycle !== 0) {
      throw new Error(`Invalid lifecycle for resolveEvent: market is already at lifecycle stage ${currentLifecycle} (must be OPEN=0)`);
    }

    // Verify deadline constraint for NO resolution
    if (!isYes) {
      const deadline = await client.readContract({ address: config.binaryVault, abi: binVaultArtifact.abi, functionName: 'eventDeadline' });
      if (BigInt(blockTime) < deadline) {
        throw new Error(`Timing constraint: cannot resolve NO before eventDeadline (${deadline} > current ${blockTime}). Wait for deadline or advance block time.`);
      }
    }

    console.log(`Resolving event outcome to: ${outcomeArg}...`);
    const receipt = await executeOperatorTx(`resolveEvent(${outcomeArg})`, (gasPrice) =>
      wallet.writeContract({
        address: config.oracle,
        abi: oracleArtifact.abi,
        functionName: 'resolveEvent',
        args: [config.binaryVault, config.shareVault, isYes],
        gasPrice
      })
    );
    console.log(`Event resolved to ${outcomeArg} successfully! Tx: ${receipt.transactionHash || receipt.hash || 'mined'}`);
    return receipt;
  }

  if (command === 'fix-price') {
    if (!args[1]) {
      throw new Error('Missing price argument. Specify non-negative price in USDC (e.g. fix-price 250)');
    }
    const price6 = parsePrice6(args[1]);

    // Verify current lifecycle: must be EVENT_RESOLVED (1)
    const currentLifecycle = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'lifecycle' });
    if (currentLifecycle !== 1) {
      throw new Error(`Invalid lifecycle for fixPrice: market is currently in stage ${currentLifecycle} (must be EVENT_RESOLVED=1). Resolve event first.`);
    }

    // Verify timing: earliestPriceFixTime
    const fixTime = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'earliestPriceFixTime' });
    if (BigInt(blockTime) < fixTime) {
      throw new Error(`Timing constraint: cannot fix price before earliestPriceFixTime (${fixTime} > current ${blockTime}). Wait for observation window.`);
    }

    console.log(`Fixing asset settlement price to: $${args[1]} (${price6} raw micro-USDC)...`);
    const receipt = await executeOperatorTx(`fixPrice($${args[1]})`, (gasPrice) =>
      wallet.writeContract({
        address: config.oracle,
        abi: oracleArtifact.abi,
        functionName: 'fixPrice',
        args: [config.shareVault, price6],
        gasPrice
      })
    );
    console.log(`Settlement price fixed to $${args[1]} successfully! Tx: ${receipt.transactionHash || receipt.hash || 'mined'}`);
    return receipt;
  }

  if (command === 'publish-and-settle') {
    const outcomeArg = (args[1] || '').toUpperCase();
    if (outcomeArg !== 'YES' && outcomeArg !== 'NO') {
      throw new Error('Invalid outcome argument. Must specify YES or NO.');
    }
    if (!args[2]) {
      throw new Error('Missing price argument. Usage: publish-and-settle <YES|NO> <priceInUSDC>');
    }
    const isYes = outcomeArg === 'YES';
    const price6 = parsePrice6(args[2]);

    const currentLifecycle = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'lifecycle' });
    if (currentLifecycle !== 0) {
      throw new Error(`Invalid lifecycle for publishAndSettle: market is already in stage ${currentLifecycle} (must be OPEN=0)`);
    }

    if (!isYes) {
      const deadline = await client.readContract({ address: config.binaryVault, abi: binVaultArtifact.abi, functionName: 'eventDeadline' });
      if (BigInt(blockTime) < deadline) {
        throw new Error(`Timing constraint: cannot resolve NO before eventDeadline (${deadline} > current ${blockTime}).`);
      }
    }

    const fixTime = await client.readContract({ address: config.shareVault, abi: shareVaultArtifact.abi, functionName: 'earliestPriceFixTime' });
    if (BigInt(blockTime) < fixTime) {
      throw new Error(`Timing constraint: cannot fix price before earliestPriceFixTime (${fixTime} > current ${blockTime}).`);
    }

    console.log(`Publishing event ${outcomeArg} and fixing price $${args[2]} (${price6} raw)...`);
    const receipt = await executeOperatorTx(`publishAndSettle(${outcomeArg}, $${args[2]})`, (gasPrice) =>
      wallet.writeContract({
        address: config.oracle,
        abi: oracleArtifact.abi,
        functionName: 'publishAndSettle',
        args: [config.binaryVault, config.shareVault, isYes, price6],
        gasPrice
      })
    );
    console.log(`Published and settled successfully! Tx: ${receipt.transactionHash || receipt.hash || 'mined'}`);
    return receipt;
  }

  throw new Error(`Unknown operator command: "${command}". Use "node scripts/demo-operator.mjs help".`);
}

export function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch(err => {
    console.error('\nOperator command error:', sanitizeErrorMessage(err.message || err));
    process.exit(1);
  });
}
