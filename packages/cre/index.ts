import { parseUnits, formatUnits } from '../core/market.mjs';
import type { ClipNotionalInput, ClipResult, ConfidentialClipOptions } from './types.ts';

export type * from './types.ts';

export function clipNotional({ requestedSize, maxNotional }: ClipNotionalInput): ClipResult {
  const requested = parseUnits(requestedSize);
  const max = parseUnits(maxNotional, 6, true);
  if (max === 0n) return { allowed: false, clippedSize: '0' };
  return { allowed: true, clippedSize: formatUnits(requested > max ? max : requested) };
}

export function getValidatedCreConfig(env: Record<string, string | undefined> = process.env): { url: URL; token: string } {
  if (!env.CRE_CLIP_URL || !env.CRE_CLIP_ALLOWED_HOST || !env.CRE_CLIP_TOKEN) {
    throw new Error('Confidential clipping is not configured. No local fallback is used.');
  }
  let url: URL;
  try {
    url = new URL(env.CRE_CLIP_URL);
  } catch {
    throw new Error('Invalid confidential endpoint configuration.');
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== env.CRE_CLIP_ALLOWED_HOST ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.port
  ) {
    throw new Error(
      'Confidential endpoint must use the explicitly approved HTTPS host without URL credentials or query data.'
    );
  }

  if (!/^[a-zA-Z0-9_-]{43,128}$/.test(env.CRE_CLIP_TOKEN)) {
    throw new Error('Configure a strong confidential bridge token.');
  }

  return { url, token: env.CRE_CLIP_TOKEN };
}

export function isCreConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    getValidatedCreConfig(env);
    return true;
  } catch {
    return false;
  }
}

export async function requestConfidentialClip(
  requestedSize: string,
  { env = process.env, fetchImpl = fetch }: ConfidentialClipOptions = {}
): Promise<ClipResult> {
  const requested = parseUnits(requestedSize);
  const { url, token } = getValidatedCreConfig(env);

  let response: Response;
  try {
    response = await fetchImpl(url.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.CRE_CLIP_TOKEN ? { Authorization: `Bearer ${env.CRE_CLIP_TOKEN}` } : {})
      },
      body: JSON.stringify({ requestedSize }),
      signal: AbortSignal.timeout(55000),
      redirect: 'error'
    });
  } catch {
    throw new Error('Confidential clip request timed out or failed.');
  }

  if (!response.ok) throw new Error('Confidential clip service rejected the request.');

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('Invalid confidential clip response.');
  }

  if (
    !result ||
    typeof result !== 'object' ||
    typeof (result as { allowed?: unknown }).allowed !== 'boolean' ||
    typeof (result as { clippedSize?: unknown }).clippedSize !== 'string'
  ) {
    throw new Error('Invalid confidential clip response.');
  }

  const res = result as { allowed: boolean; clippedSize: string };

  let clipped: bigint;
  try {
    clipped = parseUnits(res.clippedSize, 6, true);
  } catch {
    throw new Error('Invalid confidential clip response.');
  }

  if (clipped > requested || (res.allowed && clipped === 0n) || (!res.allowed && clipped !== 0n)) {
    throw new Error('Confidential clip response violates the size policy.');
  }

  return { allowed: res.allowed, clippedSize: formatUnits(clipped) };
}
