/**
 * 遥测已移除；armsBrowserPerfLoadNudge 降级为空实现。
 */

import type { WebContents } from "electron";

export function scheduleArmsBrowserPerfLoadNudge(_webContents: WebContents): void {
  // no-op
}
