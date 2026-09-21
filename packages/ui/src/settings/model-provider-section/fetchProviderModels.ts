import type { ProviderApiType } from "@zcode/provider";

export interface FetchProviderModelsInput {
  readonly baseUrl: string;
  readonly apiType: ProviderApiType;
  readonly apiKey: string;
}

export interface FetchProviderModelsResult {
  readonly modelIds: readonly string[];
  /** 上游返回了无法识别的结构时给出可读原因，不把原始响应体抛给 UI。 */
  readonly issue?: string;
}

/**
 * 从供应商端点拉取模型名单。
 *
 * OpenAI 兼容与 Anthropic 都提供 `GET {baseUrl}/models`：
 *   - OpenAI 兼容：`Authorization: Bearer <key>`，响应 `{ data: [{ id }] }`
 *   - Anthropic：  `x-api-key` + `anthropic-version`，响应 `{ data: [{ id }] }`
 *
 * baseUrl 存的是端点根（如 `https://api.z.ai/api/paas/v4`），不能用 `new URL(path, base)`
 * 拼绝对路径——那会丢掉路径前缀。必须先补上尾部斜杠做相对解析。
 */
export async function fetchProviderModelIds(
  input: FetchProviderModelsInput,
): Promise<FetchProviderModelsResult> {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) return { modelIds: [], issue: "missing-base-url" };
  let endpoint: URL;
  try {
    endpoint = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    return { modelIds: [], issue: "invalid-base-url" };
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (input.apiType === "anthropic-messages") {
    headers["x-api-key"] = input.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${input.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, { headers });
  } catch (error) {
    // 浏览器层失败多数是 CORS 或 DNS；不区分细节，统一按不可达处理。
    return { modelIds: [], issue: error instanceof Error ? `network: ${error.message}` : "network" };
  }
  if (!response.ok) return { modelIds: [], issue: `http-${response.status}` };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { modelIds: [], issue: "invalid-json" };
  }
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { modelIds: [], issue: "unexpected-shape" };

  const modelIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id !== "string") continue;
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    modelIds.push(normalized);
  }
  if (modelIds.length === 0) return { modelIds: [], issue: "empty" };
  return { modelIds };
}
