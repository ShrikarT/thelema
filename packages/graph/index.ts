// Server only. Never bundle this file into the browser.
import type {
  ReferenceItem,
  GraphReferences,
  GetReferencesOptions,
  ProtocolSourceResult,
  CrossProtocolReference,
  CrossProtocolStatus
} from './types.ts';

export type * from './types.ts';

const GATEWAY = 'https://gateway.thegraph.com/api';
const PROB_QUERY =
  'query Probability($market: ID!) { reference: fixedProductMarketMaker(id: $market) { id values: outcomeTokenPrices } _meta { block { number timestamp } } }';
const SPOT_QUERY_MESSARI =
  'query Spot($pool: ID!) { reference: liquidityPool(id: $pool) { id tokens: inputTokens { id symbol } values: inputTokenPricesUSD } _meta { block { number timestamp } } }';
const SPOT_QUERY_UNISWAP3 =
  'query Spot($pool: ID!) { reference: pool(id: $pool) { id token0 { id symbol } token1 { id symbol } token0Price token1Price } _meta { block { number timestamp } } }';

export const STANDARDIZED_MESSARI_DEX_QUERY =
  'query StandardizedPool($poolId: ID!) { reference: liquidityPool(id: $poolId) { id name symbol protocol { id name network } inputTokens { id symbol name decimals lastPriceUSD lastPriceBlockNumber } inputTokenBalances totalValueLockedUSD cumulativeVolumeUSD createdTimestamp createdBlockNumber } _meta { block { number timestamp } deployment } }';

export const DEFAULT_CROSS_SOURCE1 = {
  protocol: 'Uniswap V3',
  network: 'ARBITRUM_ONE',
  subgraphId: 'FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX',
  poolId: '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443',
  assetSymbol: 'WETH',
  assetAddress: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
};

export const DEFAULT_CROSS_SOURCE2 = {
  protocol: 'SushiSwap',
  network: 'ARBITRUM_ONE',
  subgraphId: '9tSS5FaePZnjmnXnSKCCqKVLAqA6eGg6jA2oRojsXUbP',
  poolId: '0x905dfcd5649217c42684f23958568e533c711aa3',
  assetSymbol: 'WETH',
  assetAddress: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
};

const USD_SYMBOLS = ['USDC', 'USDT', 'DAI'];

const safeId = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_:-]{1,150}$/.test(x);

export function isGraphConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.GRAPH_API_KEY || !/^[a-zA-Z0-9_-]{8,200}$/.test(env.GRAPH_API_KEY)) {
    return false;
  }
  const hasProbability = safeId(env.GRAPH_PROBABILITY_MARKET_ID);
  const hasSpot = safeId(env.GRAPH_SPOT_SUBGRAPH_ID) && safeId(env.GRAPH_SPOT_POOL_ID) && Boolean(env.GRAPH_SPOT_TOKEN_SYMBOL);
  const hasCross = Boolean(
    env.GRAPH_CROSS_PROTOCOL_ENABLED === 'true' ||
    (safeId(env.GRAPH_CROSS_SOURCE1_SUBGRAPH_ID) && safeId(env.GRAPH_CROSS_SOURCE1_POOL_ID))
  );
  return Boolean(hasProbability || hasSpot || hasCross);
}

const finite = (x: unknown): number => {
  if ((typeof x !== 'number' && typeof x !== 'string') || String(x).trim() === '') {
    throw new Error('The source did not return a numeric reference.');
  }
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('The source returned an invalid reference.');
  }
  return n;
};

const missing = (label: string, error: string, extra: Record<string, unknown> = {}): ReferenceItem => ({
  status: 'unavailable',
  value: null,
  label,
  source: 'The Graph',
  updatedAt: null,
  error,
  ...extra
});

interface GraphQueryResult {
  reference: {
    values?: (string | number)[];
    tokens?: { id: string; symbol: string }[];
    token0?: { id: string; symbol: string };
    token1?: { id: string; symbol: string };
    token0Price?: string | number;
    token1Price?: string | number;
  };
  updatedAt: string;
}

