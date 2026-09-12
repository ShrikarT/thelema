import test from 'node:test';
import assert from 'node:assert/strict';
import {SandboxMarket,USDC,TOKEN,CAP,parseUnits,formatUnits,fourNumbers,binaryBuy,shareBuy,binaryPrice} from '../packages/core/market.mjs';
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const order=(m,book='binary',side='yes',amount='25')=>m.trade(m.quote({book,side,amount}));
test('USDC parsing is exactly six decimals, shares eighteen',()=>{assert.equal(parseUnits('1.000001'),1000001n);assert.equal(parseUnits('0.000001'),1n);assert.equal(parseUnits('1',18),TOKEN);assert.equal(CAP,500000000n);});
for(const value of ['-1','1e6','NaN','Infinity','+1','01','1.1234567','','.5','0','1..1','<script>']) test(`reject malformed decimal ${JSON.stringify(value)}`,()=>assert.throws(()=>parseUnits(value)));
test('decimal formatter preserves cents and sign without floating point',()=>{assert.equal(formatUnits(1234567n),'1.234567');assert.equal(formatUnits(-1000001n),'-1.000001');assert.equal(formatUnits(10n**18n,18),'1');});
test('starting stats come from reserves, not four UI constants',()=>{const m=new SandboxMarket(),s=m.stats();close(s.p,.63);close(s.eYes,185);close(s.eNo,118);close(s.impact,67);close(s.impliedSpot,160.21);});
test('binary YES buy moves P and all conditional outputs without changing share mids',()=>{const m=new SandboxMarket(),a=m.stats();order(m);const b=m.stats();assert.ok(b.p>a.p);assert.ok(b.eYes<a.eYes);assert.ok(b.eNo>a.eNo);assert.notEqual(b.impact,a.impact);close(b.impliedSpot,a.impliedSpot);});
test('binary NO buy reduces P',()=>{const m=new SandboxMarket(),p=m.stats().p;order(m,'binary','no');assert.ok(m.stats().p<p);});
test('asset YES buy moves share price and implied spot',()=>{const m=new SandboxMarket(),a=m.stats();order(m,'asset','yes');const b=m.stats();assert.ok(b.yesSharePrice>a.yesSharePrice);assert.ok(b.impliedSpot>a.impliedSpot);assert.equal(b.p,a.p);});
test('asset NO buy moves no-world price',()=>{const m=new SandboxMarket(),a=m.stats();order(m,'asset','no');assert.ok(m.stats().eNo>a.eNo);});
test('identity holds for interior probabilities',()=>{for(const p of [.02,.12,.5,.91,.98]){const s=fourNumbers(p,80,30);close(s.impliedSpot,p*s.eYes+(1-p)*s.eNo);}});
test('division guards do not show unstable conditional values',()=>{assert.equal(fourNumbers(.019,80,30).eYes,null);assert.equal(fourNumbers(.981,80,30).eNo,null);assert.equal(fourNumbers(0,80,30).impact,null);assert.equal(fourNumbers(1,80,30).impact,null);assert.notEqual(fourNumbers(.02,80,30).eYes,null);assert.notEqual(fourNumbers(.98,80,30).eNo,null);});
test('invalid prices cannot become displayable numbers',()=>{assert.throws(()=>fourNumbers(NaN,1,2));assert.throws(()=>fourNumbers(1.01,1,2));assert.throws(()=>fourNumbers(.5,-1,2));});
for(const book of ['binary','asset']) test(`${book} split and merge is an exact whole-pair roundtrip`,()=>{const m=new SandboxMarket(),before=m.balance6;m.pairs({book,action:'split',quantity:'2'});assert.equal(m.positions[book].yes,2n*TOKEN);m.pairs({book,action:'merge',quantity:'2'});assert.equal(m.balance6,before);assert.equal(m.totalUsdc(),m.initialTotal);});
test('sub-micro pair amounts cannot extract rounding value',()=>{const m=new SandboxMarket();m.pairs({book:'binary',action:'split',quantity:'0.000000000000000001'});assert.equal(m.balance6,5000n*USDC-1n);assert.throws(()=>m.pairs({book:'binary',action:'merge',quantity:'0.000000000000000001'}));});
test('merge requires both legs and is atomic on failure',()=>{const m=new SandboxMarket(),before=JSON.stringify(m.snapshot());assert.throws(()=>m.pairs({book:'asset',action:'merge',quantity:'1'}));assert.equal(JSON.stringify(m.snapshot()),before);});
test('balance checks reject overspend without mutation',()=>{const m=new SandboxMarket(),q=m.quote({book:'binary',side:'yes',amount:'5001'}),before=JSON.stringify(m.snapshot());assert.throws(()=>m.trade(q),/Not enough/);assert.equal(JSON.stringify(m.snapshot()),before);});
test('stale quote fails after another trade',()=>{const m=new SandboxMarket(),q=m.quote({book:'binary',side:'yes',amount:'25'});order(m);assert.throws(()=>m.trade(q),/Prices changed/);});
test('slippage violation fails atomically',()=>{const m=new SandboxMarket(),q=m.quote({book:'binary',side:'yes',amount:'25'});q.minOutUnits=(BigInt(q.outUnits)+1n).toString();const before=m.totalUsdc();assert.throws(()=>m.trade(q),/slippage/);assert.equal(m.revision,0);assert.equal(m.totalUsdc(),before);});
test('minimum output must be positive and integer',()=>{const m=new SandboxMarket(),q=m.quote({book:'binary',side:'yes',amount:'25'});for(const v of ['0','-1','1.2',null])assert.throws(()=>m.trade({...q,minOutUnits:v}));});
test('expired or fabricated distant-future quote rejected',()=>{const m=new SandboxMarket(),q=m.quote({book:'asset',side:'yes',amount:'25'},1000000);assert.throws(()=>m.trade(q,1120001),/expired/);assert.throws(()=>m.trade({...q,expiresAt:999999999},1000000),/expired/);});
test('slippage configuration is bounded',()=>{const m=new SandboxMarket();for(const bps of [0,501,1.5,'50'])assert.throws(()=>m.quote({book:'binary',side:'yes',amount:'25',slippageBps:bps}));});
for(const yes of [true,false]) test(`settlement pays only ${yes?'YES':'NO'} for both books`,()=>{const m=new SandboxMarket();m.pairs({book:'binary',action:'split',quantity:'2'});m.pairs({book:'asset',action:'split',quantity:'1'});m.settle({eventYes:yes,spot:'210.123456'});const positions=m.snapshot().positions;for(const p of positions.filter(p=>p.side===(yes?'no':'yes')))assert.equal(p.payout,'0');const {paid}=m.claim();assert.equal(paid,'502');assert.equal(m.totalUsdc(),m.initialTotal);assert.throws(()=>m.claim(),/No positions/);});
test('oracle S above cap pays cap and discloses residual',()=>{const m=new SandboxMarket();m.pairs({book:'asset',action:'split',quantity:'1'});m.settle({eventYes:true,spot:'800'});assert.equal(m.snapshot().settlement.capped,true);assert.equal(m.claim().paid,'500');assert.equal(m.snapshot().settlement.residual,'0');});
test('oracle S below cap pays asset payoff and residual to explicit claims',()=>{const m=new SandboxMarket();m.pairs({book:'asset',action:'split',quantity:'1'});m.settle({eventYes:false,spot:'200'});assert.equal(m.snapshot().settlement.residual,'300');assert.equal(m.claim().paid,'500');assert.equal(m.totalUsdc(),m.initialTotal);});
test('zero asset settlement pays full cap to residual and zero to asset leg',()=>{const m=new SandboxMarket();m.pairs({book:'asset',action:'split',quantity:'1'});m.settle({eventYes:true,spot:'0'});assert.equal(m.snapshot().settlement.residual,'500');assert.equal(m.claim().paid,'500');assert.equal(m.totalUsdc(),m.initialTotal);});
test('zero asset settlement pays nothing for bare winning asset share',()=>{const m=new SandboxMarket();m.positions.asset.yes=1n*TOKEN;m.settle({eventYes:true,spot:'0'});assert.equal(m.claim().paid,'0');assert.throws(()=>m.claim(),/No positions/);});
test('settlement is final and closes mint, merge and trade',()=>{const m=new SandboxMarket();m.settle({eventYes:true,spot:'200'});assert.throws(()=>m.settle({eventYes:false,spot:'50'}),/settled/);assert.throws(()=>m.quote({book:'binary',side:'no',amount:'1'}),/settled/);assert.throws(()=>m.pairs({book:'binary',action:'split',quantity:'1'}),/settled/);});
test('oracle rejects malformed outcome and negative prices',()=>{const m=new SandboxMarket();assert.throws(()=>m.settle({eventYes:'true',spot:'1'}));assert.throws(()=>m.settle({eventYes:true,spot:'-1'}));});
test('cannot claim before resolution',()=>assert.throws(()=>new SandboxMarket().claim(),/Wait until/));
test('1000 alternating pure binary fills preserve or increase k',()=>{let r={yes:740n*TOKEN,no:1260n*TOKEN};for(let i=0;i<1000;i++){const k=r.yes*r.no;const fill=binaryBuy(r,BigInt(1+i%97)*USDC,i%2?'yes':'no');assert.ok(fill.out>0n);assert.ok(fill.reserves.yes*fill.reserves.no>=k);r=fill.reserves;assert.ok(binaryPrice(r.yes,r.no)>0&&binaryPrice(r.yes,r.no)<1);}});
test('1000 asset fills preserve k and never drain token reserve',()=>{let p={tokens:100n*TOKEN,usdc:10000n*USDC};for(let i=0;i<1000;i++){const k=p.tokens*p.usdc;const fill=shareBuy(p,BigInt(i%31+1)*USDC);p=fill.pool;assert.ok(p.tokens*p.usdc>=k);assert.ok(p.tokens>0n);}});
test('mixed executed fills conserve all sandbox USDC and binary tokens',()=>{const m=new SandboxMarket();for(let i=0;i<200;i++){order(m,i%3?'binary':'asset',i%2?'yes':'no','1');assert.equal(m.totalUsdc(),m.initialTotal);assert.equal(m.binary.yes+m.protocolBinary.yes+m.positions.binary.yes,m.binarySupply);assert.equal(m.binary.no+m.protocolBinary.no+m.positions.binary.no,m.binarySupply);assert.equal(m.shares.yes.tokens+m.protocolShares.yes+m.positions.asset.yes,m.shareSupply);assert.equal(m.shares.no.tokens+m.protocolShares.no+m.positions.asset.no,m.shareSupply);}assert.equal(m.snapshot().history.length,100);});

