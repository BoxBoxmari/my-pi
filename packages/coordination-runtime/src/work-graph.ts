import type { WorkDependency, WorkItem } from "@my-pi/contracts";

export function dependenciesOf(item: WorkItem, dependencies: WorkDependency[]): WorkDependency[] {
  return dependencies.filter((dependency) => dependency.from === item.id && dependency.type === "depends_on");
}

export function dependencyBlockers(item: WorkItem, dependencies: WorkDependency[], items: Map<string, WorkItem>): WorkItem[] {
  return dependenciesOf(item, dependencies)
    .map((dependency) => items.get(dependency.to))
    .filter((dependency): dependency is WorkItem => dependency !== undefined && dependency.state !== "done");
}
