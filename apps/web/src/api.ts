import { SandboxMarket, parseUnits, formatUnits } from '../../../packages/core/market.mjs';
import type {
  MarketSnapshot,
  QuoteResult,
  QuoteInput,
  TradeInput,
  TradeResult,
  PairsInput,
  Book,
  TradableSide,
  MarketStats,
  SandboxMarketOptions,
  FormattedPositionRow,
  ActivityRecord,
  FormattedSettlementSummary
} from '../../../packages/core/types.ts';
import type {
  ArcConfig,
  ArcMarketSnapshot,
  ArcPositionRow,
  ArcSettlementInfo
} from '../../../packages/arc/types.ts';

export type Mode = 'sandbox' | 'arc';
export type {
  Book,
  MarketSnapshot,
  FormattedPositionRow,
  ActivityRecord,
  FormattedSettlementSummary,
  ArcMarketSnapshot,
  ArcPositionRow,
  ArcSettlementInfo
};
export type Side = TradableSide;
export type Stats = MarketStats;
export type Quote = QuoteResult;
export type AnyMarketSnapshot = MarketSnapshot | ArcMarketSnapshot;
export type AnyPositionRow = FormattedPositionRow | ArcPositionRow;

export interface ReferenceItem {
  status: 'live' | 'stale' | 'unavailable';
  value: number | null;
  label: string;
  asset?: string;
  comparable?: boolean;
  error?: string;
  source?: string;
  asOf?: string;
}

export type CrossProtocolStatus = 'agreeing' | 'disagreeing' | 'single_source' | 'unavailable';

export interface ProtocolSourceResult {
  protocol: string;
  network: string;
  subgraphId: string;
  poolId: string;
  poolName: string;
  assetSymbol: string;
  assetAddress: string;
  quoteSymbol: string;
  quoteAddress: string;
  price: number | null;
  tvlUSD: number | null;
  volumeUSD: number | null;
  blockNumber: number | null;
  blockTimestamp: number | null;
  status: 'live' | 'stale' | 'unavailable';
  updatedAt: string | null;
  error?: string;
}

export interface CrossProtocolReference {
  status: CrossProtocolStatus;
  source1: ProtocolSourceResult;
  source2: ProtocolSourceResult;
  consensusPrice: number | null;
  disagreement: number | null;
  disagreementPercent: string | null;
  disagreementThreshold: number;
  maxAgeSeconds: number;
  summary: string;
  comparable: boolean;
  updatedAt: string | null;
}

export interface ReferencesData {
  probability: ReferenceItem;
  spot: ReferenceItem;
  crossProtocol?: CrossProtocolReference;
}

export interface ConfigResponse extends ArcConfig {
  preview?: boolean;
}

export interface ClipResult {
  allowed: boolean;
  clippedSize: string;
  reason?: string;
}

export interface WalletState {
  account: string;
  balance: string;
}

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    __THELEMA_PREVIEW__?: boolean;
    ethereum?: Eip1193Provider;
  }
}

export const PREVIEW = typeof window !== 'undefined' && Boolean(window.__THELEMA_PREVIEW__);

export const defaults: ConfigResponse = {
  chainId: 5042002,
  chainName: 'Arc Testnet',
  collateral: '0x3600000000000000000000000000000000000000',
  explorer: 'https://testnet.arcscan.app',
  arcReady: false,
  creReady: false,
  graphReady: false,
  contracts: {
    binaryAMM: '',
    yesShareAMM: '',
    noShareAMM: '',
    binarySplit: '',
    shareSplit: '',
    oracle: ''
  },
  csrf: ''
};

export const emptyRefs: ReferencesData = {
  probability: {
    status: 'unavailable',
    value: null,
    label: 'Related event reference',
    error: 'No live source is configured.'
  },
  spot: {
    status: 'unavailable',
    value: null,
    label: 'Asset reference',
    asset: 'sNVDA',
    comparable: false,
    error: 'No live source is configured.'
  }
};

export interface ApiOptions {
  fetchImpl?: typeof globalThis.fetch;
}