async function query(
  env: Record<string, string | undefined>,
  id: string,
  queryString: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<GraphQueryResult> {
  const maxAge = Number(env.GRAPH_MAX_AGE_SECONDS || 900);
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 3600) {
    throw new Error('Graph maximum age must be an integer from 1 to 3600 seconds.');
  }
  if (!env.GRAPH_API_KEY) {
    throw new Error('Graph API key is not configured.');
  }
  if (!/^[a-zA-Z0-9_-]{8,200}$/.test(env.GRAPH_API_KEY) || !safeId(id)) {
    throw new Error('Graph configuration is invalid.');
  }

  let response: Response;
  try {
    response = await fetchImpl(`${GATEWAY}/${encodeURIComponent(env.GRAPH_API_KEY)}/subgraphs/id/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryString, variables }),
      signal: AbortSignal.timeout(6000),
      redirect: 'error'
    });
  } catch {
    throw new Error('Graph request timed out or is unreachable.');
  }

  if (!response.ok) throw new Error('Graph returned an HTTP error.');

  let j: unknown;
  try {
    j = await response.json();
  } catch {
    throw new Error('Graph returned invalid JSON.');
  }

  const resObj = j as {
    errors?: unknown[];
    data?: {
      reference?: {
        values?: (string | number)[];
        tokens?: { id: string; symbol: string }[];
        token0?: { id: string; symbol: string };
        token1?: { id: string; symbol: string };
        token0Price?: string | number;
        token1Price?: string | number;
      };
      _meta?: {
        block?: {
          timestamp?: unknown;
        };
      };
    };
  } | null;

  if (resObj?.errors?.length || !resObj?.data?.reference) {
    throw new Error('Graph schema or market lookup failed. Verify the configured subgraph.');
  }

  const ts = finite(resObj.data._meta?.block?.timestamp);
  if (ts < 1 || Date.now() / 1000 - ts > maxAge || ts > Date.now() / 1000 + 60) {
    throw new Error('Graph reference is stale or has invalid block time.');
  }

  return { reference: resObj.data.reference, updatedAt: new Date(ts * 1000).toISOString() };
}

export interface StandardizedSourceConfig {
  protocol: string;
  network?: string;
  subgraphId: string;
  poolId: string;
  assetSymbol?: string;
  assetAddress?: string;
}

export async function fetchStandardizedSource(
  env: Record<string, string | undefined>,
  config: StandardizedSourceConfig,
  fetchImpl: typeof fetch
): Promise<ProtocolSourceResult> {
  const maxAge = Number(env.GRAPH_MAX_AGE_SECONDS || 900);
  const result: ProtocolSourceResult = {
    protocol: config.protocol,
    network: config.network || 'ARBITRUM_ONE',
    subgraphId: config.subgraphId,
    poolId: config.poolId,
    poolName: '',
    assetSymbol: config.assetSymbol || 'WETH',
    assetAddress: config.assetAddress || '',
    quoteSymbol: '',
    quoteAddress: '',
    price: null,
    tvlUSD: null,
    volumeUSD: null,
    blockNumber: null,
    blockTimestamp: null,
    status: 'unavailable',
    updatedAt: null
  };

  if (!env.GRAPH_API_KEY || !config.subgraphId || !config.poolId) {
    result.error = 'Graph API key or source configuration is missing.';
    return result;
  }

  let res: Response;
  try {
    res = await fetchImpl(`${GATEWAY}/${encodeURIComponent(env.GRAPH_API_KEY)}/subgraphs/id/${config.subgraphId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: STANDARDIZED_MESSARI_DEX_QUERY,
        variables: { poolId: config.poolId.toLowerCase() }
      }),
      signal: AbortSignal.timeout(6000),
      redirect: 'error'
    });
  } catch {
    result.error = 'Graph gateway request timed out or is unreachable.';
    return result;
  }

  if (!res.ok) {
    result.error = `Graph gateway returned HTTP error ${res.status}.`;
    return result;
  }

  let body: {
    errors?: unknown[];
    data?: {
      reference?: {
        id?: string;
        name?: string;
        symbol?: string;
        protocol?: { id?: string; name?: string; network?: string };
        inputTokens?: { id: string; symbol: string; name?: string; decimals?: number; lastPriceUSD?: string | number }[];
        inputTokenBalances?: (string | number)[];
        totalValueLockedUSD?: string | number;
        cumulativeVolumeUSD?: string | number;
      };
      _meta?: {
        block?: { number?: unknown; timestamp?: unknown };
        deployment?: string;
      };
    };
  };
  try {
    body = await res.json();
  } catch {
    result.error = 'Graph gateway returned invalid JSON.';
    return result;
  }

  if (body.errors?.length || !body.data?.reference) {
    result.error = 'Standardized pool entity not found or schema error in subgraph.';
    return result;
  }

  const pool = body.data.reference;
  result.poolName = pool.name || pool.symbol || '';
  if (pool.protocol?.name) result.protocol = pool.protocol.name;
  if (pool.protocol?.network) result.network = pool.protocol.network;

  const blockTs = Number(body.data._meta?.block?.timestamp);
  const blockNum = Number(body.data._meta?.block?.number);
  result.blockNumber = Number.isFinite(blockNum) ? blockNum : null;
  result.blockTimestamp = Number.isFinite(blockTs) ? blockTs : null;

  const nowSec = Date.now() / 1000;
  if (!Number.isFinite(blockTs) || blockTs < 1 || nowSec - blockTs > maxAge || blockTs > nowSec + 60) {
    result.status = 'stale';
    result.error = 'Reference block timestamp is stale or in the future.';
    return result;
  }
  result.updatedAt = new Date(blockTs * 1000).toISOString();

  const tokens = pool.inputTokens || [];
  if (!Array.isArray(tokens) || tokens.length < 2) {
    result.error = 'Standardized pool contains fewer than 2 input tokens.';
    return result;
  }

  const assetIdx = tokens.findIndex(t => t.symbol?.toUpperCase() === result.assetSymbol.toUpperCase());
  if (assetIdx < 0) {
    result.error = `Pool does not contain target asset ${result.assetSymbol}.`;
    return result;
  }

  const assetToken = tokens[assetIdx];
  if (config.assetAddress && assetToken.id.toLowerCase() !== config.assetAddress.toLowerCase()) {
    result.error = `Token contract address mismatch: expected ${config.assetAddress}, got ${assetToken.id}.`;
    return result;
  }
  result.assetAddress = assetToken.id;

  const quoteIdx = tokens.findIndex((t, i) => i !== assetIdx && USD_SYMBOLS.includes(t.symbol?.toUpperCase()));
  if (quoteIdx < 0) {
    result.error = 'Pool does not contain a supported USD quote token (USDC, USDT, DAI). Non-USD pool ratio rejected.';
    return result;
  }
  const quoteToken = tokens[quoteIdx];
  result.quoteSymbol = quoteToken.symbol;
  result.quoteAddress = quoteToken.id;

  const rawPrice = Number(assetToken.lastPriceUSD);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    result.error = 'Pool does not contain a positive lastPriceUSD for the asset token.';
    return result;
  }

  result.price = rawPrice;
  result.tvlUSD = Number.isFinite(Number(pool.totalValueLockedUSD)) ? Number(pool.totalValueLockedUSD) : null;
  result.volumeUSD = Number.isFinite(Number(pool.cumulativeVolumeUSD)) ? Number(pool.cumulativeVolumeUSD) : null;
  result.status = 'live';
  return result;
}

