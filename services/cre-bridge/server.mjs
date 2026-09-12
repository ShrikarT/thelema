// services/cre-bridge/server.ts
import http from "node:http";
import { createHash, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createGateway } from "./gateway.mjs";
import { sizeUnits, sizeDecimal, safeClipResult, validateCallbackUrl } from "../../packages/cre/policy.mjs";
var failure = (status, code) => Object.assign(new Error(code), { status, publicCode: code });
var secretMatches = (actual, expected) => typeof actual === "string" && actual.length < 256 && timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
function reply(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
  });
  res.end(status === 204 ? void 0 : JSON.stringify(body));
}
async function bodyJson(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(req.headers["content-type"] || "") || req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") {
    throw failure(415, "JSON_REQUIRED");
  }
  if (Number(req.headers["content-length"] || 0) > 2048) throw failure(413, "BODY_TOO_LARGE");
  req.setTimeout(5e3, () => req.destroy());
  let length = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 2048) throw failure(413, "BODY_TOO_LARGE");
      chunks.push(chunk);
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw failure(400, "INVALID_JSON_OBJECT");
    return value;
  } catch (error) {
    const err = error;
    throw err?.publicCode ? error : failure(400, "INVALID_JSON_OBJECT");
  } finally {
    req.setTimeout(0);
  }
}
function createBridge({
  authToken,
  allowedHost,
  trigger,
  callbackWaitMs = 45e3,
  maxPending = 32,
  ratePerMinute = 30,
  now = Date.now
}) {
  if (typeof authToken !== "string" || !/^[a-zA-Z0-9_-]{43,128}$/.test(authToken)) {
    throw new Error("Configure a strong bridge bearer token (at least 32 random bytes).");
  }
  if (typeof allowedHost !== "string" || !/^[a-zA-Z0-9.-]{1,253}$/.test(allowedHost) || typeof trigger !== "function") {
    throw new Error("Configure the bridge hostname and trigger.");
  }
  if (!Number.isInteger(callbackWaitMs) || callbackWaitMs < 1 || callbackWaitMs > 6e4 || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 100 || !Number.isInteger(ratePerMinute) || ratePerMinute < 1 || ratePerMinute > 120) {
    throw new Error("Invalid bridge resource limits.");
  }
  const pending = /* @__PURE__ */ new Map();
  let windowStarted = now(), requestsInWindow = 0, closing = false;
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.headersTimeout = 5e3;
  server.requestTimeout = 1e4;
  server.keepAliveTimeout = 2e3;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 128;
  async function handle(req, res) {
    try {
      if (String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase() !== allowedHost.toLowerCase()) {
        throw failure(421, "HOST_REJECTED");
      }
      if (req.headers.origin || req.headers["sec-fetch-site"]) throw failure(403, "BROWSER_REQUEST_REJECTED");
      if (closing) throw failure(503, "BRIDGE_DRAINING");
      if (req.method === "GET" && req.url === "/healthz") return reply(res, 200, { ok: true });
      if (req.method !== "POST" || !["/v1/clip", "/v1/callback"].includes(req.url || "")) throw failure(404, "NOT_FOUND");
      if (req.url === "/v1/callback") {
        const body2 = await bodyJson(req);
        if (Object.keys(body2).sort().join(",") !== "allowed,clippedSize,requestId" || typeof body2.requestId !== "string") {
          throw failure(400, "INVALID_CALLBACK");
        }
        const entry2 = pending.get(body2.requestId);
        if (!entry2 || now() >= entry2.expiresAt) throw failure(404, "UNKNOWN_OR_EXPIRED_CALLBACK");
        if (!secretMatches(req.headers.authorization, "Bearer " + entry2.callbackToken)) {
          throw failure(401, "CALLBACK_AUTH_REQUIRED");
        }
        if (entry2.delivered) throw failure(409, "CALLBACK_ALREADY_USED");
        let result;
        try {
          result = safeClipResult(body2, entry2.requestedSize);
        } catch {
          throw failure(400, "INVALID_CALLBACK_RESULT");
        }
        entry2.delivered = true;
        entry2.resolve(result);
        return reply(res, 204);
      }
      if (!secretMatches(req.headers.authorization, "Bearer " + authToken)) throw failure(401, "AUTH_REQUIRED");
      if (now() - windowStarted >= 6e4) {
        windowStarted = now();
        requestsInWindow = 0;
      }
      if (++requestsInWindow > ratePerMinute) throw failure(429, "RATE_LIMITED");
      if (pending.size >= maxPending) throw failure(503, "BRIDGE_BUSY");
      const body = await bodyJson(req);
      if (Object.keys(body).join(",") !== "requestedSize") throw failure(400, "INVALID_CLIP_REQUEST");
      let requestedSize;
      try {
        requestedSize = sizeDecimal(sizeUnits(body.requestedSize));
      } catch {
        throw failure(400, "INVALID_SIZE");
      }
      if (closing || pending.size >= maxPending) throw failure(503, "BRIDGE_BUSY");
      const requestId = randomUUID(), callbackToken = randomBytes(32).toString("base64url");
      const expiresAt = now() + callbackWaitMs, controller = new AbortController();
      let resolve, reject;
      const resultPromise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const entry = {
        requestedSize,
        callbackToken,
        expiresAt,
        resolve,
        reject,
        controller,
        delivered: false
      };
      pending.set(requestId, entry);
      const timer = setTimeout(() => {
        controller.abort();
        reject(failure(504, "CONFIDENTIAL_RESULT_TIMEOUT"));
      }, callbackWaitMs);
      timer.unref();
      const onClose = () => {
        if (!res.writableEnded) {
          controller.abort();
          reject(failure(499, "CALLER_DISCONNECTED"));
        }
      };
      res.once("close", onClose);
      try {
        const triggerPromise = Promise.resolve().then(
          () => trigger(
            {
              requestedSize,
              requestId,
              callbackToken,
              expiresAt: Math.ceil(expiresAt / 1e3)
            },
            { signal: controller.signal }
          )
        );
        const [, result] = await Promise.all([triggerPromise, resultPromise]);
        reply(res, 200, result);
      } catch (error) {
        const err = error;
        if (err?.publicCode) throw error;
        throw failure(502, "CONFIDENTIAL_GATEWAY_FAILED");
      } finally {
        clearTimeout(timer);
        pending.delete(requestId);
        res.removeListener("close", onClose);
        controller.abort();
      }
    } catch (error) {
      const err = error;
      reply(res, err?.status || 500, { error: err?.publicCode || "BRIDGE_INTERNAL_ERROR" });
    }
  }
  server.pendingCount = () => pending.size;
  server.drain = () => {
    closing = true;
    for (const entry of pending.values()) {
      entry.controller.abort();
      entry.reject(failure(503, "BRIDGE_DRAINING"));
    }
  };
  return server;
}
async function startBridge(env = process.env) {
  const callbackUrl = validateCallbackUrl(env.CRE_CALLBACK_URL || "");
  const allowedHost = new URL(callbackUrl).hostname;
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.CRE_TRIGGER_PRIVATE_KEY || "") || /^0x0{64}$/i.test(env.CRE_TRIGGER_PRIVATE_KEY || "")) {
    throw new Error("Configure the dedicated CRE trigger key in server secret storage.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.CRE_TRIGGER_SIGNER || "")) {
    throw new Error("Configure the authorized public signer address.");
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  const signer = privateKeyToAccount(env.CRE_TRIGGER_PRIVATE_KEY);
  if (signer.address.toLowerCase() !== (env.CRE_TRIGGER_SIGNER || "").toLowerCase()) {
    throw new Error("Trigger key does not match the authorized signer.");
  }
  const trigger = createGateway({
    workflowId: env.CRE_WORKFLOW_ID || "",
    registry: env.CRE_GATEWAY_REGISTRY || "private",
    signer
  });
  const server = createBridge({ authToken: env.BRIDGE_AUTH_TOKEN || "", allowedHost, trigger });
  const port = Number(env.BRIDGE_PORT || env.PORT || 8787), host = env.BRIDGE_BIND || env.HOST || "127.0.0.1";
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !["127.0.0.1", "0.0.0.0"].includes(host)) {
    throw new Error("Invalid bridge bind configuration.");
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(void 0));
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBridge().then((server) => {
    console.log("CRE bridge listening; payload, token and private-key logging is disabled.");
    const stop = () => {
      server.drain();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 8e3).unref();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }).catch(() => {
    console.error("CRE bridge could not start. Check secure configuration, dependencies and bind availability.");
    process.exitCode = 1;
  });
}
export {
  createBridge,
  startBridge
};
