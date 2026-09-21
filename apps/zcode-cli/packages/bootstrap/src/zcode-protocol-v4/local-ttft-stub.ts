/**
 * 遥测已移除；LocalTtftRecorder 降级为空实现。
 */

import type { CommandEnvelope, LocalTtftFacts } from "@zcode/shared/zcode-protocol-v4";

export class LocalTtftRecorder {
  readonly instanceId = "stub";

  constructor(
    private readonly now: () => number = () => 0,
    private readonly onDrop: () => void = () => {},
    private readonly onCheckpoint: (facts: LocalTtftFacts) => void = () => {},
  ) {}

  receive(_envelope: CommandEnvelope, _busy: boolean): boolean {
    return true;
  }

  admitted(_commandId: string): void {}

  event(_sessionId: string, _event: unknown): void {}

  clear(): void {}

  forSession(_sessionId: string, _commandId?: string): LocalTtftFacts | undefined {
    return undefined;
  }
}
