/**
 * Type definitions for CRE bridge and gateway service
 */

export interface ViemSigner {
  address: string;
  signMessage: (args: { message: string }) => Promise<string>;
}

export interface CreateRequestJWTOptions {
  now?: number;
  jwtId?: string;
}

export interface WorkflowExecuteInput {
  requestedSize: string;
  requestId: string;
  callbackToken: string;
  expiresAt: number;
}

export interface CreateGatewayOptions {
  workflowId: string;
  registry?: 'public' | 'private';
  signer: ViemSigner;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface GatewayExecutionResult {
  executionId: string;
}

export interface CreateBridgeOptions {
  authToken: string;
  allowedHost: string;
  trigger: (input: WorkflowExecuteInput, options?: { signal?: AbortSignal }) => Promise<unknown>;
  callbackWaitMs?: number;
  maxPending?: number;
  ratePerMinute?: number;
  now?: () => number;
}
