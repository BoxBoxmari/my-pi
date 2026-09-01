/**
 * Native loader: platform/arch detection, version sentinel, fallback resolution.
 * No silent stale .node loading.
 */
import { createRequire } from "node:module";

export type NativePlatform = `${NodeJS.Platform}-${NodeJS.Architecture}`;

export function currentPlatform(): NativePlatform {
  return `${process.platform}-${process.arch}` as NativePlatform;
}

export interface LoadResult<T> {
  ok: true;
  module: T;
  platform: NativePlatform;
  version: string;
}

export interface LoadError {
  ok: false;
  platform: NativePlatform;
  error: string;
  fallback: "node-fallback";
}

export function versionSentinel(expected: string, actual: string): boolean {
  return expected === actual;
}

export async function tryLoadNative<T>(specifier: string, expectedVersion: string): Promise<LoadResult<T> | LoadError> {
  const platform = currentPlatform();
  try {
    const req = createRequire(import.meta.url);
    const mod = req(specifier) as { version?: string } & T;
    const actual = (mod as { version?: string }).version ?? "unknown";
    if (!versionSentinel(expectedVersion, actual)) {
      return { ok: false, platform, error: `version mismatch: expected ${expectedVersion}, got ${actual}`, fallback: "node-fallback" };
    }
    return { ok: true, module: mod as T, platform, version: actual };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, platform, error: msg, fallback: "node-fallback" };
  }
}