export function analyzeCrossProtocol(
  s1: ProtocolSourceResult,
  s2: ProtocolSourceResult,
  options: { threshold?: number; maxAge?: number } = {}
): CrossProtocolReference {
  const threshold = options.threshold ?? 0.015;
  const maxAge = options.maxAge ?? 900;
  const s1Live = s1.status === 'live' && s1.price !== null && s1.price > 0;
  const s2Live = s2.status === 'live' && s2.price !== null && s2.price > 0;

  if (s1Live && s2Live && s1.price !== null && s2.price !== null) {
    const mean = (s1.price + s2.price) / 2;
    const diff = Math.abs(s1.price - s2.price);
    const disagreement = diff / mean;
    const pctStr = `${(disagreement * 100).toFixed(2)}%`;

    if (disagreement <= threshold) {
      return {
        status: 'agreeing',
        source1: s1,
        source2: s2,
        consensusPrice: mean,
        disagreement,
        disagreementPercent: pctStr,
        disagreementThreshold: threshold,
        maxAgeSeconds: maxAge,
        summary: `${s1.protocol} ($${s1.price.toFixed(2)}) and ${s2.protocol} ($${s2.price.toFixed(2)}) agree within ${pctStr} spread (threshold ${(threshold * 100).toFixed(1)}%).`,
        comparable: false,
        updatedAt: s1.updatedAt && s2.updatedAt && s1.updatedAt > s2.updatedAt ? s2.updatedAt : s1.updatedAt || s2.updatedAt
      };
    } else {
      return {
        status: 'disagreeing',
        source1: s1,
        source2: s2,
        consensusPrice: null,
        disagreement,
        disagreementPercent: pctStr,
        disagreementThreshold: threshold,
        maxAgeSeconds: maxAge,
        summary: `${s1.protocol} ($${s1.price.toFixed(2)}) and ${s2.protocol} ($${s2.price.toFixed(2)}) disagree by ${pctStr}, exceeding the ${(threshold * 100).toFixed(1)}% threshold.`,
        comparable: false,
        updatedAt: s1.updatedAt && s2.updatedAt && s1.updatedAt > s2.updatedAt ? s2.updatedAt : s1.updatedAt || s2.updatedAt
      };
    }
  }

  if (s1Live && !s2Live) {
    return {
      status: 'single_source',
      source1: s1,
      source2: s2,
      consensusPrice: s1.price,
      disagreement: null,
      disagreementPercent: null,
      disagreementThreshold: threshold,
      maxAgeSeconds: maxAge,
      summary: `Single valid source (${s1.protocol} at $${s1.price!.toFixed(2)}). ${s2.protocol} is ${s2.status}: ${s2.error || 'unavailable'}.`,
      comparable: false,
      updatedAt: s1.updatedAt
    };
  }

  if (!s1Live && s2Live) {
    return {
      status: 'single_source',
      source1: s1,
      source2: s2,
      consensusPrice: s2.price,
      disagreement: null,
      disagreementPercent: null,
      disagreementThreshold: threshold,
      maxAgeSeconds: maxAge,
      summary: `Single valid source (${s2.protocol} at $${s2.price!.toFixed(2)}). ${s1.protocol} is ${s1.status}: ${s1.error || 'unavailable'}.`,
      comparable: false,
      updatedAt: s2.updatedAt
    };
  }

  return {
    status: 'unavailable',
    source1: s1,
    source2: s2,
    consensusPrice: null,
    disagreement: null,
    disagreementPercent: null,
    disagreementThreshold: threshold,
    maxAgeSeconds: maxAge,
    summary: `No usable Graph reference source. ${s1.protocol}: ${s1.error || s1.status}; ${s2.protocol}: ${s2.error || s2.status}.`,
    comparable: false,
    updatedAt: null
  };
}

