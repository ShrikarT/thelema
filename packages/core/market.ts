import {
  USDC6,
  Units18,
  TradableSide,
  ClaimKind,
  Book,
  Side,
  LifecycleStage,
  MarketStatus,
  MarketMetadata,
  FullMarketMetadata,
  ObservationPolicy,
  MarketTiming,
  MarketStats,
  UserPositions,
  FormattedPositionRow,
  MarketVaults,
  ActivityRecord,
  QuoteInput,
  QuoteResult,
  TradeInput,
  TradeRecord,
  TradeResult,
  PairsInput,
  SandboxMarketOptions,
  PriceFixedSettlement,
  FormattedSettlementSummary,
  MarketSnapshot,
  OpenMarketSnapshot,
  EventResolvedMarketSnapshot,
  PriceFixedMarketSnapshot
} from './types.ts';

// Pure, integer-arithmetic sandbox. NOT a chain, oracle, or live price feed.
export const USDC: USDC6 = 10n ** 6n;
export const TOKEN: Units18 = 10n ** 18n;
export const CAP: USDC6 = 500n * USDC;
export const FEE_BPS: bigint = 30n;
const MAX_SANDBOX_ORDER: USDC6 = 1_000_000n * USDC;

export const MARKET: Readonly<MarketMetadata & {
  title: string;
  shortTitle: string;
  resolutionDate: string;
  chainId: number;
  collateralAddress: string;
}> = Object.freeze({
  id: 'china-ai-chips-snvda',
  ticker: 'sNVDA',
  asset: 'Synthetic Nvidia index',
  question: 'Will the US allow advanced AI chip sales to China by 31 December 2026?',
  title: 'Will the US allow advanced AI chip sales to China by 31 December 2026?',
  shortTitle: 'The next chapter of AI chip exports.',
  resolutionDate: '2026-12-31T23:59:59Z',
  chainId: 5042002,
  collateralAddress: '0x3600000000000000000000000000000000000000',
  cap: 500
});

export class MarketError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code = 'INVALID_INPUT', status = 400) {
    super(message);
    this.name = 'MarketError';
    this.code = code;
    this.status = status;
  }
}

export function parseUnits(value: string, decimals = 6, allowZero = false): bigint {
  if (typeof value !== 'string' || value.length > 60 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.trim())) {
    throw new MarketError('Enter a plain decimal amount without a sign or exponent.');
  }
  const [whole, fraction = ''] = value.trim().split('.');
  if (fraction.length > decimals) {
    throw new MarketError(`Use no more than ${decimals} decimal places.`);
  }
  const n = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
  if (n < 0n || (!allowZero && n === 0n) || n > 10n ** 40n) {
    throw new MarketError('Amount must be positive and within range.');
  }
  return n;
}

