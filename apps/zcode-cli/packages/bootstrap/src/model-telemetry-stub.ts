/**
 * 遥测已移除；保留空实现避免 bootstrap 调用方报错。
 */

import type { AgentExecutionTelemetryPort } from "@zcode/contracts";

export interface ModelTelemetry {
  agentExecution: AgentExecutionTelemetryPort;
  statusSink: { publish(): void };
  shutdown(): Promise<void>;
}

export interface CreateModelTelemetryOptions {
  owner?: unknown;
  sessionId: string;
}

export function createModelTelemetry(_options: CreateModelTelemetryOptions): ModelTelemetry {
  return {
    agentExecution: {
      captureCausation: () => undefined,
      startCompaction: () => ({
        captureCausation: () => undefined,
        run: <T>(execute: () => T): T => execute(),
        finishCompleted: () => {},
        finishFailed: () => {},
        finishCancelled: () => {},
        finishDiscarded: () => {},
        setInputTokens: () => {},
        setOutputTokens: () => {},
        markFallbackSelected: () => {},
      }),
      startDetachedOperation: () => ({
        captureCausation: () => undefined,
        run: <T>(execute: () => T): T => execute(),
        finishCompleted: () => {},
        finishFailed: () => {},
        finishCancelled: () => {},
        setResultType: () => {},
      }),
      startStep: () => ({
        captureCausation: () => undefined,
        run: <T>(execute: () => T): T => execute(),
        finishCompleted: () => {},
        finishFailed: () => {},
        finishCancelled: () => {},
        finishDiscarded: () => {},
      }),
      startTool: () => ({
        captureCausation: () => undefined,
        run: <T>(execute: () => T): T => execute(),
        finishCompleted: () => {},
        finishFailed: () => {},
        finishCancelled: () => {},
        markPermissionRequested: () => {},
        setPermissionDecision: () => {},
        setOutputBytes: () => {},
        setOutputTruncated: () => {},
        startCommand: () => ({
          captureCausation: () => undefined,
          run: <T>(execute: () => T): T => execute(),
          finishCompleted: () => {},
          finishFailed: () => {},
          finishCancelled: () => {},
          finishBackgrounded: () => {},
          markFirstOutput: () => {},
          markTerminationRequested: () => {},
          setExitCode: () => {},
          setSignal: () => {},
          setTimedOut: () => {},
          setOutputBytes: () => {},
        }),
        finishDenied: () => {},
      }),
      startTurn: () => ({
        captureCausation: () => undefined,
        run: <T>(execute: () => T): T => execute(),
        finishCompleted: () => {},
        finishFailed: () => {},
        finishCancelled: () => {},
        startStep: () => ({
          captureCausation: () => undefined,
          run: <T>(execute: () => T): T => execute(),
          finishCompleted: () => {},
          finishFailed: () => {},
          finishCancelled: () => {},
          finishDiscarded: () => {},
        }),
        startTool: () => ({
          captureCausation: () => undefined,
          run: <T>(execute: () => T): T => execute(),
          finishCompleted: () => {},
          finishFailed: () => {},
          finishCancelled: () => {},
          markPermissionRequested: () => {},
          setPermissionDecision: () => {},
          setOutputBytes: () => {},
          setOutputTruncated: () => {},
          startCommand: () => ({
            captureCausation: () => undefined,
            run: <T>(execute: () => T): T => execute(),
            finishCompleted: () => {},
            finishFailed: () => {},
            finishCancelled: () => {},
            finishBackgrounded: () => {},
            markFirstOutput: () => {},
            markTerminationRequested: () => {},
            setExitCode: () => {},
            setSignal: () => {},
            setTimedOut: () => {},
            setOutputBytes: () => {},
          }),
          finishDenied: () => {},
        }),
      }),
      abandonSession: () => {},
    },
    statusSink: {
      publish: () => {},
    },
    shutdown: async () => {},
  };
}
