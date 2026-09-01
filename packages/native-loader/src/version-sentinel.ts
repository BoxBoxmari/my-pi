/**
 * Version sentinel: explicit ABI/load error, no silent stale .node loading.
 */
export const CCR_NATIVE_VERSION = "0.1.0";

export function checkVersion(actual: string): { ok: boolean; expected: string; actual: string } {
  return { ok: actual === CCR_NATIVE_VERSION, expected: CCR_NATIVE_VERSION, actual };
}
