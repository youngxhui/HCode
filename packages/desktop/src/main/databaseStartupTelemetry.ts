/**
 * 遥测已移除；databaseStartupTelemetry 降级为空实现。
 */

export function reportDatabaseStartupState(_state: unknown): void {
  // no-op
}
