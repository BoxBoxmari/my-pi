import { err, isMyPiError, type MyPiError } from "@my-pi/contracts";

export function normalizeCoordinationStoreError(error: unknown): MyPiError {
  if (isMyPiError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return err.coordinationStoreFailure(message);
}
