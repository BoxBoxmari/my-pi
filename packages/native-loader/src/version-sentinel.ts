/**
 * Version sentinel: explicit ABI/load error, no silent stale .node loading.
 */
export const MY_PI_NATIVE_VERSION = "0.1.0";

/** @deprecated Use MY_PI_NATIVE_VERSION. Kept as a 1-major alias. */
export const CCR_NATIVE_VERSION = MY_PI_NATIVE_VERSION;

export function checkVersion(actual: string): { ok: boolean; expected: string; actual: string } {
  return { ok: actual === MY_PI_NATIVE_VERSION, expected: MY_PI_NATIVE_VERSION, actual };
}
