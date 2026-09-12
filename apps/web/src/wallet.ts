import { encode, words, addressWord, isAddress } from '../../../packages/arc/abi.mjs';
import { parseUnits, formatUnits, TOKEN } from '../../../packages/core/market.mjs';
import type { ArcConfig, ArcPositionRow } from '../../../packages/arc/types.ts';
import type { Quote, Book, WalletState, Eip1193Provider } from './api';

const provider = (): Eip1193Provider => {
  if (!window.ethereum) {
    throw new Error('No injected wallet found. Use a browser with an Ethereum wallet extension.');
  }
  return window.ethereum;
};

async function guard(account?: string): Promise<Eip1193Provider> {
  const p = provider();
  const chainIdHex = (await p.request({ method: 'eth_chainId' })) as string;
  if (BigInt(chainIdHex) !== 5042002n) {
    throw new Error('Switch your wallet to Arc Testnet before continuing.');
  }
  if (account) {
    const accounts = (await p.request({ method: 'eth_accounts' })) as string[] | undefined;
    if (!accounts?.some((x: string) => x.toLowerCase() === account.toLowerCase())) {
      throw new Error('Wallet account changed. Reconnect and review the trade.');
    }
  }
  return p;
}

async function read(to: string, signature: string, args: (string | number | bigint | boolean)[] = [], block = 'latest'): Promise<string> {
  if (!isAddress(to)) throw new Error('A valid deployed contract address is required.');
  const p = provider();
  return (await p.request({
    method: 'eth_call',
    params: [{ to, data: encode(signature, args) }, block]
  })) as string;
}

async function checked(config: ArcConfig, account: string): Promise<Eip1193Provider> {
  const p = await guard(account);
  if (!config.arcReady) throw new Error('The deployment is not configured.');
  if (Object.values(config.contracts).some(a => !isAddress(a))) {
    throw new Error('Invalid contract configuration.');
  }
  const decimalsRaw = await read(config.collateral, 'decimals()');
  if (words(decimalsRaw)[0] !== 6n) {
    throw new Error('Unexpected collateral decimals. Refusing this token.');
  }
  return p;
}

export async function connectWallet(config: ArcConfig): Promise<WalletState> {
  const p = provider();
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[] | undefined;
  const account = accounts?.[0];
  if (!account || !isAddress(account)) throw new Error('Wallet did not return a valid account.');
  const chainId = '0x' + (5042002).toString(16);
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e: unknown) {
    if ((e as { code?: number })?.code !== 4902) throw new Error('Please approve switching to Arc Testnet in your wallet.');
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: 'Arc Testnet',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: ['https://rpc.testnet.arc.io'],
          blockExplorerUrls: ['https://testnet.arcscan.app']
        }
      ]
    });
  }
  await guard(account);
  const decimalsRaw = await read(config.collateral, 'decimals()');
  if (words(decimalsRaw)[0] !== 6n) {
    throw new Error('Collateral must use exactly six decimals.');
  }
  const balanceRaw = await read(config.collateral, 'balanceOf(address)', [account]);
  return { account, balance: formatUnits(words(balanceRaw)[0]) };
}

