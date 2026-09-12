#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Safely load environment variables without logging secret values
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

const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io';
const ARC_CHAIN_ID = 5042002;
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const APPROVED_WALLET = '0x7eCdBAe811359ee95Dae97213EbEB48E99af920d';
const HARD_CEILING_USDC = 180.0;

const manifestPath = path.resolve('deployments/submission-market.json');
if (!existsSync(manifestPath)) {
  throw new Error(`Manifest not found at ${manifestPath}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const key = process.env.DEPLOYER_KEY || process.env.PRIVATE_KEY;
if (!key) throw new Error('No DEPLOYER_KEY in environment');
const account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key);

if (account.address.toLowerCase() !== APPROVED_WALLET.toLowerCase()) {
  throw new Error(`Signer ${account.address} does not match APPROVED_WALLET ${APPROVED_WALLET}`);
}

const client = createPublicClient({ transport: http(ARC_RPC) });
const wallet = createWalletClient({ account, transport: http(ARC_RPC) });

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]);

const BINARY_AMM_ABI = parseAbi([
  'function buyOutcome(bool buyYes, uint256 collateralIn6, uint256 minOutcomeOut18, uint256 deadline) returns (uint256)',
  'function quoteBuy(bool buyYes, uint256 collateralIn6) view returns (uint256 outcomeOut18, uint256 fee6)',
  'function reserves() view returns (uint256 reserveYes18, uint256 reserveNo18)'
]);

async function main() {
  console.log('===========================================================');
  console.log('      THELEMA ARC TESTNET DEMONSTRATION TRADE EXECUTION    ');
  console.log('===========================================================');
  const chainId = await client.getChainId();
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Connected chain ID ${chainId} does not match expected Arc Testnet ${ARC_CHAIN_ID}`);
  }
  console.log(`Connected RPC: ${ARC_RPC} (Verified Chain ID: ${chainId})`);
  console.log(`Trader / Deployer Wallet: ${account.address}`);
  console.log(`Target BinaryAMM: ${manifest.contracts.binaryAmm}`);

  const tradeAmountCollateral6 = 1_000_000n; // Exactly 1.00 USDC (6 decimals)
  console.log(`Target Demonstration Trade: 1.000000 USDC (${tradeAmountCollateral6} micro-USDC)`);

  // Cumulative Ceiling Enforcement
  const HISTORICAL_SPEND_USDC = 86.343602;
  const SUBMISSION_DEPLOYMENT_SPEND_USDC = 86.357542;
  const projectedSpendUSDC = HISTORICAL_SPEND_USDC + SUBMISSION_DEPLOYMENT_SPEND_USDC + 1.01; // ~1 USDC collateral + 0.01 gas buffer
  console.log(`\nCumulative Spending Check:`);
  console.log(`  Historical Demo Spend:       ${HISTORICAL_SPEND_USDC.toFixed(6)} USDC`);
  console.log(`  Submission Market Deploy:    ${SUBMISSION_DEPLOYMENT_SPEND_USDC.toFixed(6)} USDC`);
  console.log(`  Projected Trade Spend:       ~1.010000 USDC`);
  console.log(`  Projected Cumulative Total:  ${projectedSpendUSDC.toFixed(6)} USDC`);
  console.log(`  Approved Hard Ceiling:       ${HARD_CEILING_USDC.toFixed(6)} USDC`);
  if (projectedSpendUSDC > HARD_CEILING_USDC) {
    throw new Error(`Projected spend ${projectedSpendUSDC} exceeds approved ceiling ${HARD_CEILING_USDC}`);
  }
  console.log(`  Ceiling Status:              OK (within budget)`);

  // 1. Check Pre-Trade State
  console.log('\n--- 1. Pre-Trade State Inspection ---');
  const [preResY, preResN] = await client.readContract({
    address: manifest.contracts.binaryAmm,
    abi: BINARY_AMM_ABI,
    functionName: 'reserves'
  });
  const preCollateralBal = await client.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });
  const preYesTokens = await client.readContract({
    address: manifest.contracts.yesToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });
  const preNativeGas = await client.getBalance({ address: account.address });

  console.log(`BinaryAMM Initial Reserves: YES=${formatUnits(preResY, 18)}, NO=${formatUnits(preResN, 18)}`);
  console.log(`Wallet Collateral Balance:  ${formatUnits(preCollateralBal, 6)} USDC`);
  console.log(`Wallet YES Tokens Balance:  ${formatUnits(preYesTokens, 18)} tYES`);
  console.log(`Wallet Native Gas Balance:  ${formatUnits(preNativeGas, 18)} native USDC`);

  if (preCollateralBal < tradeAmountCollateral6) {
    throw new Error(`Insufficient collateral balance: have ${formatUnits(preCollateralBal, 6)} USDC, need 1.00 USDC`);
  }

  // 2. Quote
  console.log('\n--- 2. On-Chain Quote Calculation ---');
  const [expectedOutcome18, fee6] = await client.readContract({
    address: manifest.contracts.binaryAmm,
    abi: BINARY_AMM_ABI,
    functionName: 'quoteBuy',
    args: [true, tradeAmountCollateral6]
  });
  console.log(`Quoted Outcome Tokens Out: ${formatUnits(expectedOutcome18, 18)} tYES`);
  console.log(`Quoted Trading Fee:         ${formatUnits(fee6, 6)} USDC (0.30% / 30 bps)`);

  // 2% slippage tolerance
  const minOutcomeOut18 = (expectedOutcome18 * 98n) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 min deadline

  // 3. Approval
  console.log('\n--- 3. Collateral Allowance Check & Approval ---');
  const currentAllowance6 = await client.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, manifest.contracts.binaryAmm]
  });
  console.log(`Current Allowance for BinaryAMM: ${formatUnits(currentAllowance6, 6)} USDC`);

  let approvalTxHash = null;
  let approvalReceipt = null;
  if (currentAllowance6 < tradeAmountCollateral6) {
    console.log(`Approving exact 1.000000 USDC (${tradeAmountCollateral6} micro-USDC)...`);
    const appGasPrice = await client.getGasPrice();
    approvalTxHash = await wallet.writeContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [manifest.contracts.binaryAmm, tradeAmountCollateral6],
      gasPrice: (appGasPrice * 13n) / 10n
    });
    console.log(`Approval broadcast: ${approvalTxHash}`);
    console.log('Waiting for approval confirmation...');
    approvalReceipt = await client.waitForTransactionReceipt({ hash: approvalTxHash });
    if (approvalReceipt.status !== 'success') {
      throw new Error(`Approval transaction reverted: ${approvalTxHash}`);
    }
    console.log(`Approval confirmed in block ${approvalReceipt.blockNumber} (Gas Used: ${approvalReceipt.gasUsed})`);
  } else {
    console.log('Existing allowance is sufficient.');
  }

  // 4. Trade Execution
  console.log('\n--- 4. Executing buyOutcome(buyYes=true, 1.00 USDC) ---');
  const tradeGasPrice = await client.getGasPrice();
  const tradeTxHash = await wallet.writeContract({
    address: manifest.contracts.binaryAmm,
    abi: BINARY_AMM_ABI,
    functionName: 'buyOutcome',
    args: [true, tradeAmountCollateral6, minOutcomeOut18, deadline],
    gasPrice: (tradeGasPrice * 13n) / 10n
  });
  console.log(`Trade broadcast: ${tradeTxHash}`);
  console.log('Waiting for trade confirmation...');
  const tradeReceipt = await client.waitForTransactionReceipt({ hash: tradeTxHash });
  if (tradeReceipt.status !== 'success') {
    throw new Error(`Trade transaction reverted: ${tradeTxHash}`);
  }
  console.log(`Trade confirmed in block ${tradeReceipt.blockNumber}!`);
  console.log(`Gas Used: ${tradeReceipt.gasUsed}, Effective Gas Price: ${tradeReceipt.effectiveGasPrice}`);

  // 5. Post-Trade Verification
  console.log('\n--- 5. Post-Trade State Verification ---');
  const [postResY, postResN] = await client.readContract({
    address: manifest.contracts.binaryAmm,
    abi: BINARY_AMM_ABI,
    functionName: 'reserves'
  });
  const postCollateralBal = await client.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });
  const postYesTokens = await client.readContract({
    address: manifest.contracts.yesToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });
  const postNativeGas = await client.getBalance({ address: account.address });

  const collateralDiff = preCollateralBal - postCollateralBal;
  const yesTokensGained = postYesTokens - preYesTokens;

  console.log(`BinaryAMM Final Reserves:   YES=${formatUnits(postResY, 18)}, NO=${formatUnits(postResN, 18)}`);
  console.log(`Collateral Spent:           ${formatUnits(collateralDiff, 6)} USDC`);
  console.log(`YES Tokens Received:        ${formatUnits(yesTokensGained, 18)} tYES`);
  console.log(`Remaining Collateral:       ${formatUnits(postCollateralBal, 6)} USDC`);
  console.log(`Remaining Native Gas:       ${formatUnits(postNativeGas, 18)} native USDC`);

  // Financial spend accounting
  const approvalGasCostWei = approvalReceipt ? BigInt(approvalReceipt.gasUsed) * BigInt(approvalReceipt.effectiveGasPrice) : 0n;
  const tradeGasCostWei = BigInt(tradeReceipt.gasUsed) * BigInt(tradeReceipt.effectiveGasPrice);
  const totalTradeGasCostWei = approvalGasCostWei + tradeGasCostWei;
  const collateralSpentWei = tradeAmountCollateral6 * 10n ** 12n;
  const totalTradeSpendWei = collateralSpentWei + totalTradeGasCostWei;

  console.log('\n--- 6. Financial Spend Reconciliation ---');
  console.log(`Trade Gas Cost:             ${formatUnits(totalTradeGasCostWei, 18)} USDC`);
  console.log(`Trade Collateral Spent:     1.000000 USDC`);
  console.log(`Total Trade Spend:          ${formatUnits(totalTradeSpendWei, 18)} USDC`);

  const tradeRecord = {
    executedAt: new Date().toISOString(),
    network: {
      name: 'Arc Testnet',
      chainId: ARC_CHAIN_ID,
      rpcUrl: ARC_RPC
    },
    trader: account.address,
    targetAmm: manifest.contracts.binaryAmm,
    marketType: 'binary',
    outcomeSide: 'YES',
    collateralAmountUSDC: '1.000000',
    collateralAmountMicroUSDC: tradeAmountCollateral6.toString(),
    quote: {
      expectedTokensOut18: formatUnits(expectedOutcome18, 18),
      minTokensOut18: formatUnits(minOutcomeOut18, 18),
      feeUSDC: formatUnits(fee6, 6)
    },
    tokensReceived18: formatUnits(yesTokensGained, 18),
    approval: approvalTxHash ? {
      txHash: approvalTxHash,
      explorerUrl: `https://testnet.arcscan.app/tx/${approvalTxHash}`,
      blockNumber: Number(approvalReceipt.blockNumber),
      gasUsed: approvalReceipt.gasUsed.toString(),
      effectiveGasPrice: approvalReceipt.effectiveGasPrice.toString(),
      gasCostUSDC: formatUnits(approvalGasCostWei, 18)
    } : null,
    trade: {
      txHash: tradeTxHash,
      explorerUrl: `https://testnet.arcscan.app/tx/${tradeTxHash}`,
      blockNumber: Number(tradeReceipt.blockNumber),
      gasUsed: tradeReceipt.gasUsed.toString(),
      effectiveGasPrice: tradeReceipt.effectiveGasPrice.toString(),
      gasCostUSDC: formatUnits(tradeGasCostWei, 18)
    },
    totalGasCostUSDC: formatUnits(totalTradeGasCostWei, 18),
    totalCollateralSpentUSDC: '1.000000',
    totalTradeSpendUSDC: formatUnits(totalTradeSpendWei, 18),
    preState: {
      ammReserves: { yes: formatUnits(preResY, 18), no: formatUnits(preResN, 18) },
      traderCollateralUSDC: formatUnits(preCollateralBal, 6),
      traderYesTokens: formatUnits(preYesTokens, 18),
      traderNativeUSDC: formatUnits(preNativeGas, 18)
    },
    postState: {
      ammReserves: { yes: formatUnits(postResY, 18), no: formatUnits(postResN, 18) },
      traderCollateralUSDC: formatUnits(postCollateralBal, 6),
      traderYesTokens: formatUnits(postYesTokens, 18),
      traderNativeUSDC: formatUnits(postNativeGas, 18)
    }
  };

  manifest.demonstrationTrade = tradeRecord;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nDemonstration trade recorded to ${manifestPath}`);
  console.log(`Arcscan Trade URL: ${tradeRecord.trade.explorerUrl}`);
  if (tradeRecord.approval) {
    console.log(`Arcscan Approval URL: ${tradeRecord.approval.explorerUrl}`);
  }
}

main().catch((err) => {
  console.error('Trade execution failed:', err);
  process.exit(1);
});