export async function getCrossProtocolReferences({
  env = process.env,
  fetchImpl = fetch
}: GetReferencesOptions = {}): Promise<CrossProtocolReference> {
  const threshold = Number(env.GRAPH_CROSS_DISAGREEMENT_THRESHOLD || 0.015);
  const maxAge = Number(env.GRAPH_MAX_AGE_SECONDS || 900);

  const s1Config: StandardizedSourceConfig = {
    protocol: env.GRAPH_CROSS_SOURCE1_PROTOCOL || DEFAULT_CROSS_SOURCE1.protocol,
    network: env.GRAPH_CROSS_SOURCE1_NETWORK || DEFAULT_CROSS_SOURCE1.network,
    subgraphId: env.GRAPH_CROSS_SOURCE1_SUBGRAPH_ID || DEFAULT_CROSS_SOURCE1.subgraphId,
    poolId: env.GRAPH_CROSS_SOURCE1_POOL_ID || DEFAULT_CROSS_SOURCE1.poolId,
    assetSymbol: env.GRAPH_CROSS_TOKEN_SYMBOL || DEFAULT_CROSS_SOURCE1.assetSymbol,
    assetAddress: env.GRAPH_CROSS_TOKEN_ADDRESS || DEFAULT_CROSS_SOURCE1.assetAddress
  };

  const s2Config: StandardizedSourceConfig = {
    protocol: env.GRAPH_CROSS_SOURCE2_PROTOCOL || DEFAULT_CROSS_SOURCE2.protocol,
    network: env.GRAPH_CROSS_SOURCE2_NETWORK || DEFAULT_CROSS_SOURCE2.network,
    subgraphId: env.GRAPH_CROSS_SOURCE2_SUBGRAPH_ID || DEFAULT_CROSS_SOURCE2.subgraphId,
    poolId: env.GRAPH_CROSS_SOURCE2_POOL_ID || DEFAULT_CROSS_SOURCE2.poolId,
    assetSymbol: env.GRAPH_CROSS_TOKEN_SYMBOL || DEFAULT_CROSS_SOURCE2.assetSymbol,
    assetAddress: env.GRAPH_CROSS_TOKEN_ADDRESS || DEFAULT_CROSS_SOURCE2.assetAddress
  };

  const [s1, s2] = await Promise.all([
    fetchStandardizedSource(env, s1Config, fetchImpl),
    fetchStandardizedSource(env, s2Config, fetchImpl)
  ]);

  return analyzeCrossProtocol(s1, s2, { threshold, maxAge });
}

export interface ExtendedGetReferencesOptions extends GetReferencesOptions {
  includeCrossProtocol?: boolean;
}

