/**
 * Arc Testnet client and contract reader.
 */

import { encode, words, selector, isAddress } from './abi.ts';
import {
  MARKET,
  TOKEN,
  FEE_BPS,
  MarketError,
  binaryPrice,
  fourNumbers,
  formatUnits,
  parseUnits
} from '../core/market.ts';
import { isCreConfigured } from '../cre/index.ts';
import { isGraphConfigured } from '../graph/index.ts';
import {
  Book,
  TradableSide,
  QuoteInput,
  QuoteResult,
  LifecycleStage,
  MarketStatus
} from '../core/types.ts';
import {
  ArcConfig,
  ArcContracts,
  ArcMarketSnapshot,
  RpcCaller
} from './types.ts';

export const ARC = Object.freeze({
  chainId: 5042002,
  chainName: 'Arc Testnet',
  collateral: '0x3600000000000000000000000000000000000000',
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorer: 'https://testnet.arcscan.app'
});

export function toTimestampMs(secondsOrMs: number | bigint): number {
  const n = Number(secondsOrMs);
  if (n === Infinity) return Infinity;
  if (n <= 0 || !Number.isFinite(n)) return 0;
  return n >= 100_000_000 && n < 100_000_000_000 ? n * 1000 : n;
}

export function configuration(env: Record<string, string | undefined> = {}): ArcConfig {
  const binaryAMM = env.ARC_BINARY_AMM || '';
  const yesShareAMM = env.ARC_YES_SHARE_AMM || '';
  const noShareAMM = env.ARC_NO_SHARE_AMM || '';
  const binarySplit = env.ARC_BINARY_VAULT || '';
  const shareSplit = env.ARC_SHARE_VAULT || '';
  const oracle = env.ARC_ORACLE || '';

  const contracts: ArcContracts = {
    binaryAMM,
    yesShareAMM,
    noShareAMM,
    binarySplit,
    shareSplit,
    oracle
  };

  const arcReady = Object.values(contracts).every(isAddress);

  return {
    chainId: ARC.chainId,
    chainName: ARC.chainName,
    collateral: ARC.collateral,
    explorer: ARC.explorer,
    rpcUrl: env.ARC_RPC_URL || env.RPC_URL || ARC.rpcUrl,
    arcReady,
    creReady: isCreConfigured(env),
    graphReady: isGraphConfigured(env),
    contracts,
    csrf: ''
  };
}

export function makeRpc({
  endpoint,
  fetchImpl = globalThis.fetch
}: {
  endpoint?: string;
  fetchImpl?: typeof globalThis.fetch;
} = {}): RpcCaller {
  const finalEndpoint = endpoint || process.env.ARC_RPC_URL || process.env.RPC_URL || ARC.rpcUrl;
  return async (method: string, params: unknown[] = []): Promise<unknown> => {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await fetchImpl(finalEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(10_000)
        });
      } catch {
        if (attempt === 4) {
          throw new MarketError('Arc network is unavailable. Check your connection or retry.', 'NETWORK_ERROR', 503);
        }
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        continue;
      }

      if (res.status === 429) {
        if (attempt === 4) {
          throw new MarketError('Arc RPC returned an error response.', 'RPC_ERROR', 503);
        }
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      break;
    }

    if (!res || !res.ok) {
      throw new MarketError('Arc RPC returned an error response.', 'RPC_ERROR', 503);
    }

    let payload: { result?: unknown; error?: { message?: string } };
    try {
      payload = (await res.json()) as { result?: unknown; error?: { message?: string } };
    } catch {
      throw new MarketError('Invalid JSON returned by Arc RPC.', 'RPC_ERROR', 503);
    }

    if (payload.error) {
      throw new MarketError(payload.error.message || 'Arc RPC rejected this request.', 'RPC_ERROR', 503);
    }

    return payload.result;
  };
}

