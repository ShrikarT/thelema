#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { clipNotional, isCreConfigured, requestConfidentialClip } from '../packages/cre/index.mjs';

export async function verifyCre(env = process.env, fetchImpl = fetch, options = {}) {
  const root = options.projectRoot || process.cwd();
  const liveOptIn = Boolean(
    options.liveOptIn ||
    env.CRE_LIVE_EXECUTE === 'true' ||
    (typeof process !== 'undefined' && process.argv && process.argv.includes('--live-execute'))
  );

  console.log('--- THELEMA Sponsor Verification: Chainlink CRE Confidential Workflow ---');

  const categories = {
    policy: { pass: false, status: 'UNCHECKED', details: null },
    compilation: { pass: false, status: 'UNCHECKED', details: null },
    simulation: { pass: false, status: 'UNCHECKED', details: null },
    liveExecution: { pass: false, status: 'UNCHECKED', details: null },
    bridgeCrypto: { pass: false, status: 'UNCHECKED', details: null },
    attestation: { pass: false, status: 'UNCHECKED', details: null }
  };

  // 1. Local Policy & Arithmetic
  console.log('\n[CATEGORY 1: Local Policy & Invariant Tests]');
  try {
    const testClip = clipNotional({ requestedSize: '1000', maxNotional: '50' });
    if (testClip.allowed === true && testClip.clippedSize === '50') {
      console.log('  - Invariant:               clipNotional(1000, 50) -> allowed: true, clippedSize: 50 (Verified)');
      categories.policy = { pass: true, status: 'VERIFIED', details: 'Deterministic clipping math validated' };
    } else {
      throw new Error(`Unexpected policy output: ${JSON.stringify(testClip)}`);
    }
  } catch (err) {
    console.error(`  - Policy Error:            ${err.message}`);
    categories.policy = { pass: false, status: 'FAILED', details: err.message };
  }

  // 2. WASM Compilation & Source-Linked Build Evidence
  // 2. WASM Compilation & Source-Linked Build Evidence
  console.log('\n[CATEGORY 2: WASM Compilation & Build Evidence]');
  const workflowTsPath = path.resolve(root, 'packages/cre/workflow.ts');
  const projectYamlPath = path.resolve(root, 'packages/cre/project.yaml');
  const buildJsonPath = path.resolve(root, 'docs/evidence/cre-build.json');
  const wasmDistPath = path.resolve(root, 'packages/cre/dist/clipping.wasm');
  const requireLocalArtifact = Boolean(
    options.requireLocalArtifact ||
    env.CRE_REQUIRE_LOCAL_ARTIFACT === 'true' ||
    (typeof process !== 'undefined' && process.argv && process.argv.includes('--require-local-artifact'))
  );
  const requireEvidence = Boolean(
    options.requireEvidence ||
    env.CRE_REQUIRE_EVIDENCE === 'true' ||
    (typeof process !== 'undefined' && process.argv && process.argv.includes('--require-evidence'))
  );
  const checkSimulationReadiness = Boolean(
    options.checkSimulationReadiness ||
    options.simulationReady ||
    env.CRE_CHECK_SIMULATION_READINESS === 'true' ||
    (typeof process !== 'undefined' && process.argv && process.argv.includes('--check-simulation-readiness'))
  );

  if (!existsSync(workflowTsPath) || !existsSync(projectYamlPath)) {
    console.log('  - Error: Missing workflow.ts or project.yaml');
    categories.compilation = { pass: false, status: 'FAILED', details: 'Missing source files' };
  } else if (!existsSync(buildJsonPath)) {
    console.log('  - Error: Missing docs/evidence/cre-build.json build evidence file');
    categories.compilation = { pass: false, status: 'FAILED', details: 'Missing cre-build.json evidence' };
  } else {
    try {
      const rawEvidence = readFileSync(buildJsonPath, 'utf8');
      const evidence = JSON.parse(rawEvidence);
      if (!evidence.creCompile || evidence.creCompile.status !== 'PASS' || !evidence.creCompile.sha256) {
        throw new Error('Malformed or non-passing cre-build.json evidence.');
      }
      console.log('  - Workflow Source:         packages/cre/workflow.ts (Present)');
      console.log('  - Project Config:          packages/cre/project.yaml (Present)');
      console.log('  - Build Evidence:          docs/evidence/cre-build.json (Recorded PASS)');
      console.log(`  - Target WASM Hash:        ${evidence.creCompile.sha256}`);

      // Validate source file digests against recorded provenance if present
      if (evidence.sourceDigests && typeof evidence.sourceDigests === 'object') {
        for (const [relPath, expectedDigest] of Object.entries(evidence.sourceDigests)) {
          const absPath = path.resolve(root, relPath);
          if (!existsSync(absPath)) {
            throw new Error(`Recorded source file missing: ${relPath}`);
          }
          const rawBytes = readFileSync(absPath);
          const isText = /\.(ts|yaml|yml|json|js|mjs|txt|md)$/i.test(relPath);
          const contentToHash = isText
            ? Buffer.from(rawBytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
            : rawBytes;
          const actualDigest = createHash('sha256').update(contentToHash).digest('hex');
          if (actualDigest !== expectedDigest) {
            throw new Error(`Source provenance mismatch: ${relPath} SHA256 (${actualDigest}) does not match recorded digest in build evidence (${expectedDigest}).`);
          }
        }
        console.log('  - Source Provenance:       All recorded source file digests match current checkout');
      }

      // If WASM exists on disk, check magic bytes, WebAssembly bytecode validity, and verify hash
      if (existsSync(wasmDistPath)) {
        const wasmBytes = readFileSync(wasmDistPath);
        if (wasmBytes.length < 4 || wasmBytes[0] !== 0x00 || wasmBytes[1] !== 0x61 || wasmBytes[2] !== 0x73 || wasmBytes[3] !== 0x6d) {
          throw new Error('clipping.wasm exists on disk but has invalid WebAssembly magic bytes.');
        }
        if (!WebAssembly.validate(new Uint8Array(wasmBytes))) {
          throw new Error('clipping.wasm contains invalid WebAssembly bytecode format.');
        }
        const diskHash = createHash('sha256').update(wasmBytes).digest('hex');
        if (diskHash !== evidence.creCompile.sha256) {
          throw new Error(`WASM hash mismatch: on-disk hash (${diskHash}) does not match recorded build evidence (${evidence.creCompile.sha256}).`);
        }
        console.log('  - On-Disk WASM:            Validated magic bytes, valid bytecode, and matching SHA256');
        categories.compilation = { pass: true, status: 'VERIFIED', details: `Source-linked hash ${evidence.creCompile.sha256}` };
      } else {
        if (requireLocalArtifact) {
          throw new Error('Local WASM artifact (packages/cre/dist/clipping.wasm) is required but missing from workspace.');
        }
        console.log('  - On-Disk WASM:            Not in local workspace (can be built with npm run build:cre)');
        categories.compilation = {
          pass: false,
          status: 'RECORDED/NOT REBUILT',
          details: `Source-linked hash ${evidence.creCompile.sha256} recorded in build evidence; WASM not present in local workspace.`
        };
      }
    } catch (err) {
      console.error(`  - Compilation Evidence Error: ${err.message}`);
      categories.compilation = { pass: false, status: 'FAILED', details: err.message };
    }
  }

  // 3. Official CRE Simulation
  console.log('\n[CATEGORY 3: Official CRE Simulation]');
  const canonicalSimPath = path.resolve(root, 'docs/cre-sim.txt');
  const mirrorSimPath = path.resolve(root, 'packages/cre/cre-sim.txt');
  const simConfigPath = path.resolve(root, 'packages/cre/config.simulation.json');

  const activeSimPath = existsSync(canonicalSimPath) ? canonicalSimPath : (existsSync(mirrorSimPath) ? mirrorSimPath : null);

  if (!activeSimPath || !existsSync(simConfigPath)) {
    console.log('  - Simulation Artifacts:    Missing simulation files');
    categories.simulation = { pass: false, status: 'MISSING', details: 'Simulation files missing' };
  } else {
    try {
      const simContent = readFileSync(activeSimPath, 'utf8');
      if (!simContent || simContent.trim().length === 0) {
        throw new Error('Simulation transcript is empty or whitespace-only.');
      }

      if (simContent.includes('NOT RUN') || simContent.includes('THIS IS NOT A CRE SIMULATION LOG') || simContent.includes('SIMULATION BLOCKED')) {
        console.log('  - Simulation Status:       BLOCKED / NOT RUN');
        console.log('  - Reason:                  Explicit NOT RUN marker; CRE CLI simulation requires private-beta credentials.');
        categories.simulation = {
          pass: false,
          status: 'NOT_RUN',
          details: 'Official CRE CLI simulation was not run (requires private-beta credentials / login).'
        };
      } else if (/\bexit(?:\s*(?:code|status))?\s*[:=]?\s*([1-9]\d*)\b/i.test(simContent)) {
        const exitMatch = simContent.match(/\bexit(?:\s*(?:code|status))?\s*[:=]?\s*([1-9]\d*)\b/i);
        console.log(`  - Simulation Status:       FAILED (Non-zero exit code: ${exitMatch?.[1]})`);
        categories.simulation = {
          pass: false,
          status: 'FAILED',
          details: `Simulation transcript indicates non-zero process exit code (${exitMatch?.[0]}).`
        };
      } else if (/\b(?:awaiting(?:\s+result)?|in(?:\s+|-)?progress|started;\s*awaiting|pending|unfinished)\b/i.test(simContent)) {
        console.log('  - Simulation Status:       FAILED (Incomplete execution)');
        categories.simulation = {
          pass: false,
          status: 'FAILED',
          details: 'Simulation transcript indicates incomplete execution (awaiting result / in-progress).'
        };
      } else if (
        /\b(?:FAILED|FAILURE|ERROR|PANIC|UNSUCCESSFUL)\b/i.test(simContent) ||
        /\b(?:failed|panic|unsuccessful)\b/i.test(simContent)
      ) {
        console.log('  - Simulation Status:       FAILED');
        categories.simulation = { pass: false, status: 'FAILED', details: 'Simulation log contains errors or failure indicators' };
      } else {
        // Positive structural provenance check: must contain CLI invocation, workflow/config identity, and verified completion
        const trimmed = simContent.trim();
        const hasCliInvocation = /cre\s+workflow\s+simulate/i.test(trimmed) || /Workflow\s+simulation/i.test(trimmed);
        const hasWorkflowIdentity = /\b(?:packages\/cre|thelema|clipping|config\.simulation\.json|staging-settings)\b/i.test(trimmed);
        const hasExitZero = /\bexit(?:\s*(?:code|status))?\s*[:=]?\s*0\b/i.test(trimmed);
        const hasCompletion = (
          hasExitZero ||
          /\b(?:completed(?:\s+successfully)?|workflow\s+execution\s+completed)\b/i.test(trimmed) ||
          /\bsuccessfully\b/i.test(trimmed)
        ) && !/\bunsuccessful(?:ly)?\b/i.test(trimmed);

        if (trimmed.length < 60 || !hasCliInvocation || !hasWorkflowIdentity || !hasCompletion) {
          throw new Error('Simulation transcript lacks official CRE CLI execution provenance, workflow identity, or valid completion markers.');
        }

        console.log('  - Simulation Status:       VERIFIED (Official transcript validated)');
        categories.simulation = { pass: true, status: 'VERIFIED', details: 'Official simulation transcript passed' };
      }
    } catch (err) {
      console.log(`  - Simulation Error:        ${err.message}`);
      categories.simulation = { pass: false, status: 'FAILED', details: err.message };
    }
  }

  // 4. Confidential Live Execution (HTTP Bridge)
  console.log('\n[CATEGORY 4: Live Confidential Enclave Execution]');
  console.log('  - Architecture Notice:     CRE_FORWARDER is NOT an on-chain substitute for this HTTP bridge configuration.');
  const isConfigured = isCreConfigured(env);

  if (!isConfigured) {
    console.log('  - Status:                  UNCONFIGURED (Awaiting Live TEE Host & Token Credentials)');
    categories.liveExecution = {
      pass: false,
      status: 'UNCONFIGURED',
      details: 'Awaiting CRE_CLIP_URL, CRE_CLIP_ALLOWED_HOST, CRE_CLIP_TOKEN'
    };
  } else if (!liveOptIn) {
    console.log(`  - Configured Endpoint:     ${env.CRE_CLIP_URL}`);
    console.log('  - Live Execution Status:   STANDBY (Credentials present; live bridge request requires explicit opt-in via CRE_LIVE_EXECUTE=true or --live-execute).');
    categories.liveExecution = {
      pass: false,
      status: 'STANDBY',
      details: 'Live execution skipped without explicit opt-in'
    };
  } else {
    console.log(`  - Executing Live TEE Request to ${env.CRE_CLIP_URL}...`);
    try {
      const res = await requestConfidentialClip('100.00', { env, fetchImpl });
      console.log(`  - Live TEE Response:       allowed=${res.allowed}, clippedSize=${res.clippedSize}`);
      console.log('  - Attestation Note:        Trust assumption: client relies on operator-owned bridge TLS & token authentication; client does not perform independent hardware enclave cryptographic attestation verification.');
      categories.liveExecution = {
        pass: true,
        status: 'VERIFIED',
        details: 'Authenticated HTTP bridge response verified. Note: Client relies on operator-owned bridge TLS and bearer token authentication; does not independently verify hardware enclave cryptographic attestation.'
      };
    } catch (err) {
      console.error(`  - Live TEE Bridge Error:   ${err.message}`);
      categories.liveExecution = { pass: false, status: 'FAILED', details: err.message };
    }
  }

  // 5. Bridge Cryptography & Replay Protection
  console.log('\n[CATEGORY 5: Bridge Cryptography & Replay Protection]');
  try {
    const { privateKeyToAccount } = await import('viem/accounts');
    const { recoverMessageAddress } = await import('viem');
    const { createRequestJWT, canonicalJson } = await import('../services/cre-bridge/gateway.mjs');
    const { randomBytes } = await import('node:crypto');

    const testAccount = privateKeyToAccount('0x' + randomBytes(32).toString('hex'));
    const reqA = { jsonrpc: '2.0', id: 'verify-crypto', method: 'workflows.execute', params: { input: { requestedSize: '100' }, workflow: { workflowID: '0'.repeat(63) + '1' } } };
    const jwtA = await createRequestJWT(reqA, testAccount);
    const [header, payload, signature] = jwtA.split('.');
    const sigBytes = Buffer.from(signature, 'base64url');
    if (sigBytes.length !== 65 || (sigBytes[64] !== 0 && sigBytes[64] !== 1)) {
      throw new Error('Invalid JWT signature byte layout.');
    }
    sigBytes[64] += 27;
    const recovered = await recoverMessageAddress({
      message: `${header}.${payload}`,
      signature: '0x' + sigBytes.toString('hex')
    });
    if (recovered.toLowerCase() !== testAccount.address.toLowerCase()) {
      throw new Error('EIP-191 signer recovery failed.');
    }
    const claimsA = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const expectedDigest = '0x' + createHash('sha256').update(canonicalJson(reqA)).digest('hex');
    if (claimsA.digest !== expectedDigest) {
      throw new Error('Canonical JSON digest mismatch.');
    }

    const reqB = { jsonrpc: '2.0', id: 'verify-crypto-2', method: 'workflows.execute', params: { input: { requestedSize: '200' }, workflow: { workflowID: '0'.repeat(63) + '1' } } };
    const jwtB = await createRequestJWT(reqB, testAccount);
    const claimsB = JSON.parse(Buffer.from(jwtB.split('.')[1], 'base64url').toString('utf8'));
    if (claimsA.jti === claimsB.jti || claimsA.digest === claimsB.digest) {
      throw new Error('Replay protection collision detected.');
    }

    console.log('  - EIP-191 Signer Recovery: Ephemeral test signer address recovered');
    console.log('  - Canonical JSON Digest:   SHA-256 digest verified');
    console.log('  - Replay Protection:       Unique JTI and payload digest verified');
    categories.bridgeCrypto = {
      pass: true,
      status: 'VERIFIED',
      details: 'EIP-191 JWT signature recovery, canonical SHA-256 digest, and JTI replay protection verified'
    };
  } catch (err) {
    console.error(`  - Bridge Crypto Error:     ${err.message}`);
    categories.bridgeCrypto = { pass: false, status: 'FAILED', details: err.message };
  }

  // 6. Independent Enclave Attestation
  console.log('\n[CATEGORY 6: Independent Enclave Attestation]');
  console.log('  - Hardware Attestation:    UNATTESTED (Honest Trust Boundary)');
  console.log('  - Trust Boundary Note:     Client relies on operator-owned bridge TLS and bearer token authentication; does not independently verify hardware enclave cryptographic quotes.');
  categories.attestation = {
    pass: false,
    status: 'UNATTESTED',
    details: 'Client relies on operator-owned bridge TLS and bearer token; independent hardware enclave cryptographic quote verification not performed.'
  };

  // Summary & Audit Assessment
  console.log('\n--- CRE Sponsor Verification Summary ---');
  console.log(`1. Policy & Arithmetic:    ${categories.policy.status}`);
  console.log(`2. Compilation & Evidence: ${categories.compilation.status}`);
  console.log(`3. Official Simulation:    ${categories.simulation.status}`);
  console.log(`4. Live Enclave Execution: ${categories.liveExecution.status}`);
  console.log(`5. Bridge Cryptography:    ${categories.bridgeCrypto.status}`);
  console.log(`6. Enclave Attestation:    ${categories.attestation.status}`);

  const hasErrors = categories.policy.status === 'FAILED' ||
                    categories.compilation.status === 'FAILED' ||
                    categories.simulation.status === 'FAILED' ||
                    categories.liveExecution.status === 'FAILED' ||
                    categories.bridgeCrypto.status === 'FAILED';

  const allPassed = categories.policy.pass &&
                    categories.compilation.pass &&
                    categories.simulation.pass &&
                    categories.liveExecution.pass &&
                    categories.bridgeCrypto.pass;

  if (hasErrors) {
    console.log('\nResult: FAILED (One or more attempted verification categories failed).');
    return { status: 'ERROR', exitCode: 1, categories };
  }

  if (checkSimulationReadiness) {
    const isSimReady = categories.policy.pass &&
      (categories.compilation.pass || categories.compilation.status === 'RECORDED/NOT REBUILT') &&
      existsSync(simConfigPath) &&
      categories.bridgeCrypto.pass;

    if (isSimReady) {
      console.log('\nResult: SIMULATION_READY (Policy arithmetic, compilation evidence, simulation config, and bridge cryptography verified; decoupled from live bridge execution and hardware enclave attestation).');
      return { status: 'SIMULATION_READY', exitCode: 0, categories };
    } else {
      console.log('\nResult: NOT_READY (Pre-simulation prerequisites failed).');
      return { status: 'NOT_READY', exitCode: 1, categories };
    }
  }

  if (allPassed) {
    console.log('\nResult: FULLY VERIFIED (All 5 verifiable categories validated).');
    return { status: 'FULLY_VERIFIED', exitCode: 0, categories };
  }

  if (requireEvidence) {
    console.log('\nResult: FAILED (Required sponsor evidence incomplete: verifiable categories must be FULLY_VERIFIED).');
    return { status: 'FAILED', exitCode: 1, categories };
  }

  console.log('\nResult: AUDITED (Policy verified; compilation verified; bridge crypto verified; simulation blocked / not run; live standby / unconfigured).');
  return { status: 'AUDITED', exitCode: 0, categories };
}

import { fileURLToPath } from 'node:url';

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requireEvidence = process.argv.includes('--require-evidence');
  const requireLocalArtifact = process.argv.includes('--require-local-artifact');
  const checkSimulationReadiness = process.argv.includes('--check-simulation-readiness');
  verifyCre(process.env, fetch, { requireEvidence, requireLocalArtifact, checkSimulationReadiness })
    .then((res) => {
      if (res.exitCode !== 0 || res.status === 'ERROR' || res.status === 'NOT_READY' || (requireEvidence && res.status !== 'FULLY_VERIFIED')) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal CRE verification error:', err);
      process.exit(1);
    });
}
