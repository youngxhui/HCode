/**
 * 遥测已移除；localTtftExporter 降级为空实现。
 */

import type { LocalTtftBatch } from "@zcode/shared";

export function createLocalTtftExporter(_options: {
  env: Record<string, string | undefined>;
  now?: () => number;
  version: string;
  logger: { warn(...args: unknown[]): void };
}) {
  return {
    enqueue(_batch: LocalTtftBatch): void {
      // no-op
    },
    async shutdown(): Promise<void> {
      // no-op
    },
  };
}
