import type { CodeGraphDelta, IndexContext } from "./model.js";
import type { CodeStateProvider } from "./provider.js";

/** VCS observations are kept as a separate provider seam for later deltas. */
export class VcsCodeStateProvider implements CodeStateProvider {
  readonly name = "vcs";

  supports(_filePath: string): boolean {
    return false;
  }

  async indexFile(_context: IndexContext, filePath: string): Promise<CodeGraphDelta> {
    return { provider: this.name, changedPath: filePath, entities: [], edges: [], removedStableKeys: [], observedAt: new Date().toISOString(), providerHealth: { vcs: { status: "unavailable", message: "VCS enrichment is not requested for a file delta" } } };
  }

  async invalidate(_context: IndexContext, _paths: string[]): Promise<CodeGraphDelta[]> {
    return [];
  }
}