export async function getReferences({
  env = process.env,
  fetchImpl = fetch,
  includeCrossProtocol = false
}: ExtendedGetReferencesOptions = {}): Promise<GraphReferences> {
  const probability = async (): Promise<ReferenceItem> => {
    const label = 'Related event reference';
    try {
      if (!safeId(env.GRAPH_PROBABILITY_MARKET_ID)) throw new Error('Graph event market is not configured.');
      const id = env.GRAPH_PROBABILITY_SUBGRAPH_ID || 'Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp';
      const q = await query(env, id, PROB_QUERY, { market: env.GRAPH_PROBABILITY_MARKET_ID }, fetchImpl);
      const index = Number(env.GRAPH_YES_INDEX || 0);
      if (index !== 0 && index !== 1) throw new Error('YES outcome index must be zero or one.');
      const value = finite(q.reference.values?.[index]);
      if (value > 1) throw new Error('Probability is outside zero to one.');
      return { status: 'live', value, label, source: 'The Graph', updatedAt: q.updatedAt };
    } catch (e: unknown) {
      return missing(label, e instanceof Error ? e.message : 'The action failed.');
    }
  };

  const spot = async (): Promise<ReferenceItem> => {
    const label = 'External asset reference';
    const asset = env.GRAPH_SPOT_ASSET || 'unconfigured';
    try {
      if (!safeId(env.GRAPH_SPOT_SUBGRAPH_ID) || !safeId(env.GRAPH_SPOT_POOL_ID) || !env.GRAPH_SPOT_TOKEN_SYMBOL) {
        throw new Error('Graph spot pool and token are not configured.');
      }
      const isUniV3 =
        env.GRAPH_SPOT_SCHEMA === 'uniswap3' ||
        env.GRAPH_SPOT_SUBGRAPH_ID === '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';
      const spotQuery = isUniV3 ? SPOT_QUERY_UNISWAP3 : SPOT_QUERY_MESSARI;
      const q = await query(env, env.GRAPH_SPOT_SUBGRAPH_ID, spotQuery, { pool: env.GRAPH_SPOT_POOL_ID }, fetchImpl);
      const ref = q.reference;
      if (ref.token0 && ref.token1 && (!ref.tokens || !ref.values)) {
        const t0Symbol = ref.token0.symbol;
        const t1Symbol = ref.token1.symbol;
        const isUsd = (sym: string) => ['USDC', 'USDT', 'DAI'].includes(sym?.toUpperCase());
        let p0: number, p1: number;
        if (isUsd(t0Symbol)) {
          p0 = 1;
          p1 = finite(ref.token0Price);
        } else if (isUsd(t1Symbol)) {
          p1 = 1;
          p0 = finite(ref.token1Price);
        } else {
          throw new Error('Reference pool does not contain a supported USD quote token (USDC, USDT, DAI). Non-USD pool ratio rejected.');
        }
        ref.tokens = [
          { id: ref.token0.id, symbol: t0Symbol },
          { id: ref.token1.id, symbol: t1Symbol }
        ];
        ref.values = [p0, p1];
      }
      const index = ref.tokens?.findIndex((t: { symbol: string }) => t.symbol === env.GRAPH_SPOT_TOKEN_SYMBOL);
      if (!Number.isInteger(index) || index === undefined || index < 0) {
        throw new Error('Configured token is not in the reference pool.');
      }
      const value = finite(ref.values?.[index]);
      if (value <= 0) throw new Error('Spot reference must be positive.');
      return {
        status: 'live',
        value,
        label: `${env.GRAPH_SPOT_TOKEN_SYMBOL} pool reference`,
        asset,
        comparable:
          env.GRAPH_SPOT_COMPARABLE === 'true' && asset === 'sNVDA' && env.GRAPH_SPOT_TOKEN_SYMBOL === 'sNVDA',
        source: 'The Graph',
        updatedAt: q.updatedAt
      };
    } catch (e: unknown) {
      return missing(label, e instanceof Error ? e.message : 'The action failed.', { asset, comparable: false });
    }
  };

  const shouldFetchCross = Boolean(
    includeCrossProtocol ||
    env.GRAPH_CROSS_PROTOCOL_ENABLED === 'true' ||
    (env.GRAPH_CROSS_SOURCE1_SUBGRAPH_ID && env.GRAPH_CROSS_SOURCE1_POOL_ID)
  );

  const [p, s, cross] = await Promise.all([
    probability(),
    spot(),
    shouldFetchCross ? getCrossProtocolReferences({ env, fetchImpl }) : Promise.resolve(undefined)
  ]);

  const result: GraphReferences = { probability: p, spot: s };
  if (cross) {
    result.crossProtocol = cross;
  }
  return result;
}

export const QUERY_STATUS =
  'Standardized Messari DEX AMM schema queries verified on Uniswap V3 and SushiSwap Arbitrum One deployments.';
