/**
 * Type definitions for Chainlink CRE clipping policy and confidential requests
 */

export interface ClipNotionalInput {
  requestedSize: string;
  maxNotional: string;
}

export interface ClipResult {
  allowed: boolean;
  clippedSize: string;
}

export interface ConfidentialClipOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface CallbackEnvelopeInput {
  requestedSize: string;
  requestId: string;
  callbackToken: string;
  expiresAt: number;
}
