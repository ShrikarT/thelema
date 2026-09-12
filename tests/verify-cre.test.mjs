import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyCre } from '../scripts/verify-cre.mjs';

function createMockCreWorkspace({
  simContent = 'NOT RUN — THIS IS NOT A CRE SIMULATION LOG.',
  buildJson = {
    creCompile: {
      status: 'PASS',
      sha256: '0b1ce4c8d54df344fe8d24751ddfc841684f20922c498b54a95ff496e2e4703b',
      bytes: 2486392
    }
  },
  wasmBytes = null,
  sourceFiles = null
} = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'cre-test-'));
  mkdirSync(path.join(tmp, 'packages/cre/dist'), { recursive: true });
  mkdirSync(path.join(tmp, 'docs/evidence'), { recursive: true });

  const wfSource = (sourceFiles && sourceFiles['packages/cre/workflow.ts']) || '// workflow source';
  const projSource = (sourceFiles && sourceFiles['packages/cre/project.yaml']) || 'name: thelema-clipping';
  const polSource = (sourceFiles && sourceFiles['packages/cre/policy.ts']) || '// policy source';
  const pkgSource = (sourceFiles && sourceFiles['packages/cre/package.json']) || '{"name":"cre"}';

  writeFileSync(path.join(tmp, 'packages/cre/workflow.ts'), wfSource);
  writeFileSync(path.join(tmp, 'packages/cre/project.yaml'), projSource);
  writeFileSync(path.join(tmp, 'packages/cre/policy.ts'), polSource);
  writeFileSync(path.join(tmp, 'packages/cre/package.json'), pkgSource);
  writeFileSync(path.join(tmp, 'packages/cre/config.simulation.json'), '{"maxNotional":"50"}');

  if (simContent !== null) {
    writeFileSync(path.join(tmp, 'docs/cre-sim.txt'), simContent);
    writeFileSync(path.join(tmp, 'packages/cre/cre-sim.txt'), simContent);
  }

  if (buildJson !== null) {
    writeFileSync(path.join(tmp, 'docs/evidence/cre-build.json'), typeof buildJson === 'string' ? buildJson : JSON.stringify(buildJson));
  }

  if (wasmBytes !== null) {
    writeFileSync(path.join(tmp, 'packages/cre/dist/clipping.wasm'), wasmBytes);
  }

  return {
    root: tmp,
    cleanup: () => rmSync(tmp, { recursive: true, force: true })
  };
}

