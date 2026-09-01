/** Structured diagnostics attached to capability results. */

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  path?: string;
  range?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export function makeDiagnostic(
  severity: DiagnosticSeverity,
  message: string,
  opts?: { source?: string; path?: string },
): Diagnostic {
  const d: Diagnostic = { severity, message };
  if (opts?.source !== undefined) d.source = opts.source;
  if (opts?.path !== undefined) d.path = opts.path;
  return d;
}
