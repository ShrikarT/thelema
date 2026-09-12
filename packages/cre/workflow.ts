// Requires the genuine CRE SDK, an authorized HTTP signer, and Confidential Workflows access.
// Gateway ACCEPTED is not this callback's result: deliver it to the authenticated bridge.
import {HTTPCapability, HTTPClient, handlerInTee, decodeJson, Runner, type TeeRuntime, type HTTPPayload} from '@chainlink/cre-sdk';
import {callbackEnvelope, privateClip, validateCallbackUrl} from './policy.mjs';

type Config = {publicKey: string; callbackUrl: string};
type Decision = {allowed: boolean; clippedSize: string};

// Only the zero-argument `main` may be exported: cre-compile turns module exports into WASM
// exports and Javy rejects any exported function that takes parameters.
function onPrivateSize(runtime: TeeRuntime<Config>, payload: HTTPPayload): Decision {
  let input: ReturnType<typeof callbackEnvelope>;
  try {input = callbackEnvelope(decodeJson(payload.input), runtime.now().getTime());}
  catch {throw new Error('Invalid or expired confidential invocation.');}
  const callbackUrl = validateCallbackUrl(runtime.config.callbackUrl);
  let decision: Decision = {allowed: false, clippedSize: '0'};
  try {
    // The cap is fetched only inside the enclave. Never log it or the incoming payload.
    const cap = runtime.getSecret({id: 'MAX_NOTIONAL'}).result().value;
    decision = privateClip(input.requestedSize, cap);
  } catch {
    decision = {allowed: false, clippedSize: '0'};
  }
  const response = new HTTPClient().sendRequest(runtime, {
    url: callbackUrl, method: 'POST', timeout: '8s',
    multiHeaders: {
      'Content-Type': {values: ['application/json']},
      Authorization: {values: ['Bearer ' + input.callbackToken]},
    },
    body: Buffer.from(JSON.stringify({requestId: input.requestId, ...decision})).toString('base64'),
    // The TEE-native HTTP overload deliberately has no DON cache settings.
  }).result();
  if (response.statusCode !== 204) throw new Error('Confidential result callback was not acknowledged.');
  return decision;
}

const initWorkflow = (config: Config) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.publicKey) || /^0x0{40}$/i.test(config.publicKey)) throw new Error('Configure the authorized trigger signer address.');
  validateCallbackUrl(config.callbackUrl);
  return [handlerInTee(new HTTPCapability().trigger({authorizedKeys: [{type: 'KEY_TYPE_ECDSA_EVM', publicKey: config.publicKey}]}), onPrivateSize, [{tee: 'nitro', regions: ['us-west-2']}])];
};
export async function main() {const runner = await Runner.newRunner<Config>(); await runner.run(initWorkflow);}