async function waitReceipt(hash: string): Promise<string> {
  const p = provider();
  for (let i = 0; i < 90; i++) {
    const r = (await p.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status?: string } | null;
    if (r) {
      if (r.status !== '0x1') throw new Error(`Transaction reverted: ${hash}`);
      return hash;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Transaction submitted; confirmation is still pending. Do not blindly resend. Check Arcscan: ${hash}`);
}

async function transact(account: string, to: string, data: string): Promise<string> {
  const p = await guard(account);
  const request = { from: account, to, data, value: '0x0' };
  await p.request({ method: 'eth_call', params: [request, 'latest'] });
  const gas = (await p.request({ method: 'eth_estimateGas', params: [request] })) as string;
  await guard(account);
  const hash = (await p.request({
    method: 'eth_sendTransaction',
    params: [{ ...request, gas, chainId: '0x' + (5042002).toString(16) }]
  })) as string;
  return waitReceipt(hash);
}

async function approveExact(token: string, account: string, spender: string, amount: bigint): Promise<void> {
  if (!isAddress(spender) || amount <= 0n) throw new Error('Invalid approval.');
  const allowed = words(await read(token, 'allowance(address,address)', [account, spender]))[0];
  if (allowed >= amount) return;
  if (allowed > 0n) await transact(account, token, encode('approve(address,uint256)', [spender, 0n]));
  await transact(account, token, encode('approve(address,uint256)', [spender, amount]));
}

export async function sendArcTrade(quote: Quote, config: ArcConfig, account: string): Promise<string> {
  await checked(config, account);
  if (quote.mode !== 'arc' || !['binary', 'asset'].includes(quote.book) || !['yes', 'no'].includes(quote.side)) {
    throw new Error('A fresh Arc quote is required.');
  }
  if (Date.now() > quote.expiresAt) throw new Error('Quote expired. Review a fresh quote.');
  const amount = parseUnits(quote.amount);
  const min = BigInt(quote.minOutUnits);
  if (min <= 0n) throw new Error('Minimum output must be positive.');
  const c = config.contracts;
  const to = quote.book === 'binary' ? c.binaryAMM : quote.side === 'yes' ? c.yesShareAMM : c.noShareAMM;
  await approveExact(config.collateral, account, to, amount);
  if (Date.now() > quote.expiresAt) {
    throw new Error('Quote expired during approval. Approval remains, but no trade was sent. Review a fresh quote.');
  }
  const deadline = BigInt(Math.floor(quote.expiresAt / 1000));
  const data =
    quote.book === 'binary'
      ? encode('buyOutcome(bool,uint256,uint256,uint256)', [quote.side === 'yes', amount, min, deadline])
      : encode('buyShares(uint256,uint256,uint256)', [amount, min, deadline]);
  return transact(account, to, data);
}

export async function sendArcPairs(
  config: ArcConfig,
  account: string,
  input: { book: Book; action: 'split' | 'merge'; quantity: string }
): Promise<string> {
  await checked(config, account);
  const q = parseUnits(input.quantity, 18);
  const to = input.book === 'binary' ? config.contracts.binarySplit : config.contracts.shareSplit;
  if (input.action === 'merge') return transact(account, to, encode('merge(uint256,address)', [q, account]));
  let collateral: bigint;
  let arg: bigint;
  if (input.book === 'binary') {
    if (q % 1000000000000n !== 0n) throw new Error('Binary splits support six decimal places of pairs.');
    collateral = q / 1000000000000n;
    arg = collateral;
  } else {
    collateral = words(await read(to, 'collateralForPairs(uint256)', [q]))[0];
    arg = q;
  }
  await approveExact(config.collateral, account, to, collateral);
  return transact(account, to, encode('split(uint256,address)', [arg, account]));
}

export async function loadArcPositions(config: ArcConfig, account: string): Promise<ArcPositionRow[]> {
  await checked(config, account);
  const c = config.contracts;
  const rows: ArcPositionRow[] = [];
  for (const book of ['binary', 'asset'] as const) {
    const vault = book === 'binary' ? c.binarySplit : c.shareSplit;
    const settled = words(await read(vault, 'settled()'))[0] === 1n;
    const yes = words(await read(vault, 'eventYes()'))[0] === 1n;
    const payoff = book === 'binary' ? 1000000n : words(await read(vault, 'settlementValue6()'))[0];
    for (const side of ['yes', 'no'] as const) {
      const token = addressWord(await read(vault, book === 'binary' ? (side === 'yes' ? 'yesToken()' : 'noToken()') : side === 'yes' ? 'yesShare()' : 'noShare()'));
      const units = words(await read(token, 'balanceOf(address)', [account]))[0];
      rows.push({
        book,
        side,
        token,
        vault,
        units: units.toString(),
        quantity: formatUnits(units, 18, 8),
        payout: settled ? formatUnits(side === 'yes' === yes ? (units * payoff) / TOKEN : 0n) : null,
        winning: settled && side === 'yes' === yes
      });
    }
    if (book === 'asset') {
      const resToken = addressWord(await read(vault, 'residualShare()'));
      const resUnits = words(await read(resToken, 'balanceOf(address)', [account]))[0];
      const resPayoff = settled ? words(await read(vault, 'residualValue6()'))[0] : 0n;
      rows.push({
        book: 'asset',
        side: 'residual',
        token: resToken,
        vault,
        units: resUnits.toString(),
        quantity: formatUnits(resUnits, 18, 8),
        payout: settled ? formatUnits((resUnits * resPayoff) / TOKEN) : null,
        winning: settled && resUnits > 0n && resPayoff > 0n
      });
    }
  }
  return rows;
}

export async function sendArcClaim(config: ArcConfig, account: string): Promise<string[]> {
  const rows = await loadArcPositions(config, account);
  const wins = rows.filter(r => r.winning && BigInt(r.units) > 0n);
  if (!wins.length) throw new Error('No winning positions are claimable.');
  const confirmed: string[] = [];
  for (const row of wins) {
    try {
      confirmed.push(await transact(account, row.vault, encode('redeem(address,uint256,address)', [row.token, BigInt(row.units), account])));
    } catch (e: unknown) {
      throw new Error(`Claim stopped after ${confirmed.length} confirmed transaction(s). Refresh positions before retrying. ${e instanceof Error ? e.message : ''}`);
    }
  }
  return confirmed;
}

export async function readWalletBalance(config: ArcConfig, account: string): Promise<string> {
  await guard(account);
  const decimalsRaw = await read(config.collateral, 'decimals()');
  if (words(decimalsRaw)[0] !== 6n) {
    throw new Error('Unexpected collateral decimals.');
  }
  const balanceRaw = await read(config.collateral, 'balanceOf(address)', [account]);
  return formatUnits(words(balanceRaw)[0]);
}
