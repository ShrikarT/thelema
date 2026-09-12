import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createBridge} from '../services/cre-bridge/server.mjs';
import {canonicalJson, createRequestJWT, createGateway, GATEWAYS} from '../services/cre-bridge/gateway.mjs';
import {privateClip, safeClipResult, callbackEnvelope, validateCallbackUrl} from '../packages/cre/policy.mjs';

// All transport and signer behavior in this suite is mocked. No live CRE claim.
const AUTH = 'a'.repeat(64), WORKFLOW = '1'.repeat(64);
const signer = {address: '0x' + '12'.repeat(20), signMessage: async () => '0x' + 'ab'.repeat(64) + '1b'};
const ack = request => ({jsonrpc: '2.0', id: request.id, method: 'workflows.execute', result: {workflow_id: '0x' + WORKFLOW, workflow_execution_id: 'mock-execution', status: 'ACCEPTED'}});
async function harness(t, {onTrigger, ...options} = {}) {
  let base;
  const calls = [];
  const post = (path, body, token = AUTH, extra = {}) => fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...extra.headers}, body: JSON.stringify(body), ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers'))});
  const callback = (input, decision = {allowed: true, clippedSize: '50'}, token = input.callbackToken) => post('/v1/callback', {requestId: input.requestId, ...decision}, token);
  const server = createBridge({authToken: AUTH, allowedHost: '127.0.0.1', callbackWaitMs: 300, ...options, trigger: async (input, context) => {
    calls.push(input);
    if (onTrigger) return onTrigger(input, callback, context);
    assert.equal((await callback(input)).status, 204);
    return {executionId: 'mock-execution'};
  }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {server.drain(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  return {server, base, post, callback, calls};
}

test('Bridge: authenticated request waits for a one-time callback and returns only two fields', async t => {
  const h = await harness(t); const response = await h.post('/v1/clip', {requestedSize: '1000'});
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), {allowed: true, clippedSize: '50'});
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].callbackToken.length, 43);
  assert.equal(Object.keys(h.calls[0]).sort().join(','), 'callbackToken,expiresAt,requestId,requestedSize');
  assert.equal(h.server.pendingCount(), 0);
  assert.equal((await h.callback(h.calls[0])).status, 404);
});
test('Bridge: master bearer token cannot impersonate the confidential callback', async t => {
  const h = await harness(t, {onTrigger: async (input, callback) => {
    assert.equal((await callback(input, {allowed: true, clippedSize: '50'}, AUTH)).status, 401);
    assert.equal((await callback(input)).status, 204);
  }});
  assert.equal((await h.post('/v1/clip', {requestedSize: '1000'})).status, 200);
});
test('Bridge: duplicate callbacks cannot change an accepted decision', async t => {
  const h = await harness(t, {onTrigger: async (input, callback) => {
    assert.equal((await callback(input)).status, 204);
    assert.equal((await callback(input, {allowed: true, clippedSize: '1'})).status, 409);
  }});
  assert.equal((await (await h.post('/v1/clip', {requestedSize: '1000'})).json()).clippedSize, '50');
});
test('Bridge: acknowledged invocation without callback times out closed', async t => {
  const h = await harness(t, {callbackWaitMs: 30, onTrigger: async () => ({executionId: 'mock'})});
  const response = await h.post('/v1/clip', {requestedSize: '1000'});
  assert.equal(response.status, 504); assert.equal(h.server.pendingCount(), 0);
});
test('Bridge: a hung gateway cannot keep an order pending indefinitely', async t => {
  const h = await harness(t, {callbackWaitMs: 30, onTrigger: () => new Promise(() => {})});
  assert.equal((await h.post('/v1/clip', {requestedSize: '1000'})).status, 504);
  assert.equal(h.server.pendingCount(), 0);
});
test('Bridge: callback cannot override a rejected gateway invocation', async t => {
  const h = await harness(t, {onTrigger: async (input, callback) => {await callback(input); throw Error('provider secret=do-not-return');}});
  const response = await h.post('/v1/clip', {requestedSize: '1000'});
  assert.equal(response.status, 502); assert.deepEqual(await response.json(), {error: 'CONFIDENTIAL_GATEWAY_FAILED'});
});
test('Bridge: denial has a zero size and no local fallback', async t => {
  const h = await harness(t, {onTrigger: async (input, callback) => {await callback(input, {allowed: false, clippedSize: '0'});}});
  assert.deepEqual(await (await h.post('/v1/clip', {requestedSize: '1000'})).json(), {allowed: false, clippedSize: '0'});
});
test('Bridge: invalid callback result is rejected before resolving the request', async t => {
  const h = await harness(t, {onTrigger: async (input, callback) => {
    for (const result of [{allowed: true, clippedSize: '1001'}, {allowed: true, clippedSize: '0'}, {allowed: false, clippedSize: '1'}]) assert.equal((await callback(input, result)).status, 400);
    await callback(input);
  }});
  assert.equal((await h.post('/v1/clip', {requestedSize: '1000'})).status, 200);
});
test('Bridge: authentication is required before invoking CRE', async t => {
  const h = await harness(t);
  const response = await h.post('/v1/clip', {requestedSize: '1000'}, 'wrong');
  assert.equal(response.status, 401); assert.equal(h.calls.length, 0);
});
for (const requestedSize of ['0', '-1', 'NaN', '1e3', '1.1234567', 1000]) test('Bridge: invalid size is rejected: ' + requestedSize, async t => {
  const h = await harness(t); assert.equal((await h.post('/v1/clip', {requestedSize})).status, 400); assert.equal(h.calls.length, 0);
});
test('Bridge: request cannot select a workflow, callback destination or cap', async t => {
  const h = await harness(t);
  for (const extra of [{maxNotional: '50'}, {workflowId: WORKFLOW}, {callbackUrl: 'https://other.example.org/v1/callback'}]) assert.equal((await h.post('/v1/clip', {requestedSize: '1000', ...extra})).status, 400);
  assert.equal(h.calls.length, 0);
});
test('Bridge: browser-origin requests, non-JSON bodies and oversized bodies are rejected', async t => {
  const h = await harness(t);
  assert.equal((await h.post('/v1/clip', {requestedSize: '1'}, AUTH, {headers: {Origin: 'https://evil.example.org'}})).status, 403);
  assert.equal((await h.post('/v1/clip', {requestedSize: '1'}, AUTH, {headers: {'Content-Type': 'text/plain'}})).status, 415);
  assert.equal((await h.post('/v1/clip', {requestedSize: '1'.repeat(3000)})).status, 413);
  assert.equal(h.calls.length, 0);
});
test('Bridge: hostile Host is rejected using a real native HTTP request', async t => {
  const h = await harness(t);
  const status = await new Promise((resolve, reject) => {const req = http.request(h.base + '/healthz', {headers: {Host: 'evil.example.org'}}, res => {res.resume(); resolve(res.statusCode);}); req.on('error', reject); req.end();});
  assert.equal(status, 421);
});
test('Bridge: public health contains no workflow IDs or configuration', async t => {
  const h = await harness(t); const response = await fetch(h.base + '/healthz');
  assert.deepEqual(await response.json(), {ok: true}); assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('Bridge: global authenticated quota is enforced', async t => {
  const h = await harness(t, {ratePerMinute: 1});
  assert.equal((await h.post('/v1/clip', {requestedSize: '1000'})).status, 200);
  assert.equal((await h.post('/v1/clip', {requestedSize: '1000'})).status, 429);
  assert.equal(h.calls.length, 1);
});
test('Bridge: concurrent request bound and caller-abort cleanup', async t => {
  const h = await harness(t, {maxPending: 1, callbackWaitMs: 1000, onTrigger: async () => ({executionId: 'mock'})});
  const controller = new AbortController();
  const first = h.post('/v1/clip', {requestedSize: '1000'}, AUTH, {signal: controller.signal}).catch(error => error);
  for (let i = 0; i < 40 && h.calls.length === 0; i++) await delay(5);
  assert.equal(h.server.pendingCount(), 1);
  assert.equal((await h.post('/v1/clip', {requestedSize: '1000'})).status, 503);
  controller.abort(); await first;
  for (let i = 0; i < 40 && h.server.pendingCount(); i++) await delay(5);
  assert.equal(h.server.pendingCount(), 0);
});
test('Bridge: incomplete or weak configuration cannot start', () => {
  assert.throws(() => createBridge({authToken: 'short', allowedHost: 'example.org', trigger() {}}));
  assert.throws(() => createBridge({authToken: AUTH, allowedHost: 'example.org', trigger() {}, maxPending: Infinity}));
});

test('Gateway: canonical JSON is recursively sorted without changing array order', () => {
  assert.equal(canonicalJson({z: [{b: 2, a: 1}], a: {z: true, a: 'quoted"'}}), '{"a":{"a":"quoted\\\"","z":true},"z":[{"a":1,"b":2}]}');
  assert.throws(() => canonicalJson({a: Infinity})); assert.throws(() => canonicalJson({a: undefined}));
});
test('Gateway: JWT binds the exact body, expiry and signer; recovery byte is normalized', async () => {
  const request = {z: 1, a: {b: 2, a: 1}}; let message;
  const jwt = await createRequestJWT(request, {...signer, signMessage: async value => {message = value.message; return signer.signMessage(value);}}, {now: 1700000000000, jwtId: 'fixture-jwt-id'});
  const [header, payload, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), {alg: 'ETH', typ: 'JWT'});
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {digest: '0x' + createHash('sha256').update('{"a":{"a":1,"b":2},"z":1}').digest('hex'), iss: signer.address, iat: 1700000000, exp: 1700000060, jti: 'fixture-jwt-id'});
  assert.equal(message, header + '.' + payload); assert.equal(Buffer.from(sig, 'base64url').length, 65); assert.equal(Buffer.from(sig, 'base64url')[64], 0);
});
test('Gateway: malformed signatures are rejected', async () => {
  for (const value of ['0x', '0x' + '00'.repeat(64) + '23']) await assert.rejects(createRequestJWT({}, {...signer, signMessage: async () => value}));
});
test('Gateway: sends only to the fixed registry gateway and validates acknowledgement', async () => {
  let sent;
  const trigger = createGateway({workflowId: WORKFLOW, signer, fetchImpl: async (url, options) => {sent = {url, options}; return Response.json(ack(JSON.parse(options.body)));}});
  assert.deepEqual(await trigger({requestedSize: '1000'}), {executionId: 'mock-execution'});
  assert.equal(sent.url, GATEWAYS.private); assert.equal(sent.options.redirect, 'error');
  assert.equal(JSON.parse(sent.options.body).params.workflow.workflowID, WORKFLOW);
  assert.ok(sent.options.signal instanceof AbortSignal);
});
for (const mutation of ['requestId', 'workflowId', 'status', 'error', 'method']) test('Gateway: rejects mismatched or failed acknowledgement: ' + mutation, async () => {
  const trigger = createGateway({workflowId: WORKFLOW, signer, fetchImpl: async (url, options) => {
    const data = ack(JSON.parse(options.body));
    if (mutation === 'requestId') data.id = 'other';
    if (mutation === 'workflowId') data.result.workflow_id = '0x' + '2'.repeat(64);
    if (mutation === 'status') data.result.status = 'COMPLETED';
    if (mutation === 'error') data.error = {message: 'provider-secret'};
    if (mutation === 'method') data.method = 'other';
    return Response.json(data);
  }});
  await assert.rejects(trigger({requestedSize: '1000'}), error => error.message === 'CRE gateway invocation failed or timed out.');
});
test('Gateway: network or signer failures never leak exception text', async () => {
  for (const options of [{fetchImpl: async () => {throw Error('secret-token');}}, {signer: {...signer, signMessage: async () => {throw Error('private-key');}}}]) {
    const trigger = createGateway({workflowId: WORKFLOW, signer, ...options});
    await assert.rejects(trigger({requestedSize: '1'}), error => error.message === 'CRE gateway invocation failed or timed out.');
  }
});
test('Gateway: oversized JSON cannot be accepted', async () => {
  const trigger = createGateway({workflowId: WORKFLOW, signer, fetchImpl: async () => Response.json({data: 'x'.repeat(20000)})});
  await assert.rejects(trigger({requestedSize: '1'}));
});
test('Gateway: hung signer is bounded before making a network request', async t => {
  const keeper = setTimeout(() => {}, 100); t.after(() => clearTimeout(keeper)); let sent = false;
  const trigger = createGateway({workflowId: WORKFLOW, signer: {...signer, signMessage: () => new Promise(() => {})}, timeoutMs: 10, fetchImpl: async () => {sent = true;}});
  await assert.rejects(trigger({requestedSize: '1'})); assert.equal(sent, false);
});
test('TEE shared policy: integer clipping and valid zero-cap denial', () => {
  assert.deepEqual(privateClip('1000', '50'), {allowed: true, clippedSize: '50'});
  assert.deepEqual(privateClip('0.000001', '0.000002'), {allowed: true, clippedSize: '0.000001'});
  assert.deepEqual(privateClip('1', '0'), {allowed: false, clippedSize: '0'});
  assert.throws(() => safeClipResult({allowed: true, clippedSize: '2'}, '1'));
});
test('TEE shared policy: exact HTTPS callback endpoint only', () => {
  assert.equal(validateCallbackUrl('https://bridge.example.org/v1/callback'), 'https://bridge.example.org/v1/callback');
  for (const url of ['http://bridge.example.org/v1/callback', 'https://127.0.0.1/v1/callback', 'https://bridge.local/v1/callback', 'https://bridge.example.org:8443/v1/callback', 'https://user:pass@bridge.example.org/v1/callback', 'https://bridge.example.org/v1/callback?secret=x', 'https://bridge.example.org/elsewhere']) assert.throws(() => validateCallbackUrl(url), url);
});
test('TEE shared policy: exact fresh correlation envelope and per-request token', () => {
  const now = 1700000000000, input = {requestedSize: '1000', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', callbackToken: 'a'.repeat(43), expiresAt: now / 1000 + 45};
  assert.equal(callbackEnvelope(input, now), input);
  for (const patch of [{expiresAt: now / 1000}, {expiresAt: now / 1000 + 121}, {callbackToken: AUTH}, {requestId: 'not-a-uuid'}, {requestedSize: 'NaN'}, {callbackUrl: 'https://evil.example.org'}]) assert.throws(() => callbackEnvelope({...input, ...patch}, now));
});
