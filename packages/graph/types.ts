/**
 * Type definitions for The Graph integration
 */

export type ReferenceStatus = 'live' | 'stale' | 'unavailable';

export interface ReferenceItem {
  status: ReferenceStatus;
  value: number | null;
  label: string;
  source?: string;
  updatedAt?: string | null;
  error?: string;
  asset?: string;
  comparable?: boolean;
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
  status: ReferenceStatus;
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

export interface GraphReferences {
  probability: ReferenceItem;
  spot: ReferenceItem;
  crossProtocol?: CrossProtocolReference;
}

export interface GetReferencesOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}
