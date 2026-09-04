import { err, type AcceptanceDecision, type EvaluationResult, type EvaluationRun, type EvaluationSpec, type FeedbackPacket, type ProjectId, type RetryCycle, type WorkItem } from "@my-pi/contracts";
import type { CoordinationStore, CoordinationTransaction } from "@my-pi/coordination-store";
import { evaluateAcceptance } from "./acceptance.js";
import { makeFeedback } from "./feedback.js";
import { makeRetryCycle } from "./retry.js";
import { makeEvaluationRun, type EvaluationRunInput } from "./run.js";
import { makeEvaluationSpec, type EvaluationSpecInput } from "./spec.js";
import { resultDigest, validateProviderResult, type ProviderResultInput, type StoredEvaluationResult } from "./result.js";
import type { EvaluatorProvider } from "./provider.js";

export interface EvaluationStatus {
  run: EvaluationRun;
  results: StoredEvaluationResult[];
  decision?: AcceptanceDecision;
  feedback?: FeedbackPacket;
  retry?: RetryCycle;
}

export interface EvaluationCancellation {
  throwIfAborted(): void;
}

export class EvaluationRuntime {
  constructor(private readonly store: CoordinationStore, readonly projectId: ProjectId, private readonly providers: EvaluatorProvider[] = []) {}

  async registerSpec(input: EvaluationSpecInput): Promise<EvaluationSpec> {
    const spec = makeEvaluationSpec(this.projectId, input);
    return this.store.transact((tx) => {
      if (!tx.getProjection("project", this.projectId)) throw err.projectNotFound();
      tx.putProjection("evaluation_spec", spec.id, spec, this.projectId, spec.createdAt);
      tx.appendEvent({ projectId: this.projectId, eventType: "EvaluationSpecRegistered", actor: { kind: "system", name: "evaluation-runtime" }, payload: spec });
      return spec;
    });
  }

  async requestRun(input: Omit<EvaluationRunInput, "spec"> & { specId: EvaluationSpec["id"] }): Promise<EvaluationRun> {
    return this.store.transact((tx) => {
      const spec = tx.getProjection<EvaluationSpec>("evaluation_spec", input.specId);
      if (!spec || spec.projectId !== this.projectId) throw err.evaluationSpecInvalid("evaluation spec was not found for this project");
      const workItem = tx.getProjection<WorkItem>("work_item", input.workItemId);
      if (!workItem || workItem.projectId !== this.projectId) throw err.workItemNotFound();
      if (workItem.evaluationSpecId !== undefined && workItem.evaluationSpecId !== input.specId) throw err.evaluationSpecInvalid("evaluation run does not match the WorkItem evaluation spec");
      const run = makeEvaluationRun({ spec, workItemId: input.workItemId, intentId: input.intentId, changeReceiptId: input.changeReceiptId, repositoryStateRef: input.repositoryStateRef, attempt: input.attempt });
      tx.putProjection("evaluation_run", run.id, run, this.projectId, run.startedAt);
      tx.appendEvent({ projectId: this.projectId, eventType: "EvaluationRequested", actor: { kind: "system", name: "evaluation-runtime" }, payload: run });
      return run;
    });
  }

  async recordResult(runId: EvaluationRun["id"], input: ProviderResultInput): Promise<StoredEvaluationResult> {
    return this.store.transact((tx) => {
      const run = tx.getProjection<EvaluationRun>("evaluation_run", runId);
      if (!run) throw err.evaluationSpecInvalid("evaluation run was not found");
      const spec = tx.getProjection<EvaluationSpec>("evaluation_spec", run.specId);
      if (!spec || spec.projectId !== this.projectId || spec.version !== run.specVersion) throw err.evaluationSpecInvalid("evaluation spec version is unavailable");
      const criterion = spec.criteria.find((candidate) => candidate.id === input.criterionId);
      if (!criterion) throw err.evaluationResultConflict("criterion is not part of the bound evaluation spec");
      if (input.providerId !== criterion.evaluatorRef && !(input.providerId === "evaluation-runtime" && input.result.reasonCode === "EVALUATOR_UNAVAILABLE")) throw err.evaluationResultConflict("provider identity does not match the bound evaluator");
      if (input.result.evidence.some((evidence) => evidence.provider !== input.providerId)) throw err.evaluationResultConflict("evidence provider does not match the result provider");
      validateProviderResult(input, run.repositoryStateRef);
      if (run.state === "completed") throw err.evaluationResultConflict("completed evaluation runs are immutable");
      const stored: StoredEvaluationResult = { ...input, runId, resultDigest: resultDigest(input), recordedAt: new Date().toISOString() };
      const key = `${runId}:${input.criterionId}:${input.providerResultId}`;
      const previous = tx.getProjection<StoredEvaluationResult>("evaluation_result", key);
      if (previous) {
        if (previous.resultDigest !== stored.resultDigest) throw err.evaluationResultConflict("provider result identity was replayed with a different digest");
        return previous;
      }
      tx.putProjection("evaluation_result", key, stored, this.projectId, stored.recordedAt);
      tx.appendEvent({ projectId: this.projectId, eventType: "EvaluationResultRecorded", actor: { kind: "system", name: input.providerId }, payload: { ...stored, workItemId: run.workItemId } });
      return stored;
    });
  }

