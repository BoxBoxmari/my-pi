import type { CodeGraphDelta, IndexContext } from "./model.js";
import type { CodeStateProvider } from "./provider.js";

/** LSP enrichment is optional in V1 and is enabled by a later runtime profile. */
export class LspCodeStateProvider implements CodeStateProvider {
  readonly name = "lsp";

  supports(_filePath: string): boolean {
    return false;
  }

  async indexFile(_context: IndexContext, filePath: string): Promise<CodeGraphDelta> {
    return { provider: this.name, changedPath: filePath, entities: [], edges: [], removedStableKeys: [], observedAt: new Date().toISOString(), providerHealth: { lsp: { status: "unavailable", message: "LSP enrichment is opt-in" } } };
  }

  async invalidate(_context: IndexContext, _paths: string[]): Promise<CodeGraphDelta[]> {
    return [];
  }
}
