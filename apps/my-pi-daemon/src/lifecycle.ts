export type DaemonState = "starting" | "ready" | "degraded" | "stopping";

export class DaemonLifecycle {
  private currentState: DaemonState = "starting";

  get state(): DaemonState {
    return this.currentState;
  }

  set(state: DaemonState): void {
    this.currentState = state;
  }
}