function validateSnapshot(obj: Record<string, unknown>, context = 'market'): void {
  if (
    (obj.mode !== 'sandbox' && obj.mode !== 'arc') ||
    typeof obj.stats !== 'object' ||
    obj.stats === null
  ) {
    throw new Error(`Malformed API response: invalid ${context} payload.`);
  }

  const stats = obj.stats as Record<string, unknown>;
  if (
    typeof stats.p !== 'number' ||
    !Number.isFinite(stats.p) ||
    stats.p < 0 ||
    stats.p > 1 ||
    typeof stats.impliedSpot !== 'number' ||
    !Number.isFinite(stats.impliedSpot) ||
    stats.impliedSpot < 0 ||
    typeof stats.cap !== 'number' ||
    !Number.isFinite(stats.cap) ||
    stats.cap <= 0
  ) {
    throw new Error(`Malformed API response: invalid ${context} stats.`);
  }

  const lifecycle = obj.lifecycle as string | undefined;
  if (lifecycle && !['OPEN', 'EVENT_RESOLVED', 'PRICE_FIXED'].includes(lifecycle)) {
    throw new Error(`Malformed API response: invalid ${context} lifecycle stage.`);
  }

  if (lifecycle === 'EVENT_RESOLVED') {
    if (obj.resolvedOutcome !== 'YES' && obj.resolvedOutcome !== 'NO') {
      throw new Error(`Malformed API response: resolved market missing outcome.`);
    }
  } else if (lifecycle === 'PRICE_FIXED') {
    if (obj.status !== 'settled') {
      throw new Error(`Malformed API response: price-fixed market must be settled.`);
    }
    if (typeof obj.settlement !== 'object' || obj.settlement === null) {
      throw new Error(`Malformed API response: settled market missing settlement details.`);
    }
  }
}

export function validateApiResponse(path: string, data: unknown): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Malformed API response: expected JSON object.');
  }

  const route = path.split('?')[0];
  const obj = data as Record<string, unknown>;

  if (route === '/api/config') {
    if (
      typeof obj.chainId !== 'number' ||
      typeof obj.chainName !== 'string' ||
      typeof obj.contracts !== 'object' ||
      obj.contracts === null ||
      typeof obj.csrf !== 'string'
    ) {
      throw new Error('Malformed API response: invalid configuration payload.');
    }
  } else if (route === '/api/market') {
    validateSnapshot(obj, 'market');
  } else if (route === '/api/references') {
    if (
      typeof obj.probability !== 'object' ||
      obj.probability === null ||
      typeof obj.spot !== 'object' ||
      obj.spot === null ||
      typeof (obj.probability as Record<string, unknown>).status !== 'string' ||
      typeof (obj.spot as Record<string, unknown>).status !== 'string'
    ) {
      throw new Error('Malformed API response: invalid references payload.');
    }
  } else if (route === '/api/clip') {
    if (
      typeof obj.allowed !== 'boolean' ||
      typeof obj.clippedSize !== 'string' ||
      !/^(0|[1-9]\d{0,18})(\.\d{1,6})?$/.test(obj.clippedSize)
    ) {
      throw new Error('Malformed API response: invalid size clip payload.');
    }
  } else if (route === '/api/sandbox/quote' || route === '/api/arc/quote') {
    if (
      !['binary', 'asset'].includes(obj.book as string) ||
      !['yes', 'no'].includes(obj.side as string) ||
      (obj.mode !== 'sandbox' && obj.mode !== 'arc') ||
      typeof obj.amount !== 'string' ||
      !/^\d+(\.\d{1,6})?$/.test(obj.amount) ||
      typeof obj.quantity !== 'string' ||
      typeof obj.outUnits !== 'string' ||
      !/^\d+$/.test(obj.outUnits) ||
      BigInt(obj.outUnits) <= 0n ||
      typeof obj.minOutUnits !== 'string' ||
      !/^\d+$/.test(obj.minOutUnits) ||
      BigInt(obj.minOutUnits) <= 0n ||
      BigInt(obj.minOutUnits) > BigInt(obj.outUnits) ||
      typeof obj.fee !== 'string' ||
      typeof obj.averagePrice !== 'number' ||
      !Number.isFinite(obj.averagePrice) ||
      obj.averagePrice <= 0 ||
      typeof obj.priceImpactPct !== 'number' ||
      !Number.isFinite(obj.priceImpactPct) ||
      typeof obj.slippageBps !== 'number' ||
      !Number.isInteger(obj.slippageBps) ||
      obj.slippageBps < 1 ||
      obj.slippageBps > 500 ||
      typeof obj.revision !== 'number' ||
      !Number.isInteger(obj.revision) ||
      obj.revision < 0 ||
      typeof obj.expiresAt !== 'number' ||
      !Number.isFinite(obj.expiresAt) ||
      obj.expiresAt <= 0
    ) {
      throw new Error('Malformed API response: invalid quote payload.');
    }
  } else if (route === '/api/sandbox/trade') {
    if (
      typeof obj.trade !== 'object' ||
      obj.trade === null ||
      typeof obj.snapshot !== 'object' ||
      obj.snapshot === null
    ) {
      throw new Error('Malformed API response: invalid trade payload.');
    }
    const trade = obj.trade as Record<string, unknown>;
    if (
      !['binary', 'asset'].includes(trade.book as string) ||
      !['yes', 'no'].includes(trade.side as string) ||
      typeof trade.amount !== 'string' ||
      typeof trade.quantity !== 'string' ||
      typeof trade.type !== 'string'
    ) {
      throw new Error('Malformed API response: invalid trade object.');
    }
    validateSnapshot(obj.snapshot as Record<string, unknown>, 'trade snapshot');
  } else if (route === '/api/sandbox/claim') {
    if (
      typeof obj.paid !== 'string' ||
      !/^\d+(\.\d{1,6})?$/.test(obj.paid) ||
      typeof obj.snapshot !== 'object' ||
      obj.snapshot === null
    ) {
      throw new Error('Malformed API response: invalid claims payload.');
    }
    validateSnapshot(obj.snapshot as Record<string, unknown>, 'claim snapshot');
  } else if (route.startsWith('/api/sandbox/')) {
    validateSnapshot(obj, 'sandbox snapshot');
  }
}

