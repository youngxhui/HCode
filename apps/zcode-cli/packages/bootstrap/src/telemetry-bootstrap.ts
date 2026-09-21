import { getCapturedZCodeAgentTelemetryEnv } from "@zcode/shared";

/**
 * 遥测已移除；保留空实现避免 bootstrap 调用方报错。
 */
export async function prepareZCodeTelemetryEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  void env;
  return process.env;
}

/**
 * 遥测已移除；保留空实现避免 bootstrap 调用方报错。
 */
export async function shutdownZCodeTelemetry(): Promise<void> {
  // no-op
}
