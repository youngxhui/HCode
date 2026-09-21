import { Emitter, type Event, type IDisposable } from "@zcode/rpc";

interface TaskActivityTracker extends IDisposable {
  readonly onDidChangeRunningTaskCount: Event<number>;
  readRunningTaskCount(): number;
}

export function createTaskActivityTracker(): TaskActivityTracker {
  const changed = new Emitter<number>();
  return {
    onDidChangeRunningTaskCount: changed.event,
    readRunningTaskCount: () => 0,
    dispose: () => {
      changed.dispose();
    },
  };
}