export async function readArc(
  config: ArcConfig,
  { rpc }: { rpc?: RpcCaller } = {}
): Promise<ArcMarketSnapshot> {
  if (!config.arcReady) {
    throw new MarketError('Arc deployment is not configured. Add verified contract addresses on the server; sandbox remains separate.', 'ARC_NOT_CONFIGURED', 503);
  }

  const activeRpc = rpc || makeRpc({ endpoint: config.rpcUrl });
  const c = config.contracts;
  const chainIdHex = (await activeRpc('eth_chainId', [])) as string;
  if (BigInt(chainIdHex) !== 5042002n) {
    throw new MarketError('Unexpected RPC chain. Refusing to use it.', 'WRONG_CHAIN', 503);
  }

  const block = (await activeRpc('eth_blockNumber')) as string;
  const call = async (to: string, signature: string, args: (string | number | bigint | boolean)[] = []): Promise<bigint[]> => {
    const raw = (await activeRpc('eth_call', [{ to, data: encode(signature, args) }, block])) as string;
    return words(raw);
  };

  const [
    b, y, n, s, sy, es, sye, lc, cap6, pay, resVal, resLocked, remLiab,
    evDeadline, shCutoff, priceFixTime, orclSpot, decimals, fb, fy, fn
  ] = await Promise.all([
    call(c.binaryAMM, 'reserves()'),
    call(c.yesShareAMM, 'reserves()'),
    call(c.noShareAMM, 'reserves()'),
    call(c.binarySplit, 'settled()'),
    call(c.shareSplit, 'settled()'),
    call(c.binarySplit, 'eventYes()'),
    call(c.shareSplit, 'eventYes()'),
    call(c.shareSplit, 'lifecycle()'),
    call(c.shareSplit, 'cap6()'),
    call(c.shareSplit, 'settlementValue6()'),
    call(c.shareSplit, 'residualValue6()'),
    call(c.shareSplit, 'residualLocked6()'),
    call(c.shareSplit, 'remainingLiabilities6()'),
    call(c.shareSplit, 'eventDeadline()'),
    call(c.shareSplit, 'tradingCutoff()'),
    call(c.shareSplit, 'earliestPriceFixTime()'),
    call(c.oracle, 'settlementValue6()'),
    call(ARC.collateral, 'decimals()'),
    call(c.binaryAMM, 'feeBps()'),
    call(c.yesShareAMM, 'feeBps()'),
    call(c.noShareAMM, 'feeBps()')
  ]);

  if (decimals[0] !== 6n) {
    throw new MarketError('Collateral decimals are not six.', 'BAD_COLLATERAL', 503);
  }
  if ([fb, fy, fn].some(f => f[0] !== 30n)) {
    throw new MarketError('Pool fee differs from this deployment specification.', 'BAD_FEE', 503);
  }

  const binSettled = s[0] === 1n;
  const shareLc = lc[0];
  const shareSettled = sy[0] === 1n;
  const binYes = es[0] === 1n;
  const shareYes = sye[0] === 1n;

  // Strict lifecycle validation: OPEN, EVENT_RESOLVED (PRICE_PENDING), or PRICE_FIXED (SETTLED)
  if (shareLc === 0n) {
    if (binSettled || shareSettled) {
      throw new MarketError('Vault settlement is inconsistent. Stop and inspect the oracle.', 'BAD_STATE', 503);
    }
  } else if (shareLc === 1n) {
    if (!binSettled || shareSettled || binYes !== shareYes) {
      throw new MarketError('Vault settlement is inconsistent. Stop and inspect the oracle.', 'BAD_STATE', 503);
    }
  } else if (shareLc === 2n) {
    if (!binSettled || !shareSettled || binYes !== shareYes) {
      throw new MarketError('Vault settlement is inconsistent. Stop and inspect the oracle.', 'BAD_STATE', 503);
    }
  } else {
    throw new MarketError('Vault settlement is inconsistent. Stop and inspect the oracle.', 'BAD_STATE', 503);
  }

  const lifecycle: LifecycleStage = shareLc === 2n ? 'PRICE_FIXED' : shareLc === 1n ? 'EVENT_RESOLVED' : 'OPEN';
  const status: MarketStatus = lifecycle === 'PRICE_FIXED' ? 'settled' : lifecycle === 'EVENT_RESOLVED' ? 'event_resolved' : 'open';
  const resolvedOutcome: 'YES' | 'NO' | null = lifecycle !== 'OPEN' ? (shareYes ? 'YES' : 'NO') : null;
  const cap = cap6[0] > 0n ? Number(cap6[0] / 1_000_000n) : 500;

  let stats;
  if (lifecycle === 'PRICE_FIXED') {
    const p = shareYes ? 1.0 : 0.0;
    const payout = Number(pay[0]) / 1e6;
    stats = {
      p,
      eYes: shareYes ? payout : null,
      eNo: !shareYes ? payout : null,
      impact: null,
      impliedSpot: payout,
      yesSharePrice: shareYes ? payout : 0,
      noSharePrice: !shareYes ? payout : 0,
      cap
    };
  } else if (lifecycle === 'EVENT_RESOLVED') {
    const p = shareYes ? 1.0 : 0.0;
    if (shareYes) {
      const yesSharePrice = (y[0] > 0n && y[1] > 0n) ? Number((y[0] * TOKEN) / y[1]) / 1e6 : 0;
      stats = {
        p: 1.0,
        eYes: yesSharePrice,
        eNo: null,
        impact: null,
        impliedSpot: yesSharePrice,
        yesSharePrice,
        noSharePrice: 0,
        cap
      };
    } else {
      const noSharePrice = (n[0] > 0n && n[1] > 0n) ? Number((n[0] * TOKEN) / n[1]) / 1e6 : 0;
      stats = {
        p: 0.0,
        eYes: null,
        eNo: noSharePrice,
        impact: null,
        impliedSpot: noSharePrice,
        yesSharePrice: 0,
        noSharePrice,
        cap
      };
    }
  } else {
    // OPEN
    if ([...b, ...y, ...n].some(v => v <= 0n)) {
      throw new MarketError('Pools need positive liquidity in both assets.', 'NO_LIQUIDITY', 503);
    }
    stats = fourNumbers(binaryPrice(b[0], b[1]), Number((y[0] * TOKEN) / y[1]) / 1e6, Number((n[0] * TOKEN) / n[1]) / 1e6, cap);
  }

  return {
    mode: 'arc',
    market: MARKET,
    revision: Number(BigInt(block)),
    blockNumber: block,
    lifecycle,
    status,
    resolvedOutcome,
    cap,
    stats,
    timing: {
      eventDeadline: toTimestampMs(evDeadline[0]),
      tradingCutoff: toTimestampMs(shCutoff[0]),
      earliestPriceFixTime: toTimestampMs(priceFixTime[0]),
      policy: Number(evDeadline[0]) > 0 ? 'scheduled' : 'untimed',
      observationRule: 'Planned settlement observation window (30-minute TWAP reference after trading cutoff; current testnet deployment uses manual DEMO_ORACLE submission)',
      priceSource: 'DEMO_ORACLE manual submission (planned TWAP oracle reference)'
    },
    balance: '',
    volume: '',
    positions: [],
    history: [],
    vaults: {
      remainingLiabilities: formatUnits(remLiab[0]),
      residualLocked: formatUnits(resLocked[0])
    },
    claimed: '',
    settlement: lifecycle === 'PRICE_FIXED' ? {
      eventYes: shareYes,
      spot: formatUnits(orclSpot[0] ?? pay[0]),
      payout: formatUnits(pay[0]),
      residual: formatUnits(resVal[0]),
      residualValue: formatUnits(resVal[0]),
      residualLocked: formatUnits(resLocked[0]),
      capped: (orclSpot[0] ?? pay[0]) > (cap6[0] > 0n ? cap6[0] : 500_000_000n)
    } : null
  };
}

