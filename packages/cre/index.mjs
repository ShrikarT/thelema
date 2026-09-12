// packages/core/market.mjs
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

// packages/cre/index.ts
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
function isCreConfigured(env = process.env) {
  try {
    getValidatedCreConfig(env);
    return true;
  } catch {
    return false;
  }
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
export {
  clipNotional,
  getValidatedCreConfig,
  isCreConfigured,
  requestConfidentialClip
};
