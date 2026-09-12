import test from 'node:test';import assert from 'node:assert/strict';import {clipNotional,requestConfidentialClip,isCreConfigured} from './index.mjs';import {configuration} from '../arc/client.mjs';
const env={CRE_CLIP_URL:'https://clip.example.org/clip',CRE_CLIP_ALLOWED_HOST:'clip.example.org',CRE_CLIP_TOKEN:'a'.repeat(64)};
const response=r=>async()=>({ok:true,json:async()=>r});
test('LOCAL simulation: request 1000 clips to 50',()=>assert.deepEqual(clipNotional({requestedSize:'1000',maxNotional:'50'}),{allowed:true,clippedSize:'50'}));
test('LOCAL simulation: small request passes and zero cap disallows',()=>{assert.equal(clipNotional({requestedSize:'12.123456',maxNotional:'50'}).clippedSize,'12.123456');assert.deepEqual(clipNotional({requestedSize:'1',maxNotional:'0'}),{allowed:false,clippedSize:'0'});});
for(const value of ['-1','1e3','0','NaN','1.1234567'])test('LOCAL clipping rejects malformed or zero input '+value,()=>assert.throws(()=>clipNotional({requestedSize:value,maxNotional:'50'})));
test('Live adapter fails closed without configuration',async()=>assert.rejects(requestConfidentialClip('1000',{env:{},fetchImpl:response({allowed:true,clippedSize:'50'})}),/not configured/));
test('Live adapter returns exactly two safe fields and sends no cap',async()=>{let sent;const r=await requestConfidentialClip('1000',{env,fetchImpl:async(url,opts)=>{sent={url,opts};return {ok:true,json:async()=>({allowed:true,clippedSize:'50',secret:'must not cross'})};}});assert.deepEqual(r,{allowed:true,clippedSize:'50'});assert.deepEqual(JSON.parse(sent.opts.body),{requestedSize:'1000'});assert.equal(sent.opts.redirect,'error');assert.equal(sent.opts.headers.Authorization,'Bearer '+'a'.repeat(64));});
for(const value of [{allowed:true,clippedSize:'1001'},{allowed:false,clippedSize:'50'},{allowed:true,clippedSize:'0'},{allowed:true,clippedSize:50},{allowed:true,clippedSize:'1.0000001'}])test('Live adapter rejects invalid clipped response '+JSON.stringify(value),async()=>assert.rejects(requestConfidentialClip('1000',{env,fetchImpl:response(value)})));
for(const url of ['http://clip.example.org/clip','https://evil.example.org/clip','https://user:pass@clip.example.org/clip','https://clip.example.org/clip?token=x'])test('Live adapter rejects unsafe endpoint '+url,async()=>assert.rejects(requestConfidentialClip('1',{env:{...env,CRE_CLIP_URL:url},fetchImpl:response({allowed:true,clippedSize:'1'})}),/approved HTTPS/));
test('Live adapter never replaces an endpoint failure with demo clipping',async()=>assert.rejects(requestConfidentialClip('1000',{env,fetchImpl:async()=>{throw Error('raw credentials');}}),e=>e.message.includes('failed')&&!e.message.includes('credentials')));

test('Live adapter requires authenticated bridge configuration',async()=>assert.rejects(requestConfidentialClip('1',{env:{...env,CRE_CLIP_TOKEN:''},fetchImpl:response({allowed:true,clippedSize:'1'})}),/not configured/));
test('Live adapter rejects short bearer tokens',async()=>assert.rejects(requestConfidentialClip('1',{env:{...env,CRE_CLIP_TOKEN:'short'},fetchImpl:response({allowed:true,clippedSize:'1'})}),/strong confidential bridge token/));

test('CRE configuration checks match the request client exactly', () => {
  assert.equal(isCreConfigured(env), true);
  assert.equal(configuration(env).creReady, true);

  const badEnvs = [
    {},
    { ...env, CRE_CLIP_URL: '' },
    { ...env, CRE_CLIP_URL: 'http://clip.example.org/clip' },
    { ...env, CRE_CLIP_URL: 'https://evil.example.org/clip' },
    { ...env, CRE_CLIP_URL: 'https://user:pass@clip.example.org/clip' },
    { ...env, CRE_CLIP_URL: 'https://clip.example.org/clip?token=x' },
    { ...env, CRE_CLIP_URL: 'https://clip.example.org:8443/clip' },
    { ...env, CRE_CLIP_ALLOWED_HOST: '' },
    { ...env, CRE_CLIP_ALLOWED_HOST: 'evil.example.org' },
    { ...env, CRE_CLIP_TOKEN: '' },
    { ...env, CRE_CLIP_TOKEN: 'short' },
    { ...env, CRE_CLIP_TOKEN: 'invalid!characters#' }
  ];

  for (const bad of badEnvs) {
    assert.equal(isCreConfigured(bad), false, `Expected false for ${JSON.stringify(bad)}`);
    assert.equal(configuration(bad).creReady, false, `Expected false for ${JSON.stringify(bad)}`);
  }
});

