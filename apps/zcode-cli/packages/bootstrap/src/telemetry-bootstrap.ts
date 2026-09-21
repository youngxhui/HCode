/**
 * 遥测已移除；保留空实现避免 bootstrap 调用方报错。
 */

import { getCapturedZCodeAgentTelemetryEnv } from "@zcode/shared";

export interface PrepareZCodeTelemetryEnvOptions {
  cliVersion?: string;
  productVersion?: string;
  runtimeSurface?: string;
}

export async function prepareZCodeTelemetryEnv(
  env: NodeJS.ProcessEnv = process.env,
  _options?: PrepareZCodeTelemetryEnvOptions,
): Promise<NodeJS.ProcessEnv> {
  void env;
  void _options;
  return process.env;
}

/**
 * 遥测已移除；保留空实现避免 bootstrap 调用方报错。
 */
export async function shutdownZCodeTelemetry(): Promise<void> {
  // no-op
}