  async evaluateRun(runId: EvaluationRun["id"], observed: Record<string, unknown> = {}, signal: EvaluationCancellation = new AbortController().signal): Promise<EvaluationStatus> {
    const status = await this.startRun(runId);
    const spec = await this.store.getProjection<EvaluationSpec>("evaluation_spec", status.run.specId);
    if (!spec || spec.projectId !== this.projectId) throw err.evaluationSpecInvalid("evaluation spec was not found for this project");
    for (const criterion of spec.criteria) {
      if (status.results.some((result) => result.criterionId === criterion.id)) continue;
      const provider = this.providers.find((candidate) => candidate.id === criterion.evaluatorRef && candidate.supports(criterion));
      if (!provider) {
        await this.recordResult(runId, {
          providerResultId: `evaluation-runtime:unavailable:${criterion.id}:${status.run.attempt}`,
          providerId: "evaluation-runtime",
          criterionId: criterion.id,
          result: { criterionId: criterion.id, outcome: "error", evidence: [], reasonCode: "EVALUATOR_UNAVAILABLE" },
        });
        continue;
      }
      try {
        const providerResult = await provider.evaluate({ run: status.run, criterion, observed: observed[criterion.id] }, signal as Parameters<EvaluatorProvider["evaluate"]>[1]);
        await this.recordResult(runId, { providerResultId: providerResult.providerResultId, providerId: provider.id, criterionId: providerResult.criterionId, result: { criterionId: providerResult.criterionId, outcome: providerResult.outcome, evidence: providerResult.evidence, observed: providerResult.observed, reasonCode: providerResult.reasonCode } });
      } catch {
        await this.recordResult(runId, {
          providerResultId: `${provider.id}:error:${criterion.id}:${status.run.attempt}`,
          providerId: provider.id,
          criterionId: criterion.id,
          result: { criterionId: criterion.id, outcome: "error", evidence: [], reasonCode: (signal as { aborted?: boolean }).aborted === true ? "EVALUATOR_CANCELLED" : "EVALUATOR_ERROR" },
        });
      }
    }
    return this.completeRun(runId);
  }

