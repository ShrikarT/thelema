import {request as httpRequest} from 'node:http';
import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {createApp} from '../apps/web/server.mjs';
let server,base;
before(async()=>{server=createApp({env:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://'+'127.0.0.1:'+server.address().port;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function session(){const r=await fetch(base+'/api/config');assert.equal(r.status,200);const data=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:data.csrf};}
async function request(s,path,body,headers={}){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:s.cookie,'Content-Type':'application/json','X-CSRF-Token':s.csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});}
test('Health is honest about local scope',async()=>{const r=await fetch(base+'/api/health');const j=await r.json();assert.equal(j.liveEvidence,false);});
test('Session cookie and browser security headers are set',async()=>{const r=await fetch(base+'/api/config');assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');});
test('Mutations require initialized session and CSRF',async()=>{const r=await fetch(base+'/api/sandbox/reset',{method:'POST'});assert.equal(r.status,401);const s=await session();const q=await request(s,'/api/sandbox/reset',{}, {'X-CSRF-Token':'bad'});assert.equal(q.status,403);});
test('Cross-origin POST is blocked even with a token',async()=>{const s=await session();const r=await request(s,'/api/sandbox/reset',{}, {Origin:'https://attacker.example'});assert.equal(r.status,403);const f=await request(s,'/api/sandbox/reset',{}, {'Sec-Fetch-Site':'cross-site'});assert.equal(f.status,403);});
test('Session isolation and actual quote/trade/position flow',async()=>{const a=await session(),b=await session();const q=await (await request(a,'/api/sandbox/quote',{book:'asset',side:'yes',amount:'25'})).json();const fill=await request(a,'/api/sandbox/trade',q);assert.equal(fill.status,200);const state=(await fill.json()).snapshot;assert.equal(state.balance,'4975');assert.ok(state.stats.eYes>185);assert.ok(BigInt(state.positions.find(p=>p.book==='asset'&&p.side==='yes').units)>0n);assert.equal((await (await request(b,'/api/market?mode=sandbox')).json()).balance,'5000');const replay=await request(a,'/api/sandbox/trade',q);assert.equal(replay.status,409);});
test('HTTP split, settle, cap and claim flow',async()=>{const s=await session();assert.equal((await request(s,'/api/sandbox/pairs',{book:'asset',action:'split',quantity:'1'})).status,200);const settled=await (await request(s,'/api/sandbox/settle',{eventYes:false,spot:'700'})).json();assert.equal(settled.settlement.payout,'500');assert.equal(settled.status,'settled');assert.equal((await request(s,'/api/sandbox/quote',{book:'asset',side:'no',amount:'25'})).status,409);const claim=await (await request(s,'/api/sandbox/claim',{})).json();assert.equal(claim.paid,'500');assert.equal(claim.snapshot.balance,'5000');assert.equal((await request(s,'/api/sandbox/claim',{})).status,409);});
test('Bad input is a safe client error',async()=>{const s=await session();for(const amount of ['-1','1e3','0','1.1234567']){const r=await request(s,'/api/sandbox/quote',{book:'asset',side:'yes',amount});assert.equal(r.status,400);}});
test('JSON required, methods and body limits enforced',async()=>{const s=await session();assert.equal((await request(s,'/api/sandbox/reset',{}, {'Content-Type':'text/plain'})).status,415);assert.equal((await request(s,'/api/sandbox/reset',{x:'a'.repeat(17000)})).status,413);assert.equal((await fetch(base+'/api/config',{method:'PUT',headers:{Cookie:s.cookie}})).status,405);});
test('No .env, source file or traversal exposure',async()=>{for(const path of ['/.env','/packages/core/market.mjs','/assets/%2e%2e%2f%2e%2e%2f.env','/assets/app.js.map']){const r=await fetch(base+path);assert.equal(r.status,404);assert.ok(!(await r.text()).includes('CRE_CLIP_TOKEN'));}});
test('App routes, static assets and genuine 404',async()=>{for(const path of ['/','/market','/portfolio','/guide','/assets/app.js','/assets/app.css','/assets/thelema-sans.woff'])assert.equal((await fetch(base+path)).status,200,path);assert.equal((await fetch(base+'/not-a-page')).status,404);});
test('Arc unavailable is not fake live data',async()=>{const s=await session();const r=await request(s,'/api/market?mode=arc');assert.equal(r.status,503);assert.match((await r.json()).error,/not configured/);});
test('Clipping explicitly distinguishes local simulation from live',async()=>{const s=await session();const local=await (await request(s,'/api/clip',{mode:'sandbox',requestedSize:'1000'})).json();assert.deepEqual(local,{allowed:true,clippedSize:'50'});assert.equal((await request(s,'/api/clip',{mode:'arc',requestedSize:'1000'})).status,503);assert.equal((await request(s,'/api/clip',{mode:'fake',requestedSize:'1000'})).status,400);});
test('Clip enumeration is rate limited',async()=>{const s=await session();for(let i=0;i<15;i++)assert.equal((await request(s,'/api/clip',{mode:'sandbox',requestedSize:'1'})).status,200);assert.equal((await request(s,'/api/clip',{mode:'sandbox',requestedSize:'1'})).status,429);});
test('Host header blocks DNS rebinding targets',async()=>{const status=await new Promise((resolve,reject)=>{const req=httpRequest(base+'/api/config',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,421);});
test('Public host and origin enforcement with HTTPS APP_ORIGIN and mutations', async () => {
  const publicApp = createApp({
    env: {
      APP_HOST: 'thelema.app.example',
      APP_ORIGIN: 'https://thelema.app.example'
    }
  });
  await new Promise(resolve => publicApp.listen(0, '127.0.0.1', resolve));
  const publicPort = publicApp.address().port;
  const pBase = 'http://127.0.0.1:' + publicPort;

  try {
    // 1. Health check works
    const hRes = await fetch(pBase + '/api/health');
    assert.equal(hRes.status, 200);
    const hData = await hRes.json();
    assert.equal(hData.status, 'ok');
    assert.equal(hData.app, 'THELEMA');

    // 2. Request with configured APP_HOST is accepted
    let sessionCookie = '';
    let csrfToken = '';
    const allowedHostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(pBase + '/api/config', { headers: { Host: 'thelema.app.example' } }, res => {
        const cookies = res.headers['set-cookie'] || [];
        sessionCookie = cookies[0]?.split(';')[0] || '';
        assert.ok(cookies.some(c => c.includes('Secure')), 'Cookie must contain Secure when APP_ORIGIN is https');
        assert.ok(cookies.some(c => c.includes('SameSite=Strict')), 'Cookie must contain SameSite=Strict');
        assert.ok(cookies.some(c => c.includes('HttpOnly')), 'Cookie must contain HttpOnly');
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          const parsed = JSON.parse(body);
          csrfToken = parsed.csrf;
          resolve(res.statusCode);
        });
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(allowedHostStatus, 200);
    assert.ok(sessionCookie.startsWith('thelema_sid='));
    assert.ok(csrfToken.length > 20);

    // 3. Request with wrong host is rejected with 421
    const badHostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(pBase + '/api/config', { headers: { Host: 'wrong.app.example' } }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(badHostStatus, 421);

    // 4. HTTPS-origin POST with valid CSRF succeeds
    const postStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(pBase + '/api/sandbox/quote', {
        method: 'POST',
        headers: {
          Host: 'thelema.app.example',
          Origin: 'https://thelema.app.example',
          Cookie: sessionCookie,
          'X-CSRF-Token': csrfToken,
          'Content-Type': 'application/json'
        }
      }, res => {
        let b = '';
        res.on('data', d => { b += d; });
        res.on('end', () => {
          assert.equal(res.statusCode, 200);
          const q = JSON.parse(b);
          assert.ok(q.averagePrice);
          resolve(res.statusCode);
        });
      });
      req.on('error', reject);
      req.end(JSON.stringify({ book: 'asset', side: 'yes', amount: '25' }));
    });
    assert.equal(postStatus, 200);

    // 5. POST with downgraded plain HTTP Origin is rejected with 403
    const downgradeStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(pBase + '/api/sandbox/quote', {
        method: 'POST',
        headers: {
          Host: 'thelema.app.example',
          Origin: 'http://thelema.app.example',
          Cookie: sessionCookie,
          'X-CSRF-Token': csrfToken,
          'Content-Type': 'application/json'
        }
      }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ book: 'asset', side: 'yes', amount: '25' }));
    });
    assert.equal(downgradeStatus, 403);

    // 6. POST with mismatched Origin is rejected with 403
    const crossOriginStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(pBase + '/api/sandbox/quote', {
        method: 'POST',
        headers: {
          Host: 'thelema.app.example',
          Origin: 'https://attacker.example',
          Cookie: sessionCookie,
          'X-CSRF-Token': csrfToken,
          'Content-Type': 'application/json'
        }
      }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ book: 'asset', side: 'yes', amount: '25' }));
    });
    assert.equal(crossOriginStatus, 403);

    // 7. POST with invalid CSRF token is rejected with 403
    const badCsrfStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(pBase + '/api/sandbox/quote', {
        method: 'POST',
        headers: {
          Host: 'thelema.app.example',
          Origin: 'https://thelema.app.example',
          Cookie: sessionCookie,
          'X-CSRF-Token': 'bad-csrf-token',
          'Content-Type': 'application/json'
        }
      }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ book: 'asset', side: 'yes', amount: '25' }));
    });
    assert.equal(badCsrfStatus, 403);
  } finally {
    publicApp.closeAllConnections();
    await new Promise(resolve => publicApp.close(resolve));
  }
});

