import test from 'node:test';import assert from 'node:assert/strict';import {getReferences, isGraphConfigured} from './index.mjs';
const env={GRAPH_API_KEY:'test_key_123456',GRAPH_PROBABILITY_SUBGRAPH_ID:'probability_subgraph',GRAPH_PROBABILITY_MARKET_ID:'market_1',GRAPH_SPOT_SUBGRAPH_ID:'spot_subgraph',GRAPH_SPOT_POOL_ID:'pool_1',GRAPH_SPOT_TOKEN_SYMBOL:'WETH',GRAPH_SPOT_ASSET:'ETH'};

test('isGraphConfigured strictly matches valid key and configured subgraph/pool IDs', () => {
  assert.equal(isGraphConfigured(env), true);
  assert.equal(isGraphConfigured({ ...env, GRAPH_PROBABILITY_MARKET_ID: undefined }), true); // spot still configured
  assert.equal(isGraphConfigured({ ...env, GRAPH_SPOT_POOL_ID: undefined }), true); // probability still configured
  assert.equal(isGraphConfigured({ ...env, GRAPH_PROBABILITY_MARKET_ID: undefined, GRAPH_SPOT_POOL_ID: undefined }), false);
  assert.equal(isGraphConfigured({ ...env, GRAPH_API_KEY: undefined }), false);
  assert.equal(isGraphConfigured({ ...env, GRAPH_API_KEY: 'short' }), false); // too short
  assert.equal(isGraphConfigured({}), false);
});
const payload=(probability=true)=>({data:{reference:probability?{values:['0.6','0.4']}:{tokens:[{symbol:'WETH'},{symbol:'USDC'}],values:['2000','1']},_meta:{block:{timestamp:Math.floor(Date.now()/1000),number:100}}}});
const stub=(edit=j=>j,seen=[])=>async(url,opts)=>{seen.push({url,opts});return {ok:true,json:async()=>edit(payload(url.includes('probability_subgraph')))};};
test('Graph missing configuration is unavailable, never a fabricated reference',async()=>{const r=await getReferences({env:{},fetchImpl:()=>{throw Error('must not fetch');}});assert.equal(r.spot.status,'unavailable');assert.equal(r.probability.value,null);});
test('Graph mock normalization distinguishes ETH analog from sNVDA',async()=>{const r=await getReferences({env,fetchImpl:stub()});assert.equal(r.probability.value,.6);assert.equal(r.spot.value,2000);assert.equal(r.spot.comparable,false);assert.equal(r.spot.status,'live');});
test('Graph queries use variables and only the trusted gateway',async()=>{const seen=[];await getReferences({env,fetchImpl:stub(x=>x,seen)});assert.equal(seen.length,2);for(const req of seen){assert.match(req.url,/^https:\/\/gateway.thegraph.com\/api\//);assert.equal(req.opts.redirect,'error');const body=JSON.parse(req.opts.body);assert.ok(body.variables);assert.ok(!body.query.includes('market_1'));}});
test('Graph endpoint and provider messages do not leak key or raw errors',async()=>{const r=await getReferences({env,fetchImpl:async()=>({ok:true,json:async()=>({errors:[{message:env.GRAPH_API_KEY}]})})});assert.equal(r.spot.value,null);assert.ok(!JSON.stringify(r).includes(env.GRAPH_API_KEY));});
test('Graph rejects stale block timestamps',async()=>{const r=await getReferences({env,fetchImpl:stub(j=>{j.data._meta.block.timestamp=1;return j;})});assert.equal(r.probability.status,'unavailable');assert.match(r.spot.error,/stale/);});
test('Graph rejects missing metadata and out-of-range probability',async()=>{const r=await getReferences({env,fetchImpl:stub(j=>{j.data.reference.values=['1.1'];return j;})});assert.equal(r.probability.status,'unavailable');const m=await getReferences({env,fetchImpl:stub(j=>{delete j.data._meta;return j;})});assert.equal(m.spot.status,'unavailable');});
test('Graph network failure is explicit and contains no fallback price',async()=>{const r=await getReferences({env,fetchImpl:async()=>{throw Error('sensitive provider debug');}});assert.equal(r.spot.value,null);assert.ok(!JSON.stringify(r).includes('sensitive'));});
test('Comparability requires explicit same-asset opt-in',async()=>{const e={...env,GRAPH_SPOT_TOKEN_SYMBOL:'sNVDA',GRAPH_SPOT_ASSET:'sNVDA',GRAPH_SPOT_COMPARABLE:'true'};const r=await getReferences({env:e,fetchImpl:stub(j=>{if(j.data.reference.tokens)j.data.reference.tokens[0].symbol='sNVDA';return j;})});assert.equal(r.spot.comparable,true);});
test('Graph does not silently choose another token in the pool',async()=>{const r=await getReferences({env:{...env,GRAPH_SPOT_TOKEN_SYMBOL:'WBTC'},fetchImpl:stub()});assert.equal(r.spot.status,'unavailable');});

for(const age of ['0','-1','NaN','Infinity','3601','1.5'])test('Graph rejects unsafe freshness limit '+age,async()=>{const seen=[];const result=await getReferences({env:{...env,GRAPH_MAX_AGE_SECONDS:age},fetchImpl:stub(x=>x,seen)});assert.equal(result.probability.status,'unavailable');assert.equal(result.spot.status,'unavailable');assert.equal(seen.length,0);});

test('Graph normalizes Uniswap v3 Pool entity correctly with USD quote: Orientation 1 (USDC/WETH)', async () => {
  const uniEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_SPOT_SUBGRAPH_ID: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
    GRAPH_SPOT_POOL_ID: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
    GRAPH_SPOT_TOKEN_SYMBOL: 'WETH',
    GRAPH_SPOT_ASSET: 'ETH'
  };
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        reference: {
          id: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
          token0: { id: '0xa0b8', symbol: 'USDC' },
          token1: { id: '0xc02a', symbol: 'WETH' },
          token0Price: '2500.50',
          token1Price: '0.0004'
        },
        _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 20000000 } }
      }
    })
  });
  const res = await getReferences({ env: uniEnv, fetchImpl: mockFetch });
  assert.equal(res.spot.status, 'live');
  assert.equal(res.spot.value, 2500.50);
  assert.equal(res.spot.label, 'WETH pool reference');
  assert.equal(res.spot.comparable, false);
});

