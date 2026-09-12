// apps/web/server.ts
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { SandboxMarket, MarketError as MarketError2 } from "../../packages/core/market.mjs";
import { configuration, readArc, quoteArc } from "../../packages/arc/client.mjs";

// packages/graph/index.mjs
var GATEWAY = "https://gateway.thegraph.com/api";
var PROB_QUERY = "query Probability($market: ID!) { reference: fixedProductMarketMaker(id: $market) { id values: outcomeTokenPrices } _meta { block { number timestamp } } }";
var SPOT_QUERY_MESSARI = "query Spot($pool: ID!) { reference: liquidityPool(id: $pool) { id tokens: inputTokens { id symbol } values: inputTokenPricesUSD } _meta { block { number timestamp } } }";
var SPOT_QUERY_UNISWAP3 = "query Spot($pool: ID!) { reference: pool(id: $pool) { id token0 { id symbol } token1 { id symbol } token0Price token1Price } _meta { block { number timestamp } } }";
var STANDARDIZED_MESSARI_DEX_QUERY = "query StandardizedPool($poolId: ID!) { reference: liquidityPool(id: $poolId) { id name symbol protocol { id name network } inputTokens { id symbol name decimals lastPriceUSD lastPriceBlockNumber } inputTokenBalances totalValueLockedUSD cumulativeVolumeUSD createdTimestamp createdBlockNumber } _meta { block { number timestamp } deployment } }";
var DEFAULT_CROSS_SOURCE1 = {
  protocol: "Uniswap V3",
  network: "ARBITRUM_ONE",
  subgraphId: "FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX",
  poolId: "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443",
  assetSymbol: "WETH",
  assetAddress: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
};
var DEFAULT_CROSS_SOURCE2 = {
  protocol: "SushiSwap",
  network: "ARBITRUM_ONE",
  subgraphId: "9tSS5FaePZnjmnXnSKCCqKVLAqA6eGg6jA2oRojsXUbP",
  poolId: "0x905dfcd5649217c42684f23958568e533c711aa3",
  assetSymbol: "WETH",
  assetAddress: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
};
var USD_SYMBOLS = ["USDC", "USDT", "DAI"];
var safeId = (x) => typeof x === "string" && /^[a-zA-Z0-9_:-]{1,150}$/.test(x);
var finite = (x) => {
  if (typeof x !== "number" && typeof x !== "string" || String(x).trim() === "") {
    throw new Error("The source did not return a numeric reference.");
  }
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("The source returned an invalid reference.");
  }
  return n;
};
var missing = (label, error, extra = {}) => ({
  status: "unavailable",
  value: null,
  label,
  source: "The Graph",
  updatedAt: null,
  error,
  ...extra
});
async function query(env, id, queryString, variables, fetchImpl) {
  const maxAge = Number(env.GRAPH_MAX_AGE_SECONDS || 900);
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 3600) {
    throw new Error("Graph maximum age must be an integer from 1 to 3600 seconds.");
  }
  if (!env.GRAPH_API_KEY) {
    throw new Error("Graph API key is not configured.");
  }
  if (!/^[a-zA-Z0-9_-]{8,200}$/.test(env.GRAPH_API_KEY) || !safeId(id)) {
    throw new Error("Graph configuration is invalid.");
  }
  let response;
  try {
    response = await fetchImpl(`${GATEWAY}/${encodeURIComponent(env.GRAPH_API_KEY)}/subgraphs/id/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: queryString, variables }),
      signal: AbortSignal.timeout(6e3),
      redirect: "error"
    });
  } catch {
    throw new Error("Graph request timed out or is unreachable.");
  }
  if (!response.ok) throw new Error("Graph returned an HTTP error.");
  let j;
  try {
    j = await response.json();
  } catch {
    throw new Error("Graph returned invalid JSON.");
  }
  const resObj = j;
  if (resObj?.errors?.length || !resObj?.data?.reference) {
    throw new Error("Graph schema or market lookup failed. Verify the configured subgraph.");
  }
  const ts = finite(resObj.data._meta?.block?.timestamp);
  if (ts < 1 || Date.now() / 1e3 - ts > maxAge || ts > Date.now() / 1e3 + 60) {
    throw new Error("Graph reference is stale or has invalid block time.");
  }
  return { reference: resObj.data.reference, updatedAt: new Date(ts * 1e3).toISOString() };
}
async function fetchStandardizedSource(env, config, fetchImpl) {
  const maxAge = Number(env.GRAPH_MAX_AGE_SECONDS || 900);
  const result = {
    protocol: config.protocol,
    network: config.network || "ARBITRUM_ONE",
    subgraphId: config.subgraphId,
    poolId: config.poolId,
    poolName: "",
    assetSymbol: config.assetSymbol || "WETH",
    assetAddress: config.assetAddress || "",
    quoteSymbol: "",
    quoteAddress: "",
    price: null,
    tvlUSD: null,
    volumeUSD: null,
    blockNumber: null,
    blockTimestamp: null,
    status: "unavailable",
    updatedAt: null
  };
  if (!env.GRAPH_API_KEY || !config.subgraphId || !config.poolId) {
    result.error = "Graph API key or source configuration is missing.";
    return result;
  }
  let res;
  try {
    res = await fetchImpl(`${GATEWAY}/${encodeURIComponent(env.GRAPH_API_KEY)}/subgraphs/id/${config.subgraphId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: STANDARDIZED_MESSARI_DEX_QUERY,
        variables: { poolId: config.poolId.toLowerCase() }
      }),
      signal: AbortSignal.timeout(6e3),
      redirect: "error"
    });
  } catch {
    result.error = "Graph gateway request timed out or is unreachable.";
    return result;
  }
  if (!res.ok) {
    result.error = `Graph gateway returned HTTP error ${res.status}.`;
    return result;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    result.error = "Graph gateway returned invalid JSON.";
    return result;
  }
  if (body.errors?.length || !body.data?.reference) {
    result.error = "Standardized pool entity not found or schema error in subgraph.";
    return result;
  }
  const pool = body.data.reference;
  result.poolName = pool.name || pool.symbol || "";
  if (pool.protocol?.name) result.protocol = pool.protocol.name;
  if (pool.protocol?.network) result.network = pool.protocol.network;
  const blockTs = Number(body.data._meta?.block?.timestamp);
  const blockNum = Number(body.data._meta?.block?.number);
  result.blockNumber = Number.isFinite(blockNum) ? blockNum : null;
  result.blockTimestamp = Number.isFinite(blockTs) ? blockTs : null;
  const nowSec = Date.now() / 1e3;
  if (!Number.isFinite(blockTs) || blockTs < 1 || nowSec - blockTs > maxAge || blockTs > nowSec + 60) {
    result.status = "stale";
    result.error = "Reference block timestamp is stale or in the future.";
    return result;
  }
  result.updatedAt = new Date(blockTs * 1e3).toISOString();
  const tokens = pool.inputTokens || [];
  if (!Array.isArray(tokens) || tokens.length < 2) {
    result.error = "Standardized pool contains fewer than 2 input tokens.";
    return result;
  }
  const assetIdx = tokens.findIndex((t) => t.symbol?.toUpperCase() === result.assetSymbol.toUpperCase());
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
    result.error = "Pool does not contain a supported USD quote token (USDC, USDT, DAI). Non-USD pool ratio rejected.";
    return result;
  }
  const quoteToken = tokens[quoteIdx];
  result.quoteSymbol = quoteToken.symbol;
  result.quoteAddress = quoteToken.id;
  const rawPrice = Number(assetToken.lastPriceUSD);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    result.error = "Pool does not contain a positive lastPriceUSD for the asset token.";
    return result;
  }
  result.price = rawPrice;
  result.tvlUSD = Number.isFinite(Number(pool.totalValueLockedUSD)) ? Number(pool.totalValueLockedUSD) : null;
  result.volumeUSD = Number.isFinite(Number(pool.cumulativeVolumeUSD)) ? Number(pool.cumulativeVolumeUSD) : null;
  result.status = "live";
  return result;
}
function analyzeCrossProtocol(s1, s2, options = {}) {
  const threshold = options.threshold ?? 0.015;
  const maxAge = options.maxAge ?? 900;
  const s1Live = s1.status === "live" && s1.price !== null && s1.price > 0;
  const s2Live = s2.status === "live" && s2.price !== null && s2.price > 0;
  if (s1Live && s2Live && s1.price !== null && s2.price !== null) {
    const mean = (s1.price + s2.price) / 2;
    const diff = Math.abs(s1.price - s2.price);
    const disagreement = diff / mean;
    const pctStr = `${(disagreement * 100).toFixed(2)}%`;
    if (disagreement <= threshold) {
      return {
        status: "agreeing",
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
        status: "disagreeing",
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
      status: "single_source",
      source1: s1,
      source2: s2,
      consensusPrice: s1.price,
      disagreement: null,
      disagreementPercent: null,
      disagreementThreshold: threshold,
      maxAgeSeconds: maxAge,
      summary: `Single valid source (${s1.protocol} at $${s1.price.toFixed(2)}). ${s2.protocol} is ${s2.status}: ${s2.error || "unavailable"}.`,
      comparable: false,
      updatedAt: s1.updatedAt
    };
  }
  if (!s1Live && s2Live) {
    return {
      status: "single_source",
      source1: s1,
      source2: s2,
      consensusPrice: s2.price,
      disagreement: null,
      disagreementPercent: null,
      disagreementThreshold: threshold,
      maxAgeSeconds: maxAge,
      summary: `Single valid source (${s2.protocol} at $${s2.price.toFixed(2)}). ${s1.protocol} is ${s1.status}: ${s1.error || "unavailable"}.`,
      comparable: false,
      updatedAt: s2.updatedAt
    };
  }
  return {
    status: "unavailable",
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
async function getCrossProtocolReferences({
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const threshold = Number(env.GRAPH_CROSS_DISAGREEMENT_THRESHOLD || 0.015);
  const maxAge = Number(env.GRAPH_MAX_AGE_SECONDS || 900);
  const s1Config = {
    protocol: env.GRAPH_CROSS_SOURCE1_PROTOCOL || DEFAULT_CROSS_SOURCE1.protocol,
    network: env.GRAPH_CROSS_SOURCE1_NETWORK || DEFAULT_CROSS_SOURCE1.network,
    subgraphId: env.GRAPH_CROSS_SOURCE1_SUBGRAPH_ID || DEFAULT_CROSS_SOURCE1.subgraphId,
    poolId: env.GRAPH_CROSS_SOURCE1_POOL_ID || DEFAULT_CROSS_SOURCE1.poolId,
    assetSymbol: env.GRAPH_CROSS_TOKEN_SYMBOL || DEFAULT_CROSS_SOURCE1.assetSymbol,
    assetAddress: env.GRAPH_CROSS_TOKEN_ADDRESS || DEFAULT_CROSS_SOURCE1.assetAddress
  };
  const s2Config = {
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
async function getReferences({
  env = process.env,
  fetchImpl = fetch,
  includeCrossProtocol = false
} = {}) {
  const probability = async () => {
    const label = "Related event reference";
    try {
      if (!safeId(env.GRAPH_PROBABILITY_MARKET_ID)) throw new Error("Graph event market is not configured.");
      const id = env.GRAPH_PROBABILITY_SUBGRAPH_ID || "Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp";
      const q = await query(env, id, PROB_QUERY, { market: env.GRAPH_PROBABILITY_MARKET_ID }, fetchImpl);
      const index = Number(env.GRAPH_YES_INDEX || 0);
      if (index !== 0 && index !== 1) throw new Error("YES outcome index must be zero or one.");
      const value = finite(q.reference.values?.[index]);
      if (value > 1) throw new Error("Probability is outside zero to one.");
      return { status: "live", value, label, source: "The Graph", updatedAt: q.updatedAt };
    } catch (e) {
      return missing(label, e instanceof Error ? e.message : "The action failed.");
    }
  };
  const spot = async () => {
    const label = "External asset reference";
    const asset = env.GRAPH_SPOT_ASSET || "unconfigured";
    try {
      if (!safeId(env.GRAPH_SPOT_SUBGRAPH_ID) || !safeId(env.GRAPH_SPOT_POOL_ID) || !env.GRAPH_SPOT_TOKEN_SYMBOL) {
        throw new Error("Graph spot pool and token are not configured.");
      }
      const isUniV3 = env.GRAPH_SPOT_SCHEMA === "uniswap3" || env.GRAPH_SPOT_SUBGRAPH_ID === "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";
      const spotQuery = isUniV3 ? SPOT_QUERY_UNISWAP3 : SPOT_QUERY_MESSARI;
      const q = await query(env, env.GRAPH_SPOT_SUBGRAPH_ID, spotQuery, { pool: env.GRAPH_SPOT_POOL_ID }, fetchImpl);
      const ref = q.reference;
      if (ref.token0 && ref.token1 && (!ref.tokens || !ref.values)) {
        const t0Symbol = ref.token0.symbol;
        const t1Symbol = ref.token1.symbol;
        const isUsd = (sym) => ["USDC", "USDT", "DAI"].includes(sym?.toUpperCase());
        let p0, p1;
        if (isUsd(t0Symbol)) {
          p0 = 1;
          p1 = finite(ref.token0Price);
        } else if (isUsd(t1Symbol)) {
          p1 = 1;
          p0 = finite(ref.token1Price);
        } else {
          throw new Error("Reference pool does not contain a supported USD quote token (USDC, USDT, DAI). Non-USD pool ratio rejected.");
        }
        ref.tokens = [
          { id: ref.token0.id, symbol: t0Symbol },
          { id: ref.token1.id, symbol: t1Symbol }
        ];
        ref.values = [p0, p1];
      }
      const index = ref.tokens?.findIndex((t) => t.symbol === env.GRAPH_SPOT_TOKEN_SYMBOL);
      if (!Number.isInteger(index) || index === void 0 || index < 0) {
        throw new Error("Configured token is not in the reference pool.");
      }
      const value = finite(ref.values?.[index]);
      if (value <= 0) throw new Error("Spot reference must be positive.");
      return {
        status: "live",
        value,
        label: `${env.GRAPH_SPOT_TOKEN_SYMBOL} pool reference`,
        asset,
        comparable: env.GRAPH_SPOT_COMPARABLE === "true" && asset === "sNVDA" && env.GRAPH_SPOT_TOKEN_SYMBOL === "sNVDA",
        source: "The Graph",
        updatedAt: q.updatedAt
      };
    } catch (e) {
      return missing(label, e instanceof Error ? e.message : "The action failed.", { asset, comparable: false });
    }
  };
  const shouldFetchCross = Boolean(
    includeCrossProtocol || env.GRAPH_CROSS_PROTOCOL_ENABLED === "true" || env.GRAPH_CROSS_SOURCE1_SUBGRAPH_ID && env.GRAPH_CROSS_SOURCE1_POOL_ID
  );
  const [p, s, cross] = await Promise.all([
    probability(),
    spot(),
    shouldFetchCross ? getCrossProtocolReferences({ env, fetchImpl }) : Promise.resolve(void 0)
  ]);
  const result = { probability: p, spot: s };
  if (cross) {
    result.crossProtocol = cross;
  }
  return result;
}

// packages/cre/index.mjs
var USDC = 10n ** 6n;
var TOKEN = 10n ** 18n;
var CAP = 500n * USDC;
var MAX_SANDBOX_ORDER = 1000000n * USDC;
var MARKET = Object.freeze({
  id: "china-ai-chips-snvda",
  ticker: "sNVDA",
  asset: "Synthetic Nvidia index",
  question: "Will the US allow advanced AI chip sales to China by 31 December 2026?",
  title: "Will the US allow advanced AI chip sales to China by 31 December 2026?",
  shortTitle: "The next chapter of AI chip exports.",
  resolutionDate: "2026-12-31T23:59:59Z",
  chainId: 5042002,
  collateralAddress: "0x3600000000000000000000000000000000000000",
  cap: 500
});
var MarketError = class extends Error {
  code;
  status;
  constructor(message, code = "INVALID_INPUT", status = 400) {
    super(message);
    this.name = "MarketError";
    this.code = code;
    this.status = status;
  }
};
function parseUnits(value, decimals = 6, allowZero = false) {
  if (typeof value !== "string" || value.length > 60 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.trim())) {
    throw new MarketError("Enter a plain decimal amount without a sign or exponent.");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > decimals) {
    throw new MarketError(`Use no more than ${decimals} decimal places.`);
  }
  const n = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  if (n < 0n || !allowZero && n === 0n || n > 10n ** 40n) {
    throw new MarketError("Amount must be positive and within range.");
  }
  return n;
}
function formatUnits(value, decimals = 6, precision = decimals) {
  const n = BigInt(value);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const scale = 10n ** BigInt(decimals);
  const fraction = (abs % scale).toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / scale}${fraction ? "." + fraction : ""}`;
}
function clipNotional({ requestedSize, maxNotional }) {
  const requested = parseUnits(requestedSize);
  const max = parseUnits(maxNotional, 6, true);
  if (max === 0n) return { allowed: false, clippedSize: "0" };
  return { allowed: true, clippedSize: formatUnits(requested > max ? max : requested) };
}
function getValidatedCreConfig(env = process.env) {
  if (!env.CRE_CLIP_URL || !env.CRE_CLIP_ALLOWED_HOST || !env.CRE_CLIP_TOKEN) {
    throw new Error("Confidential clipping is not configured. No local fallback is used.");
  }
  let url;
  try {
    url = new URL(env.CRE_CLIP_URL);
  } catch {
    throw new Error("Invalid confidential endpoint configuration.");
  }
  if (url.protocol !== "https:" || url.hostname !== env.CRE_CLIP_ALLOWED_HOST || url.username || url.password || url.hash || url.search || url.port) {
    throw new Error(
      "Confidential endpoint must use the explicitly approved HTTPS host without URL credentials or query data."
    );
  }
  if (!/^[a-zA-Z0-9_-]{43,128}$/.test(env.CRE_CLIP_TOKEN)) {
    throw new Error("Configure a strong confidential bridge token.");
  }
  return { url, token: env.CRE_CLIP_TOKEN };
}
async function requestConfidentialClip(requestedSize, { env = process.env, fetchImpl = fetch } = {}) {
  const requested = parseUnits(requestedSize);
  const { url, token } = getValidatedCreConfig(env);
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...env.CRE_CLIP_TOKEN ? { Authorization: `Bearer ${env.CRE_CLIP_TOKEN}` } : {}
      },
      body: JSON.stringify({ requestedSize }),
      signal: AbortSignal.timeout(55e3),
      redirect: "error"
    });
  } catch {
    throw new Error("Confidential clip request timed out or failed.");
  }
  if (!response.ok) throw new Error("Confidential clip service rejected the request.");
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Invalid confidential clip response.");
  }
  if (!result || typeof result !== "object" || typeof result.allowed !== "boolean" || typeof result.clippedSize !== "string") {
    throw new Error("Invalid confidential clip response.");
  }
  const res = result;
  let clipped;
  try {
    clipped = parseUnits(res.clippedSize, 6, true);
  } catch {
    throw new Error("Invalid confidential clip response.");
  }
  if (clipped > requested || res.allowed && clipped === 0n || !res.allowed && clipped !== 0n) {
    throw new Error("Confidential clip response violates the size policy.");
  }
  return { allowed: res.allowed, clippedSize: formatUnits(clipped) };
}

// apps/web/server.ts
var publicDir = fileURLToPath(new URL("./public/", import.meta.url));
var exact = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function resolveHostAndOrigin(env) {
  let appHost = (env.APP_HOST || env.RENDER_EXTERNAL_HOSTNAME || "").trim();
  if (appHost) {
    const hostRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?::\d{1,5})?$|^localhost(?::\d{1,5})?$|^127\.0\.0\.1(?::\d{1,5})?$/;
    if (!hostRegex.test(appHost)) {
      throw new Error(`Invalid APP_HOST or RENDER_EXTERNAL_HOSTNAME: "${appHost}"`);
    }
  } else {
    appHost = void 0;
  }
  let appOrigin = (env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || "").trim();
  if (!appOrigin && appHost) {
    appOrigin = `https://${appHost}`;
  }
  if (appOrigin) {
    let parsed;
    try {
      parsed = new URL(appOrigin);
    } catch {
      throw new Error(`Invalid APP_ORIGIN or RENDER_EXTERNAL_URL: "${appOrigin}"`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`APP_ORIGIN must have http or https protocol: "${appOrigin}"`);
    }
    appOrigin = parsed.origin;
  } else {
    appOrigin = void 0;
  }
  return { appHost, appOrigin };
}
function createApp({ env = process.env, fetchImpl = fetch } = {}) {
  const sessions = /* @__PURE__ */ new Map();
  const effectiveEnv = { ...env };
  if (env === process.env || false || env.ARC_USE_SUBMISSION === "true") {
    try {
      const subPath = path.resolve("deployments/submission-market.json");
      if (existsSync(subPath)) {
        const manifest = JSON.parse(readFileSync(subPath, "utf8"));
        if (manifest.contracts) {
          const OLD_DEMO_ORACLE = "0x8548bd8633de8efd7d5a0327d6a51f8e5d74100f";
          const OLD_DEMO_AMM = "0x7afff3698a2f5b58b9ebac8405a7a903e482a4ab";
          if (!effectiveEnv.ARC_ORACLE || effectiveEnv.ARC_ORACLE.toLowerCase() === OLD_DEMO_ORACLE.toLowerCase()) {
            effectiveEnv.ARC_ORACLE = manifest.contracts.oracle;
          }
          if (!effectiveEnv.ARC_BINARY_AMM || effectiveEnv.ARC_BINARY_AMM.toLowerCase() === OLD_DEMO_AMM.toLowerCase()) {
            effectiveEnv.ARC_BINARY_AMM = manifest.contracts.binaryAmm;
          }
          if (!effectiveEnv.ARC_BINARY_VAULT || effectiveEnv.ARC_BINARY_VAULT.toLowerCase() === "0x9aa21d72378a36fa107129c87f17b0a42680ecb7") {
            effectiveEnv.ARC_BINARY_VAULT = manifest.contracts.binaryVault;
          }
          if (!effectiveEnv.ARC_SHARE_VAULT || effectiveEnv.ARC_SHARE_VAULT.toLowerCase() === "0x81fad3ec2d7e841cda7e1504e1bdd23f794c8e3d") {
            effectiveEnv.ARC_SHARE_VAULT = manifest.contracts.shareVault;
          }
          if (!effectiveEnv.ARC_YES_SHARE_AMM || effectiveEnv.ARC_YES_SHARE_AMM.toLowerCase() === "0x0708437945bbba6dcc72d7a271347c88a1c26cab") {
            effectiveEnv.ARC_YES_SHARE_AMM = manifest.contracts.yesShareAmm;
          }
          if (!effectiveEnv.ARC_NO_SHARE_AMM || effectiveEnv.ARC_NO_SHARE_AMM.toLowerCase() === "0xee27dd6502956c98ddc56575960f178a3e757eb2") {
            effectiveEnv.ARC_NO_SHARE_AMM = manifest.contracts.noShareAmm;
          }
        }
      }
    } catch {
    }
  }
  const config = configuration(effectiveEnv);
  const TTL = 4 * 60 * 60 * 1e3;
  const { appHost, appOrigin } = resolveHostAndOrigin(env);
  const json = (res, status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    );
    const host = req.headers.host || "";
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
    if (!local && (!appHost || host !== appHost)) {
      return json(res, 421, { error: "Unexpected host." });
    }
    let url;
    try {
      url = new URL(req.url || "/", `http://${host}`);
    } catch {
      return json(res, 400, { error: "Invalid URL." });
    }
    if (url.pathname === "/api/health") {
      return json(res, 200, {
        status: "ok",
        app: "THELEMA",
        mode: "local-research",
        liveEvidence: false,
        commit: env.RENDER_GIT_COMMIT || env.GIT_COMMIT || "3c576da",
        deployedMarket: config.contracts.binaryAMM === "0x84fd754f3c10af24d5d4e38be1853f0cd14525a1" ? "submission-market" : "demo-manifest"
      });
    }
    try {
      if (url.pathname.startsWith("/api/")) {
        const now = Date.now();
        for (const [id2, s] of sessions) {
          if (now - s.seen > TTL) sessions.delete(id2);
        }
        const id = (req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith("thelema_sid="))?.slice(12);
        let session = id ? sessions.get(id) : void 0;
        if (!session) {
          if (req.method !== "GET" || url.pathname !== "/api/config") {
            return json(res, 401, { error: "Initialize the session first." });
          }
          if (sessions.size >= 1e3) {
            return json(res, 503, { error: "Session capacity reached. Please retry later." });
          }
          const sid = randomBytes(24).toString("hex");
          session = {
            csrf: randomBytes(24).toString("hex"),
            market: new SandboxMarket(),
            seen: now,
            window: now,
            count: 0,
            clipWindow: now,
            clips: 0
          };
          sessions.set(sid, session);
          const isSecure = appOrigin ? appOrigin.startsWith("https:") : false;
          res.setHeader(
            "Set-Cookie",
            `thelema_sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${isSecure ? "; Secure" : ""}`
          );
        }
        session.seen = now;
        if (now - session.window > 6e4) {
          session.window = now;
          session.count = 0;
        }
        if (++session.count > 120) {
          return json(res, 429, { error: "Request limit reached. Retry in one minute." });
        }
        if (req.method === "GET") {
          if (url.pathname === "/api/config") {
            const { rpcUrl: _omittedRpcUrl, ...clientConfig } = config;
            return json(res, 200, { ...clientConfig, csrf: session.csrf });
          }
          if (url.pathname === "/api/market") {
            const mode = url.searchParams.get("mode") || "sandbox";
            if (mode !== "sandbox" && mode !== "arc") throw new MarketError2("Unknown execution mode.");
            return json(res, 200, mode === "sandbox" ? session.market.snapshot() : await readArc(config));
          }
          if (url.pathname === "/api/references") return json(res, 200, await getReferences({ env, fetchImpl, includeCrossProtocol: true }));
          return json(res, 404, { error: "Unknown API route." });
        }
        if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
        const origin = req.headers.origin;
        if (req.headers["sec-fetch-site"] === "cross-site") {
          return json(res, 403, { error: "Cross-origin request blocked." });
        }
        if (origin) {
          const allowedOrigin = appOrigin || (local ? `http://${host}` : void 0);
          if (!allowedOrigin || origin !== allowedOrigin) {
            return json(res, 403, { error: "Cross-origin request blocked." });
          }
        }
        if (!exact(req.headers["x-csrf-token"], session.csrf)) {
          return json(res, 403, { error: "Invalid session token. Reload the app." });
        }
        if (!String(req.headers["content-type"]).startsWith("application/json")) {
          return json(res, 415, { error: "JSON body required." });
        }
        if (Number(req.headers["content-length"]) > 16384) {
          return json(res, 413, { error: "Request body too large." });
        }
        let raw = "";
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16384) throw new MarketError2("Request body too large.", "BODY_SIZE", 413);
          raw += chunk;
        }
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new MarketError2("Invalid JSON body.");
        }
        if (!data || Array.isArray(data) || typeof data !== "object") {
          throw new MarketError2("JSON object required.");
        }
        const bodyObj = data;
        if (url.pathname === "/api/sandbox/quote") return json(res, 200, session.market.quote(bodyObj));
        if (url.pathname === "/api/sandbox/trade") return json(res, 200, session.market.trade(bodyObj));
        if (url.pathname === "/api/sandbox/pairs") return json(res, 200, session.market.pairs(bodyObj));
        if (url.pathname === "/api/sandbox/resolve-event") return json(res, 200, session.market.resolveEvent(bodyObj));
        if (url.pathname === "/api/sandbox/fix-price") return json(res, 200, session.market.fixPrice(bodyObj));
        if (url.pathname === "/api/sandbox/settle") return json(res, 200, session.market.settle(bodyObj));
        if (url.pathname === "/api/sandbox/claim") return json(res, 200, session.market.claim());
        if (url.pathname === "/api/sandbox/reset") {
          let opts = {};
          if (bodyObj.timingPolicy === "accelerated-demo") {
            const t = Date.now();
            opts = { timingPolicy: "accelerated-demo", tradingCutoff: t + 6e4, eventDeadline: t + 12e4, earliestPriceFixTime: t + 12e4 };
          } else if (bodyObj.timingPolicy) {
            opts = bodyObj;
          }
          session.market = new SandboxMarket(opts);
          return json(res, 200, session.market.snapshot());
        }
        if (url.pathname === "/api/arc/quote") return json(res, 200, await quoteArc(config, bodyObj));
        if (url.pathname === "/api/clip") {
          if (now - session.clipWindow > 6e4) {
            session.clipWindow = now;
            session.clips = 0;
          }
          if (++session.clips > 15) return json(res, 429, { error: "Size policy limit reached. Retry in one minute." });
          if (bodyObj.mode !== "arc" && bodyObj.mode !== "sandbox") throw new MarketError2("Specify the clipping execution mode.");
          if (bodyObj.mode === "sandbox") return json(res, 200, clipNotional({ requestedSize: String(bodyObj.requestedSize ?? ""), maxNotional: "50" }));
          try {
            return json(res, 200, await requestConfidentialClip(String(bodyObj.requestedSize ?? ""), { env, fetchImpl }));
          } catch {
            return json(res, 503, { error: "Confidential clipping is unavailable or rejected the response. No local fallback was used." });
          }
        }
        return json(res, 404, { error: "Unknown API route." });
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
      const routes = ["/", "/market", "/portfolio", "/guide"];
      let file = "index.html";
      let status = routes.includes(url.pathname) ? 200 : 404;
      if (url.pathname.startsWith("/assets/")) {
        let decoded;
        try {
          decoded = decodeURIComponent(url.pathname);
        } catch {
          throw new MarketError2("Invalid path.");
        }
        file = decoded.slice(1);
        status = 200;
      } else if (url.pathname === "/robots.txt") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("User-agent: *\nDisallow: /\n");
      } else if (url.pathname.startsWith("/.") || /\.(env|md|json|sol|ts|mjs)$/.test(url.pathname)) {
        return json(res, 404, { error: "Not found." });
      }
      const resolved = path.resolve(publicDir, file);
      if (!resolved.startsWith(publicDir) || ![".html", ".js", ".css", ".svg", ".woff", ".woff2", ".webp", ".png"].includes(path.extname(resolved))) {
        return json(res, 404, { error: "Not found." });
      }
      let content;
      try {
        content = await readFile(resolved);
      } catch {
        return json(res, 404, { error: "Asset not found. Run npm run build." });
      }
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".webp": "image/webp",
        ".png": "image/png"
      };
      res.writeHead(status, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": file === "index.html" ? "no-store" : "public, max-age=3600"
      });
      res.end(req.method === "HEAD" ? void 0 : content);
    } catch (e) {
      const known = e instanceof MarketError2;
      json(res, known ? e.status : 500, {
        error: known ? e.message : "Request failed. Check configuration and retry.",
        code: known ? e.code : "REQUEST_FAILED"
      });
    }
  });
  server.requestTimeout = 15e3;
  server.headersTimeout = 1e4;
  server.keepAliveTimeout = 5e3;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile?.(fileURLToPath(new URL("../../.env", import.meta.url)));
  } catch {
  }
  const port = Number(process.env.PORT || 3e3);
  const host = process.env.HOST || "127.0.0.1";
  createApp().listen(
    port,
    host,
    () => console.log(`THELEMA local server listening on http://${host}:${port} \u2014 sandbox default, live integrations not implied.`)
  );
}
export {
  createApp,
  resolveHostAndOrigin
};
