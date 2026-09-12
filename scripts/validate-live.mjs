// Read-only validation. This script never signs or sends a blockchain transaction.
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ARC, configuration, makeRpc, readArc} from '../packages/arc/client.mjs';
import {encode, words} from '../packages/arc/abi.mjs';
import {getReferences} from '../packages/graph/index.mjs';
import {requestConfidentialClip} from '../packages/cre/index.mjs';

export async function validateLive({env = process.env, fetchImpl = fetch, publicOnly = false} = {}) {
  const report = {checkedAt: new Date().toISOString(), mode: publicOnly ? 'PUBLIC_READ_ONLY_PROBE' : 'CONFIGURED_READ_ONLY_VALIDATION', releaseApproved: false};
  const rpc = makeRpc({fetchImpl});
  try {
    const chain = await rpc('eth_chainId', []);
    if (BigInt(chain) !== BigInt(ARC.chainId)) throw Error('Unexpected chain.');
    const block = await rpc('eth_blockNumber', []);
    const [decimals] = words(await rpc('eth_call', [{to: ARC.collateral, data: encode('decimals()')}, block]));
    if (BigInt(chain) !== BigInt(ARC.chainId) || decimals !== 6n || BigInt(block) < 1n) throw Error('Invalid public chain probe.');
    report.arcPublic = {status: 'PASS', chainId: Number(BigInt(chain)), blockNumber: BigInt(block).toString(), collateral: ARC.collateral, collateralDecimals: Number(decimals), rpcHost: new URL(ARC.rpcUrl).hostname};
  } catch {report.arcPublic = {status: 'FAILED_OR_UNREACHABLE', note: 'Public RPC chain, block and collateral checks did not pass. No fallback data was used.'};}
  if (publicOnly) {
    report.deployment = {status: 'NOT_CHECKED', note: 'A public RPC probe does not prove THELEMA contracts are deployed or secure.'};
    return report;
  }
  const config = configuration(env);
  if (!config.arcReady) report.deployment = {status: 'NOT_CONFIGURED'};
  else {
    try {
      const state = await readArc(config, {rpc});
      report.deployment = {status: 'READ_CHECKS_PASSED', blockNumber: BigInt(state.blockNumber).toString(), marketStatus: state.status, contracts: config.contracts, note: 'Read validation only; compiler-bytecode identity, ownership, liquidity funding and transaction receipts still need review.'};
    } catch {report.deployment = {status: 'FAILED', note: 'Configured contract read checks did not pass.'};}
  }
  const references = await getReferences({env, fetchImpl});
  report.graph = {
    status: references.probability.status === 'live' && references.spot.status === 'live' ? 'READ_CHECKS_PASSED' : 'NOT_CONFIGURED_OR_FAILED',
    probability: {status: references.probability.status, value: references.probability.value, updatedAt: references.probability.updatedAt},
    spot: {status: references.spot.status, value: references.spot.value, asset: references.spot.asset, comparable: references.spot.comparable, updatedAt: references.spot.updatedAt},
    note: 'Confirm event identity, token identity, schema and pricing units separately. An ETH reference is not an sNVDA spot oracle.',
  };
  if (!config.creReady) report.cre = {status: 'NOT_CONFIGURED'};
  else {
    try {
      const result = await requestConfidentialClip('1', {env, fetchImpl});
      report.cre = {status: 'AUTHENTICATED_RESPONSE_VALID', probeSize: '1', result, note: 'Endpoint response validated, not independent TEE attestation. Retain the matching genuine CRE execution evidence separately.'};
    } catch {report.cre = {status: 'FAILED', note: 'Authenticated bridge response was not received or failed validation.'};}
  }
  report.nextGate = 'HUMAN_REVIEW_AND_GENUINE_DEPLOYMENT_CONFIDENTIAL_EXECUTION_EVIDENCE_REQUIRED';
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), publicOnly = args.includes('--public-only');
  const index = args.indexOf('--output'), output = index < 0 ? null : args[index + 1];
  const allowed = new Set(['--public-only', '--output']);
  if (args.some((arg, i) => !allowed.has(arg) && !(index >= 0 && i === index + 1)) || (index >= 0 && !output)) {
    console.error('Usage: node scripts/validate-live.mjs [--public-only] [--output report.json]'); process.exitCode = 2;
  } else {
    const report = await validateLive({publicOnly});
    const text = JSON.stringify(report, null, 2) + '\n';
    if (output) {await mkdir(path.dirname(output), {recursive: true}); await writeFile(output, text);}
    console.log(text);
    const ok = publicOnly ? report.arcPublic.status === 'PASS' : report.arcPublic.status === 'PASS' && report.deployment.status === 'READ_CHECKS_PASSED' && report.graph.status === 'READ_CHECKS_PASSED' && report.cre.status === 'AUTHENTICATED_RESPONSE_VALID';
    if (!ok) process.exitCode = 1;
  }
}