test('Graph normalizes Uniswap v3 Pool entity correctly with USD quote: Orientation 2 (WETH/USDC)', async () => {
  const uniEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_SPOT_SUBGRAPH_ID: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
    GRAPH_SPOT_POOL_ID: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
    GRAPH_SPOT_TOKEN_SYMBOL: 'WETH',
    GRAPH_SPOT_ASSET: 'ETH'
  };
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        reference: {
          id: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
          token0: { id: '0xc02a', symbol: 'WETH' },
          token1: { id: '0xa0b8', symbol: 'USDC' },
          token0Price: '0.0004',
          token1Price: '2490.75'
        },
        _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 20000000 } }
      }
    })
  });
  const res = await getReferences({ env: uniEnv, fetchImpl: mockFetch });
  assert.equal(res.spot.status, 'live');
  assert.equal(res.spot.value, 2490.75);
  assert.equal(res.spot.label, 'WETH pool reference');
  assert.equal(res.spot.comparable, false);
});

test('Graph rejects non-USD pool ratios (e.g. WBTC/WETH) without fabricating missing references', async () => {
  const nonUsdEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_SPOT_SUBGRAPH_ID: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
    GRAPH_SPOT_POOL_ID: '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed',
    GRAPH_SPOT_TOKEN_SYMBOL: 'WBTC',
    GRAPH_SPOT_ASSET: 'BTC'
  };
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        reference: {
          id: '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed',
          token0: { id: '0x2260', symbol: 'WBTC' },
          token1: { id: '0xc02a', symbol: 'WETH' },
          token0Price: '25.8',
          token1Price: '0.0387'
        },
        _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 20000000 } }
      }
    })
  });
  const res = await getReferences({ env: nonUsdEnv, fetchImpl: mockFetch });
  assert.equal(res.spot.status, 'unavailable');
  assert.equal(res.spot.value, null);
  assert.match(res.spot.error, /does not contain a supported USD quote token/i);
});

