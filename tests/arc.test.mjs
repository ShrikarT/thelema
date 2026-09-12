import test from 'node:test';import assert from 'node:assert/strict';import {keccak256,selector,encode,words,addressWord} from '../packages/arc/abi.mjs';import {configuration,readArc,quoteArc,makeRpc} from '../packages/arc/client.mjs';
const address=i=>'0x'+i.toString(16).padStart(40,'0'),word=(...v)=>'0x'+v.map(x=>BigInt(x).toString(16).padStart(64,'0')).join('');
const names=['ARC_BINARY_AMM','ARC_YES_SHARE_AMM','ARC_NO_SHARE_AMM','ARC_BINARY_VAULT','ARC_SHARE_VAULT','ARC_ORACLE'],config=configuration(Object.fromEntries(names.map((n,i)=>[n,address(i+1)])));
function mockRpc({chain=5042002,settled=0,shareLc=undefined,shareSettled=undefined,eventYes=1,binYes=undefined,binSettled=undefined,cutoff=0,priceFixTime=0,decimals=6,fee=30,empty=false,payout=200000000n,spot=200000000n,resVal=300000000n}={}){
 const tags=[];
 const effLc=shareLc!==undefined?BigInt(shareLc):(settled?2n:0n);
 const effBinSettled=binSettled!==undefined?BigInt(binSettled):(effLc>0n?1n:0n);
 const effShareSettled=shareSettled!==undefined?BigInt(shareSettled):(effLc===2n?1n:0n);
 const effShareYes=BigInt(eventYes);
 const effBinYes=binYes!==undefined?BigInt(binYes):effShareYes;
 const rpc=async(method,args)=>{
  if(method==='eth_chainId')return '0x'+chain.toString(16);
  if(method==='eth_blockNumber')return '0x64';
  assert.equal(method,'eth_call');
  const [{to,data},tag]=args;
  tags.push(tag);
  const s=data.slice(0,10);
  if(s===selector('reserves()'))return empty?word(0,0):to===config.contracts.binaryAMM?word(740n*10n**18n,1260n*10n**18n):to===config.contracts.yesShareAMM?word(11655000000n,100n*10n**18n):word(4366000000n,100n*10n**18n);
  if(s===selector('decimals()'))return word(decimals);
  if(s===selector('feeBps()'))return word(fee);
  if(s===selector('lifecycle()'))return word(effLc);
  if(s===selector('settled()'))return to===config.contracts.binarySplit?word(effBinSettled):to===config.contracts.shareSplit?word(effShareSettled):word(settled);
  if(s===selector('eventYes()'))return to===config.contracts.binarySplit?word(effBinYes):word(effShareYes);
  if(s===selector('tradingCutoff()'))return word(cutoff);
  if(s===selector('earliestPriceFixTime()'))return word(priceFixTime);
  if(s===selector('eventDeadline()'))return word(0);
  if(s===selector('cap6()'))return word(500000000n);
  if(s===selector('settlementValue6()')||s===selector('payout()'))return word(payout);
  if(s===selector('reportedPrice()'))return word(spot);
  if(s===selector('residualValue6()')||s===selector('residualValue()'))return word(resVal);
  if(s===selector('residualLocked6()')||s===selector('residualLocked()'))return word(resVal*1000n);
  if(s===selector('remainingLiabilities6()'))return word(resVal*1000n);
  if(s===selector('quoteBuyShares(uint256)'))return word(213000000000000000n,75000);
  if(s===selector('quoteBuy(bool,uint256)'))return word(39000000000000000000n,75000);
  return word(0);
 };
 return {rpc,tags};
}
test('Keccak empty string known vector',()=>assert.equal(keccak256(''),'0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'));
test('Keccak abc known vector',()=>assert.equal(keccak256('abc'),'0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'));
for(const [sig,s] of [['transfer(address,uint256)','0xa9059cbb'],['balanceOf(address)','0x70a08231'],['approve(address,uint256)','0x095ea7b3'],['decimals()','0x313ce567'],['allowance(address,address)','0xdd62ed3e']])test('Known selector '+sig,()=>assert.equal(selector(sig),s));
test('Static ABI exact encoding and decoding',()=>{assert.equal(encode('approve(address,uint256)',[address(1),25n]),'0x095ea7b3'+address(1).slice(2).padStart(64,'0')+'19'.padStart(64,'0'));assert.deepEqual(words(word(1,1000000)),[1n,1000000n]);assert.equal(addressWord(word(42)),address(42));});
test('Static ABI rejects unsupported, negative, malformed and unsafe values',()=>{for(const f of [()=>encode('x(string)',['x']),()=>encode('x(uint256)',[-1]),()=>encode('x(uint256)',[Number.MAX_SAFE_INTEGER+1]),()=>encode('x(address)',['0x123']),()=>encode('x(bool)',[1]),()=>words('0x12'),()=>addressWord(word(0))])assert.throws(f);});
test('Arc absent config refuses to substitute sandbox',async()=>assert.rejects(readArc(configuration({})),/not configured/));
test('Arc MOCK reads use one block and derive the initial four numbers',async()=>{const {rpc,tags}=mockRpc();const s=await readArc(config,{rpc});assert.equal(s.mode,'arc');assert.equal(s.stats.p,.63);assert.equal(s.stats.eYes,185);assert.ok(Math.abs(s.stats.eNo-118)<1e-9);assert.ok(Math.abs(s.stats.impact-67)<1e-9);assert.ok(tags.every(x=>x==='0x64'));assert.equal(s.balance,'');});
for(const [options,match] of [[{chain:1},/chain/],[{decimals:18},/decimals/],[{fee:50},/fee/],[{empty:true},/liquidity/]])test('Arc MOCK rejects invalid chain/collateral/pool '+JSON.stringify(options),async()=>assert.rejects(readArc(config,mockRpc(options)),match));
test('Arc MOCK quotes preserve decimal units and a positive slippage bound',async()=>{const q=await quoteArc(config,{book:'asset',side:'yes',amount:'25',slippageBps:50},mockRpc());assert.equal(q.mode,'arc');assert.equal(q.quantity,'0.213');assert.equal(q.fee,'0.075');assert.ok(BigInt(q.minOutUnits)<BigInt(q.outUnits));assert.equal(q.revision,100);});
test('Arc MOCK settled market refuses quotes',async()=>assert.rejects(quoteArc(config,{book:'asset',side:'yes',amount:'25'},mockRpc({settled:1})),/settled/));
test('Arc network failures are sanitized',async()=>{const rpc=makeRpc({fetchImpl:async()=>{throw Error('credentials-in-debug');}});await assert.rejects(rpc('eth_chainId',[]),e=>e.message.includes('unavailable')&&!e.message.includes('credentials'));});
test('Arc MOCK reads EVENT_RESOLVED state correctly',async()=>{
 const s=await readArc(config,mockRpc({shareLc:1,eventYes:1}));
 assert.equal(s.lifecycle,'EVENT_RESOLVED');
 assert.equal(s.status,'event_resolved');
 assert.equal(s.resolvedOutcome,'YES');
 assert.equal(s.stats.p,1.0);
 assert.equal(s.stats.noSharePrice,0);
 assert.equal(s.stats.impliedSpot,s.stats.yesSharePrice);
 assert.equal(s.stats.eNo,null);
});
test('Arc MOCK allows surviving leg quotes but rejects binary and losing leg quotes in EVENT_RESOLVED',async()=>{
 const mock=mockRpc({shareLc:1,eventYes:1});
 const q=await quoteArc(config,{book:'asset',side:'yes',amount:'25'},mock);
 assert.equal(q.book,'asset');
 assert.equal(q.side,'yes');
 await assert.rejects(quoteArc(config,{book:'binary',side:'yes',amount:'25'},mock),/closed|frozen/);
 await assert.rejects(quoteArc(config,{book:'asset',side:'no',amount:'25'},mock),/frozen/);
});
test('Arc MOCK settled market reads successfully even with empty liquidity',async()=>{
 const s=await readArc(config,mockRpc({settled:1,empty:true}));
 assert.equal(s.lifecycle,'PRICE_FIXED');
 assert.equal(s.stats.impliedSpot,200);
});
test('Arc MOCK rejects inconsistent lifecycle states',async()=>{
 await assert.rejects(readArc(config,mockRpc({shareLc:0,binSettled:1})),e=>e.code==='BAD_STATE'||/inconsistent/i.test(e.message));
 await assert.rejects(readArc(config,mockRpc({shareLc:0,shareSettled:1})),e=>e.code==='BAD_STATE'||/inconsistent/i.test(e.message));
 await assert.rejects(readArc(config,mockRpc({shareLc:1,shareSettled:1})),e=>e.code==='BAD_STATE'||/inconsistent/i.test(e.message));
 await assert.rejects(readArc(config,mockRpc({shareLc:1,binSettled:0})),e=>e.code==='BAD_STATE'||/inconsistent/i.test(e.message));
 await assert.rejects(readArc(config,mockRpc({shareLc:2,shareSettled:0})),e=>e.code==='BAD_STATE'||/inconsistent/i.test(e.message));
 await assert.rejects(readArc(config,mockRpc({shareLc:1,eventYes:1,binYes:0})),e=>e.code==='BAD_STATE'||/inconsistent/i.test(e.message));
});

