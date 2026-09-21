/**
 * 遥测已移除；保留空实现避免 core 调用方报错。
 */

import type {
  AgentExecutionTelemetryPort,
  AgentTelemetryActorKind,
  AgentTelemetryCausation,
  AgentStepSpanWriter,
  AgentTelemetryInputSource,
  AgentTurnSpanWriter,
  CommandExecutionSpanWriter,
  CompactionTraceStart,
  ContextCompactionSpanWriter,
  DetachedOperationSpanWriter,
  DetachedOperationTraceStart,
  MessageId,
  ModelAttemptSpanWriter,
  ModelCallSpanWriter,
  SessionTaskType,
  ToolExecutionSpanWriter,
  TraceContext,
} from "@zcode/contracts";

interface RuntimeTelemetryFacadeOptions {
  agentName?: string;
  causation?: AgentTelemetryCausation;
  causationMode?: "child" | "linked_root";
  launchSurface?: string;
  parentSessionId?: string;
  port?: AgentExecutionTelemetryPort;
  sessionId: string;
  taskType?: SessionTaskType;
}

const NOOP_SCOPE = {
  captureCausation: () => undefined as AgentTelemetryCausation | undefined,
  run: <T>(execute: () => T): T => execute(),
};

const NOOP_COMMAND: CommandExecutionSpanWriter = {
  ...NOOP_SCOPE,
  finishCompleted() {},
  finishFailed() {},
  finishCancelled() {},
  finishBackgrounded() {},
  markFirstOutput() {},
  markTerminationRequested() {},
  setExitCode() {},
  setSignal() {},
  setTimedOut() {},
  setOutputBytes() {},
};

const NOOP_TOOL: ToolExecutionSpanWriter = {
  ...NOOP_SCOPE,
  markPermissionRequested() {},
  setPermissionDecision() {},
  setOutputBytes() {},
  setOutputTruncated() {},
  startCommand: () => NOOP_COMMAND,
  finishCompleted() {},
  finishDenied() {},
  finishFailed() {},
  finishCancelled() {},
};

const NOOP_ATTEMPT: ModelAttemptSpanWriter = {
  ...NOOP_SCOPE,
  finishAbandoned() {},
  finishCompleted() {},
  finishFailed() {},
  finishCancelled() {},
  markFirstContent() {},
  markFirstProviderEvent() {},
  markFirstText() {},
  markStreamStalled() {},
  setCacheReadTokens() {},
  setCacheWriteTokens() {},
  setEffectiveReasoningBudgetTokens() {},
  setEffectiveReasoningControl() {},
  setEffectiveReasoningLevel() {},
  setEffectiveReasoningState() {},
  setFinishReason() {},
  setHttpStatusCode() {},
  setInputTokens() {},
  setOutputTokens() {},
  setProviderErrorCode() {},
  setProviderErrorMessage() {},
  setProviderRequestId() {},
  setReasoningTokens() {},
  setResponseModel() {},
  setRetryAfterMs() {},
  setStreamOutputCommitted() {},
};

const NOOP_CALL: ModelCallSpanWriter = {
  ...NOOP_SCOPE,
  finishAbandoned() {},
  finishCompleted() {},
  finishFailed() {},
  finishCancelled() {},
  markFallbackSelected() {},
  startAttempt: () => NOOP_ATTEMPT,
};

const NOOP_COMPACTION: ContextCompactionSpanWriter = {
  ...NOOP_SCOPE,
  finishCompleted() {},
  finishDiscarded() {},
  finishFailed() {},
  finishCancelled() {},
  setInputTokens() {},
  setOutputTokens() {},
  markFallbackSelected() {},
};

const NOOP_DETACHED: DetachedOperationSpanWriter = {
  ...NOOP_SCOPE,
  finishCompleted() {},
  finishFailed() {},
  finishCancelled() {},
  setResultType() {},
};

const NOOP_STEP: AgentStepSpanWriter = {
  ...NOOP_SCOPE,
  finishCompleted() {},
  finishDiscarded() {},
  finishFailed() {},
  finishCancelled() {},
};

const NOOP_TURN = {
  ...NOOP_SCOPE,
  finishCompleted() {},
  finishFailed() {},
  finishCancelled() {},
  startStep: () => NOOP_STEP,
  startTool: () => NOOP_TOOL,
} as unknown as AgentTurnSpanWriter;

const NOOP_AGENT_EXECUTION_TELEMETRY: AgentExecutionTelemetryPort = {
  ...NOOP_SCOPE,
  abandonSession() {},
  startCompaction() {
    return NOOP_COMPACTION;
  },
  startDetachedOperation() {
    return NOOP_DETACHED;
  },
  startStep() {
    return NOOP_STEP;
  },
  startTool() {
    return NOOP_TOOL;
  },
  startTurn() {
    return NOOP_TURN;
  },
};

function actorKindFromTaskType(taskType: SessionTaskType | undefined): AgentTelemetryActorKind {
  if (taskType === "subagent_child") return "subagent";
  if (taskType === "workflow_child" || taskType === "nested_workflow_child") {
    return "workflow_child";
  }
  return "main";
}

export class RuntimeTelemetryFacade {
  readonly port: AgentExecutionTelemetryPort;
  readonly actorKind: AgentTelemetryActorKind;

  constructor(options: RuntimeTelemetryFacadeOptions) {
    this.port = options.port ?? NOOP_AGENT_EXECUTION_TELEMETRY;
    this.actorKind = actorKindFromTaskType(options.taskType);
  }

  captureCausation(): AgentTelemetryCausation | undefined {
    return this.port.captureCausation();
  }

  turn(input: {
    inputSource?: AgentTelemetryInputSource;
    traceContext: TraceContext;
    turnNumber: number;
  }): AgentTurnSpanWriter {
    return this.port.startTurn({
      causation: undefined,
      causationMode: "linked_root",
      context: {
        actorKind: this.actorKind,
        agentName: "",
        launchSurface: "standalone_cli",
        parentSessionId: undefined,
        parentTurnId: undefined,
        queryId: input.traceContext.queryId,
        sessionId: input.traceContext.sessionId ?? "",
        turnId: input.traceContext.turnId,
      },
      inputSource: input.inputSource ?? "user",
      turnNumber: input.turnNumber,
    });
  }

  step(input: { stepId: MessageId; stepIndex: number }): AgentStepSpanWriter {
    return this.port.startStep({
      stepId: input.stepId,
      stepIndex: input.stepIndex,
    });
  }

  compaction(
    input: CompactionTraceStart & { traceContext?: TraceContext },
  ): ContextCompactionSpanWriter {
    return this.port.startCompaction(input);
  }

  detached(
    input: Omit<DetachedOperationTraceStart, "causation" | "context"> & {
      causation?: AgentTelemetryCausation;
      traceContext: TraceContext;
    },
  ): DetachedOperationSpanWriter {
    return this.port.startDetachedOperation({
      ...input,
      causation: input.causation ?? this.captureCausation(),
      context: {
        actorKind: this.actorKind,
        agentName: "",
        launchSurface: "standalone_cli",
        parentSessionId: undefined,
        parentTurnId: undefined,
        queryId: input.traceContext.queryId,
        sessionId: input.traceContext.sessionId ?? "",
        turnId: input.traceContext.turnId,
      },
    });
  }
}