test('Cross-Protocol: Dual sources agreeing within 1.5% threshold produce agreeing status and consensus price', async () => {
  const crossEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true',
    GRAPH_CROSS_DISAGREEMENT_THRESHOLD: '0.015',
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
          { id: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', name: 'WETH', decimals: 18, lastPriceUSD: String(price) },
          { id: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', symbol: 'USDC', name: 'USDC', decimals: 6, lastPriceUSD: '1' }
        ],
        inputTokenBalances: ['100', '250000'],
        totalValueLockedUSD: String(tvl),
        cumulativeVolumeUSD: String(vol),
        createdTimestamp: '1626122625'
      },
      _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 50000000 } }
    }
  });

  const mockFetch = async (url) => {
    const isUni = url.includes('FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX');
    const mock = isUni
      ? makePoolMock('Uniswap V3', 2480, 1000000, 5000000000)
      : makePoolMock('SushiSwap', 2475, 200000, 400000000);
    return { ok: true, json: async () => mock };
  };

  const refs = await getReferences({ env: crossEnv, fetchImpl: mockFetch, includeCrossProtocol: true });
  assert.ok(refs.crossProtocol, 'crossProtocol must be present');
  assert.equal(refs.crossProtocol.status, 'agreeing');
  assert.equal(refs.crossProtocol.source1.protocol, 'Uniswap V3');
  assert.equal(refs.crossProtocol.source1.price, 2480);
  assert.equal(refs.crossProtocol.source2.protocol, 'SushiSwap');
  assert.equal(refs.crossProtocol.source2.price, 2475);
  assert.equal(refs.crossProtocol.consensusPrice, 2477.5);
  assert.match(refs.crossProtocol.disagreementPercent, /0\.20%/);
  assert.equal(refs.crossProtocol.comparable, false);
});

test('Cross-Protocol: Disagreement exceeding threshold produces disagreeing status with null consensus price', async () => {
  const crossEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true',
    GRAPH_CROSS_DISAGREEMENT_THRESHOLD: '0.015'
  };

  const makePoolMock = (protocol, price) => ({
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
        totalValueLockedUSD: '500000',
        cumulativeVolumeUSD: '1000000'
      },
      _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 50000000 } }
    }
  });

  const mockFetch = async (url) => {
    const isUni = url.includes('FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX');
    const mock = isUni ? makePoolMock('Uniswap V3', 2600) : makePoolMock('SushiSwap', 2400); // 8% spread
    return { ok: true, json: async () => mock };
  };

  const refs = await getReferences({ env: crossEnv, fetchImpl: mockFetch, includeCrossProtocol: true });
  assert.ok(refs.crossProtocol);
  assert.equal(refs.crossProtocol.status, 'disagreeing');
  assert.equal(refs.crossProtocol.consensusPrice, null);
  assert.match(refs.crossProtocol.disagreementPercent, /8\.00%/);
  assert.match(refs.crossProtocol.summary, /exceeding the 1\.5% threshold/);
});

test('Cross-Protocol: Single source fallback when one provider fails or times out', async () => {
  const crossEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true'
  };

  const mockFetch = async (url) => {
    const isUni = url.includes('FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX');
    if (isUni) {
      return {
        ok: true,
        json: async () => ({
          data: {
            reference: {
              id: 'pool_test',
              name: 'Uniswap V3 WETH/USDC',
              symbol: 'WETH/USDC',
              protocol: { id: 'proto_1', name: 'Uniswap V3', network: 'ARBITRUM_ONE' },
              inputTokens: [
                { id: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18, lastPriceUSD: '2485.50' },
                { id: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', symbol: 'USDC', decimals: 6, lastPriceUSD: '1' }
              ],
              totalValueLockedUSD: '1000000',
              cumulativeVolumeUSD: '5000000'
            },
            _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 50000000 } }
          }
        })
      };
    }
    // SushiSwap returns 500 error
    return { ok: false, status: 500 };
  };

  const refs = await getReferences({ env: crossEnv, fetchImpl: mockFetch, includeCrossProtocol: true });
  assert.ok(refs.crossProtocol);
  assert.equal(refs.crossProtocol.status, 'single_source');
  assert.equal(refs.crossProtocol.source1.status, 'live');
  assert.equal(refs.crossProtocol.source1.price, 2485.50);
  assert.equal(refs.crossProtocol.source2.status, 'unavailable');
  assert.equal(refs.crossProtocol.consensusPrice, 2485.50);
  assert.equal(refs.crossProtocol.disagreement, null);
  assert.match(refs.crossProtocol.summary, /Single valid source \(Uniswap V3 at \$2485\.50\)/);
});

