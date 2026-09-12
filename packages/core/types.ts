/**
 * THELEMA Core Type Definitions
 *
 * Explicit unit distinctions:
 * - USDC6: 6-decimal integer micro-USDC (1 USDC = 1_000_000n)
 * - Units18: 18-decimal integer token units (1 token = 10^18n)
 * - UnixSeconds: Timestamp in seconds (EVM block.timestamp standard)
 * - UnixMillis: Timestamp in milliseconds (JavaScript Date.now() standard)
 */

export type USDC6 = bigint;
export type Units18 = bigint;
export type UnixSeconds = number;
export type UnixMillis = number;

export type TradableSide = 'yes' | 'no';
export type ClaimKind = 'yes' | 'no' | 'residual';
export type Book = 'binary' | 'asset';
export type Side = TradableSide;

export type LifecycleStage = 'OPEN' | 'EVENT_RESOLVED' | 'PRICE_FIXED';
export type MarketStatus = 'open' | 'event_resolved' | 'settled';

export interface MarketMetadata {
  readonly id: string;
  readonly ticker: string;
  readonly question: string;
  readonly asset: string;
  readonly cap: number;
}

export interface FullMarketMetadata extends MarketMetadata {
  readonly title: string;
  readonly shortTitle: string;
  readonly resolutionDate: string;
  readonly chainId: number;
  readonly collateralAddress: string;
}

export interface ObservationPolicy {
  readonly rule: string;
  readonly source: string;
  readonly eventSource: string;
}

export interface MarketTiming {
  readonly eventDeadline: number;
  readonly tradingCutoff: number;
  readonly earliestPriceFixTime: number;
  readonly policy: string;
  readonly observationRule: string;
  readonly priceSource: string;
  readonly label?: string;
  readonly eventSource?: string;
}

export interface MarketStats {
  p: number;
  eYes: number | null;
  eNo: number | null;
  impact: number | null;
  impliedSpot: number;
  yesSharePrice: number;
  noSharePrice: number;
  cap: number;
}

export interface UserPositions {
  binary: {
    yes: Units18;
    no: Units18;
  };
  asset: {
    yes: Units18;
    no: Units18;
    residual: Units18;
  };
}

export interface FormattedPositionRow {
  book: Book;
  side: ClaimKind;
  units: string;
  quantity: string;
  payout: string | null;
  winning?: boolean;
}

export interface MarketVaults {
  binary?: string;
  asset?: string;
  fees?: string;
  remainingLiabilities: string;
  residualLocked: string;
  collateralBalance?: string;
}

export interface ActivityRecord {
  id: number;
  type: string;
  amount: string;
  at: string;
  mode: string;
  book?: string;
  side?: string;
  quantity?: string;
  details?: Record<string, unknown>;
}

export interface SandboxMarketOptions {
  market?: Partial<FullMarketMetadata>;
  cap?: number;
  cap6?: USDC6;
  eventDeadline?: number;
  tradingCutoff?: number;
  earliestPriceFixTime?: number;
  timingPolicy?: string;
  observationRule?: string;
  priceSource?: string;
  eventSource?: string;
}

export interface QuoteInput {
  book: Book;
  side: TradableSide;
  amount: string;
  slippageBps?: number;
}

export interface QuoteResult {
  book: Book;
  side: TradableSide;
  amount: string;
  outUnits: string;
  quantity: string;
  minOutUnits: string;
  fee: string;
  averagePrice: number;
  priceImpactPct: number;
  slippageBps: number;
  revision: number;
  expiresAt: number;
  mode: 'sandbox' | 'arc';
}

export interface TradeRecord {
  id: number;
  book: Book;
  side: TradableSide;
  amount: string;
  quantity: string;
  at: string;
  type: string;
  mode: 'sandbox' | 'arc';
  details?: Record<string, unknown>;
}

export type TradeInput = QuoteResult | { quote: QuoteResult };

export interface TradeResult {
  trade: TradeRecord;
  snapshot: MarketSnapshot;
}

export interface PairsInput {
  book: Book;
  action: 'split' | 'merge';
  quantity: string;
}

export interface PriceFixedSettlement {
  eventYes: boolean;
  spot: string;
  spot6: USDC6;
  payout: string;
  payout6: USDC6;
  residual: string;
  residualValue: string;
  residualValue6: USDC6;
  residualLocked: string;
  residualLocked6: USDC6;
  capped: boolean;
}

export interface FormattedSettlementSummary {
  eventYes: boolean;
  spot: string;
  payout: string;
  residual: string;
  residualValue: string;
  residualLocked: string;
  capped: boolean;
  at?: string;
}

export interface BaseMarketSnapshot {
  mode: 'sandbox' | 'arc';
  market: MarketMetadata;
  revision: number;
  timing: MarketTiming;
  observationPolicy: ObservationPolicy;
  stats: MarketStats;
  balance: string;
  volume: string;
  positions: FormattedPositionRow[];
  history: ActivityRecord[];
  vaults: MarketVaults;
  claimed: string;
  cap: number;
}

export interface OpenMarketSnapshot extends BaseMarketSnapshot {
  lifecycle: 'OPEN';
  status: 'open';
  eventYes: null;
  resolvedOutcome: null;
  settlement: null;
}

export interface EventResolvedMarketSnapshot extends BaseMarketSnapshot {
  lifecycle: 'EVENT_RESOLVED';
  status: 'event_resolved';
  eventYes: boolean;
  resolvedOutcome: 'YES' | 'NO';
  settlement: null;
}

export interface PriceFixedMarketSnapshot extends BaseMarketSnapshot {
  lifecycle: 'PRICE_FIXED';
  status: 'settled';
  eventYes: boolean;
  resolvedOutcome: 'YES' | 'NO';
  settlement: FormattedSettlementSummary;
}

export type MarketSnapshot =
  | OpenMarketSnapshot
  | EventResolvedMarketSnapshot
  | PriceFixedMarketSnapshot;
