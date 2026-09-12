// Requires installed genuine viem. Separate from offline mock tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, createHash} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {recoverMessageAddress} from 'viem';
import {createRequestJWT, canonicalJson} from './gateway.mjs';

test('REAL crypto: CRE JWT EIP-191 signature recovers the dedicated ephemeral signer', async () => {
  // Ephemeral test-only key: never funded, sent to a gateway, logged or persisted.
  const account = privateKeyToAccount('0x' + randomBytes(32).toString('hex'));
  const request = {jsonrpc: '2.0', id: 'crypto-test', method: 'workflows.execute', params: {input: {requestedSize: '1'}, workflow: {workflowID: '1'.repeat(64)}}};
  const jwt = await createRequestJWT(request, account);
  const [header, payload, signature] = jwt.split('.');
  const bytes = Buffer.from(signature, 'base64url');
  assert.equal(bytes.length, 65); assert.ok(bytes[64] === 0 || bytes[64] === 1);
  bytes[64] += 27;
  const recovered = await recoverMessageAddress({message: header + '.' + payload, signature: '0x' + bytes.toString('hex')});
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.digest, '0x' + createHash('sha256').update(canonicalJson(request)).digest('hex'));
  assert.equal(claims.exp - claims.iat, 60);
});
test('REAL crypto: different requests have independent JWT replay identifiers and digests', async () => {
  const account = privateKeyToAccount('0x' + randomBytes(32).toString('hex'));
  const a = await createRequestJWT({requestedSize: '1'}, account), b = await createRequestJWT({requestedSize: '2'}, account);
  const decode = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.notEqual(decode(a).jti, decode(b).jti); assert.notEqual(decode(a).digest, decode(b).digest);
});