test('CRE: Rejects NOT RUN marker in cre-sim.txt as unverified simulation', async () => {
  const ws = createMockCreWorkspace({
    simContent: 'NOT RUN — THIS IS NOT A CRE SIMULATION LOG.\nCRE CLI unavailable.'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'NOT_RUN');
    assert.equal(res.status, 'AUDITED');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects empty string in simulation transcript as FAILED', async () => {
  const ws = createMockCreWorkspace({ simContent: '' });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
    assert.match(res.categories.simulation.details, /empty or whitespace/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects whitespace-only simulation transcript as FAILED', async () => {
  const ws = createMockCreWorkspace({ simContent: '   \n  \t  \r\n   ' });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
    assert.match(res.categories.simulation.details, /empty or whitespace/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects simulation transcript without official CRE CLI markers as FAILED', async () => {
  const ws = createMockCreWorkspace({
    simContent: 'Simulated output from a generic script: all tests passed successfully with 0 errors.'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
    assert.match(res.categories.simulation.details, /provenance/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Valid official simulation transcript with CRE markers passes as VERIFIED', async () => {
  const validTranscript = [
    '$ cre workflow simulate packages/cre -R packages/cre --target staging-settings --non-interactive',
    'Simulating workflow: thelema-clipping',
    'Trigger: HTTP payload received',
    'Handler clipping execution completed successfully',
    'Workflow simulation exit code 0'
  ].join('\n');

  const ws = createMockCreWorkspace({ simContent: validTranscript });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, true);
    assert.equal(res.categories.simulation.status, 'VERIFIED');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects missing cre-build.json evidence', async () => {
  const ws = createMockCreWorkspace({ buildJson: null });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects malformed cre-build.json evidence', async () => {
  const ws = createMockCreWorkspace({ buildJson: '{ malformed json: true' });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects on-disk WASM with invalid magic bytes', async () => {
  const ws = createMockCreWorkspace({
    wasmBytes: Buffer.from('NOT_A_WASM_FILE')
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'FAILED');
    assert.match(res.categories.compilation.details, /magic bytes/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects on-disk WASM with valid magic bytes but invalid WebAssembly bytecode format', async () => {
  // Magic bytes \0asm followed by corrupt bytes that fail WebAssembly.validate
  const corruptWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x99, 0x99, 0x99, 0x99]);
  const ws = createMockCreWorkspace({
    wasmBytes: corruptWasm
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'FAILED');
    assert.match(res.categories.compilation.details, /invalid WebAssembly bytecode format/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects on-disk WASM with SHA-256 mismatch against evidence', async () => {
  // Minimal valid WASM: magic \0asm + version 1
  const validMinimalWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const ws = createMockCreWorkspace({
    wasmBytes: validMinimalWasm
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'FAILED');
    assert.match(res.categories.compilation.details, /mismatch/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Valid on-disk WASM matching recorded SHA256 passes compilation as VERIFIED', async () => {
  const validMinimalWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const wasmHash = createHash('sha256').update(validMinimalWasm).digest('hex');
  const ws = createMockCreWorkspace({
    wasmBytes: validMinimalWasm,
    buildJson: {
      creCompile: {
        status: 'PASS',
        sha256: wasmHash,
        bytes: validMinimalWasm.length
      }
    }
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, true);
    assert.equal(res.categories.compilation.status, 'VERIFIED');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects source provenance mismatch against recorded sourceDigests', async () => {
  const ws = createMockCreWorkspace({
    sourceFiles: {
      'packages/cre/workflow.ts': '// modified workflow source that does not match recorded digest'
    },
    buildJson: {
      creCompile: {
        status: 'PASS',
        sha256: '0b1ce4c8d54df344fe8d24751ddfc841684f20922c498b54a95ff496e2e4703b',
        bytes: 2486392
      },
      sourceDigests: {
        'packages/cre/workflow.ts': '0000000000000000000000000000000000000000000000000000000000000000'
      }
    }
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'FAILED');
    assert.match(res.categories.compilation.details, /Source provenance mismatch/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Missing on-disk WASM reports RECORDED/NOT REBUILT by default without failing', async () => {
  const ws = createMockCreWorkspace({ wasmBytes: null });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'RECORDED/NOT REBUILT');
    assert.equal(res.status, 'AUDITED');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Missing on-disk WASM fails when requireLocalArtifact is requested', async () => {
  const ws = createMockCreWorkspace({ wasmBytes: null });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root, requireLocalArtifact: true });
    assert.equal(res.categories.compilation.pass, false);
    assert.equal(res.categories.compilation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
    assert.match(res.categories.compilation.details, /Local WASM artifact.*is required/);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Credentials present without explicit live opt-in do NOT send HTTP request', async () => {
  const env = {
    CRE_CLIP_URL: 'https://clip.example.org/clip',
    CRE_CLIP_ALLOWED_HOST: 'clip.example.org',
    CRE_CLIP_TOKEN: 'a'.repeat(64)
  };
  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({ allowed: true, clippedSize: '50' }) };
  };

  const ws = createMockCreWorkspace();
  try {
    const res = await verifyCre(env, mockFetch, { projectRoot: ws.root, liveOptIn: false });
    assert.equal(fetchCalled, false, 'Fetch must not be called without live opt-in');
    assert.equal(res.categories.liveExecution.status, 'STANDBY');
    assert.equal(res.categories.liveExecution.pass, false);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Explicit live opt-in triggers bridge execution and records response with honest trust note', async () => {
  const env = {
    CRE_CLIP_URL: 'https://clip.example.org/clip',
    CRE_CLIP_ALLOWED_HOST: 'clip.example.org',
    CRE_CLIP_TOKEN: 'a'.repeat(64),
    CRE_LIVE_EXECUTE: 'true'
  };
  let fetchCalled = false;
  const mockFetch = async (url, opts) => {
    fetchCalled = true;
    assert.equal(url, 'https://clip.example.org/clip');
    return {
      ok: true,
      json: async () => ({ allowed: true, clippedSize: '50' })
    };
  };

  const ws = createMockCreWorkspace();
  try {
    const res = await verifyCre(env, mockFetch, { projectRoot: ws.root });
    assert.equal(fetchCalled, true, 'Fetch must be called with live opt-in');
    assert.equal(res.categories.liveExecution.status, 'VERIFIED');
    assert.equal(res.categories.liveExecution.pass, true);
    assert.match(res.categories.liveExecution.details, /trust assumption|operator-owned bridge/i);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects simulation transcript containing Exit code: 2 as FAILED', async () => {
  const ws = createMockCreWorkspace({
    simContent: '$ cre workflow simulate packages/cre\nWorkflow simulation\nclipping handler\nExit code: 2'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects simulation transcript containing exit status 2 as FAILED', async () => {
  const ws = createMockCreWorkspace({
    simContent: '$ cre workflow simulate packages/cre\nWorkflow simulation\nclipping handler\nexit status 2'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects simulation transcript containing Unsuccessful as FAILED even with success substring', async () => {
  const ws = createMockCreWorkspace({
    simContent: '$ cre workflow simulate packages/cre\nSimulating workflow: thelema-clipping\nExecution completed: Unsuccessful'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects simulation transcript containing panic as FAILED', async () => {
  const ws = createMockCreWorkspace({
    simContent: '$ cre workflow simulate packages/cre\nWorkflow simulation\npanic: runtime error occurred'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects synthetic fixture "cre workflow simulate packages/cre\\nworkflow execution completed\\nexit=1\\n" as FAILED', async () => {
  const ws = createMockCreWorkspace({
    simContent: 'cre workflow simulate packages/cre\nworkflow execution completed\nexit=1\n'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
    assert.match(res.categories.simulation.details, /non-zero process exit code/i);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Rejects synthetic fixture "cre workflow simulate packages/cre\\nhandler execution started; awaiting result\\n" as FAILED', async () => {
  const ws = createMockCreWorkspace({
    simContent: 'cre workflow simulate packages/cre\nhandler execution started; awaiting result\n'
  });
  try {
    const res = await verifyCre({}, fetch, { projectRoot: ws.root });
    assert.equal(res.categories.simulation.pass, false);
    assert.equal(res.categories.simulation.status, 'FAILED');
    assert.equal(res.status, 'ERROR');
    assert.match(res.categories.simulation.details, /incomplete execution|awaiting result/i);
  } finally {
    ws.cleanup();
  }
});

test('CRE: Simulation readiness check passes on workspace without requiring live execution or attestation', async () => {
  const res = await verifyCre({}, fetch, { checkSimulationReadiness: true });
  assert.equal(res.status, 'SIMULATION_READY');
  assert.equal(res.exitCode, 0);
  assert.equal(res.categories.policy.pass, true);
  assert.equal(res.categories.bridgeCrypto.pass, true);
  assert.equal(res.categories.liveExecution.pass, false);
  assert.equal(res.categories.attestation.pass, false);
});

test('CRE: Current project workspace passes policy, reports compilation VERIFIED or RECORDED/NOT REBUILT, simulation NOT_RUN', async () => {
  const res = await verifyCre({}, fetch);
  assert.equal(res.categories.policy.pass, true);
  assert.ok(res.categories.compilation.status === 'VERIFIED' || res.categories.compilation.status === 'RECORDED/NOT REBUILT');
  assert.equal(res.categories.simulation.status, 'NOT_RUN');
  assert.equal(res.categories.liveExecution.status, 'UNCONFIGURED');
  assert.equal(res.categories.bridgeCrypto.status, 'VERIFIED');
  assert.equal(res.categories.attestation.status, 'UNATTESTED');
  assert.equal(res.status, 'AUDITED');
});
