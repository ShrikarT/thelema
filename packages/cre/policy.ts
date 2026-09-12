// Pure six-decimal clipping policy shared by the TEE handler and bridge validation.
// No filesystem, network, random source, logs, or Node-only APIs.
import type { CallbackEnvelopeInput, ClipResult } from './types.ts';

export function sizeUnits(value: unknown, allowZero = false): bigint {
  if (typeof value !== 'string' || value.length > 30 || !/^(0|[1-9]\d{0,18})(\.\d{1,6})?$/.test(value)) {
    throw new Error('Invalid size.');
  }
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (units === 0n && !allowZero) throw new Error('Size must be positive.');
  return units;
}

export function sizeDecimal(units: bigint): string {
  const fraction = (units % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return String(units / 1000000n) + (fraction ? '.' + fraction : '');
}

export function privateClip(requestedSize: string, maxNotional: string): ClipResult {
  const requested = sizeUnits(requestedSize);
  const cap = sizeUnits(maxNotional, true);
  return cap === 0n
    ? { allowed: false, clippedSize: '0' }
    : { allowed: true, clippedSize: sizeDecimal(requested < cap ? requested : cap) };
}

export function safeClipResult(value: unknown, requestedSize: string): ClipResult {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as { allowed?: unknown }).allowed !== 'boolean' ||
    typeof (value as { clippedSize?: unknown }).clippedSize !== 'string'
  ) {
    throw new Error('Invalid clip result.');
  }
  const val = value as { allowed: boolean; clippedSize: string };
  const clipped = sizeUnits(val.clippedSize, true);
  const requested = sizeUnits(requestedSize);
  if (clipped > requested || (val.allowed && clipped === 0n) || (!val.allowed && clipped !== 0n)) {
    throw new Error('Invalid clip result.');
  }
  return { allowed: val.allowed, clippedSize: sizeDecimal(clipped) };
}

export function validateCallbackUrl(value: unknown): string {
  // An exact configured HTTPS endpoint, not a URL supplied by the invoking user.
  // Regex deliberately avoids depending on a DOM URL implementation in the WASM runtime.
  if (
    typeof value !== 'string' ||
    value.length > 300 ||
    !/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+\/v1\/callback$/.test(value)
  ) {
    throw new Error('Configure the exact public HTTPS callback endpoint.');
  }
  const host = value.slice(8, -12).toLowerCase();
  if (/^\d+(\.\d+){3}$/.test(host) || /\.(localhost|local|internal|invalid|test)$/.test(host)) {
    throw new Error('Callback must use an approved public DNS name.');
  }
  return value;
}

export function callbackEnvelope(input: unknown, nowMs: number): CallbackEnvelopeInput {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'callbackToken,expiresAt,requestId,requestedSize'
  ) {
    throw new Error('Invalid invocation.');
  }
  const env = input as CallbackEnvelopeInput;
  sizeUnits(env.requestedSize);
  if (
    typeof env.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.requestId) ||
    typeof env.callbackToken !== 'string' ||
    !/^[a-zA-Z0-9_-]{43}$/.test(env.callbackToken) ||
    !Number.isSafeInteger(env.expiresAt) ||
    env.expiresAt * 1000 <= nowMs ||
    env.expiresAt * 1000 > nowMs + 120000
  ) {
    throw new Error('Invalid or expired invocation.');
  }
  return env;
}