test('original 166 -> 500 exploit is blocked because merging requires residual R',()=>{
  const m = new SandboxMarket();
  const startBal = m.balance6;
  const qYes = m.quote({book: 'asset', side: 'yes', amount: '120'});
  m.trade(qYes);
  const qNo = m.quote({book: 'asset', side: 'no', amount: '46'});
  m.trade(qNo);
  assert.ok(m.positions.asset.yes >= 1n * TOKEN);
  assert.ok(m.positions.asset.no >= 1n * TOKEN);
  assert.equal(m.positions.asset.residual, 0n);
  assert.throws(() => m.pairs({book: 'asset', action: 'merge', quantity: '1'}), /Merging requires equal quantities of YES, NO, and RESIDUAL claims/);
  assert.equal(m.balance6, startBal - 166n * USDC);
});

test('full complete-set mint, split, merge with R is exact roundtrip',()=>{
  const m = new SandboxMarket();
  const startBal = m.balance6;
  m.pairs({book: 'asset', action: 'split', quantity: '2.5'});
  assert.equal(m.positions.asset.yes, 25n * TOKEN / 10n);
  assert.equal(m.positions.asset.no, 25n * TOKEN / 10n);
  assert.equal(m.positions.asset.residual, 25n * TOKEN / 10n);
  assert.equal(m.balance6, startBal - 1250n * USDC);
  m.pairs({book: 'asset', action: 'merge', quantity: '1.5'});
  assert.equal(m.balance6, startBal - 500n * USDC);
  m.pairs({book: 'asset', action: 'merge', quantity: '1'});
  assert.equal(m.balance6, startBal);
  assert.equal(m.totalUsdc(), m.initialTotal);
});