export async function quoteArc(
  config: ArcConfig,
  input: QuoteInput,
  { rpc }: { rpc?: RpcCaller } = {}
): Promise<QuoteResult> {
  const activeRpc = rpc || makeRpc({ endpoint: config.rpcUrl });
  const state = await readArc(config, { rpc: activeRpc });
  if (state.status === 'settled' || state.lifecycle === 'PRICE_FIXED') {
    throw new MarketError('Market has settled.', 'SETTLED', 409);
  }

  const now = Date.now();
  const cutoffMs = toTimestampMs(state.timing?.tradingCutoff ?? 0);
  if (cutoffMs > 0 && now > cutoffMs) {
    throw new MarketError('Testnet demo trading window closed.', 'TRADING_FROZEN', 409);
  }

  const { book, side, amount, slippageBps = 50 } = input;
  if (!['binary', 'asset'].includes(book) || !['yes', 'no'].includes(side) || !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) {
    throw new MarketError('Invalid quote parameters.');
  }

  if (state.lifecycle === 'EVENT_RESOLVED') {
    if (book === 'binary') {
      throw new MarketError('Binary trading is closed because the event has resolved.', 'TRADING_FROZEN', 409);
    }
    const winningSide: TradableSide = state.resolvedOutcome === 'YES' ? 'yes' : 'no';
    if (side !== winningSide) {
      throw new MarketError('Trading is frozen for the losing asset outcome.', 'TRADING_FROZEN', 409);
    }
  }

  const a = parseUnits(amount);
  if (a > 1_000_000n * 1_000_000n) throw new MarketError('Order exceeds app limit.');
  const c = config.contracts;
  const to = book === 'binary'
    ? c.binaryAMM
    : side === 'yes'
      ? c.yesShareAMM
      : c.noShareAMM;

  const data = book === 'binary'
    ? encode('quoteBuy(bool,uint256)', [side === 'yes', a])
    : encode('quoteBuyShares(uint256)', [a]);

  const [out, fee] = words((await activeRpc('eth_call', [{ to, data }, state.blockNumber])) as string);
  if (out <= 0n) throw new MarketError('Quote returned no shares.');
  const avg = Number(a) / 1e6 / (Number(out) / 1e18);
  const mid = book === 'binary'
    ? (side === 'yes' ? state.stats.p : 1 - state.stats.p)
    : state.stats[side === 'yes' ? 'yesSharePrice' : 'noSharePrice'];
  const priceImpactPct = mid > 0 ? (avg / mid - 1) * 100 : 0;

  return {
    book,
    side,
    amount: formatUnits(a),
    outUnits: out.toString(),
    quantity: formatUnits(out, 18, 6),
    minOutUnits: (out * BigInt(10000 - slippageBps) / 10000n).toString(),
    fee: formatUnits(fee),
    averagePrice: avg,
    priceImpactPct,
    slippageBps,
    revision: state.revision,
    expiresAt: Date.now() + 120_000,
    mode: 'arc'
  };
}
