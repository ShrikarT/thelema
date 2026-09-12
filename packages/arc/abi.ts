/**
 * Narrow static ABI encoder and Keccak-256 implementation.
 * It never signs or hashes secret material.
 * Keccak-f[1600] is used solely to derive public function selectors.
 */

const MASK: bigint = (1n << 64n) - 1n;

const ROT: readonly number[] = Object.freeze([
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20,
  3, 10, 43, 25, 39, 41, 45, 15, 21, 8,
  18, 2, 61, 56, 14
]);

const RC: readonly bigint[] = Object.freeze([
  1n,
  0x8082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x808bn,
  0x80000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x8an,
  0x88n,
  0x80008009n,
  0x8000000an,
  0x8000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x80000001n,
  0x8000000080008008n
]);

const rol = (n: bigint, shift: number): bigint => {
  if (shift === 0) return n;
  const s = BigInt(shift);
  return ((n << s) | (n >> (64n - s))) & MASK;
};

export function keccak256(text: string): string {
  const raw = new TextEncoder().encode(text);
  const rate = 136;
  const len = Math.ceil((raw.length + 1) / rate) * rate;
  const bytes = new Uint8Array(len);
  bytes.set(raw);
  bytes[raw.length] = 1;
  bytes[len - 1] |= 128;

  const state = Array<bigint>(25).fill(0n);

  for (let offset = 0; offset < len; offset += rate) {
    for (let i = 0; i < rate; i++) {
      state[i >> 3] ^= BigInt(bytes[offset + i]) << BigInt((i % 8) * 8);
    }

    for (const roundConstant of RC) {
      const c = Array<bigint>(5).fill(0n);
      const d = Array<bigint>(5).fill(0n);
      const b = Array<bigint>(25).fill(0n);

      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          c[x] ^= state[x + 5 * y];
        }
      }

      for (let x = 0; x < 5; x++) {
        d[x] = c[(x + 4) % 5] ^ rol(c[(x + 1) % 5], 1);
      }

      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const idx = x + 5 * y;
          state[idx] ^= d[x];
          b[y + 5 * ((2 * x + 3 * y) % 5)] = rol(state[idx], ROT[idx]);
        }
      }

      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const idx = x + 5 * y;
          state[idx] = (b[idx] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y])) & MASK;
        }
      }

      state[0] ^= roundConstant;
    }
  }

  return '0x' + Array.from({ length: 32 }, (_, i) => {
    const byte = Number((state[i >> 3] >> BigInt((i % 8) * 8)) & 255n);
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

export function isAddress(x: unknown): x is string {
  return typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x) && !/^0x0{40}$/.test(x);
}

export function selector(signature: string): string {
  return keccak256(signature).slice(0, 10);
}

export type AbiArgument = string | number | bigint | boolean;

export function encode(signature: string, args: AbiArgument[] = []): string {
  const match = /^\w+\(([^)]*)\)$/.exec(signature);
  if (!match) throw new Error('Invalid static ABI signature');

  const types = match[1] ? match[1].split(',') : [];
  if (types.length !== args.length) throw new Error('ABI argument count mismatch');

  const encodedArgs = types.map((t, i) => {
    const arg = args[i];
    let n: bigint;

    if (t === 'address') {
      if (typeof arg !== 'string' || !isAddress(arg)) {
        throw new Error('Invalid address');
      }
      return arg.slice(2).toLowerCase().padStart(64, '0');
    }

    if (t === 'bool') {
      if (typeof arg !== 'boolean') throw new Error('Expected boolean');
      n = arg ? 1n : 0n;
    } else if (t === 'uint256') {
      if (typeof arg === 'number' && !Number.isSafeInteger(arg)) {
        throw new Error('Unsafe integer');
      }
      try {
        n = BigInt(arg);
      } catch {
        throw new Error('Expected unsigned integer');
      }
    } else {
      throw new Error('Unsupported ABI type');
    }

    if (n < 0n || n >= (1n << 256n)) {
      throw new Error('Integer out of uint256 range');
    }
    return n.toString(16).padStart(64, '0');
  });

  return selector(signature) + encodedArgs.join('');
}

export function words(hex: string): bigint[] {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-fA-F]{64})+$/.test(hex)) {
    throw new Error('Invalid ABI response');
  }
  const matches = hex.slice(2).match(/.{64}/g);
  if (!matches) throw new Error('Invalid ABI response format');
  return matches.map(x => BigInt('0x' + x));
}

export function addressWord(hex: string): string {
  const w = words(hex);
  if (w.length !== 1 || w[0] >= (1n << 160n)) {
    throw new Error('Invalid address response');
  }
  const addr = '0x' + w[0].toString(16).padStart(40, '0');
  if (!isAddress(addr)) throw new Error('Zero contract address');
  return addr;
}