test('Cross-Protocol: Stale block timestamp on one source triggers single source fallback', async () => {
  const crossEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true',
    GRAPH_MAX_AGE_SECONDS: '900'
  };

  const mockFetch = async (url) => {
    const isUni = url.includes('FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX');
    const ts = isUni ? 100000 : Math.floor(Date.now() / 1000); // Uni is ancient, Sushi is fresh
    return {
      ok: true,
      json: async () => ({
        data: {
          reference: {
            id: 'pool_test',
            name: 'Pool',
            symbol: 'WETH/USDC',
            protocol: { id: 'proto_1', name: isUni ? 'Uniswap V3' : 'SushiSwap', network: 'ARBITRUM_ONE' },
            inputTokens: [
              { id: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18, lastPriceUSD: '2470' },
              { id: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', symbol: 'USDC', decimals: 6, lastPriceUSD: '1' }
            ],
            totalValueLockedUSD: '1000000',
            cumulativeVolumeUSD: '5000000'
          },
          _meta: { block: { timestamp: ts, number: 50000000 } }
        }
      })
    };
  };

  const refs = await getReferences({ env: crossEnv, fetchImpl: mockFetch, includeCrossProtocol: true });
  assert.ok(refs.crossProtocol);
  assert.equal(refs.crossProtocol.status, 'single_source');
  assert.equal(refs.crossProtocol.source1.status, 'stale');
  assert.equal(refs.crossProtocol.source2.status, 'live');
  assert.equal(refs.crossProtocol.consensusPrice, 2470);
});

test('Cross-Protocol: Both sources failing results in unavailable status with null consensus price', async () => {
  const crossEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true'
  };

  const mockFetch = async () => ({ ok: false, status: 503 });

  const refs = await getReferences({ env: crossEnv, fetchImpl: mockFetch, includeCrossProtocol: true });
  assert.ok(refs.crossProtocol);
  assert.equal(refs.crossProtocol.status, 'unavailable');
  assert.equal(refs.crossProtocol.consensusPrice, null);
  assert.equal(refs.crossProtocol.disagreement, null);
  assert.match(refs.crossProtocol.summary, /No usable Graph reference source/);
});

test('Cross-Protocol: Rejects token contract address mismatch', async () => {
  const crossEnv = {
    GRAPH_API_KEY: 'test_key_123456',
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true'
  };

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        reference: {
          id: 'pool_test',
          name: 'Pool',
          symbol: 'WETH/USDC',
          protocol: { id: 'proto_1', name: 'Uniswap V3', network: 'ARBITRUM_ONE' },
          inputTokens: [
            { id: '0xdeadbeef00000000000000000000000000000000', symbol: 'WETH', decimals: 18, lastPriceUSD: '2470' }, // wrong address
            { id: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', symbol: 'USDC', decimals: 6, lastPriceUSD: '1' }
          ]
        },
        _meta: { block: { timestamp: Math.floor(Date.now() / 1000), number: 50000000 } }
      }
    })
  });

  const refs = await getReferences({ env: crossEnv, fetchImpl: mockFetch, includeCrossProtocol: true });
  assert.ok(refs.crossProtocol);
  assert.equal(refs.crossProtocol.status, 'unavailable');
  assert.match(refs.crossProtocol.source1.error, /Token contract address mismatch/);
});

test('Cross-Protocol: Never leaks API key in errors or output objects', async () => {
  const secretKey = 'test_secret_api_key_xyz987';
  const crossEnv = {
    GRAPH_API_KEY: secretKey,
    GRAPH_CROSS_PROTOCOL_ENABLED: 'true'
  };

  const mockFetch = async () => {
    throw new Error(`Connection to https://gateway.thegraph.com/api/${secretKey}/failed`);
  };

  const refs = await getReferences({ env: crossEnv, fetchImpl: mockFetch, includeCrossProtocol: true });
  const serialized = JSON.stringify(refs);
  assert.ok(!serialized.includes(secretKey), 'Serialized references must not leak API key');
});
