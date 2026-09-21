/**
 * 设备稳定标识符（deviceMid）生成与读取。
 *
 * 遥测已移除，deviceMid 仅保留给非遥测场景使用：
 * - autoUpdater 请求头
 * - help config / context prompt rollout 请求参数
 * - preload 同步读取
 */

import { app } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DEVICE_MID_KEY = "deviceMid";
const STATE_FILE_NAME = "device-state.json";

function getUserDataDir(): string {
  return app.getPath("userData");
}

function getDeviceStatePath(): string {
  return join(getUserDataDir(), STATE_FILE_NAME);
}

function generateDeviceMid(): string {
  const seed = `${homedir()}-${process.platform}-${osHwmid()}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

function osHwmid(): string {
  try {
    const os = await import("node:os");
    const parts = [
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model ?? "unknown-cpu",
      os.totalmem().toString(),
      os.hostname(),
    ];
    return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
  } catch {
    return "fallback-hwmid";
  }
}

async function readStoredDeviceMid(): Promise<string | null> {
  try {
    const fs = await import("node:fs");
    const content = await fs.readFile(getDeviceStatePath(), "utf-8");
    const data = JSON.parse(content) as Record<string, string>;
    const stored = data[DEVICE_MID_KEY];
    if (typeof stored === "string" && stored.length > 0) {
      return stored;
    }
  } catch {
    // 文件不存在或解析失败，继续生成新 ID
  }
  return null;
}

async function persistDeviceMid(deviceMid: string): Promise<void> {
  try {
    const fs = await import("node:fs");
    const path = getDeviceStatePath();
    let existing: Record<string, string> = {};
    try {
      const content = await fs.readFile(path, "utf-8");
      existing = JSON.parse(content) as Record<string, string>;
    } catch {
      // 忽略读取失败
    }
    existing[DEVICE_MID_KEY] = deviceMid;
    await fs.writeFile(path, JSON.stringify(existing, undefined, 2), "utf-8");
  } catch {
    // 写入失败不影响启动，继续使用内存中的 ID
  }
}

export async function ensureDesktopDeviceMidSync(): Promise<string> {
  // 优先从命令行参数读取（preload 同步透传）
  const argDeviceId = process.argv.find((arg) => arg.startsWith("--device-id="));
  if (argDeviceId) {
    const id = argDeviceId.slice("--device-id=".length).trim();
    if (id.length > 0) {
      return id;
    }
  }

  // 从持久化文件读取
  const stored = await readStoredDeviceMid();
  if (stored) {
    return stored;
  }

  // 生成新 ID 并持久化
  const newId = generateDeviceMid();
  await persistDeviceMid(newId);
  return newId;
}
