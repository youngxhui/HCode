/**
 * 遥测已移除；保留空实现避免 bootstrap 调用方报错。
 */

export interface ModelTelemetry {
  agentExecution: unknown;
  statusSink: unknown;
  shutdown(): Promise<void>;
}

export interface CreateModelTelemetryOptions {
  owner?: unknown;
  sessionId: string;
}

export function createModelTelemetry(_options: CreateModelTelemetryOptions): ModelTelemetry {
  return {
    agentExecution: {},
    statusSink: undefined,
    shutdown: async () => {},
  };
}
