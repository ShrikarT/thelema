import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyGraph } from '../scripts/verify-graph.mjs';

const validEnv = {
  GRAPH_API_KEY: 'test_key_12345678',
  GRAPH_PROBABILITY_MARKET_ID: 'market_123',
  GRAPH_SPOT_SUBGRAPH_ID: 'subgraph_456',
  GRAPH_SPOT_POOL_ID: 'pool_789',
  GRAPH_SPOT_TOKEN_SYMBOL: 'USDC',
  GRAPH_MAX_AGE_SECONDS: '900'
};

const makeMockFetch = (handler) => async (url, opts) => handler(url, opts);

test('Graph: Unconfigured environment exits 0 and does not claim live verification', async () => {
  const res = await verifyGraph({}, fetch);
  assert.equal(res.status, 'UNCONFIGURED');
  assert.equal(res.exitCode, 0);
  assert.equal(res.verified, false);
});

test('Graph: Target configured without GRAPH_API_KEY fails with exitCode 1', async () => {
  const env = { GRAPH_PROBABILITY_MARKET_ID: 'market_123' }; // missing key
  const res = await verifyGraph(env, fetch);
  assert.equal(res.status, 'FAILED');
  assert.equal(res.exitCode, 1);
  assert.match(res.error, /GRAPH_API_KEY/);
});

test('Graph: Partial spot configuration fails with exitCode 1', async () => {
  const env = {
    GRAPH_API_KEY: 'test_key_12345678',
    GRAPH_SPOT_SUBGRAPH_ID: 'subgraph_456'
    // missing pool ID and token symbol
  };
  const res = await verifyGraph(env, fetch);
  assert.equal(res.status, 'FAILED');
  assert.equal(res.exitCode, 1);
  assert.match(res.error, /Partial spot configuration/);
});

test('Graph: HTTP 500 / 401 gateway failure exits nonzero with failure status', async () => {
  const mockFetch = makeMockFetch(async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized'
  }));

  const res = await verifyGraph(validEnv, mockFetch);
  assert.equal(res.status, 'FAILED');
  assert.equal(res.exitCode, 1);
  assert.equal(res.verified, false);
  assert.equal(res.summary.probability, 'FAILED');
  assert.equal(res.summary.spot, 'FAILED');
});

test('Graph: GraphQL errors array exits nonzero with failure status', async () => {
  const mockFetch = makeMockFetch(async () => ({
    ok: true,
    json: async () => ({
      errors: [{ message: 'Field "outcomeTokenPrices" does not exist' }]
    })
  }));

  const res = await verifyGraph(validEnv, mockFetch);
  assert.equal(res.status, 'FAILED');
  assert.equal(res.exitCode, 1);
  assert.equal(res.verified, false);
});

test('Graph: Stale block timestamp exits nonzero with failure status', async () => {
  const mockFetch = makeMockFetch(async () => ({
    ok: true,
    json: async () => ({
      data: {
        reference: { values: ['0.6', '0.4'] },
        _meta: { block: { timestamp: 100000, number: 1 } } // ancient timestamp
      }
    })
  }));

  const res = await verifyGraph(validEnv, mockFetch);
  assert.equal(res.status, 'FAILED');
  assert.equal(res.exitCode, 1);
  assert.equal(res.verified, false);
});

test('Graph: Missing entity (reference is null) exits nonzero with failure status', async () => {
  const mockFetch = makeMockFetch(async () => ({
    ok: true,
    json: async () => ({
      data: {
        reference: null,
        _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 100 } }
      }
    })
  }));

  const res = await verifyGraph(validEnv, mockFetch);
  assert.equal(res.status, 'FAILED');
  assert.equal(res.exitCode, 1);
  assert.equal(res.verified, false);
});

test('Graph: Valid configured responses exit 0 and report VERIFIED', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const mockFetch = makeMockFetch(async (url) => {
    if (url.includes('subgraphs/id/subgraph_456')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            reference: {
              tokens: [{ id: '0x1', symbol: 'USDC' }],
              values: ['1.0']
            },
            _meta: { block: { timestamp: nowSec, number: 100 } }
          }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          reference: {
            values: ['0.65', '0.35']
          },
          _meta: { block: { timestamp: nowSec, number: 100 } }
        }
      })
    };
  });

  const res = await verifyGraph(validEnv, mockFetch);
  assert.equal(res.status, 'VERIFIED');
  assert.equal(res.exitCode, 0);
  assert.equal(res.verified, true);
  assert.equal(res.summary.probability, 'VERIFIED');
  assert.equal(res.summary.spot, 'VERIFIED');
});