let csrf = '';
let sandbox = new SandboxMarket();

export async function api<T = unknown>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  options: ApiOptions = {}
): Promise<T> {
  if (PREVIEW) {
    const route = path.split('?')[0];
    if (route === '/api/config') return { ...defaults, preview: true } as unknown as T;
    if (route === '/api/market') {
      if (path.includes('mode=arc')) {
        throw new Error('Arc mode needs the local server, deployed contracts and a connected wallet.');
      }
      return sandbox.snapshot() as unknown as T;
    }
    if (route === '/api/references') return structuredClone(emptyRefs) as unknown as T;

    if (route === '/api/clip') {
      const b = body as { mode?: string; requestedSize: string };
      if (b.mode !== 'sandbox') throw new Error('No confidential endpoint is connected.');
      const n = parseUnits(b.requestedSize);
      const clipped = n > 50_000_000n ? 50_000_000n : n;
      return { allowed: true, clippedSize: formatUnits(clipped) } as unknown as T;
    }

    if (route === '/api/sandbox/quote') return sandbox.quote(body as QuoteInput) as unknown as T;
    if (route === '/api/sandbox/trade') return sandbox.trade(body as TradeInput) as unknown as T;
    if (route === '/api/sandbox/pairs') return sandbox.pairs(body as PairsInput) as unknown as T;
    if (route === '/api/sandbox/resolve-event') return sandbox.resolveEvent(body as { eventYes: boolean }) as unknown as T;
    if (route === '/api/sandbox/fix-price') return sandbox.fixPrice(body as { spot: string }) as unknown as T;
    if (route === '/api/sandbox/settle') return sandbox.settle(body as { eventYes: boolean; spot: string }) as unknown as T;
    if (route === '/api/sandbox/claim') return sandbox.claim() as unknown as T;
    if (route === '/api/sandbox/reset') {
      let opts: SandboxMarketOptions = {};
      const resetBody = body as { timingPolicy?: string } | undefined;
      if (resetBody?.timingPolicy === 'accelerated-demo') {
        const now = Date.now();
        opts = {
          timingPolicy: 'accelerated-demo',
          tradingCutoff: now + 60000,
          eventDeadline: now + 120000,
          earliestPriceFixTime: now + 120000
        };
      } else if (resetBody && typeof resetBody === 'object' && resetBody.timingPolicy) {
        opts = resetBody;
      }
      sandbox = new SandboxMarket(opts);
      return sandbox.snapshot() as unknown as T;
    }
    throw new Error('This action requires the configured local server.');
  }

  const isArcClip = path === '/api/clip' && (body as { mode?: string } | undefined)?.mode === 'arc';
  const timeoutMs = isArcClip ? 60000 : 15000;
  const fetchFn = options.fetchImpl || globalThis.fetch;

  const res = await fetchFn(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }

  if (!res.ok) {
    const msg = (typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error: unknown }).error === 'string')
      ? (data as { error: string }).error
      : 'Request failed. Please retry.';
    throw new Error(msg);
  }

  validateApiResponse(path, data);

  if (path === '/api/config' && typeof data === 'object' && data !== null && 'csrf' in data && typeof (data as { csrf: unknown }).csrf === 'string') {
    csrf = (data as { csrf: string }).csrf;
  }

  return data as T;
}

export const money = (n: number | string | bigint | null | undefined, digits = 2): string =>
  n === null || n === undefined || n === '' || !Number.isFinite(Number(n))
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(Number(n));

export const pct = (n: number | string | null | undefined): string =>
  n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '—' : `${(Number(n) * 100).toFixed(1)}%`;

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : 'The action failed. Please retry.');

export const short = (s: string): string => (s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : s);
