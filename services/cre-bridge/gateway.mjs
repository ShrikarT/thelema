// services/cre-bridge/gateway.ts
import { createHash, randomUUID } from "node:crypto";
var GATEWAYS = Object.freeze({
  public: "https://01.gateway.zone-a.cre.chain.link/",
  private: "https://01.enterprise-gateway.zone-a.cre.chain.link/"
});
function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  throw new Error("Only finite JSON values may be signed.");
}
var encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function createRequestJWT(request, signer, { now = Date.now(), jwtId = randomUUID() } = {}) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer?.address) || /^0x0{40}$/i.test(signer.address) || typeof signer.signMessage !== "function") {
    throw new Error("Invalid trigger signer.");
  }
  const iat = Math.floor(now / 1e3);
  if (!Number.isSafeInteger(iat) || iat < 0) throw new Error("Invalid signing time.");
  const payload = {
    digest: "0x" + createHash("sha256").update(canonicalJson(request), "utf8").digest("hex"),
    iss: signer.address,
    iat,
    exp: iat + 60,
    jti: jwtId
  };
  const message = encode({ alg: "ETH", typ: "JWT" }) + "." + encode(payload);
  const signature = await signer.signMessage({ message });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("Invalid signature encoding.");
  }
  const bytes = Buffer.from(signature.slice(2), "hex");
  const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
  if (recovery !== 0 && recovery !== 1) throw new Error("Invalid signature recovery ID.");
  bytes[64] = recovery;
  return message + "." + bytes.toString("base64url");
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error("Gateway deadline exceeded."));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      }
    );
  });
}
async function readJson(response, limit = 16384) {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Invalid gateway HTTP response.");
  }
  if (Number(response.headers.get("content-length") || 0) > limit) throw new Error("Gateway response too large.");
  let length = 0;
  const chunks = [];
  if (!response.body) throw new Error("Empty gateway response.");
  for await (const chunk of response.body) {
    const buf = Buffer.from(chunk);
    length += buf.byteLength;
    if (length > limit) throw new Error("Gateway response too large.");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function createGateway({
  workflowId,
  registry = "private",
  signer,
  fetchImpl = fetch,
  timeoutMs = 7e3
}) {
  if (!/^[0-9a-fA-F]{64}$/.test(workflowId) || /^0{64}$/.test(workflowId)) {
    throw new Error("Configure a nonzero 64-character CRE workflow ID without 0x.");
  }
  if (!Object.hasOwn(GATEWAYS, registry)) throw new Error("CRE registry must be public or private.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1e4) throw new Error("Invalid gateway timeout.");
  return async (input, { signal: callerSignal } = {}) => {
    const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const request = {
        id: randomUUID(),
        jsonrpc: "2.0",
        method: "workflows.execute",
        params: { input, workflow: { workflowID: workflowId } }
      };
      const token = await abortable(createRequestJWT(request, signer), signal);
      if (signal.aborted) throw new Error("Expired invocation.");
      const response = await abortable(
        fetchImpl(GATEWAYS[registry], {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: canonicalJson(request),
          redirect: "error",
          signal
        }),
        signal
      );
      const data = await abortable(readJson(response), signal);
      const result = data?.result;
      if (data?.error || data?.jsonrpc !== "2.0" || data?.id !== request.id || data?.method !== "workflows.execute" || result?.status !== "ACCEPTED" || typeof result?.workflow_id !== "string" || result.workflow_id.replace(/^0x/i, "").toLowerCase() !== workflowId.toLowerCase() || typeof result?.workflow_execution_id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(result.workflow_execution_id)) {
        throw new Error("Gateway did not acknowledge this workflow.");
      }
      return { executionId: result.workflow_execution_id };
    } catch {
      throw new Error("CRE gateway invocation failed or timed out.");
    }
  };
}
export {
  GATEWAYS,
  canonicalJson,
  createGateway,
  createRequestJWT
};
