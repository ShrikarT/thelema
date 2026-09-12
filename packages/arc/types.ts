/**
 * Arc Adapter Type Definitions
 */

import {
  TradableSide,
  ClaimKind,
  Book,
  LifecycleStage,
  MarketStatus,
  MarketMetadata,
  MarketTiming,
  MarketStats,
  QuoteResult,
  USDC6,
  Units18,
  ActivityRecord
} from '../core/types.ts';

export interface ArcContracts {
  binaryAMM: string;
  yesShareAMM: string;
  noShareAMM: string;
  binarySplit: string;
  shareSplit: string;
  oracle: string;
}

export interface ArcConfig {
  chainId: number;
  chainName: string;
  collateral: string;
  explorer: string;
  rpcUrl?: string;
  arcReady: boolean;
  creReady: boolean;
  graphReady: boolean;
  contracts: ArcContracts;
  csrf: string;
}

export interface ArcPositionRow {
  book: Book;
  side: ClaimKind;
  token: string;
  vault: string;
  units: string;
  quantity: string;
  payout: string | null;
  winning: boolean;
}

export interface ArcSettlementInfo {
  eventYes: boolean;
  spot: string;
  payout: string;
  residual: string;
  residualValue: string;
  residualLocked: string;
  capped: boolean;
}

export interface ArcMarketSnapshot {
  mode: 'arc';
  market: MarketMetadata;
  revision: number;
  blockNumber: string;
  lifecycle: LifecycleStage;
  status: MarketStatus;
  eventYes?: boolean | null;
  resolvedOutcome: 'YES' | 'NO' | null;
  cap: number;
  stats: MarketStats;
  timing: MarketTiming;
  balance: string;
  volume: string;
  positions: ArcPositionRow[];
  history: ActivityRecord[];
  vaults: {
    remainingLiabilities: string;
    residualLocked: string;
  };
  claimed: string;
  settlement: ArcSettlementInfo | null;
}

export type RpcCaller = (method: string, params?: unknown[]) => Promise<unknown>;
