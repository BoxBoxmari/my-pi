import type { CodeGraphDelta, IndexContext } from "./model.js";

export interface CodeStateProvider {
  readonly name: string;
  supports(filePath: string): boolean;
  indexFile(context: IndexContext, filePath: string): Promise<CodeGraphDelta>;
  invalidate(context: IndexContext, paths: string[]): Promise<CodeGraphDelta[]>;
}