test('independent ownership and transferred claims: Y, N, R pay exact formula for all price vectors',()=>{
  const scenarios = [
    {eventYes: true, spot: '0', expY: '0', expN: '0', expR: '500'},
    {eventYes: true, spot: '250', expY: '250', expN: '0', expR: '250'},
    {eventYes: true, spot: '500', expY: '500', expN: '0', expR: '0'},
    {eventYes: true, spot: '750', expY: '500', expN: '0', expR: '0'},
    {eventYes: false, spot: '0', expY: '0', expN: '0', expR: '500'},
    {eventYes: false, spot: '250', expY: '0', expN: '250', expR: '250'},
    {eventYes: false, spot: '500', expY: '0', expN: '500', expR: '0'},
    {eventYes: false, spot: '750', expY: '0', expN: '500', expR: '0'}
  ];
  for (const s of scenarios) {
    // Holder of Y only
    const mY = new SandboxMarket();
    mY.positions.asset.yes = 1n * TOKEN;
    mY.settle({eventYes: s.eventYes, spot: s.spot});
    assert.equal(mY.claim().paid, s.expY);

    // Holder of N only
    const mN = new SandboxMarket();
    mN.positions.asset.no = 1n * TOKEN;
    mN.settle({eventYes: s.eventYes, spot: s.spot});
    assert.equal(mN.claim().paid, s.expN);

    // Holder of R only
    const mR = new SandboxMarket();
    mR.positions.asset.residual = 1n * TOKEN;
    mR.settle({eventYes: s.eventYes, spot: s.spot});
    assert.equal(mR.claim().paid, s.expR);

    // Sum of Y + N + R is always C = 500
    assert.equal(Number(s.expY) + Number(s.expN) + Number(s.expR), 500);
  }
});

