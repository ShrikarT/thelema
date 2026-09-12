import test from 'node:test';
import assert from 'node:assert/strict';
import { api, validateApiResponse } from '../apps/web/src/api.ts';

const mockFetch = (status, payload) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

test('api: rejects non-object or null response bodies on HTTP 200', async () => {
  for (const invalid of [null, undefined, 'string-payload', 12345, [1, 2, 3]]) {
    await assert.rejects(
      () => api('/api/config', 'GET', undefined, { fetchImpl: mockFetch(200, invalid) }),
      /Malformed API response: expected JSON object/
    );
  }
});

test('api: rejects malformed /api/config payloads', async () => {
  const baseConfig = {
    chainId: 5042002,
    chainName: 'Arc Testnet',
    collateral: '0x3600000000000000000000000000000000000000',
    contracts: { binaryAMM: '0x1' },
    csrf: 'test-csrf-token'
  };

  // Valid config should pass
  const valid = await api('/api/config', 'GET', undefined, { fetchImpl: mockFetch(200, baseConfig) });
  assert.equal(valid.chainId, 5042002);

  // Missing or wrong chainId
  await assert.rejects(
    () => api('/api/config', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseConfig, chainId: '5042002' }) }),
    /invalid configuration payload/
  );
  // Missing chainName
  await assert.rejects(
    () => api('/api/config', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseConfig, chainName: null }) }),
    /invalid configuration payload/
  );
  // Missing contracts
  await assert.rejects(
    () => api('/api/config', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseConfig, contracts: null }) }),
    /invalid configuration payload/
  );
  // Missing csrf
  await assert.rejects(
    () => api('/api/config', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseConfig, csrf: undefined }) }),
    /invalid configuration payload/
  );
});

test('api: rejects malformed /api/market payloads', async () => {
  const baseMarket = {
    mode: 'sandbox',
    lifecycle: 'OPEN',
    status: 'open',
    stats: { p: 0.5, eYes: 200, eNo: 80, impact: 120, impliedSpot: 150, cap: 500 }
  };

  const valid = await api('/api/market', 'GET', undefined, { fetchImpl: mockFetch(200, baseMarket) });
  assert.equal(valid.mode, 'sandbox');

  // Invalid mode
  await assert.rejects(
    () => api('/api/market', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseMarket, mode: 'unknown' }) }),
    /invalid market payload/
  );
  // Missing stats
  await assert.rejects(
    () => api('/api/market', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseMarket, stats: null }) }),
    /invalid market payload/
  );
  // Non-numeric p
  await assert.rejects(
    () => api('/api/market', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseMarket, stats: { p: 'half' } }) }),
    /invalid market/
  );
  // Missing lifecycle and status
  await assert.rejects(
    () => api('/api/market', 'GET', undefined, { fetchImpl: mockFetch(200, { ...baseMarket, lifecycle: 'INVALID_STAGE' }) }),
    /invalid market/
  );
});

test('api: rejects malformed /api/references payloads', async () => {
  const baseRefs = {
    probability: { status: 'live', label: 'Polymarket', value: 0.65 },
    spot: { status: 'live', label: 'Uniswap', value: 120.5 }
  };

  const valid = await api('/api/references', 'GET', undefined, { fetchImpl: mockFetch(200, baseRefs) });
  assert.equal(valid.probability.value, 0.65);

  // Missing probability
  await assert.rejects(
    () => api('/api/references', 'GET', undefined, { fetchImpl: mockFetch(200, { spot: baseRefs.spot }) }),
    /invalid references payload/
  );
  // Missing spot
  await assert.rejects(
    () => api('/api/references', 'GET', undefined, { fetchImpl: mockFetch(200, { probability: baseRefs.probability }) }),
    /invalid references payload/
  );
  // Missing status inside reference item
  await assert.rejects(
    () => api('/api/references', 'GET', undefined, { fetchImpl: mockFetch(200, { probability: { label: 'p' }, spot: baseRefs.spot }) }),
    /invalid references payload/
  );
});

test('api: rejects malformed /api/clip payloads', async () => {
  const baseClip = { allowed: true, clippedSize: '50' };

  const valid = await api('/api/clip', 'POST', { requestedSize: '100' }, { fetchImpl: mockFetch(200, baseClip) });
  assert.equal(valid.allowed, true);

  // Missing allowed boolean
  await assert.rejects(
    () => api('/api/clip', 'POST', {}, { fetchImpl: mockFetch(200, { clippedSize: '50' }) }),
    /invalid size clip payload/
  );
  // Missing clippedSize string
  await assert.rejects(
    () => api('/api/clip', 'POST', {}, { fetchImpl: mockFetch(200, { allowed: true }) }),
    /invalid size clip payload/
  );
  // Negative or non-decimal clippedSize
  for (const badSize of ['-1', '1e3', 'NaN', '1.1234567', 'abc']) {
    await assert.rejects(
      () => api('/api/clip', 'POST', {}, { fetchImpl: mockFetch(200, { allowed: true, clippedSize: badSize }) }),
      /invalid size clip payload/
    );
  }
});