test('Platform-derived defaults from RENDER_EXTERNAL_HOSTNAME', async () => {
  const renderApp = createApp({
    env: {
      RENDER_EXTERNAL_HOSTNAME: 'thelema-service.onrender.com'
    }
  });
  await new Promise(resolve => renderApp.listen(0, '127.0.0.1', resolve));
  const port = renderApp.address().port;
  const rBase = 'http://127.0.0.1:' + port;

  try {
    let sid = '';
    let csrf = '';
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(rBase + '/api/config', { headers: { Host: 'thelema-service.onrender.com' } }, res => {
        const cookies = res.headers['set-cookie'] || [];
        sid = cookies[0]?.split(';')[0] || '';
        assert.ok(cookies.some(c => c.includes('Secure')), 'Platform-derived origin https must set Secure cookie');
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          csrf = JSON.parse(body).csrf;
          resolve(res.statusCode);
        });
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 200);

    // POST with derived origin succeeds
    const postStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(rBase + '/api/sandbox/quote', {
        method: 'POST',
        headers: {
          Host: 'thelema-service.onrender.com',
          Origin: 'https://thelema-service.onrender.com',
          Cookie: sid,
          'X-CSRF-Token': csrf,
          'Content-Type': 'application/json'
        }
      }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ book: 'asset', side: 'yes', amount: '25' }));
    });
    assert.equal(postStatus, 200);
  } finally {
    renderApp.closeAllConnections();
    await new Promise(resolve => renderApp.close(resolve));
  }
});

test('Rejects invalid APP_HOST or APP_ORIGIN configuration', () => {
  assert.throws(() => createApp({ env: { APP_HOST: 'bad host with spaces' } }), /Invalid APP_HOST/);
  assert.throws(() => createApp({ env: { APP_ORIGIN: 'ftp://bad-protocol.example' } }), /APP_ORIGIN must have http or https/);
});