test('vault liabilities never exceed collateral balance throughout lifecycle',()=>{
  const m = new SandboxMarket();
  assert.ok(m.shareVault6 >= m.remainingLiabilities6());
  m.pairs({book: 'asset', action: 'split', quantity: '5'});
  assert.ok(m.shareVault6 >= m.remainingLiabilities6());
  const q = m.quote({book: 'asset', side: 'yes', amount: '50'});
  m.trade(q);
  assert.ok(m.shareVault6 >= m.remainingLiabilities6());
  m.resolveEvent({eventYes: true});
  assert.ok(m.shareVault6 >= m.remainingLiabilities6());
  m.fixPrice({spot: '350'});
  assert.ok(m.shareVault6 >= m.remainingLiabilities6());
  m.claim();
  assert.ok(m.shareVault6 >= m.remainingLiabilities6());
});

test('separate lifecycle stages and intermediate binary claiming preserving asset claims',()=>{
  const m = new SandboxMarket();
  m.pairs({book: 'binary', action: 'split', quantity: '2'});
  m.pairs({book: 'asset', action: 'split', quantity: '1'});
  
  // 1. Resolve event YES
  m.resolveEvent({eventYes: true});
  assert.equal(m.lifecycle, 'EVENT_RESOLVED');
  assert.equal(m.isTradingAllowed({book: 'binary', side: 'yes'}), false);
  assert.equal(m.isTradingAllowed({book: 'asset', side: 'no'}), false);
  assert.equal(m.isTradingAllowed({book: 'asset', side: 'yes'}), true);

  // 2. Claim binary winnings immediately
  const binClaim = m.claim();
  assert.equal(binClaim.paid, '2');
  assert.equal(m.positions.binary.yes, 0n);
  assert.equal(m.positions.binary.no, 0n);
  assert.equal(m.positions.asset.yes, 1n * TOKEN); // Asset claims preserved!
  assert.equal(m.positions.asset.residual, 1n * TOKEN);

  // 3. Second claim before price fix throws PRICE_PENDING
  assert.throws(() => m.claim(), /asset claims unlock after price fixing/);

  // 4. Fix price
  m.fixPrice({spot: '300'});
  assert.equal(m.lifecycle, 'PRICE_FIXED');
  assert.equal(m.isTradingAllowed({book: 'asset', side: 'yes'}), false);

  // 5. Claim asset and residual
  const assetClaim = m.claim();
  assert.equal(assetClaim.paid, '500'); // 300 for YES + 200 for RESIDUAL
  assert.equal(m.positions.asset.yes, 0n);
  assert.equal(m.positions.asset.residual, 0n);

  // 6. Claim when empty throws
  assert.throws(() => m.claim(), /No positions remain to claim/);
});

