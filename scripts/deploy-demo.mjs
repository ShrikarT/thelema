#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import os from 'node:os';
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
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ANVIL_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const candidateEnvPaths = ['.env', path.resolve('../thelema/.env')];
for (const envPath of candidateEnvPaths) {
  if (existsSync(envPath)) {
    try {
      const rawEnv = readFileSync(envPath, 'utf8');
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
}

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
  'function transfer(address, uint256) returns (bool)',
  'function mint(address, uint256) returns (bool)',
  'function totalSupply() view returns (uint256)'
]);

const AMM_ABI = parseAbi([
  'function reserves() view returns (uint256, uint256)',
  'function yesToken() view returns (address)',
  'function noToken() view returns (address)',
  'function collateral() view returns (address)',
  'function vault() view returns (address)'
]);

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

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function loadArtifact(contractName) {
  const p = path.resolve('packages/contracts/out', `${contractName}.sol`, `${contractName}.json`);
  if (!existsSync(p)) {
    try {
      const foundryBin = path.join(os.homedir(), '.foundry', 'bin');
      const env = { ...process.env, PATH: `${foundryBin}${path.delimiter}${process.env.PATH || ''}` };
      execSync('forge build', { cwd: 'packages/contracts', env, stdio: 'ignore' });
    } catch {}
  }
  if (!existsSync(p)) {
    throw new Error(`Artifact ${contractName} not found at ${p}. Run "forge build" in packages/contracts.`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

export async function validateAndReconcileManifest({
  manifestRaw,
  manifestPath,
  client,
  expectedOwner,
  chainId
}) {
  let manifest = { steps: {}, contracts: {}, journal: [] };
  const unverifiedSteps = [];
  let incurredGasWei = 0n;

  if (!manifestRaw || !manifestRaw.trim()) {
    return {
      manifest,
      incurredGasWei: 0n,
      unverifiedSteps: []
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(manifestRaw.trim());
  } catch (err) {
    throw new Error(`Corrupted manifest JSON at ${manifestPath}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid manifest format at ${manifestPath}: expected JSON object.`);
  }

  // 1. Genuinely empty UNCONFIGURED manifest is accepted as clean initial state
  const isGenuinelyEmptyUnconfigured = (
    parsed.status === 'UNCONFIGURED' &&
    (!parsed.contracts || Object.keys(parsed.contracts).length === 0) &&
    (!parsed.journal || parsed.journal.length === 0) &&
    (!parsed.steps || Object.keys(parsed.steps).length === 0)
  );

  if (isGenuinelyEmptyUnconfigured) {
    return {
      manifest: {
        status: 'UNCONFIGURED',
        network: { chainId, name: 'Arc Testnet' },
        owner: expectedOwner || null,
        contracts: {},
        steps: {},
        journal: []
      },
      incurredGasWei: 0n,
      unverifiedSteps: []
    };
  }

  // 2. Once history or contracts exist, require consistent chain and owner
  if (parsed.network?.chainId && parsed.network.chainId !== chainId) {
    throw new Error(`Manifest network mismatch: manifest chain ${parsed.network.chainId} vs active ${chainId}`);
  }

  if (parsed.owner && expectedOwner && parsed.owner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(`Manifest owner mismatch: manifest at ${manifestPath} is owned by ${parsed.owner}, but target address is ${expectedOwner}. Refusing to trust foreign manifest steps for this address.`);
  }

  manifest = {
    status: parsed.status || 'IN_PROGRESS',
    network: parsed.network || { chainId },
    owner: parsed.owner || expectedOwner,
    contracts: parsed.contracts ? { ...parsed.contracts } : {},
    steps: parsed.steps ? { ...parsed.steps } : {},
    journal: Array.isArray(parsed.journal) ? [...parsed.journal] : [],
    timing: parsed.timing ? { ...parsed.timing } : {}
  };

  // 3. Verify on-chain bytecode and contract bindings if contracts exist
  let oracleArtifact, binVaultArtifact, shareVaultArtifact;
  try {
    oracleArtifact = loadArtifact('DemoOracle');
    binVaultArtifact = loadArtifact('BinaryVault');
    shareVaultArtifact = loadArtifact('ShareVault');
  } catch {}

  if (manifest.contracts?.oracle) {
    const code = await client.getBytecode({ address: manifest.contracts.oracle });
    if (!code || code === '0x') {
      throw new Error(`Recorded DemoOracle ${manifest.contracts.oracle} has no on-chain bytecode`);
    }
    if (oracleArtifact) {
      const oracleOwner = await client.readContract({
        address: manifest.contracts.oracle,
        abi: oracleArtifact.abi,
        functionName: 'owner'
      });
      if (expectedOwner && oracleOwner.toLowerCase() !== expectedOwner.toLowerCase()) {
        throw new Error(`Recorded DemoOracle owner mismatch: on-chain ${oracleOwner} vs deployer ${expectedOwner}`);
      }
    }
  }

  if (manifest.contracts?.binaryVault && manifest.contracts?.oracle) {
    const code = await client.getBytecode({ address: manifest.contracts.binaryVault });
    if (!code || code === '0x') {
      throw new Error(`Recorded BinaryVault ${manifest.contracts.binaryVault} has no on-chain bytecode`);
    }
    if (binVaultArtifact) {
      const boundOracle = await client.readContract({
        address: manifest.contracts.binaryVault,
        abi: binVaultArtifact.abi,
        functionName: 'oracle'
      });
      if (boundOracle.toLowerCase() !== manifest.contracts.oracle.toLowerCase()) {
        throw new Error(`Recorded BinaryVault bound to unexpected oracle: ${boundOracle}`);
      }
      const boundCollateral = await client.readContract({
        address: manifest.contracts.binaryVault,
        abi: binVaultArtifact.abi,
        functionName: 'collateral'
      });
      if (boundCollateral.toLowerCase() !== ARC_USDC.toLowerCase()) {
        throw new Error(`Recorded BinaryVault collateral mismatch: ${boundCollateral}`);
      }
    }
  }

  if (manifest.contracts?.shareVault && manifest.contracts?.oracle) {
    const code = await client.getBytecode({ address: manifest.contracts.shareVault });
    if (!code || code === '0x') {
      throw new Error(`Recorded ShareVault ${manifest.contracts.shareVault} has no on-chain bytecode`);
    }
    if (shareVaultArtifact) {
      const boundOracle = await client.readContract({
        address: manifest.contracts.shareVault,
        abi: shareVaultArtifact.abi,
        functionName: 'oracle'
      });
      if (boundOracle.toLowerCase() !== manifest.contracts.oracle.toLowerCase()) {
        throw new Error(`Recorded ShareVault bound to unexpected oracle: ${boundOracle}`);
      }
      const boundCollateral = await client.readContract({
        address: manifest.contracts.shareVault,
        abi: shareVaultArtifact.abi,
        functionName: 'collateral'
      });
      if (boundCollateral.toLowerCase() !== ARC_USDC.toLowerCase()) {
        throw new Error(`Recorded ShareVault collateral mismatch: ${boundCollateral}`);
      }
      const onChainCap = await client.readContract({
        address: manifest.contracts.shareVault,
        abi: shareVaultArtifact.abi,
        functionName: 'cap6'
      });
      if (onChainCap !== 500_000_000n) {
        throw new Error(`Recorded ShareVault cap mismatch: ${onChainCap} vs 500000000`);
      }
    }
  }

  // AMM token pairing validation
  if (manifest.contracts?.binaryAmm && manifest.contracts?.yesToken && manifest.contracts?.noToken) {
    const code = await client.getBytecode({ address: manifest.contracts.binaryAmm });
    if (!code || code === '0x') throw new Error(`Recorded BinaryAMM ${manifest.contracts.binaryAmm} has no on-chain bytecode`);
    const yToken = await client.readContract({ address: manifest.contracts.binaryAmm, abi: AMM_ABI, functionName: 'yesToken' });
    const nToken = await client.readContract({ address: manifest.contracts.binaryAmm, abi: AMM_ABI, functionName: 'noToken' });
    if (yToken.toLowerCase() !== manifest.contracts.yesToken.toLowerCase() || nToken.toLowerCase() !== manifest.contracts.noToken.toLowerCase()) {
      throw new Error('Recorded BinaryAMM token pairing mismatch.');
    }
  }

  // 4. Reconcile journal entries and enforce sender/nonce/receipt integrity
  const verifiedMinedSteps = new Set();
  if (Array.isArray(manifest.journal)) {
    for (const entry of manifest.journal) {
      if ((entry.status === 'SUBMITTED' || entry.status === 'MINED' || entry.status === 'REVERTED') && entry.hash) {
        const rcpt = await client.getTransactionReceipt({ hash: entry.hash }).catch(() => null);
        if (!rcpt) {
          throw new Error(`Unverifiable transaction receipt for step "${entry.step}": transaction hash ${entry.hash} not found on-chain. Refusing to trust unverified manifest history.`);
        }

        const tx = await client.getTransaction({ hash: entry.hash }).catch(() => null);
        if (!tx) {
          throw new Error(`Transaction ${entry.hash} for step "${entry.step}" not found on-chain.`);
        }

        if (expectedOwner && tx.from && tx.from.toLowerCase() !== expectedOwner.toLowerCase()) {
          throw new Error(`Borrowed transaction rejected: step "${entry.step}" transaction ${entry.hash} was sent by ${tx.from}, not target address ${expectedOwner}.`);
        }

        entry.nonce = Number(tx.nonce);

        let gasPriceWei;
        if (rcpt.effectiveGasPrice) {
          gasPriceWei = BigInt(rcpt.effectiveGasPrice);
        } else if (entry.receipt?.effectiveGasPrice) {
          gasPriceWei = BigInt(entry.receipt.effectiveGasPrice);
        } else if (tx?.gasPrice) {
          gasPriceWei = BigInt(tx.gasPrice);
        } else {
          throw new Error(`Unresolved historical fee: cannot determine historical gas price for transaction ${entry.hash}. Stopping to preserve spending auditability.`);
        }

        const gasUsed = BigInt(rcpt.gasUsed);
        entry.receipt = {
          blockNumber: Number(rcpt.blockNumber),
          gasUsed: gasUsed.toString(),
          effectiveGasPrice: gasPriceWei.toString(),
          contractAddress: rcpt.contractAddress || entry.receipt?.contractAddress || null
        };

        if (rcpt.status === 'success') {
          entry.status = 'MINED';
          verifiedMinedSteps.add(entry.step);
          manifest.steps[entry.step] = {
            status: 'COMPLETED',
            txHash: entry.hash,
            receipt: entry.receipt,
            contractAddress: entry.receipt.contractAddress
          };
          if (entry.receipt.contractAddress) {
            manifest.contracts[entry.step] = entry.receipt.contractAddress;
          }
        } else {
          entry.status = 'REVERTED';
        }

        incurredGasWei += gasUsed * gasPriceWei;
      } else if (entry.status === 'MINED' || entry.status === 'REVERTED') {
        if (!entry.receipt?.gasUsed) {
          throw new Error(`Unresolved spending history: missing receipt for step ${entry.step}. Stopping.`);
        }
        const gUsed = BigInt(entry.receipt.gasUsed);
        let gPrice;
        if (entry.receipt.effectiveGasPrice) {
          gPrice = BigInt(entry.receipt.effectiveGasPrice);
        } else if (entry.hash) {
          const tx = await client.getTransaction({ hash: entry.hash }).catch(() => null);
          if (tx?.gasPrice) {
            gPrice = BigInt(tx.gasPrice);
          } else {
            throw new Error(`Unresolved historical fee: cannot determine historical gas price for transaction ${entry.hash}. Stopping.`);
          }
        } else {
          throw new Error(`Unresolved spending history: missing effectiveGasPrice and hash for step ${entry.step}. Stopping.`);
        }
        incurredGasWei += gUsed * gPrice;
      } else if (entry.status === 'INTENT' && expectedOwner) {
        const currentNonce = await client.getTransactionCount({ address: expectedOwner });
        if (entry.nonce !== undefined && entry.nonce !== null && currentNonce > BigInt(entry.nonce)) {
          throw new Error(
            `Uncertain broadcast outcome for step "${entry.step}": recorded INTENT with nonce ${entry.nonce}, but account nonce has advanced to ${currentNonce}. Stopping deployment to prevent duplicate broadcasts or state corruption.`
          );
        }
      }
    }
  }

  // 5. Reconcile recorded steps: any step marked COMPLETED without a verified mined receipt in journal is UNVERIFIED
  for (const [stepKey, stepVal] of Object.entries(manifest.steps)) {
    if (stepVal?.status === 'COMPLETED' && !verifiedMinedSteps.has(stepKey)) {
      unverifiedSteps.push(stepKey);
      manifest.steps[stepKey].status = 'UNVERIFIED';
      manifest.steps[stepKey].provenance = 'UNVERIFIED_ALLOWANCE';
    }
  }

  return {
    manifest,
    incurredGasWei,
    unverifiedSteps
  };
}

export async function runDeploy({
  rpcUrl = process.env.ARC_RPC_URL || process.env.RPC_URL || ARC_TESTNET_RPC,
  privateKey = null,
  address = null,
  preflightOnly = false,
  isLocal = false,
  dryRun = false,
  autoFund = true,
  manifestPath = path.resolve('deployments/demo-manifest.json'),
  planPath = path.resolve('deployments/unsigned-launch-plan.json'),
  testFailureHook = null
} = {}) {
  const safeRpcUrl = redactRpcUrl(rpcUrl);
  console.log('--- THELEMA Demo Deployment & Seeding Preflight ---');
  const commit = getGitCommit();
  console.log(`Source Commit: ${commit}`);
  console.log(`RPC Endpoint: ${safeRpcUrl}`);

  // Boundary check: require explicit local selection AND verified loopback node identity
  const isExplicitLocal = Boolean(isLocal || process.env.THELEMA_LOCAL === 'true' || (process.argv && process.argv.includes('--local')));
  const isLoopback = isLocalRpc(rpcUrl);

  if (isExplicitLocal && !isLoopback) {
    throw new Error('Safety violation: isLocal=true specified but RPC endpoint is not a loopback address. Refusing to classify remote RPC as local development node.');
  }

  // Local-dev exemption applies ONLY when explicitly selected AND verified to be loopback
  const isLocalDev = isExplicitLocal && isLoopback;

  const transport = http(rpcUrl);
  const client = createPublicClient({ transport });

  // 1. Enforce Chain ID 5042002 on EVERY target before any writes
  let chainId;
  try {
    chainId = await client.getChainId();
  } catch (err) {
    const cleanErr = sanitizeRpcError(err);
    console.error(`Failed to connect to RPC at ${safeRpcUrl}: ${cleanErr.message}`);
    if (isLoopback) {
      console.log('Please ensure local Anvil or node is running (e.g. anvil --chain-id 5042002)');
    }
    throw cleanErr;
  }

  console.log(`Connected to Chain ID: ${chainId}`);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Unsupported chain ID ${chainId}. THELEMA operations are strictly restricted to chain ${ARC_CHAIN_ID} (Arc Testnet / local Arc fork).`);
  }

  // Unified Market Specification & Small-Budget Fractional Profile
  const cap6 = 500_000_000n; // $500.00
  const defaultEventOffset = isLocalDev ? 3600 : 86400; // 1h local, 24h public
  const defaultCutoffOffset = isLocalDev ? 7200 : 172800; // 2h local, 48h public
  const eventDeadlineOffset = Number(process.env.DEMO_CALENDAR_EVENT_OFFSET || defaultEventOffset);
  const cutoffOffset = Number(process.env.DEMO_CALENDAR_CUTOFF_OFFSET || defaultCutoffOffset);
  const earliestPriceFixOffset = Number(process.env.DEMO_CALENDAR_PRICE_FIX_OFFSET || cutoffOffset);

  const budgetProfile = {
    capUSD: '$500.00',
    cap6: 500_000_000,
    binarySplitUSDC: '20.00 USDC (collateral)',
    binarySplit6: 20_000_000n,
    binarySeedTokens18: 10n * 10n ** 18n, // 10 YES + 10 NO into pool
    shareSplitUSDC: '50.00 USDC (collateral)',
    shareSplit6: 50_000_000n,
    shareSplitSets18: 100_000_000_000_000_000n, // 0.1 complete sets
    yesShareSeedUSDC: '11.655 USDC (collateral)',
    yesShareSeed6: 11_655_000n,
    yesShareSeedShares18: 100_000_000_000_000_000n, // 0.1 yesShare ($116.55 implied initial price)
    noShareSeedUSDC: '4.366 USDC (collateral)',
    noShareSeed6: 4_366_000n,
    noShareSeedShares18: 100_000_000_000_000_000n, // 0.1 noShare ($43.66 implied initial price)
    totalUSDCRequired: '86.021 USDC (collateral)',
    totalUSDCRequired6: 86_021_000n,
    proposedCeilingUSDC: `${process.env.PROPOSED_CEILING_USDC || '100'}.00 USDC (total collateral + dynamic gas budget)`,
    deployerRetains: '10 YES, 10 NO, 0.1 residualShare (R max payout $50.00: R <= q * cap), LP tokens'
  };

  const ESTIMATED_GAS = {
    oracle: 600_000n,
    binaryVault: 2_000_000n,
    shareVault: 3_200_000n,
    binaryAmm: 1_800_000n,
    yesShareAmm: 1_700_000n,
    noShareAmm: 1_700_000n,
    approve_usdc_bin_split: 100_000n,
    binary_split: 350_000n,
    approve_yes_bin_amm: 100_000n,
    approve_no_bin_amm: 100_000n,
    binary_seed: 350_000n,
    approve_usdc_share_split: 100_000n,
    share_split: 350_000n,
    approve_usdc_yes_amm: 100_000n,
    approve_yes_share_amm: 100_000n,
    yes_share_seed: 350_000n,
    approve_usdc_no_amm: 100_000n,
    approve_no_share_amm: 100_000n,
    no_share_seed: 350_000n
  };

  const ceilingUsdc = BigInt(process.env.PROPOSED_CEILING_USDC || 100);
  const PROPOSED_CEILING_USDC_WEI = ceilingUsdc * 10n ** 18n;

  // Resolve target address and address-only preflight mode
  let targetAddress = address;
  if (!targetAddress && typeof process !== 'undefined' && process.argv) {
    const idx = process.argv.indexOf('--address');
    if (idx !== -1 && process.argv[idx + 1]) {
      targetAddress = process.argv[idx + 1];
    } else {
      const eqArg = process.argv.find(a => a.startsWith('--address='));
      if (eqArg) targetAddress = eqArg.split('=')[1];
    }
  }

  const isAddressOnly = Boolean(
    targetAddress ||
    preflightOnly ||
    (typeof process !== 'undefined' && process.argv && (
      process.argv.includes('--address') ||
      process.argv.some(a => a.startsWith('--address=')) ||
      process.argv.includes('--preflight')
    ))
  );

  // =========================================================================
  // UNCONDITIONALLY READ-ONLY ADDRESS PREFLIGHT MODE
  // =========================================================================
  if (isAddressOnly) {
    if (!targetAddress) {
      throw new Error('Address-only preflight mode requires a public 20-byte hex address (e.g. --address 0x...). Private key derivation is strictly prohibited in read-only preflight mode.');
    }
    if (typeof targetAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(targetAddress)) {
      throw new Error(`Invalid address for preflight: "${targetAddress}". Must be a valid 20-byte hex address (0x...).`);
    }

    console.log('\n======================================================');
    console.log('--- ADDRESS-ONLY FUNDING PREFLIGHT (READ-ONLY MODE) ---');
    console.log('======================================================');
    console.log(`Target Public Address: ${targetAddress}`);
    console.log('Note: Unconditionally read-only. No keys accessed, no signers created, no transactions broadcast, no manifest writes.');

    // In-memory view of manifest via shared reconciliation (do NOT write to disk)
    const manifestRaw = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null;
    const { manifest: inMemoryManifest, incurredGasWei, unverifiedSteps } = await validateAndReconcileManifest({
      manifestRaw,
      manifestPath,
      client,
      expectedOwner: targetAddress,
      chainId
    });

    // Incurred collateral & gas
    let incurredCollateral6 = 0n;
    if (inMemoryManifest.steps?.binary_split?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.binarySplit6;
    if (inMemoryManifest.steps?.share_split?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.shareSplit6;
    if (inMemoryManifest.steps?.yes_share_seed?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.yesShareSeed6;
    if (inMemoryManifest.steps?.no_share_seed?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.noShareSeed6;
    const incurredCollateralWei = incurredCollateral6 * 10n ** 12n;

    let effectiveGasPrice;
    try {
      effectiveGasPrice = await client.getGasPrice();
      if (typeof effectiveGasPrice !== 'bigint' || effectiveGasPrice <= 0n) {
        throw new Error(`Non-positive gas price: ${effectiveGasPrice}`);
      }
    } catch (err) {
      throw new Error(`Failed to retrieve gas price from RPC (${safeRpcUrl}): ${err.message}. Refusing to guess gas price.`);
    }

    const incurredSpendingWei = incurredCollateralWei + incurredGasWei;

    // Remaining collateral
    let remainingCollateral6 = 0n;
    if (inMemoryManifest.steps?.binary_split?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.binarySplit6;
    if (inMemoryManifest.steps?.share_split?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.shareSplit6;
    if (inMemoryManifest.steps?.yes_share_seed?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.yesShareSeed6;
    if (inMemoryManifest.steps?.no_share_seed?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.noShareSeed6;
    const remainingCollateralWei = remainingCollateral6 * 10n ** 12n;

    // Remaining gas units & honest provenance
    let remainingGasUnits = 0n;
    const gasProvenance = [];
    for (const [stepKey, units] of Object.entries(ESTIMATED_GAS)) {
      if (inMemoryManifest.steps?.[stepKey]?.status === 'COMPLETED') {
        const rcptGas = inMemoryManifest.steps[stepKey].receipt?.gasUsed;
        gasProvenance.push({
          step: stepKey,
          status: 'COMPLETED',
          provenance: 'MINED_RECEIPT',
          gasUnits: rcptGas || units.toString(),
          notes: `Mined on-chain (block ${inMemoryManifest.steps[stepKey].receipt?.blockNumber || 'unknown'})`
        });
      } else if (inMemoryManifest.steps?.[stepKey]?.status === 'UNVERIFIED') {
        // UNVERIFIED_ALLOWANCE is uncertainty, not zero past gas: retain in remaining budget
        remainingGasUnits += units;
        gasProvenance.push({
          step: stepKey,
          status: 'UNVERIFIED',
          provenance: 'UNVERIFIED_ALLOWANCE',
          gasUnits: units.toString(),
          notes: 'Completed step lacks verified on-chain receipt in journal; conservatively retained in remaining gas budget'
        });
      } else {
        remainingGasUnits += units;
        gasProvenance.push({
          step: stepKey,
          status: 'PENDING',
          provenance: 'CONSERVATIVE_ALLOWANCE',
          gasUnits: units.toString(),
          notes: 'Conservative allowance for undeployed contract dependency based on Foundry execution traces'
        });
      }
    }

    const safetyReserveUnits = (remainingGasUnits * 30n) / 100n;
    const totalGasUnitsWithReserve = remainingGasUnits + safetyReserveUnits;
    const remainingGasBudgetWei = totalGasUnitsWithReserve * effectiveGasPrice;
    const remainingRequiredFundsWei = remainingCollateralWei + remainingGasBudgetWei;

    // Total planned spending vs proposed ceiling
    const totalPlannedSpendingWei = incurredSpendingWei + remainingRequiredFundsWei;
    const isCeilingExceeded = totalPlannedSpendingWei > PROPOSED_CEILING_USDC_WEI;

    // Read on-chain balances
    const nativeBalance = await client.getBalance({ address: targetAddress });
    let collateralBalance = 0n;
    try {
      collateralBalance = await client.readContract({
        address: ARC_USDC,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [targetAddress]
      });
    } catch {
      collateralBalance = 0n;
    }

    const isNativeFunded = nativeBalance >= remainingRequiredFundsWei;
    const isCollateralFunded = collateralBalance >= remainingCollateral6;
    const isFunded = isNativeFunded && isCollateralFunded;
    const nativeSurplusOrShortfallWei = nativeBalance >= remainingRequiredFundsWei ? nativeBalance - remainingRequiredFundsWei : remainingRequiredFundsWei - nativeBalance;
    const collateralSurplusOrShortfall6 = collateralBalance >= remainingCollateral6 ? collateralBalance - remainingCollateral6 : remainingCollateral6 - collateralBalance;

    console.log(`\n--- Preflight Summary for ${targetAddress} ---`);
    console.log(`Selected Chain: ${chainId} (Arc Testnet)`);
    console.log(`Current Native Balance (USDC gas, 18-dec): ${formatUnits(nativeBalance, 18)} USDC`);
    console.log(`Current Collateral Balance (USDC ERC-20, 6-dec): ${formatUnits(collateralBalance, 6)} USDC`);
    console.log(`\n--- Remaining Requirements ---`);
    console.log(`Remaining Collateral: ${formatUnits(remainingCollateral6, 6)} USDC`);
    console.log(`Remaining Gas Units (base): ${remainingGasUnits.toLocaleString()} gas`);
    console.log(`Safety Reserve (30%): ${safetyReserveUnits.toLocaleString()} gas`);
    console.log(`Total Gas Units with Reserve: ${totalGasUnitsWithReserve.toLocaleString()} gas`);
    console.log(`Effective Gas Price: ${effectiveGasPrice} wei (${formatUnits(effectiveGasPrice, 9)} gwei)`);
    console.log(`Dynamic Gas Budget: ${formatUnits(remainingGasBudgetWei, 18)} USDC`);
    console.log(`Total Required Funds: ${formatUnits(remainingRequiredFundsWei, 18)} USDC`);
    console.log(`\n--- Proposed 100.00 USDC Spending Ceiling Check ---`);
    console.log(`Proposed Hard Ceiling: 100.00 USDC`);
    console.log(`Incurred Spending (collateral + gas): ${formatUnits(incurredSpendingWei, 18)} USDC`);
    console.log(`Remaining Spending (collateral + gas): ${formatUnits(remainingRequiredFundsWei, 18)} USDC`);
    console.log(`Total Planned Deployment Spending: ${formatUnits(totalPlannedSpendingWei, 18)} USDC`);
    console.log(`Ceiling Status: ${isCeilingExceeded ? 'EXCEEDED (Action Required)' : 'WITHIN CEILING (OK)'}`);
    console.log(`\n--- Funding Status ---`);
    console.log(`Native Balance Status: ${isNativeFunded ? `SURPLUS (+${formatUnits(nativeSurplusOrShortfallWei, 18)} USDC)` : `SHORTFALL (-${formatUnits(nativeSurplusOrShortfallWei, 18)} USDC)`}`);
    console.log(`Collateral Balance Status: ${isCollateralFunded ? `SURPLUS (+${formatUnits(collateralSurplusOrShortfall6, 6)} USDC)` : `SHORTFALL (-${formatUnits(collateralSurplusOrShortfall6, 6)} USDC)`}`);
    console.log(`\n--- Preflight Verification Categories ---`);
    console.log(`Funding Readiness:     ${isFunded ? 'READY' : 'INSUFFICIENT'}`);
    console.log(`Deployment Integrity:  ${unverifiedSteps.length === 0 ? 'CLEAN / VERIFIED' : 'UNVERIFIED_STEPS_DETECTED'}`);
    console.log(`Owner Authorization:   REQUIRED_FOR_BROADCAST (Preflight is strictly read-only; releaseApproved=false)`);
    console.log(`Overall Readiness:     ${isFunded && !isCeilingExceeded ? 'READY FOR DEPLOYMENT' : 'ACTION REQUIRED BEFORE BROADCAST'}`);

    return {
      mode: 'ADDRESS_ONLY_PREFLIGHT',
      status: isFunded && !isCeilingExceeded ? 'READY' : 'ACTION_REQUIRED',
      address: targetAddress,
      chainId,
      rpcUrl: safeRpcUrl,
      readiness: {
        fundingReadiness: isFunded ? 'READY' : 'INSUFFICIENT',
        deploymentIntegrity: unverifiedSteps.length === 0 ? 'CLEAN' : 'UNVERIFIED_STEPS_DETECTED',
        ownerAuthorization: 'REQUIRED_FOR_BROADCAST'
      },
      balances: {
        nativeUSDCWei: nativeBalance.toString(),
        nativeUSDCFormatted: formatUnits(nativeBalance, 18),
        collateralUSDC6: collateralBalance.toString(),
        collateralUSDCFormatted: formatUnits(collateralBalance, 6)
      },
      remainingRequirements: {
        collateral6: remainingCollateral6.toString(),
        collateralFormatted: `${formatUnits(remainingCollateral6, 6)} USDC`,
        gasUnits: remainingGasUnits.toString(),
        safetyReserveUnits: safetyReserveUnits.toString(),
        totalGasUnitsWithReserve: totalGasUnitsWithReserve.toString(),
        effectiveGasPriceWei: effectiveGasPrice.toString(),
        gasBudgetWei: remainingGasBudgetWei.toString(),
        gasBudgetFormatted: `${formatUnits(remainingGasBudgetWei, 18)} USDC`,
        totalRequiredFundsWei: remainingRequiredFundsWei.toString(),
        totalRequiredFundsFormatted: `${formatUnits(remainingRequiredFundsWei, 18)} USDC`
      },
      spendingCeiling: {
        proposedCeilingWei: PROPOSED_CEILING_USDC_WEI.toString(),
        proposedCeilingFormatted: '100.00 USDC',
        incurredCollateralWei: incurredCollateralWei.toString(),
        incurredGasWei: incurredGasWei.toString(),
        incurredTotalWei: incurredSpendingWei.toString(),
        incurredTotalFormatted: `${formatUnits(incurredSpendingWei, 18)} USDC`,
        remainingTotalWei: remainingRequiredFundsWei.toString(),
        remainingTotalFormatted: `${formatUnits(remainingRequiredFundsWei, 18)} USDC`,
        totalPlannedSpendingWei: totalPlannedSpendingWei.toString(),
        totalPlannedSpendingFormatted: `${formatUnits(totalPlannedSpendingWei, 18)} USDC`,
        isCeilingExceeded
      },
      fundingCheck: {
        isFunded,
        isNativeFunded,
        isCollateralFunded,
        nativeSurplusOrShortfallWei: nativeSurplusOrShortfallWei.toString(),
        nativeSurplusOrShortfallFormatted: `${formatUnits(nativeSurplusOrShortfallWei, 18)} USDC (${isNativeFunded ? 'SURPLUS' : 'SHORTFALL'})`,
        collateralSurplusOrShortfall6: collateralSurplusOrShortfall6.toString(),
        collateralSurplusOrShortfallFormatted: `${formatUnits(collateralSurplusOrShortfall6, 6)} USDC (${isCollateralFunded ? 'SURPLUS' : 'SHORTFALL'})`
      },
      gasProvenance
    };
  }

  function buildUnsignedPlan(planGasBudgetWei = 0n) {
    return {
      status: 'PENDING_APPROVAL',
      timestamp: new Date().toISOString(),
      network: {
        name: isLocalDev ? 'Local EVM (Anvil)' : 'Arc Testnet',
        chainId: ARC_CHAIN_ID,
        rpcUrl: safeRpcUrl,
        explorer: 'https://testnet.arcscan.app',
        usdcCollateralPrecompile: ARC_USDC,
        gasCurrency: 'USDC (gas) [18 decimals native]'
      },
      sourceCommit: commit,
      marketSpecification: {
        title: 'NVDA US-China Semiconductor Export Restrictions (Synthetic Demo)',
        description: 'Will US export policy restrict advanced GPU shipments further before deadline?',
        cap6: Number(cap6),
        capUSD: budgetProfile.capUSD,
        feeBps: 30,
        syntheticDemoCalendar: {
          eventOffsetSec: eventDeadlineOffset,
          cutoffOffsetSec: cutoffOffset,
          earliestPriceFixOffsetSec: earliestPriceFixOffset
        }
      },
      budgetRequirements: {
        proposedCeiling: '100.00 USDC (proposed hard maximum ceiling for collateral + dynamic gas budget)',
        totalCollateralRequired: budgetProfile.totalUSDCRequired,
        dynamicGasBudgetEstimate: planGasBudgetWei > 0n ? `${formatUnits(planGasBudgetWei, 18)} USDC (dynamic gas estimate with 30% safety reserve)` : 'Calculated dynamically via preflight based on active RPC gas price and 30% safety reserve',
        breakdown: {
          binarySplit: '20.00 USDC (collateral) -> 20 YES + 20 NO; seeds pool with 10 YES + 10 NO',
          shareSplit: '50.00 USDC (collateral) -> 0.1 complete sets (0.1 yes, 0.1 no, 0.1 residual)',
          yesSharePool: '11.655 USDC (collateral) + 0.1 yesShare ($116.55 initial implied price)',
          noSharePool: '4.366 USDC (collateral) + 0.1 noShare ($43.66 initial implied price)',
          ownerReserve: budgetProfile.deployerRetains
        }
      },
      ownerActionRequired: [
        '1. Run read-only preflight: node scripts/deploy-demo.mjs --address <approved-wallet-address>',
        '2. Confirm wallet balance satisfies total required funds under 100.00 USDC ceiling.',
        '3. Provide ephemeral credentials securely (interactive prompt or session env; never commit or store in persistent shell history):',
        '   - APPROVED_DEPLOYER_ADDRESS=<approved-wallet-address>',
        '   - RELEASE_APPROVED=true',
        '   - DEPLOYER_KEY=<approved-private-key>',
        '4. Execute deployment: npm run deploy:demo'
      ]
    };
  }

  // Safety boundaries check: any execution outside verified explicit local dev requires RELEASE_APPROVED
  // Safety boundaries check: any execution outside verified explicit local dev requires RELEASE_APPROVED
  if (!isLocalDev) {
    console.log('\n[SAFETY ENFORCEMENT: Non-Local Development Target]');
    const candidateKey = privateKey || process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
    if (candidateKey && candidateKey.toLowerCase() === ANVIL_DEV_KEY.toLowerCase()) {
      throw new Error('SAFETY VIOLATION: Anvil development key cannot be used outside explicit local development!');
    }
    const releaseApproved = process.env.RELEASE_APPROVED === 'true';
    if (!releaseApproved || dryRun || !candidateKey) {
      console.log('SAFETY ENFORCEMENT: Public / non-local deployment requires explicit approval (RELEASE_APPROVED=true) and an approved private key.');
      console.log('Generating Unsigned Launch Plan & Preflight Assessment...\n');

      let currentGasPrice = 0n;
      try {
        currentGasPrice = await client.getGasPrice();
      } catch {}
      const totalUnits = Object.values(ESTIMATED_GAS).reduce((a, b) => a + b, 0n);
      const withReserve = totalUnits + (totalUnits * 30n) / 100n;
      const dynamicGasWei = currentGasPrice > 0n ? withReserve * currentGasPrice : 0n;

      const plan = buildUnsignedPlan(dynamicGasWei);
      mkdirSync(path.dirname(planPath), { recursive: true });
      writeFileSync(planPath, JSON.stringify(plan, null, 2));
      console.log(`Unsigned launch plan written to: ${planPath}`);
      return plan;
    }
  }

  // Dry run check on every target (read-only)
  if (dryRun) {
    console.log('\n[DRY RUN REQUESTED: Read-only mode across all targets]');
    let currentGasPrice = 0n;
    try {
      currentGasPrice = await client.getGasPrice();
    } catch {}
    const totalUnits = Object.values(ESTIMATED_GAS).reduce((a, b) => a + b, 0n);
    const withReserve = totalUnits + (totalUnits * 30n) / 100n;
    const dynamicGasWei = currentGasPrice > 0n ? withReserve * currentGasPrice : 0n;

    const plan = buildUnsignedPlan(dynamicGasWei);
    mkdirSync(path.dirname(planPath), { recursive: true });
    writeFileSync(planPath, JSON.stringify(plan, null, 2));
    console.log(`Unsigned launch plan written to: ${planPath}`);
    return plan;
  }

  // =========================================================================
  // WRITE DEPLOYMENT MODE: Resolve Deployment Keys & Approved Signer
  // =========================================================================
  const resolvedPrivateKey = privateKey || process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
  const effectiveKey = resolvedPrivateKey || (isLocalDev ? ANVIL_DEV_KEY : null);
  if (!effectiveKey) {
    throw new Error('No private key specified. Set DEPLOYER_KEY or PRIVATE_KEY.');
  }

  const account = privateKeyToAccount(effectiveKey);

  // Require an explicit matching approved address for non-local writes
  if (!isLocalDev) {
    const approvedAddress = process.env.APPROVED_DEPLOYER_ADDRESS;
    if (!approvedAddress) {
      throw new Error('Safety violation: Non-local deployment requires an explicit APPROVED_DEPLOYER_ADDRESS in environment.');
    }
    if (approvedAddress.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`Safety violation: signer address ${account.address} does not match APPROVED_DEPLOYER_ADDRESS ${approvedAddress}`);
    }
  } else if (process.env.APPROVED_DEPLOYER_ADDRESS) {
    if (process.env.APPROVED_DEPLOYER_ADDRESS.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`Safety violation: signer address ${account.address} does not match APPROVED_DEPLOYER_ADDRESS ${process.env.APPROVED_DEPLOYER_ADDRESS}`);
    }
  }

  // Verified local node identity check: fail closed on loopback proxies that cannot be verified as Anvil
  if (isLocalDev) {
    await verifyLocalNodeIdentity(client);
  }

  const wallet = createWalletClient({ account, transport });
  console.log(`Deployer Address: ${account.address}`);

  // Load contract artifacts
  console.log('\nLoading contract artifacts...');
  const oracleArtifact = loadArtifact('DemoOracle');
  const binVaultArtifact = loadArtifact('BinaryVault');
  const shareVaultArtifact = loadArtifact('ShareVault');
  const binAmmArtifact = loadArtifact('BinaryAMM');
  const shareAmmArtifact = loadArtifact('ShareAMM');
  const mockUsdcArtifact = loadArtifact('MockUSDC');

  // Check or inject MockUSDC at Arc precompile if local
  let usdcCode = await client.getBytecode({ address: ARC_USDC });
  if ((!usdcCode || usdcCode === '0x') && isLocalDev) {
    console.log('Injecting MockUSDC at Arc precompile address on local EVM...');
    await client.request({
      method: 'anvil_setCode',
      params: [ARC_USDC, mockUsdcArtifact.deployedBytecode.object]
    });
    usdcCode = await client.getBytecode({ address: ARC_USDC });
  }

  // Current block timestamp
  const currentBlock = await client.getBlock({ blockTag: 'latest' });
  const blockTime = Number(currentBlock.timestamp);
  console.log(`Current Block Timestamp: ${blockTime} (${new Date(blockTime * 1000).toISOString()})`);

  // Load existing manifest for safe resume & atomic writing
  let manifest = {
    status: 'IN_PROGRESS',
    sourceCommit: commit,
    network: {
      name: isLocalDev ? 'Local EVM (Anvil)' : 'Arc Testnet',
      chainId,
      rpcUrl: safeRpcUrl
    },
    contracts: {},
    timing: {},
    steps: {},
    journal: [],
    owner: account.address
  };

  function persistManifestAtomic() {
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    const tmpFile = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(manifest, null, 2));
    renameSync(tmpFile, manifestPath);
  }

  // Validate existing manifest before reuse using shared reconciliation helper
  const manifestRaw = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null;
  const { manifest: validatedManifest, unverifiedSteps } = await validateAndReconcileManifest({
    manifestRaw,
    manifestPath,
    client,
    expectedOwner: account.address,
    chainId
  });
  if (validatedManifest.status && validatedManifest.status !== 'UNCONFIGURED') {
    manifest.status = validatedManifest.status;
  }
  manifest.contracts = validatedManifest.contracts || {};
  manifest.steps = validatedManifest.steps || {};
  manifest.timing = validatedManifest.timing || {};
  manifest.journal = validatedManifest.journal || [];
  persistManifestAtomic();
  if (unverifiedSteps && unverifiedSteps.length > 0) {
    console.log(`[RECONCILE] Manifest contained unverified completed steps: ${unverifiedSteps.join(', ')}.`);
  } else if (Object.keys(manifest.contracts).length > 0) {
    console.log('Found valid existing manifest. Verified contract identities and receipts on-chain for safe resume.');
  }

  // =========================================================================
  // CRASH RECOVERY: Reconcile Incomplete & Mined Transactions Before Spending
  // =========================================================================
  console.log('\n--- Reconciling Incomplete & Mined Transactions ---');
  if (Array.isArray(manifest.journal) && manifest.journal.length > 0) {
    for (const entry of manifest.journal) {
      if ((entry.status === 'SUBMITTED' || entry.status === 'MINED') && entry.hash) {
        console.log(`[RECONCILE] Checking on-chain status for step "${entry.step}": ${entry.hash}`);
        const existingReceipt = await client.getTransactionReceipt({ hash: entry.hash }).catch(() => null);
        if (existingReceipt) {
          let effectivePrice = existingReceipt.effectiveGasPrice;
          if (!effectivePrice) {
            if (entry.receipt?.effectiveGasPrice) {
              effectivePrice = BigInt(entry.receipt.effectiveGasPrice);
            } else {
              const tx = await client.getTransaction({ hash: entry.hash }).catch(() => null);
              if (tx?.gasPrice) {
                effectivePrice = tx.gasPrice;
              } else {
                throw new Error(`Unresolved historical fee: cannot determine historical gas price for transaction ${entry.hash}. Stopping to preserve spending auditability.`);
              }
            }
          }
          entry.receipt = {
            blockNumber: Number(existingReceipt.blockNumber),
            gasUsed: existingReceipt.gasUsed.toString(),
            effectiveGasPrice: effectivePrice.toString(),
            contractAddress: existingReceipt.contractAddress || entry.receipt?.contractAddress || null
          };

          if (existingReceipt.status === 'success') {
            console.log(`[RECONCILE] Step "${entry.step}" was successfully mined in block ${existingReceipt.blockNumber}.`);
            entry.status = 'MINED';
            manifest.steps[entry.step] = {
              status: 'COMPLETED',
              txHash: entry.hash,
              receipt: entry.receipt,
              contractAddress: existingReceipt.contractAddress || entry.receipt?.contractAddress || null,
              completedAt: manifest.steps[entry.step]?.completedAt || new Date().toISOString()
            };
            if (existingReceipt.contractAddress || entry.receipt?.contractAddress) {
              manifest.contracts[entry.step] = existingReceipt.contractAddress || entry.receipt.contractAddress;
            }
          } else {
            entry.status = 'REVERTED';
            throw new Error(`Previously submitted transaction for "${entry.step}" reverted on-chain: ${entry.hash}`);
          }
        } else {
          // Transaction not yet mined; check mempool
          const pendingTx = await client.getTransaction({ hash: entry.hash }).catch(() => null);
          if (pendingTx) {
            console.log(`[RECONCILE] Transaction ${entry.hash} is pending in mempool. Waiting for confirmation...`);
            const receipt = await client.waitForTransactionReceipt({ hash: entry.hash });
            const pPrice = receipt.effectiveGasPrice || pendingTx.gasPrice;
            entry.receipt = {
              blockNumber: Number(receipt.blockNumber),
              gasUsed: receipt.gasUsed.toString(),
              effectiveGasPrice: (pPrice || null)?.toString(),
              contractAddress: receipt.contractAddress || null
            };
            if (receipt.status !== 'success') {
              entry.status = 'REVERTED';
              throw new Error(`Transaction reverted: ${entry.hash}`);
            }
            entry.status = 'MINED';
            manifest.steps[entry.step] = {
              status: 'COMPLETED',
              txHash: entry.hash,
              receipt: entry.receipt,
              contractAddress: receipt.contractAddress || null,
              completedAt: new Date().toISOString()
            };
            if (receipt.contractAddress) manifest.contracts[entry.step] = receipt.contractAddress;
          } else {
            const currentNonce = await client.getTransactionCount({ address: account.address });
            if (currentNonce > entry.nonce) {
              throw new Error(
                `Uncertain outcome for "${entry.step}": hash ${entry.hash} not found, but account nonce advanced from ${entry.nonce} to ${currentNonce}. Stopping deployment to prevent duplicate broadcasts.`
              );
            }
          }
        }
      } else if (entry.status === 'INTENT') {
        const currentNonce = await client.getTransactionCount({ address: account.address });
        if (currentNonce > entry.nonce) {
          throw new Error(
            `Uncertain broadcast outcome for step "${entry.step}": recorded INTENT with nonce ${entry.nonce}, but account nonce has advanced to ${currentNonce}. Stopping deployment to prevent duplicate broadcasts or state corruption.`
          );
        }
      }
    }
    persistManifestAtomic();
  }

  // =========================================================================
  // REAL FUNDING PREFLIGHT: Dynamic Gas & Remaining Costs Calculation
  // =========================================================================
  console.log('\n--- Real Funding Preflight & Balance Validation ---');

  // 1. Calculate remaining collateral costs
  let remainingCollateral6 = 0n;
  if (manifest.steps?.binary_split?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.binarySplit6;
  if (manifest.steps?.share_split?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.shareSplit6;
  if (manifest.steps?.yes_share_seed?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.yesShareSeed6;
  if (manifest.steps?.no_share_seed?.status !== 'COMPLETED') remainingCollateral6 += budgetProfile.noShareSeed6;

  // 2. Calculate remaining gas units dynamically (including approval transactions)
  let remainingGasUnits = 0n;
  for (const [stepKey, units] of Object.entries(ESTIMATED_GAS)) {
    if (manifest.steps?.[stepKey]?.status !== 'COMPLETED') {
      remainingGasUnits += units;
    }
  }

  // Add 30% safety reserve
  const safetyReserveUnits = (remainingGasUnits * 30n) / 100n;
  const totalGasUnitsWithReserve = remainingGasUnits + safetyReserveUnits;

  let effectiveGasPrice;
  try {
    effectiveGasPrice = await client.getGasPrice();
    if (typeof effectiveGasPrice !== 'bigint' || effectiveGasPrice <= 0n) {
      throw new Error(`Non-positive gas price: ${effectiveGasPrice}`);
    }
  } catch (err) {
    throw new Error(`Failed to retrieve gas price from RPC (${safeRpcUrl}): ${err.message}. Refusing to guess gas price.`);
  }
  const remainingGasBudgetWei = totalGasUnitsWithReserve * effectiveGasPrice;

  // Calculate incurred spending from journal & steps (counting both MINED and REVERTED transactions)
  let incurredGasWei = 0n;
  if (Array.isArray(manifest.journal)) {
    for (const j of manifest.journal) {
      if ((j.status === 'MINED' || j.status === 'REVERTED') && j.receipt?.gasUsed) {
        const gUsed = BigInt(j.receipt.gasUsed);
        let gPrice;
        if (j.receipt.effectiveGasPrice) {
          gPrice = BigInt(j.receipt.effectiveGasPrice);
        } else if (j.hash) {
          const tx = await client.getTransaction({ hash: j.hash }).catch(() => null);
          if (tx?.gasPrice) {
            gPrice = tx.gasPrice;
          } else {
            throw new Error(`Unresolved historical fee: cannot determine historical gas price for transaction ${j.hash}. Stopping to preserve spending auditability.`);
          }
        } else {
          throw new Error(`Unresolved spending history: missing receipt and hash for step ${j.step}. Stopping deployment.`);
        }
        incurredGasWei += gUsed * gPrice;
      } else if (j.status === 'MINED' || j.status === 'REVERTED') {
        throw new Error(`Unresolved spending history: missing receipt for step ${j.step}. Stopping deployment.`);
      }
    }
  }

  let incurredCollateral6 = 0n;
  if (manifest.steps?.binary_split?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.binarySplit6;
  if (manifest.steps?.share_split?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.shareSplit6;
  if (manifest.steps?.yes_share_seed?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.yesShareSeed6;
  if (manifest.steps?.no_share_seed?.status === 'COMPLETED') incurredCollateral6 += budgetProfile.noShareSeed6;
  const incurredCollateralWei = incurredCollateral6 * 10n ** 12n;
  const incurredSpendingWei = incurredCollateralWei + incurredGasWei;

  const requiredCollateralNativeWei = remainingCollateral6 * 10n ** 12n;
  const totalRequiredNativeWei = requiredCollateralNativeWei + remainingGasBudgetWei;
  const totalPlannedSpendingWei = incurredSpendingWei + totalRequiredNativeWei;

  console.log(`Remaining Gas Units (with 30% safety reserve): ${totalGasUnitsWithReserve.toLocaleString()} gas`);
  console.log(`Effective Gas Price: ${effectiveGasPrice} wei (${formatUnits(effectiveGasPrice, 9)} gwei)`);
  console.log(`Required USDC (gas budget) [native, 18-dec]: ${formatUnits(remainingGasBudgetWei, 18)} USDC`);
  console.log(`Required USDC (collateral) [ERC-20, 6-dec]: ${formatUnits(remainingCollateral6, 6)} USDC`);
  console.log(`Incurred Spending (collateral + gas): ${formatUnits(incurredSpendingWei, 18)} USDC`);
  console.log(`Total Planned Spending (incurred + remaining): ${formatUnits(totalPlannedSpendingWei, 18)} USDC`);

  // Gas Provenance Reporting
  console.log('\n--- Gas Estimates & Provenance Breakdown ---');
  for (const [stepKey, units] of Object.entries(ESTIMATED_GAS)) {
    if (manifest.steps?.[stepKey]?.status === 'COMPLETED') {
      const rcptGas = manifest.steps[stepKey].receipt?.gasUsed;
      if (rcptGas) {
        console.log(`  - ${stepKey.padEnd(26)}: ${rcptGas.padStart(9)} gas [MINED_RECEIPT] (block ${manifest.steps[stepKey].receipt?.blockNumber || 'unknown'})`);
      } else {
        console.log(`  - ${stepKey.padEnd(26)}: ${units.toString().padStart(9)} gas [UNVERIFIED_ALLOWANCE] (receipt missing on-chain)`);
      }
    } else {
      console.log(`  - ${stepKey.padEnd(26)}: ${units.toString().padStart(9)} gas [CONSERVATIVE_ALLOWANCE] (undeployed dependency, Foundry trace)`);
    }
  }

  // Enforce proposed 100.00 USDC hard ceiling
  if (totalPlannedSpendingWei > PROPOSED_CEILING_USDC_WEI) {
    throw new Error(
      `Proposed deployment spending ceiling exceeded: planned total is ${formatUnits(totalPlannedSpendingWei, 18)} USDC, which exceeds the proposed ceiling of 100.00 USDC (incurred: ${formatUnits(incurredSpendingWei, 18)} USDC, remaining: ${formatUnits(totalRequiredNativeWei, 18)} USDC). Deployment halted before transaction broadcast.`
    );
  }

  // Read current balances
  const nativeBalance = await client.getBalance({ address: account.address });

  // Read ERC-20 precompile balance through callable interface; do not assume empty bytecode means unavailable
  let collateralBalance;
  try {
    collateralBalance = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    });
  } catch (err) {
    if (isLocalDev) {
      console.log('Local EVM: Injecting MockUSDC at Arc precompile address...');
      await client.request({
        method: 'anvil_setCode',
        params: [ARC_USDC, mockUsdcArtifact.deployedBytecode.object]
      });
      try {
        collateralBalance = await client.readContract({
          address: ARC_USDC,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [account.address]
        });
      } catch (retryErr) {
        throw new Error(`Failed to read USDC balance from precompile ${ARC_USDC}: ${retryErr.message}`);
      }
    } else {
      throw new Error(`Failed to read USDC balance from precompile ${ARC_USDC}: ${err.message}`);
    }
  }

  console.log(`Current USDC (native gas/currency) Balance: ${formatUnits(nativeBalance, 18)} USDC`);
  console.log(`Current USDC (ERC-20 precompile) Balance: ${formatUnits(collateralBalance, 6)} USDC`);

  // Local EVM autofund only if enabled and needed
  if (isLocalDev && autoFund && collateralBalance < remainingCollateral6) {
    console.log('Local EVM: Minting test USDC collateral to deployer...');
    const mintHash = await wallet.writeContract({
      address: ARC_USDC,
      abi: mockUsdcArtifact.abi,
      functionName: 'mint',
      args: [account.address, 10_000_000_000n]
    });
    await client.waitForTransactionReceipt({ hash: mintHash });
    collateralBalance = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address]
    });
    console.log(`Updated USDC (collateral) Balance: ${formatUnits(collateralBalance, 6)} USDC`);
  }

  // Strict preflight validation: single native balance must cover both collateral and gas budget
  if (nativeBalance < totalRequiredNativeWei) {
    throw new Error(
      `Insufficient single native USDC balance: have ${formatUnits(nativeBalance, 18)} USDC, require at least ${formatUnits(totalRequiredNativeWei, 18)} USDC (${formatUnits(requiredCollateralNativeWei, 18)} collateral + ${formatUnits(remainingGasBudgetWei, 18)} gas budget with 30% safety reserve). On Arc, native USDC and ERC20 USDC share the same underlying balance.`
    );
  }

  if (collateralBalance < remainingCollateral6) {
    throw new Error(
      `Insufficient USDC (collateral) balance: have ${formatUnits(collateralBalance, 6)} USDC, require at least ${formatUnits(remainingCollateral6, 6)} USDC for remaining operations.`
    );
  }

  console.log('Funding preflight validation passed! Ready to proceed.');

  // =========================================================================
  // CRASH-SAFE TRANSACTION EXECUTION WITH ATOMIC JOURNALING
  // =========================================================================
  async function executeWithJournal(stepKey, description, sendAction) {
    if (manifest.steps[stepKey]?.status === 'COMPLETED') {
      console.log(`[RESUME] Step "${stepKey}" (${description}) already completed on-chain.`);
      return manifest.steps[stepKey];
    }

    // Check if journal has an existing active attempt (ignore previously reverted attempts)
    let entry = manifest.journal.find(j => j.step === stepKey && j.status !== 'REVERTED');
    if (entry && (entry.status === 'SUBMITTED' || entry.status === 'MINED') && entry.hash) {
      console.log(`[RECONCILE] Found previously recorded transaction for "${stepKey}": ${entry.hash}`);
      const existingReceipt = await client.getTransactionReceipt({ hash: entry.hash }).catch(() => null);
      if (existingReceipt) {
        let effectivePrice = existingReceipt.effectiveGasPrice;
        if (!effectivePrice) {
          if (entry.receipt?.effectiveGasPrice) {
            effectivePrice = BigInt(entry.receipt.effectiveGasPrice);
          } else {
            const tx = await client.getTransaction({ hash: entry.hash }).catch(() => null);
            if (tx?.gasPrice) {
              effectivePrice = tx.gasPrice;
            } else {
              throw new Error(`Unresolved historical fee: cannot determine historical gas price for transaction ${entry.hash}. Stopping to preserve spending auditability.`);
            }
          }
        }
        entry.receipt = {
          blockNumber: Number(existingReceipt.blockNumber),
          gasUsed: existingReceipt.gasUsed.toString(),
          effectiveGasPrice: effectivePrice.toString(),
          contractAddress: existingReceipt.contractAddress || entry.receipt?.contractAddress || null
        };
        if (existingReceipt.status === 'success') {
          console.log(`[RECONCILE] Transaction ${entry.hash} was successfully mined in block ${existingReceipt.blockNumber}.`);
          entry.status = 'MINED';
          manifest.steps[stepKey] = {
            status: 'COMPLETED',
            txHash: entry.hash,
            receipt: entry.receipt,
            contractAddress: existingReceipt.contractAddress || entry.receipt?.contractAddress || null,
            completedAt: manifest.steps[stepKey]?.completedAt || new Date().toISOString()
          };
          if (existingReceipt.contractAddress || entry.receipt?.contractAddress) {
            manifest.contracts[stepKey] = existingReceipt.contractAddress || entry.receipt.contractAddress;
          }
          persistManifestAtomic();
          return manifest.steps[stepKey];
        } else {
          entry.status = 'REVERTED';
          persistManifestAtomic();
          throw new Error(`Previously submitted transaction for "${stepKey}" reverted on-chain: ${entry.hash}`);
        }
      } else {
        const pendingTx = await client.getTransaction({ hash: entry.hash }).catch(() => null);
        if (pendingTx) {
          console.log(`[RECONCILE] Transaction ${entry.hash} is pending in mempool. Waiting for confirmation...`);
          const receipt = await client.waitForTransactionReceipt({ hash: entry.hash });
          const pPrice = receipt.effectiveGasPrice || pendingTx.gasPrice;
          entry.receipt = {
            blockNumber: Number(receipt.blockNumber),
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: (pPrice || 0n).toString(),
            contractAddress: receipt.contractAddress || null
          };
          if (receipt.status !== 'success') {
            entry.status = 'REVERTED';
            persistManifestAtomic();
            throw new Error(`Transaction reverted: ${entry.hash}`);
          }
          entry.status = 'MINED';
          manifest.steps[stepKey] = {
            status: 'COMPLETED',
            txHash: entry.hash,
            receipt: entry.receipt,
            contractAddress: receipt.contractAddress || null,
            completedAt: new Date().toISOString()
          };
          if (receipt.contractAddress) {
            manifest.contracts[stepKey] = receipt.contractAddress;
          }
          persistManifestAtomic();
          return manifest.steps[stepKey];
        } else {
          const currentNonce = await client.getTransactionCount({ address: account.address });
          if (currentNonce > entry.nonce) {
            throw new Error(
              `Uncertain outcome for "${stepKey}": hash ${entry.hash} not found, but account nonce advanced from ${entry.nonce} to ${currentNonce}. Stopping deployment to prevent duplicate broadcasts.`
            );
          }
          console.log(`[RECONCILE] Transaction ${entry.hash} was dropped without nonce advancement. Retrying step.`);
        }
      }
    }

    if (entry && entry.status === 'INTENT') {
      const currentNonce = await client.getTransactionCount({ address: account.address });
      if (currentNonce > entry.nonce) {
        throw new Error(
          `Uncertain broadcast outcome for step "${stepKey}": recorded INTENT with nonce ${entry.nonce}, but account nonce has advanced to ${currentNonce}. Stopping deployment to prevent duplicate broadcasts or state corruption.`
        );
      }
    }

    // Dynamic pre-broadcast budget recheck & ceiling enforcement
    let curGasPrice;
    try {
      curGasPrice = await client.getGasPrice();
      if (typeof curGasPrice !== 'bigint' || curGasPrice <= 0n) {
        throw new Error(`Non-positive gas price: ${curGasPrice}`);
      }
    } catch (err) {
      throw new Error(`Failed to retrieve current gas price before broadcasting "${stepKey}": ${err.message}. Halting to prevent unpriced broadcast.`);
    }

    // Cumulative incurred spending from journal (both MINED and REVERTED transactions)
    let liveIncurredGasWei = 0n;
    for (const j of manifest.journal) {
      if ((j.status === 'MINED' || j.status === 'REVERTED') && j.receipt?.gasUsed) {
        const gUsed = BigInt(j.receipt.gasUsed);
        let gPrice;
        if (j.receipt.effectiveGasPrice) {
          gPrice = BigInt(j.receipt.effectiveGasPrice);
        } else if (j.hash) {
          const tx = await client.getTransaction({ hash: j.hash }).catch(() => null);
          if (tx?.gasPrice) {
            gPrice = tx.gasPrice;
          } else {
            throw new Error(`Unresolved historical fee for transaction ${j.hash} in step ${j.step}. Halting before broadcast.`);
          }
        } else {
          throw new Error(`Unresolved spending history for step ${j.step}. Halting before broadcast.`);
        }
        liveIncurredGasWei += gUsed * gPrice;
      }
    }

    let liveIncurredCollateral6 = 0n;
    if (manifest.steps?.binary_split?.status === 'COMPLETED') liveIncurredCollateral6 += budgetProfile.binarySplit6;
    if (manifest.steps?.share_split?.status === 'COMPLETED') liveIncurredCollateral6 += budgetProfile.shareSplit6;
    if (manifest.steps?.yes_share_seed?.status === 'COMPLETED') liveIncurredCollateral6 += budgetProfile.yesShareSeed6;
    if (manifest.steps?.no_share_seed?.status === 'COMPLETED') liveIncurredCollateral6 += budgetProfile.noShareSeed6;
    const liveIncurredCollateralWei = liveIncurredCollateral6 * 10n ** 12n;
    const liveIncurredTotalWei = liveIncurredCollateralWei + liveIncurredGasWei;

    // Remaining gas budget from this step onward (including safety reserve)
    let liveRemainingGasUnits = 0n;
    for (const [sKey, units] of Object.entries(ESTIMATED_GAS)) {
      if (manifest.steps?.[sKey]?.status !== 'COMPLETED') {
        liveRemainingGasUnits += units;
      }
    }
    const liveSafetyReserveUnits = (liveRemainingGasUnits * 30n) / 100n;
    const liveTotalGasWithReserve = liveRemainingGasUnits + liveSafetyReserveUnits;
    const liveRemainingGasBudgetWei = liveTotalGasWithReserve * curGasPrice;

    let liveRemainingCollateral6 = 0n;
    if (manifest.steps?.binary_split?.status !== 'COMPLETED') liveRemainingCollateral6 += budgetProfile.binarySplit6;
    if (manifest.steps?.share_split?.status !== 'COMPLETED') liveRemainingCollateral6 += budgetProfile.shareSplit6;
    if (manifest.steps?.yes_share_seed?.status !== 'COMPLETED') liveRemainingCollateral6 += budgetProfile.yesShareSeed6;
    if (manifest.steps?.no_share_seed?.status !== 'COMPLETED') liveRemainingCollateral6 += budgetProfile.noShareSeed6;
    const liveRemainingCollateralWei = liveRemainingCollateral6 * 10n ** 12n;

    const liveTotalPlannedWei = liveIncurredTotalWei + liveRemainingCollateralWei + liveRemainingGasBudgetWei;
    if (liveTotalPlannedWei > PROPOSED_CEILING_USDC_WEI) {
      throw new Error(
        `Pre-broadcast spending ceiling exceeded for step "${stepKey}": total planned spending ${formatUnits(liveTotalPlannedWei, 18)} USDC exceeds 100.00 USDC ceiling (incurred: ${formatUnits(liveIncurredTotalWei, 18)} USDC, remaining: ${formatUnits(liveRemainingCollateralWei + liveRemainingGasBudgetWei, 18)} USDC at gas price ${curGasPrice} wei). Broadcast aborted.`
      );
    }

    const stepGasLimit = ESTIMATED_GAS[stepKey];
    if (!stepGasLimit) {
      throw new Error(`Missing gas limit configuration for step "${stepKey}"`);
    }

    // Maximum fee bound (130% of current gas price)
    const maxFeeBound = (curGasPrice * 130n) / 100n;
    const maxStepCostWei = stepGasLimit * maxFeeBound;

    // Enforce maxStepCostWei fits within 100.00 USDC ceiling
    if (liveIncurredTotalWei + liveRemainingCollateralWei + maxStepCostWei > PROPOSED_CEILING_USDC_WEI) {
      throw new Error(
        `Pre-broadcast spending ceiling exceeded for step "${stepKey}": bounded max step cost ${formatUnits(maxStepCostWei, 18)} USDC (gas limit ${stepGasLimit} at max fee ${maxFeeBound} wei) + incurred ${formatUnits(liveIncurredTotalWei, 18)} USDC exceeds 100.00 USDC ceiling. Broadcast aborted.`
      );
    }

    // Step 1: Record Intent with current Nonce
    const nonce = await client.getTransactionCount({ address: account.address });
    if (!entry) {
      entry = {
        step: stepKey,
        description,
        status: 'INTENT',
        nonce,
        startedAt: new Date().toISOString()
      };
      manifest.journal.push(entry);
    } else {
      entry.status = 'INTENT';
      entry.nonce = nonce;
      entry.startedAt = new Date().toISOString();
    }
    persistManifestAtomic();

    // Step 2: Broadcast transaction with bounded fee and explicit gas limit
    const hash = await sendAction(nonce, maxFeeBound, stepGasLimit);
    entry.hash = hash;
    entry.status = 'SUBMITTED';
    persistManifestAtomic();

    // Test Failure Hook: AFTER_BROADCAST
    if (testFailureHook) {
      testFailureHook('AFTER_BROADCAST', stepKey, hash);
    }

    // Step 3: Wait for receipt
    const receipt = await client.waitForTransactionReceipt({ hash });
    let resolvedEffectiveGasPrice = receipt.effectiveGasPrice;
    if (!resolvedEffectiveGasPrice) {
      const tx = await client.getTransaction({ hash }).catch(() => null);
      if (tx?.gasPrice) {
        resolvedEffectiveGasPrice = tx.gasPrice;
      } else {
        throw new Error(`Unresolvable receipt fee: transaction ${hash} mined but gas price could not be determined from receipt or transaction. Halting to preserve spending auditability.`);
      }
    }
    entry.receipt = {
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: resolvedEffectiveGasPrice.toString(),
      contractAddress: receipt.contractAddress || null
    };

    if (receipt.status !== 'success') {
      entry.status = 'REVERTED';
      persistManifestAtomic();
      throw new Error(`Transaction ${description} reverted: ${hash}`);
    }

    entry.status = 'MINED';
    persistManifestAtomic();

    // Test Failure Hook: AFTER_MINING
    if (testFailureHook) {
      testFailureHook('AFTER_MINING', stepKey, hash);
    }

    manifest.steps[stepKey] = {
      status: 'COMPLETED',
      txHash: hash,
      receipt: entry.receipt,
      contractAddress: receipt.contractAddress || null,
      completedAt: new Date().toISOString()
    };
    if (receipt.contractAddress) {
      manifest.contracts[stepKey] = receipt.contractAddress;
    }
    persistManifestAtomic();

    return manifest.steps[stepKey];
  }

  // Timings: keep previously recorded timing or establish fresh timing
  const eventDeadline = process.env.DEMO_EVENT_DEADLINE
    ? BigInt(process.env.DEMO_EVENT_DEADLINE)
    : BigInt(manifest.timing?.eventDeadline || blockTime + eventDeadlineOffset);
  const tradingCutoff = process.env.DEMO_TRADING_CUTOFF
    ? BigInt(process.env.DEMO_TRADING_CUTOFF)
    : BigInt(manifest.timing?.tradingCutoff || blockTime + cutoffOffset);
  const earliestPriceFixTime = process.env.DEMO_PRICE_FIX_TIME
    ? BigInt(process.env.DEMO_PRICE_FIX_TIME)
    : BigInt(manifest.timing?.earliestPriceFixTime || blockTime + earliestPriceFixOffset);

  manifest.timing = {
    deployedAtBlockTime: manifest.timing?.deployedAtBlockTime || blockTime,
    eventDeadline: Number(eventDeadline),
    tradingCutoff: Number(tradingCutoff),
    earliestPriceFixTime: Number(earliestPriceFixTime),
    capUSD: budgetProfile.capUSD
  };
  persistManifestAtomic();

  // 1. Deploy Core Contracts
  console.log('\n--- Core Contract Deployments ---');
  await executeWithJournal('oracle', 'Deploy DemoOracle', async (nonce, gasPrice, gasLimit) => {
    console.log('Deploying DemoOracle...');
    return wallet.deployContract({
      abi: oracleArtifact.abi,
      bytecode: oracleArtifact.bytecode.object,
      args: [account.address],
      nonce,
      gasPrice,
      gas: gasLimit
    });
  });
  const oracleAddress = manifest.contracts.oracle;
  console.log(`  -> DemoOracle at: ${oracleAddress}`);

  await executeWithJournal('binaryVault', 'Deploy BinaryVault', async (nonce, gasPrice, gasLimit) => {
    console.log('Deploying BinaryVault...');
    return wallet.deployContract({
      abi: binVaultArtifact.abi,
      bytecode: binVaultArtifact.bytecode.object,
      args: [ARC_USDC, oracleAddress, eventDeadline, tradingCutoff],
      nonce,
      gasPrice,
      gas: gasLimit
    });
  });
  const binVaultAddress = manifest.contracts.binaryVault;
  console.log(`  -> BinaryVault at: ${binVaultAddress}`);

  await executeWithJournal('shareVault', 'Deploy ShareVault', async (nonce, gasPrice, gasLimit) => {
    console.log('Deploying ShareVault...');
    return wallet.deployContract({
      abi: shareVaultArtifact.abi,
      bytecode: shareVaultArtifact.bytecode.object,
      args: [ARC_USDC, oracleAddress, cap6, eventDeadline, tradingCutoff, earliestPriceFixTime],
      nonce,
      gasPrice,
      gas: gasLimit
    });
  });
  const shareVaultAddress = manifest.contracts.shareVault;
  console.log(`  -> ShareVault at: ${shareVaultAddress}`);

  await executeWithJournal('binaryAmm', 'Deploy BinaryAMM', async (nonce, gasPrice, gasLimit) => {
    console.log('Deploying BinaryAMM...');
    return wallet.deployContract({
      abi: binAmmArtifact.abi,
      bytecode: binAmmArtifact.bytecode.object,
      args: [binVaultAddress, account.address, 30n],
      nonce,
      gasPrice,
      gas: gasLimit
    });
  });
  const binAmmAddress = manifest.contracts.binaryAmm;
  console.log(`  -> BinaryAMM at: ${binAmmAddress}`);

  const yesShareAddress = await client.readContract({
    address: shareVaultAddress,
    abi: shareVaultArtifact.abi,
    functionName: 'yesShare'
  });
  manifest.contracts.yesShare = yesShareAddress;

  const noShareAddress = await client.readContract({
    address: shareVaultAddress,
    abi: shareVaultArtifact.abi,
    functionName: 'noShare'
  });
  manifest.contracts.noShare = noShareAddress;

  const residualShareAddress = await client.readContract({
    address: shareVaultAddress,
    abi: shareVaultArtifact.abi,
    functionName: 'residualShare'
  });
  manifest.contracts.residualShare = residualShareAddress;

  await executeWithJournal('yesShareAmm', 'Deploy ShareAMM (YES)', async (nonce, gasPrice, gasLimit) => {
    console.log('Deploying ShareAMM (YES)...');
    return wallet.deployContract({
      abi: shareAmmArtifact.abi,
      bytecode: shareAmmArtifact.bytecode.object,
      args: [ARC_USDC, yesShareAddress, shareVaultAddress, 30n, 'ysLP'],
      nonce,
      gasPrice,
      gas: gasLimit
    });
  });
  const yesAmmAddress = manifest.contracts.yesShareAmm;
  console.log(`  -> ShareAMM (YES) at: ${yesAmmAddress}`);

  await executeWithJournal('noShareAmm', 'Deploy ShareAMM (NO)', async (nonce, gasPrice, gasLimit) => {
    console.log('Deploying ShareAMM (NO)...');
    return wallet.deployContract({
      abi: shareAmmArtifact.abi,
      bytecode: shareAmmArtifact.bytecode.object,
      args: [ARC_USDC, noShareAddress, shareVaultAddress, 30n, 'nsLP'],
      nonce,
      gasPrice,
      gas: gasLimit
    });
  });
  const noAmmAddress = manifest.contracts.noShareAmm;
  console.log(`  -> ShareAMM (NO) at: ${noAmmAddress}`);

  const yesTokenAddress = await client.readContract({
    address: binVaultAddress,
    abi: binVaultArtifact.abi,
    functionName: 'yesToken'
  });
  manifest.contracts.yesToken = yesTokenAddress;

  const noTokenAddress = await client.readContract({
    address: binVaultAddress,
    abi: binVaultArtifact.abi,
    functionName: 'noToken'
  });
  manifest.contracts.noToken = noTokenAddress;
  manifest.contracts.usdc = ARC_USDC;
  persistManifestAtomic();

  // Verify contract bindings on chain
  console.log('\n--- Verifying On-Chain Contract Bindings ---');
  const boundOracleBin = await client.readContract({ address: binVaultAddress, abi: binVaultArtifact.abi, functionName: 'oracle' });
  const boundOracleShare = await client.readContract({ address: shareVaultAddress, abi: shareVaultArtifact.abi, functionName: 'oracle' });
  if (boundOracleBin.toLowerCase() !== oracleAddress.toLowerCase() || boundOracleShare.toLowerCase() !== oracleAddress.toLowerCase()) {
    throw new Error('Oracle binding mismatch!');
  }
  manifest.steps.verify_bindings = { status: 'COMPLETED', verifiedAt: new Date().toISOString() };
  persistManifestAtomic();
  console.log('Contract bindings successfully verified.');

  const farDeadline = BigInt(blockTime + 86400 * 365);

  // 2. Binary Split & Seed (20 USDC -> 20 YES + 20 NO; seed 10 YES + 10 NO)
  console.log('\n--- Seeding Initial Liquidity (Fractional Profile) ---');
  if (manifest.steps.binary_split?.status !== 'COMPLETED') {
    console.log('Splitting 20 USDC into 20 YES + 20 NO...');
    const currentAllowance = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, binVaultAddress]
    });
    if (currentAllowance < budgetProfile.binarySplit6) {
      await executeWithJournal('approve_usdc_bin_split', 'Approve USDC for BinaryVault', async (nonce, gasPrice, gasLimit) => {
        return wallet.writeContract({
          address: ARC_USDC,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [binVaultAddress, budgetProfile.binarySplit6],
          nonce,
          gasPrice,
          gas: gasLimit
        });
      });
    }

    await executeWithJournal('binary_split', 'Split Binary sets', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: binVaultAddress,
        abi: binVaultArtifact.abi,
        functionName: 'split',
        args: [budgetProfile.binarySplit6, account.address],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });
  } else {
    console.log('[RESUME] binary_split already completed.');
  }

  // Seed BinaryAMM if reserves are zero
  const binReserves = await client.readContract({ address: binAmmAddress, abi: AMM_ABI, functionName: 'reserves' });
  if (binReserves[0] === 0n || binReserves[1] === 0n) {
    console.log('Adding liquidity to BinaryAMM (10 YES, 10 NO)...');
    await executeWithJournal('approve_yes_bin_amm', 'Approve YES for BinaryAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: yesTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [binAmmAddress, budgetProfile.binarySeedTokens18],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });

    await executeWithJournal('approve_no_bin_amm', 'Approve NO for BinaryAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: noTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [binAmmAddress, budgetProfile.binarySeedTokens18],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });

    await executeWithJournal('binary_seed', 'Add Liquidity BinaryAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: binAmmAddress,
        abi: binAmmArtifact.abi,
        functionName: 'addLiquidity',
        args: [budgetProfile.binarySeedTokens18, budgetProfile.binarySeedTokens18, 1n, farDeadline],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });
  } else {
    console.log('[RESUME] BinaryAMM already has positive liquidity.');
    manifest.steps.binary_seed = manifest.steps.binary_seed || {
      status: 'COMPLETED',
      verifiedReserves: binReserves.map(String)
    };
    persistManifestAtomic();
  }

  // 3. Share Split (50 USDC -> 0.1 complete sets = 0.1 yesShare + 0.1 noShare + 0.1 residualShare)
  if (manifest.steps.share_split?.status !== 'COMPLETED') {
    console.log('Splitting 50 USDC for 0.1 complete sets in ShareVault...');
    const currentAllowance = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, shareVaultAddress]
    });
    if (currentAllowance < budgetProfile.shareSplit6) {
      await executeWithJournal('approve_usdc_share_split', 'Approve USDC for ShareVault', async (nonce, gasPrice, gasLimit) => {
        return wallet.writeContract({
          address: ARC_USDC,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [shareVaultAddress, budgetProfile.shareSplit6],
          nonce,
          gasPrice,
          gas: gasLimit
        });
      });
    }

    await executeWithJournal('share_split', 'Split Share sets', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: shareVaultAddress,
        abi: shareVaultArtifact.abi,
        functionName: 'split',
        args: [budgetProfile.shareSplitSets18, account.address],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });
  } else {
    console.log('[RESUME] share_split already completed.');
  }

  // 4. Seed YesShareAMM (11.655 USDC + 0.1 yesShare -> $116.55 initial price)
  const yesReserves = await client.readContract({ address: yesAmmAddress, abi: AMM_ABI, functionName: 'reserves' });
  if (yesReserves[0] === 0n || yesReserves[1] === 0n) {
    console.log('Adding liquidity to YesShareAMM (11.655 USDC + 0.1 yesShare)...');
    await executeWithJournal('approve_usdc_yes_amm', 'Approve USDC for YesShareAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: ARC_USDC,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [yesAmmAddress, budgetProfile.yesShareSeed6],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });

    await executeWithJournal('approve_yes_share_amm', 'Approve yesShare for YesShareAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: yesShareAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [yesAmmAddress, budgetProfile.yesShareSeedShares18],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });

    await executeWithJournal('yes_share_seed', 'Add Liquidity YesShareAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: yesAmmAddress,
        abi: shareAmmArtifact.abi,
        functionName: 'addLiquidity',
        args: [budgetProfile.yesShareSeed6, budgetProfile.yesShareSeedShares18, 1n, farDeadline],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });
  } else {
    console.log('[RESUME] YesShareAMM already has positive liquidity.');
    manifest.steps.yes_share_seed = manifest.steps.yes_share_seed || {
      status: 'COMPLETED',
      verifiedReserves: yesReserves.map(String)
    };
    persistManifestAtomic();
  }

  // 5. Seed NoShareAMM (4.366 USDC + 0.1 noShare -> $43.66 initial price)
  const noReserves = await client.readContract({ address: noAmmAddress, abi: AMM_ABI, functionName: 'reserves' });
  if (noReserves[0] === 0n || noReserves[1] === 0n) {
    console.log('Adding liquidity to NoShareAMM (4.366 USDC + 0.1 noShare)...');
    await executeWithJournal('approve_usdc_no_amm', 'Approve USDC for NoShareAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: ARC_USDC,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [noAmmAddress, budgetProfile.noShareSeed6],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });

    await executeWithJournal('approve_no_share_amm', 'Approve noShare for NoShareAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: noShareAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [noAmmAddress, budgetProfile.noShareSeedShares18],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });

    await executeWithJournal('no_share_seed', 'Add Liquidity NoShareAMM', async (nonce, gasPrice, gasLimit) => {
      return wallet.writeContract({
        address: noAmmAddress,
        abi: shareAmmArtifact.abi,
        functionName: 'addLiquidity',
        args: [budgetProfile.noShareSeed6, budgetProfile.noShareSeedShares18, 1n, farDeadline],
        nonce,
        gasPrice,
        gas: gasLimit
      });
    });
  } else {
    console.log('[RESUME] NoShareAMM already has positive liquidity.');
    manifest.steps.no_share_seed = manifest.steps.no_share_seed || {
      status: 'COMPLETED',
      verifiedReserves: noReserves.map(String)
    };
    persistManifestAtomic();
  }

  console.log('\nLiquidity seeding complete!');

  // Mark ACTIVE_DEMO and save final manifest
  manifest.status = 'ACTIVE_DEMO';
  manifest.deploymentDate = manifest.deploymentDate || new Date().toISOString();
  persistManifestAtomic();

  console.log(`\nDeployment manifest saved to: ${manifestPath}`);
  console.log('\nEnvironment variables to use this deployment:');
  console.log(`ARC_ORACLE=${oracleAddress}`);
  console.log(`ARC_BINARY_VAULT=${binVaultAddress}`);
  console.log(`ARC_SHARE_VAULT=${shareVaultAddress}`);
  console.log(`ARC_BINARY_AMM=${binAmmAddress}`);
  console.log(`ARC_YES_SHARE_AMM=${yesAmmAddress}`);
  console.log(`ARC_NO_SHARE_AMM=${noAmmAddress}`);

  return manifest;
}

// CLI execution if executed directly
export function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  const isDryRun = process.argv.includes('--dry-run');
  const isLocalArg = process.argv.includes('--local');
  const isPreflightArg = process.argv.includes('--preflight');
  let addressArg = null;
  const addressIdx = process.argv.indexOf('--address');
  if (addressIdx !== -1 && process.argv[addressIdx + 1]) {
    addressArg = process.argv[addressIdx + 1];
  } else {
    const eqArg = process.argv.find(a => a.startsWith('--address='));
    if (eqArg) addressArg = eqArg.split('=')[1];
  }

  let manifestArg = process.env.DEPLOYMENT_MANIFEST_PATH;
  const manifestIdx = process.argv.indexOf('--manifest');
  if (manifestIdx !== -1 && process.argv[manifestIdx + 1]) {
    manifestArg = process.argv[manifestIdx + 1];
  } else {
    const eqArg = process.argv.find(a => a.startsWith('--manifest='));
    if (eqArg) manifestArg = eqArg.split('=')[1];
  }

  runDeploy({
    dryRun: isDryRun,
    isLocal: isLocalArg,
    address: addressArg,
    manifestPath: manifestArg ? path.resolve(manifestArg) : undefined,
    preflightOnly: isPreflightArg
  })
    .then((result) => {
      if (result && result.mode === 'ADDRESS_ONLY_PREFLIGHT') {
        if (!result.fundingCheck?.isFunded || result.spendingCeiling?.isCeilingExceeded) {
          console.error('\n[PREFLIGHT ACTION REQUIRED] Address funding check failed or proposed spending ceiling was exceeded.');
          process.exit(1);
        }
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nDeployment failed:', sanitizeErrorMessage(err.message));
      process.exit(1);
    });
}