export function formatUnits(value: bigint | string | number, decimals = 6, precision = decimals): string {
  const n = BigInt(value);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const scale = 10n ** BigInt(decimals);
  const fraction = (abs % scale).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / scale}${fraction ? '.' + fraction : ''}`;
}

export const ceilDiv = (a: bigint, b: bigint): bigint => (a === 0n ? 0n : (a + b - 1n) / b);
export const floorDiv = (a: bigint, b: bigint): bigint => a / b;
export const mulDiv = (a: bigint, b: bigint, c: bigint): bigint => (a * b) / c;
const clone = <T>(obj: T): T => structuredClone(obj);

export function binaryPrice(reserveYes: Units18, reserveNo: Units18): number {
  if (reserveYes <= 0n || reserveNo <= 0n) throw new MarketError('Pool has no liquidity.');
  return Number(reserveNo * 1_000_000_000n / (reserveYes + reserveNo)) / 1_000_000_000;
}

export function toTimestampMs(secondsOrMs: number | bigint | undefined | null): number {
  if (secondsOrMs === undefined || secondsOrMs === null) return 0;
  const n = Number(secondsOrMs);
  if (n === Infinity) return Infinity;
  if (n <= 0 || !Number.isFinite(n)) return 0;
  return n >= 100_000_000 && n < 100_000_000_000 ? n * 1000 : n;
}

export function fourNumbers(p: number, yesSharePrice: number, noSharePrice: number, cap = 500): MarketStats {
  if (![p, yesSharePrice, noSharePrice].every(Number.isFinite) || p < 0 || p > 1 || yesSharePrice < 0 || noSharePrice < 0) {
    throw new MarketError('Invalid market prices.');
  }
  let eYes: number | null = null;
  let eNo: number | null = null;
  if (p === 1) {
    eYes = yesSharePrice;
    eNo = null;
  } else if (p === 0) {
    eYes = null;
    eNo = noSharePrice;
  } else {
    eYes = p < 0.02 ? null : yesSharePrice / p;
    eNo = p > 0.98 ? null : noSharePrice / (1 - p);
  }
  return {
    p, eYes, eNo,
    impact: eYes === null || eNo === null ? null : eYes - eNo,
    impliedSpot: yesSharePrice + noSharePrice,
    yesSharePrice, noSharePrice, cap
  };
}

export function binaryBuy(reserves: { yes: Units18; no: Units18 }, amount6: USDC6, side: TradableSide) {
  if (!['yes', 'no'].includes(side) || amount6 <= 0n) throw new MarketError('Choose a valid outcome and amount.');
  const fee6 = amount6 * FEE_BPS / 10000n;
  const net6 = amount6 - fee6;
  const minted = net6 * (TOKEN / USDC);
  const other: TradableSide = side === 'yes' ? 'no' : 'yes';
  const k = reserves.yes * reserves.no;
  const nextOther = reserves[other] + minted;
  const nextSelected = ceilDiv(k, nextOther);
  const out = reserves[side] + minted - nextSelected;
  if (out <= 0n) throw new MarketError('Amount is too small for this pool.');
  return { out, fee6, net6, minted, reserves: { ...reserves, [side]: nextSelected, [other]: nextOther } };
}

export function shareBuy(pool: { usdc: USDC6; tokens: Units18 }, amount6: USDC6) {
  if (amount6 <= 0n || pool.usdc <= 0n || pool.tokens <= 0n) throw new MarketError('Invalid amount or empty pool.');
  const fee6 = amount6 * FEE_BPS / 10000n;
  const net6 = amount6 - fee6;
  const out = pool.tokens * net6 / (pool.usdc + net6);
  if (out <= 0n || out >= pool.tokens) throw new MarketError('Amount is too small or pool cannot fill it.');
  return { out, fee6, pool: { usdc: pool.usdc + amount6, tokens: pool.tokens - out } };
}

export type { SandboxMarketOptions };

export class SandboxMarket {
  readonly market: FullMarketMetadata;
  readonly cap6: USDC6;
  readonly eventDeadline: number;
  readonly tradingCutoff: number;
  readonly earliestPriceFixTime: number;
  readonly timingPolicy: string;
  readonly observationPolicy: ObservationPolicy;

  lifecycle: LifecycleStage;
  eventYes: boolean | null;
  settlement: {
    eventYes: boolean;
    spot6: USDC6;
    payout6: USDC6;
    residualValue6: USDC6;
    capped: boolean;
    at: string;
  } | null;
  revision: number;
  balance6: USDC6;
  volume6: USDC6;
  fees6: USDC6;
  claimed6: USDC6;

  binary: { yes: Units18; no: Units18 };
  binarySupply: Units18;
  binaryVault6: USDC6;
  protocolBinary: { yes: Units18; no: Units18 };

  shares: {
    yes: { tokens: Units18; usdc: USDC6 };
    no: { tokens: Units18; usdc: USDC6 };
  };
  shareSupply: Units18;
  shareVault6: USDC6;
  protocolShares: { yes: Units18; no: Units18; residual: Units18 };

  positions: {
    binary: { yes: Units18; no: Units18 };
    asset: { yes: Units18; no: Units18; residual: Units18 };
  };
  history: ActivityRecord[];
  readonly initialTotal: USDC6;

  constructor(options: SandboxMarketOptions = {}) {
    this.market = Object.freeze(options.market ? { ...MARKET, ...options.market } : MARKET);
    this.cap6 = options.cap6 ?? (options.cap ? parseUnits(String(options.cap)) : CAP);
    this.eventDeadline = options.eventDeadline ? toTimestampMs(options.eventDeadline) : 0;
    this.tradingCutoff = options.tradingCutoff !== undefined ? toTimestampMs(options.tradingCutoff) : Infinity;
    this.earliestPriceFixTime = options.earliestPriceFixTime ? toTimestampMs(options.earliestPriceFixTime) : 0;
    this.timingPolicy = options.timingPolicy || (this.eventDeadline > 0 ? 'scheduled' : 'untimed');
    this.observationPolicy = Object.freeze({
      rule: options.observationRule || (this.timingPolicy === 'untimed'
        ? 'Untimed local simulation (instant manual DEMO_ORACLE responses for testing)'
        : 'Planned settlement observation window (30-minute TWAP reference after trading cutoff; current sandbox uses manual DEMO_ORACLE submission)'),
      source: options.priceSource || 'Manual DEMO_ORACLE operator submission (synthetic sNVDA reference)',
      eventSource: options.eventSource || 'US Dept of Commerce BIS export regulation registry'
    });

    this.lifecycle = 'OPEN';
    this.eventYes = null;
    this.settlement = null;
    this.revision = 0;
    this.balance6 = 5000n * USDC;
    this.volume6 = 0n;
    this.fees6 = 0n;
    this.claimed6 = 0n;

    this.binary = { yes: 740n * TOKEN, no: 1260n * TOKEN };
    this.binarySupply = 1500n * TOKEN;
    this.binaryVault6 = 1500n * USDC;
    this.protocolBinary = { yes: 760n * TOKEN, no: 240n * TOKEN };

    this.shares = {
      yes: { tokens: 100n * TOKEN, usdc: 11655n * USDC },
      no: { tokens: 100n * TOKEN, usdc: 4366n * USDC }
    };
    this.shareSupply = 300n * TOKEN;
    this.shareVault6 = 300n * this.cap6;
    this.protocolShares = { yes: 200n * TOKEN, no: 200n * TOKEN, residual: 300n * TOKEN };

    this.positions = {
      binary: { yes: 0n, no: 0n },
      asset: { yes: 0n, no: 0n, residual: 0n }
    };
    this.history = [];
    this.initialTotal = this.totalUsdc();
  }

  totalUsdc(): USDC6 {
    return this.balance6 + this.binaryVault6 + this.shareVault6 + this.shares.yes.usdc + this.shares.no.usdc + this.fees6;
  }

  remainingLiabilities6(): USDC6 {
    if (this.lifecycle !== 'PRICE_FIXED' || !this.settlement) {
      return this.shareSupply * this.cap6 / TOKEN;
    }
    const winShares = this.eventYes
      ? this.shares.yes.tokens + this.protocolShares.yes + this.positions.asset.yes
      : this.shares.no.tokens + this.protocolShares.no + this.positions.asset.no;
    const resShares = this.protocolShares.residual + this.positions.asset.residual;
    return (winShares * this.settlement.payout6 + resShares * this.settlement.residualValue6) / TOKEN;
  }

  residualLocked6(): USDC6 {
    if (this.lifecycle !== 'PRICE_FIXED' || !this.settlement) return 0n;
    const outstandingR = this.protocolShares.residual + this.positions.asset.residual;
    return outstandingR * this.settlement.residualValue6 / TOKEN;
  }

  stats(_now: number = Date.now()): MarketStats {
    const cap = Number(this.cap6 / USDC);
    if (this.lifecycle === 'PRICE_FIXED' && this.settlement) {
      const p = this.eventYes ? 1.0 : 0.0;
      const payout = Number(this.settlement.payout6) / 1e6;
      return {
        p,
        eYes: this.eventYes ? payout : null,
        eNo: !this.eventYes ? payout : null,
        impact: null,
        impliedSpot: payout,
        yesSharePrice: this.eventYes ? payout : 0,
        noSharePrice: !this.eventYes ? payout : 0,
        cap
      };
    }

    if (this.lifecycle === 'EVENT_RESOLVED') {
      const p = this.eventYes ? 1.0 : 0.0;
      if (this.eventYes) {
        const yesSharePrice = Number(this.shares.yes.usdc * TOKEN / this.shares.yes.tokens) / 1e6;
        return {
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
        const noSharePrice = Number(this.shares.no.usdc * TOKEN / this.shares.no.tokens) / 1e6;
        return {
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
    }

    const p = binaryPrice(this.binary.yes, this.binary.no);
    const yesSharePrice = Number(this.shares.yes.usdc * TOKEN / this.shares.yes.tokens) / 1e6;
    const noSharePrice = Number(this.shares.no.usdc * TOKEN / this.shares.no.tokens) / 1e6;
    return fourNumbers(p, yesSharePrice, noSharePrice, cap);
  }

  isTradingAllowed({ book, side }: { book: Book; side: TradableSide }, now = Date.now()): boolean {
    if (now > this.tradingCutoff) return false;
    if (this.lifecycle === 'PRICE_FIXED') return false;
    if (book === 'binary') return this.lifecycle === 'OPEN';
    if (book === 'asset') {
      if (this.lifecycle === 'OPEN') return true;
      if (this.lifecycle === 'EVENT_RESOLVED') return side === (this.eventYes ? 'yes' : 'no');
    }
    return false;
  }

  assertOpen(): void {
    if (this.settlement) throw new MarketError('This market has settled. Claim your winning positions.', 'SETTLED', 409);
  }

  quote({ book, side, amount, slippageBps = 50 }: QuoteInput, now = Date.now()): QuoteResult {
    if (this.lifecycle === 'PRICE_FIXED' || this.settlement) {
      throw new MarketError('This market has settled. Trading is closed.', 'SETTLED', 409);
    }
    if (!this.isTradingAllowed({ book, side }, now)) {
      throw new MarketError('Trading is frozen for this book or outcome.', 'TRADING_FROZEN', 409);
    }
    if (!['binary', 'asset'].includes(book) || !['yes', 'no'].includes(side)) throw new MarketError('Choose a book and outcome.');
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw new MarketError('Slippage must be between 0.01% and 5%.');
    const amount6: USDC6 = parseUnits(amount);
    if (amount6 > MAX_SANDBOX_ORDER) throw new MarketError('Amount exceeds the sandbox order limit.');
    const buy = book === 'binary' ? binaryBuy(this.binary, amount6, side) : shareBuy(this.shares[side], amount6);
    const before = this.stats(now);
    const unitPrice = book === 'binary' ? (side === 'yes' ? before.p : 1 - before.p) : before[side === 'yes' ? 'yesSharePrice' : 'noSharePrice'];
    const average = Number(amount6) / 1e6 / (Number(buy.out) / 1e18);
    return {
      book,
      side,
      amount: formatUnits(amount6),
      outUnits: buy.out.toString(),
      quantity: formatUnits(buy.out, 18, 6),
      minOutUnits: ((buy.out * BigInt(10000 - slippageBps)) / 10000n).toString(),
      fee: formatUnits(buy.fee6),
      averagePrice: average,
      priceImpactPct: unitPrice === 0 ? 0 : (average / unitPrice - 1) * 100,
      slippageBps,
      revision: this.revision,
      expiresAt: now + 120000,
      mode: 'sandbox'
    };
  }

  trade(input: TradeInput, now = Date.now()): TradeResult {
    const quote = ('quote' in input && input.quote) ? input.quote : (input as QuoteResult);
    if (!quote || quote.mode !== 'sandbox') throw new MarketError('A fresh sandbox quote is required.');
    const { book, side } = quote;
    if (!this.isTradingAllowed({ book, side }, now)) {
      throw new MarketError('Trading is frozen for this book or outcome.', 'TRADING_FROZEN', 409);
    }
    if (!Number.isInteger(quote.revision) || quote.revision !== this.revision) throw new MarketError('Prices changed. Review a fresh quote.', 'STALE_QUOTE', 409);
    if (!Number.isFinite(quote.expiresAt) || quote.expiresAt < now || quote.expiresAt > now + 120000) throw new MarketError('Quote expired. Review a new quote.', 'EXPIRED_QUOTE', 409);
    const verifiedQuote = this.quote(quote, now);
    const amount6: USDC6 = parseUnits(quote.amount);
    if (amount6 > this.balance6) throw new MarketError('Not enough sandbox USDC. Reset the sandbox to start again.', 'BALANCE', 409);
    if (typeof quote.minOutUnits !== 'string' || !/^\d{1,60}$/.test(quote.minOutUnits) || BigInt(quote.minOutUnits) <= 0n) throw new MarketError('Review a valid minimum output.');
    if (BigInt(verifiedQuote.outUnits) < BigInt(quote.minOutUnits)) throw new MarketError('Price moved past your slippage limit.', 'SLIPPAGE', 409);
    if (book === 'binary') {
      const fill = binaryBuy(this.binary, amount6, side);
      this.binary = fill.reserves;
      this.binaryVault6 += fill.net6;
      this.binarySupply += fill.minted;
      this.fees6 += fill.fee6;
    } else {
      this.shares[side] = shareBuy(this.shares[side], amount6).pool;
    }
    this.balance6 -= amount6;
    this.volume6 += amount6;
    this.positions[book][side] += BigInt(verifiedQuote.outUnits);
    this.revision++;
    const trade: TradeRecord = {
      id: this.revision,
      book,
      side,
      amount: verifiedQuote.amount,
      quantity: verifiedQuote.quantity,
      at: new Date(now).toISOString(),
      type: 'buy',
      mode: 'sandbox'
    };
    this.history.unshift(trade);
    this.history = this.history.slice(0, 100);
    return { trade, snapshot: this.snapshot() };
  }

  pairs({ book, action, quantity }: PairsInput, now = Date.now()): MarketSnapshot {
    this.assertOpen();
    if (now > this.tradingCutoff || this.lifecycle !== 'OPEN') {
      throw new MarketError('Pair operations are frozen.', 'TRADING_FROZEN', 409);
    }
    if (!['binary', 'asset'].includes(book) || !['split', 'merge'].includes(action)) throw new MarketError('Choose split or merge in a valid book.');
    const units = parseUnits(quantity, 18);
    if (book === 'binary') {
      const cost = action === 'split' ? ceilDiv(units * USDC, TOKEN) : (units * USDC) / TOKEN;
      if (cost === 0n) throw new MarketError('Pair amount is too small.');
      if (action === 'split' && (cost > this.balance6 || cost > MAX_SANDBOX_ORDER)) throw new MarketError('Not enough sandbox USDC.', 'BALANCE', 409);
      if (action === 'merge' && (this.positions.binary.yes < units || this.positions.binary.no < units)) throw new MarketError('Merging requires equal quantities of both outcomes.', 'BALANCE', 409);
      const sign = action === 'split' ? 1n : -1n;
      this.balance6 -= sign * cost;
      this.positions.binary.yes += sign * units;
      this.positions.binary.no += sign * units;
      this.binaryVault6 += sign * cost;
      this.binarySupply += sign * units;
      this.revision++;
      this.history.unshift({ id: this.revision, type: action, book, quantity, amount: formatUnits(cost), at: new Date(now).toISOString(), mode: 'sandbox' });
      this.history = this.history.slice(0, 100);
      return this.snapshot();
    } else {
      const cost = action === 'split' ? ceilDiv(units * this.cap6, TOKEN) : (units * this.cap6) / TOKEN;
      if (cost === 0n) throw new MarketError('Pair amount is too small.');
      if (action === 'split' && (cost > this.balance6 || cost > MAX_SANDBOX_ORDER)) throw new MarketError('Not enough sandbox USDC.', 'BALANCE', 409);
      if (action === 'merge') {
        if (this.positions.asset.yes < units || this.positions.asset.no < units || this.positions.asset.residual < units) {
          throw new MarketError('Merging requires equal quantities of YES, NO, and RESIDUAL claims.', 'BALANCE', 409);
        }
      }
      const sign = action === 'split' ? 1n : -1n;
      this.balance6 -= sign * cost;
      this.positions.asset.yes += sign * units;
      this.positions.asset.no += sign * units;
      this.positions.asset.residual += sign * units;
      this.shareVault6 += sign * cost;
      this.shareSupply += sign * units;
      this.revision++;
      this.history.unshift({ id: this.revision, type: action, book, quantity, amount: formatUnits(cost), at: new Date(now).toISOString(), mode: 'sandbox' });
      this.history = this.history.slice(0, 100);
      return this.snapshot();
    }
  }

  resolveEvent({ eventYes }: { eventYes: boolean }, now = Date.now()): MarketSnapshot {
    if (this.lifecycle !== 'OPEN') throw new MarketError('Event has already been resolved.', 'RESOLVED', 409);
    if (typeof eventYes !== 'boolean') throw new MarketError('Choose a valid resolution.');
    if (!eventYes && this.eventDeadline > 0 && now < this.eventDeadline) {
      throw new MarketError('Cannot resolve NO before the event deadline.', 'DEADLINE_NOT_PASSED', 400);
    }
    this.eventYes = eventYes;
    this.lifecycle = 'EVENT_RESOLVED';
    this.revision++;
    this.history.unshift({
      id: this.revision,
      type: 'resolve-event',
      amount: eventYes ? 'YES' : 'NO',
      at: new Date().toISOString(),
      mode: 'sandbox'
    });
    return this.snapshot();
  }

  fixPrice({ spot }: { spot: string }, now = Date.now()): MarketSnapshot {
    if (this.lifecycle === 'OPEN') throw new MarketError('Resolve the binary event before fixing the asset price.', 'EVENT_PENDING', 409);
    if (this.lifecycle === 'PRICE_FIXED') throw new MarketError('Settlement price has already been fixed.', 'SETTLED', 409);
    if (this.earliestPriceFixTime > 0 && now < this.earliestPriceFixTime) {
      throw new MarketError('Price observation window has not arrived.', 'TIMING', 400);
    }
    const spot6: USDC6 = parseUnits(spot, 6, true);
    if (spot6 > MAX_SANDBOX_ORDER) throw new MarketError('Oracle value is outside the sandbox range.');

    const payout6: USDC6 = spot6 > this.cap6 ? this.cap6 : spot6;
    const residualValue6: USDC6 = this.cap6 - payout6;

    this.settlement = {
      eventYes: Boolean(this.eventYes),
      spot6,
      payout6,
      residualValue6,
      capped: spot6 > this.cap6,
      at: new Date().toISOString()
    };
    this.lifecycle = 'PRICE_FIXED';
    this.revision++;
    this.history.unshift({
      id: this.revision,
      type: 'fix-price',
      amount: formatUnits(spot6),
      at: new Date().toISOString(),
      mode: 'sandbox'
    });
    return this.snapshot();
  }

  settle({ eventYes, spot }: { eventYes: boolean; spot: string }, now = Date.now()): MarketSnapshot {
    if (this.lifecycle !== 'OPEN') throw new MarketError('This market has settled. Claim your winning positions.', 'SETTLED', 409);
    if (typeof eventYes !== 'boolean') throw new MarketError('Choose a valid resolution.');
    if (!eventYes && this.eventDeadline > 0 && now < this.eventDeadline) {
      throw new MarketError('Cannot resolve NO before the event deadline.', 'DEADLINE_NOT_PASSED', 400);
    }
    if (this.earliestPriceFixTime > 0 && now < this.earliestPriceFixTime) {
      throw new MarketError('Price observation window has not arrived.', 'TIMING', 400);
    }
    const spot6: USDC6 = parseUnits(spot, 6, true);
    if (spot6 > MAX_SANDBOX_ORDER) throw new MarketError('Oracle value is outside the sandbox range.');

    this.resolveEvent({ eventYes }, now);
    return this.fixPrice({ spot }, now);
  }

  claim(): { paid: string; snapshot: MarketSnapshot } {
    if (this.lifecycle === 'OPEN') throw new MarketError('Wait until the sandbox oracle resolves the market.', 'NOT_SETTLED', 409);
    let totalPaid6: USDC6 = 0n;
    let hadPositions = false;

    // Binary claim
    if (this.eventYes !== null && (this.positions.binary.yes > 0n || this.positions.binary.no > 0n)) {
      hadPositions = true;
      const winner: TradableSide = this.eventYes ? 'yes' : 'no';
      const binUnits = this.positions.binary[winner];
      if (binUnits > 0n) {
        const binPayout: USDC6 = binUnits * USDC / TOKEN;
        this.binaryVault6 -= binPayout;
        totalPaid6 += binPayout;
      }
      this.positions.binary = { yes: 0n, no: 0n };
    }

    // Asset and Residual claims
    if (this.lifecycle === 'PRICE_FIXED' && this.settlement) {
      const winner: TradableSide = this.settlement.eventYes ? 'yes' : 'no';
      const winUnits = this.positions.asset[winner];
      const loseUnits = this.positions.asset[winner === 'yes' ? 'no' : 'yes'];
      const resUnits = this.positions.asset.residual;
      if (winUnits > 0n || loseUnits > 0n || resUnits > 0n) {
        hadPositions = true;
        const sharePayout: USDC6 = winUnits * this.settlement.payout6 / TOKEN;
        const resPayout: USDC6 = resUnits * this.settlement.residualValue6 / TOKEN;
        const assetTotal: USDC6 = sharePayout + resPayout;
        this.shareVault6 -= assetTotal;
        totalPaid6 += assetTotal;
        this.positions.asset = { yes: 0n, no: 0n, residual: 0n };
      }
    }

    if (!hadPositions) {
      if (this.lifecycle === 'EVENT_RESOLVED' && (this.positions.asset.yes > 0n || this.positions.asset.no > 0n || this.positions.asset.residual > 0n)) {
        throw new MarketError('Binary positions are claimed or empty; asset claims unlock after price fixing.', 'PRICE_PENDING', 409);
      }
      throw new MarketError('No positions remain to claim.', 'EMPTY', 409);
    }

    this.balance6 += totalPaid6;
    this.claimed6 += totalPaid6;
    this.revision++;
    this.history.unshift({
      id: this.revision,
      type: 'claim',
      amount: formatUnits(totalPaid6),
      at: new Date().toISOString(),
      mode: 'sandbox'
    });
    return { paid: formatUnits(totalPaid6), snapshot: this.snapshot() };
  }

  snapshot(): MarketSnapshot {
    const stats = this.stats();
    const s = this.settlement;
    const base = {
      mode: 'sandbox' as const,
      market: this.market,
      revision: this.revision,
      balance: formatUnits(this.balance6),
      volume: formatUnits(this.volume6),
      observationPolicy: this.observationPolicy,
      cap: Number(this.cap6 / USDC),
      stats,
      timing: {
        policy: this.timingPolicy,
        label: this.timingPolicy === 'untimed'
          ? 'Untimed local sandbox (instant simulation without waiting period)'
          : this.timingPolicy === 'accelerated-demo'
          ? 'Accelerated demo schedule (finite demonstration timing)'
          : 'Scheduled production calendar',
        eventDeadline: this.eventDeadline,
        tradingCutoff: this.tradingCutoff,
        earliestPriceFixTime: this.earliestPriceFixTime,
        observationRule: this.observationPolicy.rule,
        priceSource: this.observationPolicy.source,
        eventSource: this.observationPolicy.eventSource
      },
      history: clone(this.history),
      claimed: formatUnits(this.claimed6),
      vaults: {
        binary: formatUnits(this.binaryVault6),
        asset: formatUnits(this.shareVault6),
        fees: formatUnits(this.fees6),
        remainingLiabilities: formatUnits(this.remainingLiabilities6()),
        residualLocked: formatUnits(this.residualLocked6())
      },
      positions: [
        {
          book: 'binary' as Book,
          side: 'yes' as ClaimKind,
          units: this.positions.binary.yes.toString(),
          quantity: formatUnits(this.positions.binary.yes, 18, 8),
          payout: this.eventYes !== null ? formatUnits(this.eventYes ? this.positions.binary.yes * USDC / TOKEN : 0n) : null
        },
        {
          book: 'binary' as Book,
          side: 'no' as ClaimKind,
          units: this.positions.binary.no.toString(),
          quantity: formatUnits(this.positions.binary.no, 18, 8),
          payout: this.eventYes !== null ? formatUnits(!this.eventYes ? this.positions.binary.no * USDC / TOKEN : 0n) : null
        },
        {
          book: 'asset' as Book,
          side: 'yes' as ClaimKind,
          units: this.positions.asset.yes.toString(),
          quantity: formatUnits(this.positions.asset.yes, 18, 8),
          payout: s ? formatUnits(s.eventYes ? this.positions.asset.yes * s.payout6 / TOKEN : 0n) : null
        },
        {
          book: 'asset' as Book,
          side: 'no' as ClaimKind,
          units: this.positions.asset.no.toString(),
          quantity: formatUnits(this.positions.asset.no, 18, 8),
          payout: s ? formatUnits(!s.eventYes ? this.positions.asset.no * s.payout6 / TOKEN : 0n) : null
        },
        {
          book: 'asset' as Book,
          side: 'residual' as ClaimKind,
          units: this.positions.asset.residual.toString(),
          quantity: formatUnits(this.positions.asset.residual, 18, 8),
          payout: s ? formatUnits(this.positions.asset.residual * s.residualValue6 / TOKEN) : null
        }
      ]
    };

    if (this.lifecycle === 'PRICE_FIXED' && s) {
      return {
        ...base,
        lifecycle: 'PRICE_FIXED',
        status: 'settled',
        eventYes: Boolean(this.eventYes),
        resolvedOutcome: this.eventYes ? 'YES' : 'NO',
        settlement: {
          eventYes: s.eventYes,
          spot: formatUnits(s.spot6),
          payout: formatUnits(s.payout6),
          residual: formatUnits(s.residualValue6),
          residualValue: formatUnits(s.residualValue6),
          residualLocked: formatUnits(this.residualLocked6()),
          capped: s.capped,
          at: s.at
        }
      };
    }

    if (this.lifecycle === 'EVENT_RESOLVED') {
      return {
        ...base,
        lifecycle: 'EVENT_RESOLVED',
        status: 'event_resolved',
        eventYes: Boolean(this.eventYes),
        resolvedOutcome: this.eventYes ? 'YES' : 'NO',
        settlement: null
      };
    }

    return {
      ...base,
      lifecycle: 'OPEN',
      status: 'open',
      eventYes: null,
      resolvedOutcome: null,
      settlement: null
    };
  }
}