test('timing guards: trading cutoff, early NO, and earliest price-fix time enforced',()=>{
  const m = new SandboxMarket({
    eventDeadline: 1000,
    tradingCutoff: 1500,
    earliestPriceFixTime: 2000
  });

  // Early NO rejected before eventDeadline
  assert.throws(() => m.resolveEvent({eventYes: false}, 500), /Cannot resolve NO before the event deadline/);
  // Early YES permitted before eventDeadline if event occurred early
  const mEarly = new SandboxMarket({eventDeadline: 1000, tradingCutoff: 1500, earliestPriceFixTime: 2000});
  mEarly.resolveEvent({eventYes: true}, 500);
  assert.equal(mEarly.lifecycle, 'EVENT_RESOLVED');

  // NO permitted after eventDeadline
  m.resolveEvent({eventYes: false}, 1001);
  assert.equal(m.lifecycle, 'EVENT_RESOLVED');

  // Trading allowed before cutoff
  assert.equal(m.isTradingAllowed({book: 'asset', side: 'no'}, 1400), true);
  // Trading blocked after cutoff even if price is not fixed yet
  assert.equal(m.isTradingAllowed({book: 'asset', side: 'no'}, 1501), false);
  assert.throws(() => m.quote({book: 'asset', side: 'no', amount: '10'}, 1501), /Trading is frozen/);

  // Fixing price rejected before earliestPriceFixTime
  assert.throws(() => m.fixPrice({spot: '300'}, 1999), /Price observation window has not arrived/);
  // Fixing price succeeds after earliestPriceFixTime
  m.fixPrice({spot: '300'}, 2001);
  assert.equal(m.lifecycle, 'PRICE_FIXED');
});

test('configurable market with custom cap C=250',()=>{
  const m = new SandboxMarket({cap6: 250n * USDC});
  assert.equal(m.cap6, 250n * USDC);
  const startBal = m.balance6;
  m.pairs({book: 'asset', action: 'split', quantity: '2'});
  assert.equal(m.balance6, startBal - 500n * USDC); // 2 * 250 = 500
  m.settle({eventYes: true, spot: '400'}); // spot 400 > cap 250
  assert.equal(m.snapshot().settlement.capped, true);
  assert.equal(m.snapshot().settlement.payout, '250');
  assert.equal(m.snapshot().settlement.residual, '0');
  const claim = m.claim();
  assert.equal(claim.paid, '500'); // 2 * 250 = 500
});