test('Graph: Unconfigured environment with requireConfigured fails with exitCode 1', async () => {
  const res = await verifyGraph({}, fetch, { requireConfigured: true });
  assert.equal(res.status, 'FAILED');
  assert.equal(res.exitCode, 1);
  assert.equal(res.verified, false);
  assert.match(res.error, /unconfigured/);
});

test('Graph: recordEvidence records sanitized evidence JSON without secret leakage', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'thelema-graph-test-'));
  const nowSec = Math.floor(Date.now() / 1000);
  const mockFetch = makeMockFetch(async (url) => {
    if (url.includes('subgraphs/id/subgraph_456')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            reference: {
              tokens: [{ id: '0x1', symbol: 'USDC' }],
              values: ['1.0']
            },
            _meta: { block: { timestamp: nowSec, number: 100 } }
          }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          reference: {
            values: ['0.65', '0.35']
          },
          _meta: { block: { timestamp: nowSec, number: 100 } }
        }
      })
    };
  });

  try {
    const res = await verifyGraph(validEnv, mockFetch, { projectRoot: tempDir, recordEvidence: true });
    assert.equal(res.status, 'VERIFIED');
    assert.equal(res.verified, true);

    const evidenceFile = path.join(tempDir, 'docs', 'evidence', 'graph-live.json');
    assert.ok(existsSync(evidenceFile), 'Evidence file must be written to docs/evidence/graph-live.json');

    const content = JSON.parse(readFileSync(evidenceFile, 'utf8'));
    assert.equal(content.status, 'VERIFIED');
    assert.equal(content.references.probability.value, 0.65);
    assert.equal(content.references.spot.value, 1.0);
    // Crucial: API key must NOT be leaked
    assert.doesNotMatch(JSON.stringify(content), /test_key_12345678/);
    assert.match(content.gateway, /\[REDACTED\]/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Graph: verifyGraph verifies standardized cross-protocol dual sources and records sanitized evidence', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'thelema-cross-graph-test-'));
  const nowSec = Math.floor(Date.now() / 1000);
  const crossEnv = {
    GRAPH_API_KEY: 'test_key_12345678',
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true',
    GRAPH_MAX_AGE_SECONDS: '900'
  };

  const makePoolMock = (protocol, price, tvl, vol) => ({
    data: {
      reference: {
        id: 'pool_test',
        name: `${protocol} WETH/USDC`,
        symbol: 'WETH/USDC',
        protocol: { id: 'proto_1', name: protocol, network: 'ARBITRUM_ONE' },
        inputTokens: [
          { id: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18, lastPriceUSD: String(price) },
          { id: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', symbol: 'USDC', decimals: 6, lastPriceUSD: '1' }
        ],
        totalValueLockedUSD: String(tvl),
        cumulativeVolumeUSD: String(vol),
        createdTimestamp: '1626122625'
      },
      _meta: { block: { timestamp: nowSec, number: 50000000 } }
    }
  });

  const mockFetch = makeMockFetch(async (url) => {
    const isUni = url.includes('FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX');
    const mock = isUni
      ? makePoolMock('Uniswap V3', 2480, 1050000, 58000000000)
      : makePoolMock('SushiSwap', 2475, 170000, 4350000000);
    return { ok: true, json: async () => mock };
  });

  try {
    const res = await verifyGraph(crossEnv, mockFetch, { projectRoot: tempDir, recordEvidence: true, includeCrossProtocol: true });
    assert.equal(res.status, 'VERIFIED');
    assert.equal(res.verified, true);
    assert.equal(res.summary.crossProtocol, 'VERIFIED');

    const crossEvidenceFile = path.join(tempDir, 'docs', 'evidence', 'graph-cross-protocol.json');
    assert.ok(existsSync(crossEvidenceFile), 'Evidence file must be written to docs/evidence/graph-cross-protocol.json');

    const content = JSON.parse(readFileSync(crossEvidenceFile, 'utf8'));
    assert.equal(content.status, 'VERIFIED');
    assert.equal(content.schema, 'Messari DEX AMM Standardized Schema (liquidityPool)');
    assert.equal(content.crossProtocol.status, 'agreeing');
    assert.equal(content.crossProtocol.source1.protocol, 'Uniswap V3');
    assert.equal(content.crossProtocol.source1.price, 2480);
    assert.equal(content.crossProtocol.source2.protocol, 'SushiSwap');
    assert.equal(content.crossProtocol.source2.price, 2475);
    assert.equal(content.crossProtocol.consensusPrice, 2477.5);
    assert.equal(content.crossProtocol.comparable, false);

    // API key must NOT be leaked
    assert.doesNotMatch(JSON.stringify(content), /test_key_12345678/);
    assert.match(content.gateway, /\[REDACTED\]/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});


