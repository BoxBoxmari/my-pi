import type { CodeEdge, CodeEntity } from "@my-pi/contracts";
import type { CodeStateDeltaInput, CoordinationStore } from "@my-pi/coordination-store";
import { AstCodeStateProvider } from "./ast-provider.js";
import { mergeDeltas } from "./delta.js";
import type { CodeGraphDelta, CodeGraphSnapshot, IndexContext } from "./model.js";
import { FileSystemCodeStateProvider } from "./fs-provider.js";
import type { CodeStateProvider } from "./provider.js";

function edgeKey(edge: CodeEdge): string {
  return `${edge.from}|${edge.to}|${edge.kind}|${edge.provider}`;
}

export class CodeStateIndexer {
  private readonly entities = new Map<string, CodeEntity>();
  private readonly edges = new Map<string, CodeEdge>();
  private readonly providers: CodeStateProvider[];

  constructor(private readonly persistence?: Pick<CoordinationStore, "applyCodeStateDelta" | "getCodeState">, providers?: CodeStateProvider[]) {
    this.providers = providers ?? [new FileSystemCodeStateProvider(), new AstCodeStateProvider()];
  }

  async load(context: IndexContext): Promise<CodeGraphSnapshot> {
    if (this.persistence) {
      const state = await this.persistence.getCodeState(context.projectId, context.worktreeId);
      this.entities.clear();
      this.edges.clear();
      for (const entity of state.entities) this.entities.set(entity.stableKey, entity);
      for (const edge of state.edges) this.edges.set(edgeKey(edge), edge);
    }
    return this.snapshot();
  }

  async indexFile(context: IndexContext, filePath: string): Promise<CodeGraphDelta> {
    context.signal.throwIfAborted();
    const deltas: CodeGraphDelta[] = [];
    for (const provider of this.providers) {
      if (!provider.supports(filePath)) continue;
      try {
        deltas.push(await provider.indexFile(context, filePath));
      } catch (error) {
        if (context.signal.aborted) throw error;
        deltas.push({ provider: provider.name, changedPath: filePath, entities: [], edges: [], removedStableKeys: [], observedAt: new Date().toISOString(), providerHealth: { [provider.name]: { status: "degraded", message: error instanceof Error ? error.message : String(error) } } });
      }
    }
    const merged = mergeDeltas(deltas[0]?.changedPath ?? filePath, deltas);
    const removedIds = new Set<string>();
    for (const [stableKey, entity] of this.entities) {
      if (entity.path === merged.changedPath || merged.removedStableKeys.includes(stableKey)) {
        removedIds.add(entity.id);
        this.entities.delete(stableKey);
      }
    }
    for (const [key, edge] of this.edges) {
      if (removedIds.has(edge.from) || removedIds.has(edge.to)) this.edges.delete(key);
    }
    for (const entity of merged.entities) this.entities.set(entity.stableKey, entity);
    for (const edge of merged.edges) this.edges.set(edgeKey(edge), edge);
    if (this.persistence) {
      const input: CodeStateDeltaInput = {
        projectId: context.projectId,
        repositoryId: context.repositoryId,
        worktreeId: context.worktreeId,
        changedPath: merged.changedPath,
        entities: merged.entities,
        edges: merged.edges,
        removedStableKeys: merged.removedStableKeys,
        observedAt: merged.observedAt,
        providerHealth: merged.providerHealth,
      };
      await this.persistence.applyCodeStateDelta(input);
    }
    return merged;
  }

  async indexPaths(context: IndexContext, paths: string[]): Promise<CodeGraphDelta[]> {
    if (paths.length > 2_000) throw new RangeError("code-state path count exceeds 2000");
    const deltas: CodeGraphDelta[] = [];
    for (const filePath of paths) deltas.push(await this.indexFile(context, filePath));
    return deltas;
  }

  async invalidate(context: IndexContext, paths: string[]): Promise<CodeGraphDelta[]> {
    const deltas: CodeGraphDelta[] = [];
    for (const provider of this.providers) deltas.push(...await provider.invalidate(context, paths));
    for (const delta of deltas) {
      for (const [stableKey, entity] of this.entities) {
        if (entity.path === delta.changedPath || delta.removedStableKeys.includes(stableKey)) this.entities.delete(stableKey);
      }
    }
    const entityIds = new Set([...this.entities.values()].map((entity) => entity.id));
    for (const [key, edge] of this.edges) {
      if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) this.edges.delete(key);
    }
    if (this.persistence) {
      for (const delta of deltas) {
        await this.persistence.applyCodeStateDelta({
          projectId: context.projectId,
          repositoryId: context.repositoryId,
          worktreeId: context.worktreeId,
          changedPath: delta.changedPath,
          entities: [],
          edges: [],
          removedStableKeys: delta.removedStableKeys,
          observedAt: delta.observedAt,
          providerHealth: delta.providerHealth,
        });
      }
    }
    return deltas;
  }

  snapshot(): CodeGraphSnapshot {
    return { entities: [...this.entities.values()], edges: [...this.edges.values()] };
  }
}