test('atomic settlement failure does not partially mutate state', () => {
  const m = new SandboxMarket();
  const snapBefore = JSON.stringify(m.snapshot());
  assert.throws(() => m.settle({eventYes: true, spot: '-1'}), /Enter a plain decimal amount/);
  assert.equal(JSON.stringify(m.snapshot()), snapBefore);
  assert.equal(m.lifecycle, 'OPEN');
  assert.equal(m.eventYes, null);

  // Invalid eventYes boolean
  assert.throws(() => m.settle({eventYes: 'true', spot: '200'}), /Choose a valid resolution/);
  assert.equal(JSON.stringify(m.snapshot()), snapBefore);

  // Early NO with eventDeadline
  const mTimed = new SandboxMarket({eventDeadline: 5000});
  const timedBefore = JSON.stringify(mTimed.snapshot());
  assert.throws(() => mTimed.settle({eventYes: false, spot: '200'}, 1000), /Cannot resolve NO before the event deadline/);
  assert.equal(JSON.stringify(mTimed.snapshot()), timedBefore);
  assert.equal(mTimed.lifecycle, 'OPEN');
});

test('lifecycle-dependent pricing in EVENT_RESOLVED and PRICE_FIXED', () => {
  const m = new SandboxMarket();
  m.resolveEvent({eventYes: true});
  assert.equal(m.lifecycle, 'EVENT_RESOLVED');
  assert.equal(m.snapshot().resolvedOutcome, 'YES');

  const statsResolved = m.stats();
  assert.equal(statsResolved.p, 1.0);
  assert.ok(statsResolved.yesSharePrice > 0);
  assert.equal(statsResolved.noSharePrice, 0);
  assert.equal(statsResolved.eYes, statsResolved.yesSharePrice);
  assert.equal(statsResolved.eNo, null);
  assert.equal(statsResolved.impliedSpot, statsResolved.yesSharePrice);
  assert.equal(statsResolved.impact, null);

  // Surviving leg (YES) can be quoted
  const qYes = m.quote({book: 'asset', side: 'yes', amount: '25'});
  assert.ok(BigInt(qYes.outUnits) > 0n);

  // Binary and losing asset leg quotes rejected
  assert.throws(() => m.quote({book: 'binary', side: 'yes', amount: '25'}), /Trading is frozen/);
  assert.throws(() => m.quote({book: 'binary', side: 'no', amount: '25'}), /Trading is frozen/);
  assert.throws(() => m.quote({book: 'asset', side: 'no', amount: '25'}), /Trading is frozen/);

  // Fix price
  m.fixPrice({spot: '220'});
  assert.equal(m.lifecycle, 'PRICE_FIXED');
  const statsFixed = m.stats();
  assert.equal(statsFixed.p, 1.0);
  assert.equal(statsFixed.yesSharePrice, 220);
  assert.equal(statsFixed.noSharePrice, 0);
  assert.equal(statsFixed.impliedSpot, 220);

  const snap = m.snapshot();
  assert.equal(snap.settlement.spot, '220');
  assert.equal(snap.settlement.payout, '220');
  assert.equal(snap.settlement.residualValue, '280');
  assert.equal(snap.settlement.residualLocked, snap.vaults.residualLocked);

  // All quotes rejected in PRICE_FIXED
  assert.throws(() => m.quote({book: 'asset', side: 'yes', amount: '25'}), /settled/);
});

test('residualLocked6 counts outstanding R claims and excludes redeemed claims', () => {
  const m = new SandboxMarket();
  m.pairs({book: 'asset', action: 'split', quantity: '10'});
  assert.equal(m.positions.asset.residual, 10n * TOKEN);

  m.resolveEvent({eventYes: true});
  m.fixPrice({spot: '200'});
  assert.equal(m.lifecycle, 'PRICE_FIXED');
  assert.equal(m.settlement.residualValue6, 300n * USDC);

  const lockedBefore = m.residualLocked6();
  assert.equal(lockedBefore, 310n * 300n * USDC);

  m.claim();
  assert.equal(m.positions.asset.residual, 0n);

  const lockedAfter = m.residualLocked6();
  assert.equal(lockedAfter, 300n * 300n * USDC);
  assert.equal(lockedBefore - lockedAfter, 10n * 300n * USDC);
});


