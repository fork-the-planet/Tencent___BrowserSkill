import { ChromiumCdp } from "@/browser-driver/chromium-cdp";
import type { SessionManager } from "@/session-manager/manager";
import type { NetworkParams, NetworkResult, RpcError } from "@/transport/types";
import {
  type CdpRunner,
  type ChromeTabsApi,
  chromeTabsApi,
  isRpcError,
  lookupSession,
  resolveTargetTab,
} from "./shared";

const DEFAULT_NETWORK_LIMIT = 50;
const MAX_NETWORK_LIMIT = 200;
const DEFAULT_MAX_TEXT_CHARS = 1000;
const MAX_TEXT_CHARS = 4096;

export interface NetworkDeps {
  cdp: CdpRunner;
  tabsApi: ChromeTabsApi;
}

function defaultNetworkDeps(): NetworkDeps {
  return {
    cdp: new ChromiumCdp(),
    tabsApi: chromeTabsApi,
  };
}

export async function handleNetwork(
  manager: SessionManager,
  params: NetworkParams,
  deps: NetworkDeps = defaultNetworkDeps(),
): Promise<NetworkResult | RpcError> {
  const ctxOrErr = lookupSession(manager, params, "network");
  if (isRpcError(ctxOrErr)) return ctxOrErr;
  const bounds = parseNetworkBounds(params);
  if (isRpcError(bounds)) return bounds;
  const target = await resolveTargetTab(manager, ctxOrErr, params.tab_id, deps.tabsApi);
  if (isRpcError(target)) return target;
  if (!deps.cdp.ensureNetworkCapture || !deps.cdp.networkEntriesSince) {
    return { code: "cdp_failed", message: "network capture requires CDP network support" };
  }

  try {
    await deps.cdp.ensureNetworkCapture(target.tabId);
    deps.cdp.trackSessionTab?.(ctxOrErr.sessionId, target.tabId);
    return deps.cdp.networkEntriesSince(
      target.tabId,
      bounds.since,
      bounds.limit,
      bounds.maxTextChars,
    );
  } catch (err) {
    return {
      code: "cdp_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseNetworkBounds(params: NetworkParams):
  | {
      since: number | undefined;
      limit: number;
      maxTextChars: number;
    }
  | RpcError {
  const since = params.since;
  if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) {
    return { code: "invalid_params", message: "since must be a non-negative integer" };
  }
  const limit = boundedOptionalInteger(
    params.limit,
    DEFAULT_NETWORK_LIMIT,
    MAX_NETWORK_LIMIT,
    "limit",
  );
  if (isRpcError(limit)) return limit;
  const maxTextChars = boundedOptionalInteger(
    params.max_text_chars,
    DEFAULT_MAX_TEXT_CHARS,
    MAX_TEXT_CHARS,
    "max_text_chars",
  );
  if (isRpcError(maxTextChars)) return maxTextChars;
  return {
    since,
    limit,
    maxTextChars,
  };
}

function boundedOptionalInteger(
  value: number | undefined,
  defaultValue: number,
  maxValue: number,
  field: string,
): number | RpcError {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { code: "invalid_params", message: `${field} must be a positive integer` };
  }
  return Math.min(value, maxValue);
}