test('api: rejects malformed /api/sandbox/quote and /api/arc/quote payloads', async () => {
  const baseQuote = {
    book: 'asset',
    side: 'yes',
    amount: '25',
    quantity: '0.213',
    outUnits: '213000000000000000',
    minOutUnits: '211935000000000000',
    fee: '0.075',
    averagePrice: 117.37,
    priceImpactPct: 0.7,
    slippageBps: 50,
    revision: 1,
    expiresAt: Date.now() + 60000,
    mode: 'sandbox'
  };

  const valid = await api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, baseQuote) });
  assert.equal(valid.quantity, '0.213');

  // Missing outUnits
  await assert.rejects(
    () => api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, outUnits: null }) }),
    /invalid quote payload/
  );
  // Missing minOutUnits
  await assert.rejects(
    () => api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, minOutUnits: undefined }) }),
    /invalid quote payload/
  );
  // minOutUnits > outUnits
  await assert.rejects(
    () => api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, minOutUnits: '999999999999999999' }) }),
    /invalid quote payload/
  );
  // Invalid book enum
  await assert.rejects(
    () => api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, book: 'stocks' }) }),
    /invalid quote payload/
  );
  // Invalid side enum
  await assert.rejects(
    () => api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, side: 'maybe' }) }),
    /invalid quote payload/
  );
  // Invalid slippageBps (out of range)
  await assert.rejects(
    () => api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, slippageBps: 1000 }) }),
    /invalid quote payload/
  );
  // Missing quantity
  await assert.rejects(
    () => api('/api/arc/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, quantity: null }) }),
    /invalid quote payload/
  );
  // Missing fee
  await assert.rejects(
    () => api('/api/sandbox/quote', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseQuote, fee: undefined }) }),
    /invalid quote payload/
  );
});

test('api: rejects malformed /api/sandbox/trade payloads', async () => {
  const baseTrade = {
    trade: { id: 't1', type: 'buy', book: 'asset', side: 'yes', amount: '25', quantity: '0.213' },
    snapshot: {
      mode: 'sandbox',
      lifecycle: 'OPEN',
      status: 'open',
      stats: { p: 0.5, impliedSpot: 150, cap: 500, yesSharePrice: 116.55, noSharePrice: 43.66 }
    }
  };

  const valid = await api('/api/sandbox/trade', 'POST', {}, { fetchImpl: mockFetch(200, baseTrade) });
  assert.equal(valid.trade.id, 't1');

  // Missing trade
  await assert.rejects(
    () => api('/api/sandbox/trade', 'POST', {}, { fetchImpl: mockFetch(200, { snapshot: baseTrade.snapshot }) }),
    /invalid trade payload/
  );
  // Missing snapshot
  await assert.rejects(
    () => api('/api/sandbox/trade', 'POST', {}, { fetchImpl: mockFetch(200, { trade: baseTrade.trade }) }),
    /invalid trade payload/
  );
  // Invalid trade book
  await assert.rejects(
    () => api('/api/sandbox/trade', 'POST', {}, { fetchImpl: mockFetch(200, { ...baseTrade, trade: { ...baseTrade.trade, book: 'invalid' } }) }),
    /invalid trade object/
  );
});

test('api: rejects malformed /api/sandbox/claim payloads', async () => {
  const baseClaim = {
    paid: '11.00',
    snapshot: {
      mode: 'sandbox',
      lifecycle: 'PRICE_FIXED',
      status: 'settled',
      stats: { p: 1.0, impliedSpot: 250, cap: 500, yesSharePrice: 250, noSharePrice: 0 },
      settlement: { spot: '250', payout: '250', residual: '250' }
    }
  };

  const valid = await api('/api/sandbox/claim', 'POST', {}, { fetchImpl: mockFetch(200, baseClaim) });
  assert.equal(valid.paid, '11.00');

  // Missing paid
  await assert.rejects(
    () => api('/api/sandbox/claim', 'POST', {}, { fetchImpl: mockFetch(200, { snapshot: baseClaim.snapshot }) }),
    /invalid claims payload/
  );
  // Missing snapshot
  await assert.rejects(
    () => api('/api/sandbox/claim', 'POST', {}, { fetchImpl: mockFetch(200, { paid: '11.00' }) }),
    /invalid claims payload/
  );
});

test('validateApiResponse: direct validator checks reject invalid shapes and inconsistent lifecycle', () => {
  assert.throws(() => validateApiResponse('/api/config', null), /expected JSON object/);
  assert.throws(() => validateApiResponse('/api/config', [1, 2, 3]), /expected JSON object/);
  assert.throws(() => validateApiResponse('/api/sandbox/reset', { mode: 123 }), /invalid sandbox snapshot payload/);

  // Inconsistent lifecycle: EVENT_RESOLVED without resolvedOutcome
  assert.throws(
    () => validateApiResponse('/api/market', {
      mode: 'sandbox',
      lifecycle: 'EVENT_RESOLVED',
      status: 'event_resolved',
      stats: { p: 1.0, impliedSpot: 150, cap: 500 }
    }),
    /resolved market missing outcome/
  );

  // Inconsistent lifecycle: PRICE_FIXED without status settled
  assert.throws(
    () => validateApiResponse('/api/market', {
      mode: 'sandbox',
      lifecycle: 'PRICE_FIXED',
      status: 'open',
      stats: { p: 1.0, impliedSpot: 250, cap: 500 }
    }),
    /price-fixed market must be settled/
  );
});