  async completeRun(runId: EvaluationRun["id"]): Promise<EvaluationStatus> {
    return this.store.transact((tx) => {
      const run = tx.getProjection<EvaluationRun>("evaluation_run", runId);
      if (!run) throw err.evaluationSpecInvalid("evaluation run was not found");
      const spec = tx.getProjection<EvaluationSpec>("evaluation_spec", run.specId);
      if (!spec || spec.projectId !== this.projectId) throw err.evaluationSpecInvalid("evaluation spec was not found for this project");
      if (run.state === "completed") return this.statusFromTransaction(tx, run);
      const results = tx.listProjections<StoredEvaluationResult>("evaluation_result", this.projectId).map((record) => record.value).filter((result) => resultsForRun(result, runId));
      const acceptance = evaluateAcceptance(spec, run.repositoryStateRef, results);
      const decision: AcceptanceDecision = { runId, decision: acceptance.decision, decisionDigest: acceptance.decisionDigest, reasons: acceptance.reasons };
      tx.putProjection("evaluation_decision", runId, decision, this.projectId, new Date().toISOString());
      const feedback = makeFeedback(run, acceptance, results);
      if (feedback) tx.putProjection("feedback_packet", feedback.id, feedback, this.projectId, new Date().toISOString());
      const retry = acceptance.decision === "accepted" ? undefined : makeRetryCycle(run, acceptance.decision === "rejected" ? "recommended" : "review_required", results.flatMap((result) => result.result.reasonCode ? [result.result.reasonCode] : []), feedback?.retryConstraints ?? []);
      if (retry) tx.putProjection("retry_cycle", retry.id, retry, this.projectId, retry.updatedAt);
      const completed = { ...run, state: "completed" as const, completedAt: new Date().toISOString() };
      tx.putProjection("evaluation_run", run.id, completed, this.projectId, completed.completedAt);
      tx.appendEvent({ projectId: this.projectId, eventType: "EvaluationCompleted", actor: { kind: "system", name: "evaluation-runtime" }, payload: completed });
      tx.appendEvent({ projectId: this.projectId, eventType: "AcceptanceDecided", actor: { kind: "system", name: "evaluation-runtime" }, payload: { ...decision, workItemId: run.workItemId } });
      if (feedback) tx.appendEvent({ projectId: this.projectId, eventType: "FeedbackIssued", actor: { kind: "system", name: "evaluation-runtime" }, payload: feedback });
      if (retry?.state === "recommended") tx.appendEvent({ projectId: this.projectId, eventType: "RetryRecommended", actor: { kind: "system", name: "evaluation-runtime" }, payload: { ...retry, workItemId: run.workItemId } });
      return { run: completed, results, decision, ...(feedback ? { feedback } : {}), ...(retry ? { retry } : {}) };
    });
  }

  async status(runId: EvaluationRun["id"]): Promise<EvaluationStatus> {
    const run = await this.store.getProjection<EvaluationRun>("evaluation_run", runId);
    if (!run) throw err.evaluationSpecInvalid("evaluation run was not found");
    const results = (await this.store.listProjections<StoredEvaluationResult>("evaluation_result", this.projectId)).map((record) => record.value).filter((result) => resultsForRun(result, runId));
    const spec = await this.store.getProjection<EvaluationSpec>("evaluation_spec", run.specId);
    if (!spec || spec.projectId !== this.projectId) throw err.evaluationSpecInvalid("evaluation run is not owned by this project");
    const decision = await this.store.getProjection<AcceptanceDecision>("evaluation_decision", runId);
    const feedbackRecords = await this.store.listProjections<FeedbackPacket>("feedback_packet", this.projectId);
    const feedback = feedbackRecords.map((record) => record.value).find((packet) => packet.runId === runId);
    const retryRecords = await this.store.listProjections<RetryCycle>("retry_cycle", this.projectId);
    const retry = retryRecords.map((record) => record.value).find((cycle) => cycle.runId === runId);
    return { run, results, ...(decision ? { decision } : {}), ...(feedback ? { feedback } : {}), ...(retry ? { retry } : {}) };
  }

  private async startRun(runId: EvaluationRun["id"]): Promise<EvaluationStatus> {
    await this.store.transact((tx) => {
      const run = tx.getProjection<EvaluationRun>("evaluation_run", runId);
      if (!run) throw err.evaluationSpecInvalid("evaluation run was not found");
      if (run.state !== "pending") return;
      const started = { ...run, state: "running" as const, startedAt: run.startedAt ?? new Date().toISOString() };
      tx.putProjection("evaluation_run", run.id, started, this.projectId, started.startedAt);
      tx.appendEvent({ projectId: this.projectId, eventType: "EvaluationStarted", actor: { kind: "system", name: "evaluation-runtime" }, payload: started });
    });
    return this.status(runId);
  }

  private statusFromTransaction(tx: CoordinationTransaction, run: EvaluationRun): EvaluationStatus {
    const results = tx.listProjections<StoredEvaluationResult>("evaluation_result", this.projectId).map((record) => record.value).filter((result) => resultsForRun(result, run.id));
    const decision = tx.getProjection<AcceptanceDecision>("evaluation_decision", run.id);
    const feedback = tx.listProjections<FeedbackPacket>("feedback_packet", this.projectId).map((record) => record.value).find((packet) => packet.runId === run.id);
    const retry = tx.listProjections<RetryCycle>("retry_cycle", this.projectId).map((record) => record.value).find((cycle) => cycle.runId === run.id);
    return { run, results, ...(decision ? { decision } : {}), ...(feedback ? { feedback } : {}), ...(retry ? { retry } : {}) };
  }
}

function resultsForRun(result: StoredEvaluationResult, runId: string): boolean {
  return result.runId === runId;
}
