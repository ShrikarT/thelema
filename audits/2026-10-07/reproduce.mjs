// Audit probes. Local arithmetic / mocked data plus optional public read/quote calls.
// No wallet, keys, signing, approvals, trades, or chain mutations.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {SandboxMarket, fourNumbers, shareBuy, TOKEN, USDC} from '../../packages/core/market.mjs';
import {fetchStandardizedSource} from '../../packages/graph/index.mjs';

const findings = {};
const market = new SandboxMarket();
const before = market.stats();
market.trade(market.quote({book:'binary',side:'yes',amount:'100'}));
const after = market.stats();
assert.equal(before.yesSharePrice, after.yesSharePrice);
assert.equal(before.noSharePrice, after.noSharePrice);
assert.notEqual(before.impact, after.impact);
findings.probabilityOnlyChange = {before, after, assetPoolsUnchanged:true};

const incoherent = fourNumbers(0.02,116.55,43.66,500);
assert.ok(incoherent.eYes > incoherent.cap);
findings.cappedConditionalOutOfBounds = incoherent;

const yesSeed = {usdc:11655000n,tokens:100000000000000000n};
findings.seedQuotes = ['0.1','1','5','25','50','1000'].map(amount => {
  const amount6 = BigInt(Math.round(Number(amount)*1e6));
  const result = shareBuy(yesSeed,amount6);
  const averagePrice = Number(amount6)/1e6/(Number(result.out)/1e18);
  return {amount,shares:Number(result.out)/1e18,averagePrice,
    priceImpactPercent:(averagePrice/116.55-1)*100,
    maximumPossiblePayout:Number(result.out)*500/1e18,
    worstCaseLossEvenAtCap:Number(amount)-Number(result.out)*500/1e18};
});

const graphResult = await fetchStandardizedSource(
  {GRAPH_API_KEY:'audit_mock_key',GRAPH_MAX_AGE_SECONDS:'900'},
  {protocol:'Mock source',subgraphId:'mock',poolId:'pool',assetSymbol:'WETH',assetAddress:'0x1'},
  async()=>({ok:true,json:async()=>({data:{reference:{id:'pool',protocol:{name:'Mock source'},
    inputTokens:[{id:'0x1',symbol:'WETH',lastPriceUSD:'2500',lastPriceBlockNumber:1},
      {id:'0x2',symbol:'USDC'}]},_meta:{block:{number:999999,timestamp:Math.floor(Date.now()/1000)}}}})})
);
assert.equal(graphResult.status,'live');
findings.mockStaleTokenPriceAccepted = {scope:'Mocked response, not live market evidence',result:graphResult,
  tokenLastPriceBlockNumber:1,indexerBlockNumber:999999};

if(process.argv.includes('--public')) {
  const base='https://thelema.onrender.com';
  const response=await fetch(base+'/api/config',{signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw Error('Public config HTTP '+response.status);
  const config=await response.json();
  const cookie=response.headers.get('set-cookie')?.split(';')[0];
  if(!cookie) throw Error('No public session cookie');
  const headers={'Cookie':cookie};
  const read=async path=>{
    const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(60000)});
    return {status:r.status,data:await r.json()};
  };
  const {csrf,...publicConfig}=config;
  const state=await read('/api/market?mode=arc');
  const references=await read('/api/references');
  const quotes=[];
  for(const amount of ['0.1','1','25','50']) {
    const r=await fetch(base+'/api/arc/quote',{method:'POST',
      headers:{...headers,'Content-Type':'application/json','X-CSRF-Token':csrf},
      body:JSON.stringify({book:'asset',side:'yes',amount,slippageBps:50}),
      signal:AbortSignal.timeout(60000)});
    const data=await r.json();
    quotes.push({status:r.status,data,
      maximumPossiblePayout:data.outUnits?Number(data.outUnits)*state.data.cap/1e18:null});
  }
  findings.publicDeployment={checkedAt:new Date().toISOString(),config:publicConfig,state,references,quotes};
}

await writeFile(new URL('./reproductions.json',import.meta.url),JSON.stringify(findings,null,2));
console.log(JSON.stringify({localProbes:4,publicReadAndQuoteOnly:Boolean(findings.publicDeployment),
  report:'audits/2026-10-07/reproductions.json'},null,2));
