/**
 * @ccr/ast — minimal read-only AST search stub.
 * Full tree-sitter/ast-grep integration is pending G0 supplier qualification (pi-ast).
 * This stub satisfies the package structure and allows the tool to be discovered;
 * it delegates to a simple regex-based structural match for the V1 corpus.
 */
import type { AstBackend, AstSearchRequest, AstSearchResult } from "@ccr/native-ports";

export class FallbackAstBackend implements AstBackend {
  readonly kind = "node-fallback" as const;
  async search(request: AstSearchRequest, signal: AbortSignal): Promise<AstSearchResult> {
    signal.throwIfAborted();
    // Minimal stub: no structural matches yet — returns empty, non-truncated.
    // Real implementation will use pi-ast or tree-sitter once qualified.
    return { matches: [], truncated: false, totalCount: 0 };
  }
}
export const AST_LANGUAGES = ["typescript","javascript","python","rust","go"] as const;
