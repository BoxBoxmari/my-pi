import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA256 = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const TASK_ID = /^OT-[0-9]{3,}$/;
const RUN_ID = /^run-[0-9a-f]{16}$/;
const ISO_DATE = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const ARM_IDS = ["control", "treatment"];
const ALLOWED_COMMANDS = new Set(["node", "node.exe", "npm", "npm.cmd", "pnpm", "pnpm.cmd", "go", "go.exe", "cargo", "cargo.exe", "python", "python.exe"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

function string(errors, value, label, { nonEmpty = true } = {}) {
  add(errors, typeof value === "string" && (!nonEmpty || value.length > 0), `${label} must be a ${nonEmpty ? "non-empty " : ""}string`);
  return typeof value === "string" ? value : undefined;
}

function hash(errors, value, label) {
  add(errors, typeof value === "string" && SHA256.test(value), `${label} must be a 40-character commit SHA`);
}

function digest(errors, value, label) {
  add(errors, typeof value === "string" && DIGEST.test(value), `${label} must be a 64-character SHA-256 digest`);
}

function date(errors, value, label) {
  add(errors, ISO_DATE(value), `${label} must be an ISO-8601 timestamp`);
}

function unique(errors, values, label) {
  if (!Array.isArray(values)) return;
  add(errors, new Set(values).size === values.length, `${label} must contain unique values`);
}

function validateCommand(errors, command, label) {
  add(errors, isObject(command), `${label} must be an object`);
  if (!isObject(command)) return;
  string(errors, command.id, `${label}.id`);
  add(errors, Array.isArray(command.argv) && command.argv.length >= 2 && command.argv.length <= 32 && command.argv.every((item) => typeof item === "string" && item.length > 0), `${label}.argv must be a bounded non-empty argument array`);
  if (Array.isArray(command.argv) && command.argv.length > 0) {
    const executable = path.basename(command.argv[0]).toLowerCase();
    add(errors, ALLOWED_COMMANDS.has(executable), `${label}.argv[0] is not an allowed predeclared test command`);
  }
  add(errors, Number.isInteger(command.timeoutMs) && command.timeoutMs >= 1_000 && command.timeoutMs <= 900_000, `${label}.timeoutMs must be between 1000 and 900000`);
}

function validateArm(errors, arm, label, taskBase) {
  add(errors, isObject(arm), `${label} must be an object`);
  if (!isObject(arm)) return;
  string(errors, arm.profileId, `${label}.profileId`);
  string(errors, arm.description, `${label}.description`);
  hash(errors, arm.baseCommit, `${label}.baseCommit`);
  add(errors, arm.baseCommit === taskBase, `${label}.baseCommit must equal baseCommit`);
  string(errors, arm.worktreeKey, `${label}.worktreeKey`);
  string(errors, arm.sessionKey, `${label}.sessionKey`);
  add(errors, arm.freshWorktree === true, `${label}.freshWorktree must be true`);
  add(errors, arm.freshSession === true, `${label}.freshSession must be true`);
  if (arm.setupCommands !== undefined) {
    add(errors, Array.isArray(arm.setupCommands), `${label}.setupCommands must be an array`);
    if (Array.isArray(arm.setupCommands)) {
      arm.setupCommands.forEach((command, index) => validateCommand(errors, command, `${label}.setupCommands[${index}]`));
      unique(errors, arm.setupCommands.map((command) => command?.id), `${label}.setupCommands ids`);
    }
  }
}


function validateWorkloadPatch(errors, patch, label) {
  add(errors, isObject(patch), label + " must be an object");
  if (!isObject(patch)) return;
  string(errors, patch.id, label + ".id");
  string(errors, patch.path, label + ".path");
  string(errors, patch.old, label + ".old", { nonEmpty: false });
  string(errors, patch.new, label + ".new", { nonEmpty: false });
  if (patch.expectedAfterHash !== undefined) digest(errors, patch.expectedAfterHash.replace(/^sha256:/, ""), label + ".expectedAfterHash");
}

function validateFinalCheck(errors, check, label) {
  add(errors, isObject(check), label + " must be an object");
  if (!isObject(check)) return;
  string(errors, check.path, label + ".path");
  if (check.expectedHash !== undefined) add(errors, typeof check.expectedHash === "string" && /^sha256:[0-9a-f]{64}$/i.test(check.expectedHash), label + ".expectedHash is invalid");
  if (check.includes !== undefined) add(errors, Array.isArray(check.includes) && check.includes.every((value) => typeof value === "string"), label + ".includes must be an array of strings");
  if (check.excludes !== undefined) add(errors, Array.isArray(check.excludes) && check.excludes.every((value) => typeof value === "string"), label + ".excludes must be an array of strings");
}

function validatePN6Evaluator(errors, evaluator) {
  add(errors, isObject(evaluator), "PN6 workload.evaluator must be an object");
  if (!isObject(evaluator)) return;
  add(errors, evaluator.kind === "measured_source_repair", "PN6 workload.evaluator.kind must be measured_source_repair");
  add(errors, isObject(evaluator.routeRequirements), "PN6 evaluator.routeRequirements must be an object");
  add(errors, isObject(evaluator.sourceChecks), "PN6 evaluator.sourceChecks must be an object");
  add(errors, isObject(evaluator.repairPatches), "PN6 evaluator.repairPatches must be an object");
  for (const armId of ARM_IDS) {
    const routes = evaluator.routeRequirements?.[armId];
    add(errors, Array.isArray(routes) && routes.every((value) => typeof value === "string" && value.length > 0), "PN6 evaluator.routeRequirements." + armId + " must be a string array");
    validateFinalCheck(errors, evaluator.sourceChecks?.[armId], "PN6 evaluator.sourceChecks." + armId);
    const patches = evaluator.repairPatches?.[armId];
    add(errors, Array.isArray(patches), "PN6 evaluator.repairPatches." + armId + " must be an array");
    if (Array.isArray(patches)) patches.forEach((patch, index) => validateWorkloadPatch(errors, patch, "PN6 evaluator.repairPatches." + armId + "[" + index + "]"));
  }
  add(errors, Array.isArray(evaluator.repairPatches?.control) && evaluator.repairPatches.control.length > 0, "PN6 evaluator.control repairPatches must contain a preregistered repair");
}

function validateWorkload(errors, workload, taskClass) {
  if (workload === undefined) return;
  add(errors, isObject(workload), "workload must be an object");
  if (!isObject(workload)) return;
  if (workload.targetPath !== undefined) string(errors, workload.targetPath, "workload.targetPath");
  if (workload.patch !== undefined) validateWorkloadPatch(errors, { ...workload.patch, id: workload.patch.id ?? "source-patch", path: workload.targetPath ?? workload.patch.path }, "workload.patch");
  if (workload.groundTruth !== undefined) add(errors, Array.isArray(workload.groundTruth), "workload.groundTruth must be an array");
  for (const routeName of ["controlRoute", "treatmentRoute"]) if (workload[routeName] !== undefined) add(errors, Array.isArray(workload[routeName]), "workload." + routeName + " must be an array");
  if (taskClass === "PN6") {
    add(errors, workload.evidenceKind === "observed_source_change", "PN6 workload.evidenceKind must be observed_source_change");
    string(errors, workload.heterogeneityKey, "PN6 workload.heterogeneityKey");
    if (workload.mutationMode !== undefined) add(errors, ["treatment_only", "shared_source_change"].includes(workload.mutationMode), "PN6 workload.mutationMode is invalid");
    if (workload.evaluator !== undefined) validatePN6Evaluator(errors, workload.evaluator);
  }
  if (taskClass !== "PN8") return;
  add(errors, ["controlled_replay", "live_repair"].includes(workload.evidenceKind), "PN8 workload.evidenceKind must be controlled_replay or live_repair");
  if (workload.evidenceKind === "live_repair") {
    string(errors, workload.frozenStateId, "PN8 workload.frozenStateId");
    string(errors, workload.heterogeneityKey, "PN8 workload.heterogeneityKey");
    return;
  }
  add(errors, isObject(workload.failureReplay), "PN8 workload.failureReplay must be an object");
  if (isObject(workload.failureReplay)) {
    string(errors, workload.failureReplay.id, "workload.failureReplay.id");
    string(errors, workload.failureReplay.sourceRecord, "workload.failureReplay.sourceRecord");
    add(errors, Array.isArray(workload.failureReplay.patches) && workload.failureReplay.patches.length > 0, "PN8 failureReplay.patches must not be empty");
    if (Array.isArray(workload.failureReplay.patches)) workload.failureReplay.patches.forEach((patch, index) => validateWorkloadPatch(errors, patch, "workload.failureReplay.patches[" + index + "]"));
  }
  add(errors, isObject(workload.repairPatches), "PN8 workload.repairPatches must be an object");
  if (isObject(workload.repairPatches)) {
    const repairSets = ["shared", "control", "treatment"].filter((name) => Array.isArray(workload.repairPatches[name]));
    add(errors, repairSets.length > 0, "PN8 repairPatches must declare shared or both arm-specific patch sets");
    for (const name of repairSets) workload.repairPatches[name].forEach((patch, index) => validateWorkloadPatch(errors, patch, "workload.repairPatches." + name + "[" + index + "]"));
  }
  add(errors, isObject(workload.guidance), "PN8 workload.guidance must be an object");
  if (isObject(workload.guidance)) for (const armId of ["control", "treatment"]) {
    const guidance = workload.guidance[armId];
    add(errors, isObject(guidance), "workload.guidance." + armId + " must be an object");
    if (isObject(guidance)) {
      string(errors, guidance.mode, "workload.guidance." + armId + ".mode");
      string(errors, guidance.sourceRecord, "workload.guidance." + armId + ".sourceRecord");
    }
  }
  add(errors, Array.isArray(workload.finalChecks) && workload.finalChecks.length > 0, "PN8 workload.finalChecks must not be empty");
  if (Array.isArray(workload.finalChecks)) for (const [index, check] of workload.finalChecks.entries()) {
    add(errors, isObject(check), "workload.finalChecks[" + index + "] must be an object");
    if (isObject(check)) {
      string(errors, check.path, "workload.finalChecks[" + index + "].path");
      if (check.expectedHash !== undefined) add(errors, typeof check.expectedHash === "string" && /^sha256:[0-9a-f]{64}$/i.test(check.expectedHash), "workload.finalChecks[" + index + "].expectedHash is invalid");
      if (check.includes !== undefined) add(errors, Array.isArray(check.includes), "workload.finalChecks[" + index + "].includes must be an array");
      if (check.excludes !== undefined) add(errors, Array.isArray(check.excludes), "workload.finalChecks[" + index + "].excludes must be an array");
    }
  }
}

export function validateObservedTask(task) {
  const errors = [];
  add(errors, isObject(task), "task must be an object");
  if (!isObject(task)) return { ok: false, errors };
  add(errors, task.schemaVersion === "2", "schemaVersion must be \"2\"");
  add(errors, task.recordType === "observed-task-v2", "recordType must be observed-task-v2");
  add(errors, typeof task.taskId === "string" && TASK_ID.test(task.taskId), "taskId must match OT-###");
  string(errors, task.taskDefinitionPath, "taskDefinitionPath");
  hash(errors, task.taskDefinitionCommit, "taskDefinitionCommit");
  add(errors, isObject(task.registration), "registration must be an object");
  if (isObject(task.registration)) string(errors, task.registration.receiptPath, "registration.receiptPath");
  date(errors, task.registeredAt, "registeredAt");
  string(errors, task.title, "title");
  add(errors, ["PN6", "PN8", "research"].includes(task.taskClass), "taskClass must be PN6, PN8, or research");
  add(errors, ["PN6", "PN8", "none"].includes(task.primaryHypothesis), "primaryHypothesis must be PN6, PN8, or none");
  hash(errors, task.baseCommit, "baseCommit");

  add(errors, isObject(task.targetScope), "targetScope must be an object");
  if (isObject(task.targetScope)) {
    add(errors, Array.isArray(task.targetScope.include) && task.targetScope.include.length > 0, "targetScope.include must not be empty");
    add(errors, Array.isArray(task.targetScope.exclude), "targetScope.exclude must be an array");
  }

  add(errors, Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0, "acceptanceCriteria must not be empty");
  if (Array.isArray(task.acceptanceCriteria)) {
    task.acceptanceCriteria.forEach((criterion, index) => {
      add(errors, isObject(criterion), `acceptanceCriteria[${index}] must be an object`);
      if (isObject(criterion)) {
        string(errors, criterion.id, `acceptanceCriteria[${index}].id`);
        string(errors, criterion.condition, `acceptanceCriteria[${index}].condition`);
      }
    });
    unique(errors, task.acceptanceCriteria.map((criterion) => criterion?.id), "acceptanceCriteria ids");
  }

  add(errors, isObject(task.primaryVariable), "primaryVariable must be an object");
  if (isObject(task.primaryVariable)) {
    string(errors, task.primaryVariable.name, "primaryVariable.name");
    const control = string(errors, task.primaryVariable.control, "primaryVariable.control");
    const treatment = string(errors, task.primaryVariable.treatment, "primaryVariable.treatment");
    add(errors, control !== undefined && treatment !== undefined && control !== treatment, "control and treatment must differ on exactly one declared primary variable");
  }

  add(errors, isObject(task.arms), "arms must be an object");
  if (isObject(task.arms)) {
    validateArm(errors, task.arms.control, "arms.control", task.baseCommit);
    validateArm(errors, task.arms.treatment, "arms.treatment", task.baseCommit);
    if (isObject(task.arms.control) && isObject(task.arms.treatment)) {
      add(errors, task.arms.control.worktreeKey !== task.arms.treatment.worktreeKey, "control and treatment must use different worktree keys");
      add(errors, task.arms.control.sessionKey !== task.arms.treatment.sessionKey, "control and treatment must use different session keys");
      add(errors, task.arms.control.profileId !== task.arms.treatment.profileId || task.primaryVariable?.control !== task.primaryVariable?.treatment, "arm profiles must reflect the declared primary variable");
    }
  }

  add(errors, Array.isArray(task.requiredTests) && task.requiredTests.length > 0, "requiredTests must not be empty");
  if (Array.isArray(task.requiredTests)) {
    task.requiredTests.forEach((command, index) => validateCommand(errors, command, `requiredTests[${index}]`));
    unique(errors, task.requiredTests.map((command) => command?.id), "requiredTests ids");
  }

  if (isObject(task.arms) && isObject(task.arms.control) && isObject(task.arms.treatment) && Array.isArray(task.requiredTests)) {
    const requiredIds = new Set(task.requiredTests.map((command) => command?.id));
    const controlSetup = Array.isArray(task.arms.control.setupCommands) ? task.arms.control.setupCommands : [];
    const treatmentSetup = Array.isArray(task.arms.treatment.setupCommands) ? task.arms.treatment.setupCommands : [];
    for (const [label, commands] of [["arms.control", controlSetup], ["arms.treatment", treatmentSetup]]) {
      for (const command of commands) add(errors, !requiredIds.has(command?.id), `${label}.setupCommands ids must not overlap requiredTests ids`);
    }
    add(errors, controlSetup.length === treatmentSetup.length, "control and treatment must declare matching setup command counts");
    if (controlSetup.length > 0 && treatmentSetup.length > 0) {
      const signature = (commands) => JSON.stringify(commands.map((command) => ({ id: command.id, argv: command.argv, timeoutMs: command.timeoutMs })));
      add(errors, signature(controlSetup) !== signature(treatmentSetup), "control and treatment setupCommands must differ on the declared primary variable");
    }
    if (["PN6", "PN8"].includes(task.taskClass) || ["PN6", "PN8"].includes(task.primaryHypothesis)) {
      add(errors, controlSetup.length > 0, "PN6/PN8 control arm must declare setupCommands for the primary variable");
      add(errors, treatmentSetup.length > 0, "PN6/PN8 treatment arm must declare setupCommands for the primary variable");
    }
  }

  add(errors, isObject(task.environment), "environment must be an object");
  if (isObject(task.environment)) {
    string(errors, task.environment.hostFamily, "environment.hostFamily");
    string(errors, task.environment.modelFamily, "environment.modelFamily");
    add(errors, task.environment.sameHostFamily === true, "sameHostFamily must be true for a paired comparison");
    add(errors, task.environment.sameModelFamily === true, "sameModelFamily must be true for a paired comparison");
  }

  add(errors, isObject(task.adjudication), "adjudication must be an object");
  if (isObject(task.adjudication)) {
    add(errors, task.adjudication.independent === true, "adjudication.independent must be true");
    string(errors, task.adjudication.evaluator, "adjudication.evaluator");
    string(errors, task.adjudication.groundTruth, "adjudication.groundTruth");
    add(errors, Array.isArray(task.adjudication.requiredEvidence) && task.adjudication.requiredEvidence.length > 0, "adjudication.requiredEvidence must not be empty");
  }

  add(errors, Array.isArray(task.metrics) && task.metrics.length > 0, "metrics must not be empty");
  if (Array.isArray(task.metrics)) {
    task.metrics.forEach((metric, index) => {
      add(errors, isObject(metric), `metrics[${index}] must be an object`);
      if (isObject(metric)) {
        string(errors, metric.id, `metrics[${index}].id`);
        string(errors, metric.definition, `metrics[${index}].definition`);
        add(errors, ["primary", "secondary"].includes(metric.role), `metrics[${index}].role must be primary or secondary`);
      }
    });
    add(errors, task.metrics.filter((metric) => metric?.role === "primary").length === 1, "exactly one primary metric is required");
    unique(errors, task.metrics.map((metric) => metric?.id), "metric ids");
  }

  add(errors, isObject(task.contaminationControls), "contaminationControls must be an object");
  if (isObject(task.contaminationControls)) {
    for (const key of ["freshWorktree", "freshSession", "noSharedContext", "noCrossArmArtifacts"]) add(errors, task.contaminationControls[key] === true, `contaminationControls.${key} must be true`);
    add(errors, typeof task.contaminationControls.stableAuthorityRequired === "boolean", "contaminationControls.stableAuthorityRequired must be boolean");
    add(errors, Array.isArray(task.contaminationControls.forbiddenPaths), "contaminationControls.forbiddenPaths must be an array");
  }

  if (["PN6", "PN8"].includes(task.taskClass)) add(errors, isObject(task.workload), "PN6/PN8 workload is required");
  validateWorkload(errors, task.workload, task.taskClass);
  return { ok: errors.length === 0, errors };
}

function validateCommandResult(errors, command, label) {
  add(errors, isObject(command), `${label} must be an object`);
  if (!isObject(command)) return;
  string(errors, command.id, `${label}.id`);
  add(errors, Array.isArray(command.argv) && command.argv.length >= 2 && command.argv.every((item) => typeof item === "string" && item.length > 0), `${label}.argv must be a non-empty argument array`);
  if (command.phase !== undefined) add(errors, ["arm_setup", "downstream"].includes(command.phase), `${label}.phase is invalid`);
  add(errors, ["passed", "failed", "timed_out", "not_run"].includes(command.status), `${label}.status is invalid`);
  add(errors, command.exitCode === null || Number.isInteger(command.exitCode), `${label}.exitCode must be an integer or null`);
  if (command.stdoutDigest !== undefined) digest(errors, command.stdoutDigest, `${label}.stdoutDigest`);
  if (command.stderrDigest !== undefined) digest(errors, command.stderrDigest, `${label}.stderrDigest`);
}

function validateArmResult(errors, arm, label, task, seen) {
  add(errors, isObject(arm), `${label} must be an object`);
  if (!isObject(arm)) return;
  add(errors, ARM_IDS.includes(arm.armId), `${label}.armId must be control or treatment`);
  string(errors, arm.runId, `${label}.runId`);
  add(errors, typeof arm.runId === "string" && RUN_ID.test(arm.runId), `${label}.runId has an invalid format`);
  string(errors, arm.sessionId, `${label}.sessionId`);
  string(errors, arm.worktreeId, `${label}.worktreeId`);
  hash(errors, arm.baseCommit, `${label}.baseCommit`);
  add(errors, arm.baseCommit === task.baseCommit, `${label}.baseCommit must equal the task baseCommit`);
  digest(errors, arm.sourceStateDigest, `${label}.sourceStateDigest`);
  add(errors, Array.isArray(arm.commands), `${label}.commands must be an array`);
  if (Array.isArray(arm.commands)) arm.commands.forEach((command, index) => validateCommandResult(errors, command, `${label}.commands[${index}]`));
  add(errors, isObject(arm.contamination), `${label}.contamination must be an object`);
  if (isObject(arm.contamination)) {
    add(errors, typeof arm.contamination.detected === "boolean", `${label}.contamination.detected must be boolean`);
    add(errors, Array.isArray(arm.contamination.reasons), `${label}.contamination.reasons must be an array`);
    if (arm.contamination.detected) seen.contaminated = true;
  }
}

// Arm setup is the preregistered primary-variable intervention; requiredTests follow identically for both arms.
function declaredCommands(task, armId) {
  const setup = task?.arms?.[armId]?.setupCommands;
  return [
    ...(Array.isArray(setup) ? setup.map((command) => ({ ...command, phase: "arm_setup" })) : []),
    ...(Array.isArray(task?.requiredTests) ? task.requiredTests.map((command) => ({ ...command, phase: "downstream" })) : []),
  ];
}

function validateEvidenceShape(errors, result, task) {
  const hypothesis = task?.taskClass ?? task?.primaryHypothesis;
  if (hypothesis === "PN6") {
    add(errors, result.evidenceKind === "observed_source_change", "PN6 result.evidenceKind must be observed_source_change");
    add(errors, isObject(result.measurementEvidence), "PN6 measurementEvidence must be an object");
    if (isObject(result.measurementEvidence)) {
      add(errors, result.measurementEvidence.evaluatorMode === "independent-command-output", "PN6 measurementEvidence.evaluatorMode must be independent-command-output");
      add(errors, isObject(result.measurementEvidence.armRuns), "PN6 measurementEvidence.armRuns must be an object");
      for (const armId of ARM_IDS) {
        const row = result.measurementEvidence.armRuns?.[armId];
        add(errors, isObject(row), "PN6 measurementEvidence.armRuns." + armId + " must be an object");
        if (isObject(row)) {
          string(errors, row.runId, "PN6 measurementEvidence.armRuns." + armId + ".runId");
          add(errors, Number.isInteger(row.repairIterations) && row.repairIterations >= 0, "PN6 repairIterations must be a measured non-negative integer");
          add(errors, typeof row.accepted === "boolean", "PN6 arm acceptance must be independently recorded");
        }
      }
    }
  }
  if (hypothesis === "PN8" && task?.workload?.evidenceKind === "live_repair") {
    add(errors, result.evidenceKind === "live_repair", "PN8 live_repair result.evidenceKind is required");
    add(errors, Array.isArray(result.repairSessions) && result.repairSessions.length === 2, "PN8 live_repair requires exactly two repairSessions");
    if (Array.isArray(result.repairSessions)) {
      const sessionIds = result.repairSessions.map((session) => session?.sessionId);
      const worktreeIds = result.repairSessions.map((session) => session?.worktreeId);
      const frozenDigests = result.repairSessions.map((session) => session?.frozenStateDigest);
      unique(errors, sessionIds, "PN8 repair session ids");
      unique(errors, worktreeIds, "PN8 repair worktree ids");
      add(errors, frozenDigests.length === 2 && frozenDigests.every((digestValue) => digestValue === frozenDigests[0]), "PN8 repair sessions must share one frozenStateDigest");
      for (const [index, session] of result.repairSessions.entries()) {
        const label = "repairSessions[" + index + "]";
        add(errors, isObject(session), label + " must be an object");
        if (!isObject(session)) continue;
        add(errors, ARM_IDS.includes(session.armId), label + ".armId must be control or treatment");
        string(errors, session.sessionId, label + ".sessionId");
        string(errors, session.worktreeId, label + ".worktreeId");
        digest(errors, session.frozenStateDigest, label + ".frozenStateDigest");
        add(errors, ["ordinary_log", "structured_feedback_packet"].includes(session.feedbackMode), label + ".feedbackMode is invalid");
        add(errors, Number.isInteger(session.attempts) && session.attempts >= 1, label + ".attempts must be a positive integer");
        add(errors, session.initialFailureObserved === true, label + ".initialFailureObserved must be true");
        add(errors, Array.isArray(session.repairPatchIds) && session.repairPatchIds.length > 0 && session.repairPatchIds.every((value) => typeof value === "string" && value.length > 0), label + ".repairPatchIds must contain a non-empty repair identity");
        string(errors, session.evaluatorEvidence, label + ".evaluatorEvidence");
        add(errors, typeof session.accepted === "boolean", label + ".accepted must be independently recorded");
        add(errors, session.priorPassesPreserved === true, label + ".priorPassesPreserved must be true");
        add(errors, session.regressions === 0, label + ".regressions must be zero");
        add(errors, session.falseAccepts === 0, label + ".falseAccepts must be zero");
      }
      add(errors, result.repairSessions.some((session) => session?.armId === "control" && session?.feedbackMode === "ordinary_log"), "PN8 control ordinary_log session is required");
      add(errors, result.repairSessions.some((session) => session?.armId === "treatment" && session?.feedbackMode === "structured_feedback_packet"), "PN8 treatment structured_feedback_packet session is required");
    }
  }
}

function validateMeasurement(errors, measurement, label, task, seen) {
  add(errors, isObject(measurement), `${label} must be an object`);
  if (!isObject(measurement)) return;
  string(errors, measurement.id, `${label}.id`);
  add(errors, ARM_IDS.includes(measurement.armId), `${label}.armId must be control or treatment`);
  add(errors, typeof measurement.value === "number" && Number.isFinite(measurement.value), `${label}.value must be a finite number`);
  if (measurement.unit !== undefined) string(errors, measurement.unit, `${label}.unit`);
  if (measurement.source !== undefined) string(errors, measurement.source, `${label}.source`);
  if (task && Array.isArray(task.metrics)) add(errors, task.metrics.some((metric) => metric?.id === measurement.id), `${label}.id must reference a task metric`);
  const key = `${measurement.armId}\0${measurement.id}`;
  if (seen.has(key)) add(errors, false, `${label} duplicates an arm/metric measurement`);
  seen.add(key);
}

export function validateObservedResult(result, task) {
  const errors = [];
  add(errors, isObject(result), "result must be an object");
  if (!isObject(result)) return { ok: false, errors };
  add(errors, result.schemaVersion === "2", "schemaVersion must be \"2\"");
  add(errors, result.recordType === "observed-result-v2", "recordType must be observed-result-v2");
  add(errors, typeof result.taskId === "string" && TASK_ID.test(result.taskId), "taskId must match OT-###");
  string(errors, result.taskDefinition, "taskDefinition");
  hash(errors, result.taskDefinitionCommit, "taskDefinitionCommit");
  add(errors, typeof result.runId === "string" && RUN_ID.test(result.runId), "runId has an invalid format");
  add(errors, ["COMPLETED", "FAILED", "CONTAMINATED", "INCONCLUSIVE"].includes(result.status), "status is invalid");
  hash(errors, result.baseCommit, "baseCommit");
  date(errors, result.runStartedAt, "runStartedAt");
  date(errors, result.runCompletedAt, "runCompletedAt");
  if (ISO_DATE(result.runStartedAt) && ISO_DATE(result.runCompletedAt)) add(errors, Date.parse(result.runCompletedAt) >= Date.parse(result.runStartedAt), "runCompletedAt must not precede runStartedAt");

  const taskValidation = task === undefined ? undefined : validateObservedTask(task);
  if (taskValidation && taskValidation.ok) {
    add(errors, result.taskId === task.taskId, "result.taskId must match task.taskId");
    add(errors, result.taskDefinition === task.taskDefinitionPath, "result.taskDefinition must match taskDefinitionPath");
    add(errors, result.taskDefinitionCommit === task.taskDefinitionCommit, "result.taskDefinitionCommit must match taskDefinitionCommit");
    add(errors, result.baseCommit === task.baseCommit, "result.baseCommit must match task.baseCommit");
    if (ISO_DATE(task.registeredAt) && ISO_DATE(result.runStartedAt)) add(errors, Date.parse(result.runStartedAt) >= Date.parse(task.registeredAt), "runStartedAt must be after task preregistration");
  }

  if (taskValidation?.ok) validateEvidenceShape(errors, result, task);

  const seen = { contaminated: false };
  add(errors, Array.isArray(result.arms) && result.arms.length === 2, "result.arms must contain exactly two arms");
  if (Array.isArray(result.arms)) {
    const armIds = result.arms.map((arm) => arm?.armId);
    const runIds = result.arms.map((arm) => arm?.runId);
    const sessionIds = result.arms.map((arm) => arm?.sessionId);
    const worktreeIds = result.arms.map((arm) => arm?.worktreeId);
    add(errors, ARM_IDS.every((id) => armIds.includes(id)), "result.arms must contain one control and one treatment");
    unique(errors, armIds, "arm ids");
    unique(errors, runIds, "arm run ids");
    unique(errors, sessionIds, "arm session ids");
    unique(errors, worktreeIds, "arm worktree ids");
    result.arms.forEach((arm, index) => validateArmResult(errors, arm, `arms[${index}]`, task ?? { baseCommit: result.baseCommit }, seen));
    if (task && taskValidation?.ok) {
      for (const arm of result.arms) {
        const expected = declaredCommands(task, arm?.armId);
        const observed = Array.isArray(arm?.commands) ? arm.commands : [];
        const expectedById = new Map(expected.map((command) => [command.id, command]));
        const observedIds = new Set();
        for (const command of observed) {
          add(errors, !observedIds.has(command?.id), `${arm?.armId ?? "arm"} contains duplicate command ${command?.id}`);
          observedIds.add(command?.id);
          const declaration = expectedById.get(command?.id);
          add(errors, declaration !== undefined, `${arm?.armId ?? "arm"} contains undeclared command ${command?.id}`);
          if (declaration !== undefined) {
            add(errors, JSON.stringify(command.argv) === JSON.stringify(declaration.argv), `${arm?.armId ?? "arm"} command ${command.id} argv differs from preregistration`);
            if (command.phase !== undefined) add(errors, command.phase === declaration.phase, `${arm?.armId ?? "arm"} command ${command.id} phase differs from preregistration`);
          }
        }
        for (const declaration of expected) add(errors, observedIds.has(declaration.id), `${arm?.armId ?? "arm"} is missing declared command ${declaration.id}`);
      }
    }
  }

  add(errors, isObject(result.adjudication), "adjudication must be an object");
  if (isObject(result.adjudication)) {
    add(errors, result.adjudication.independent === true, "result adjudication must be independent");
    string(errors, result.adjudication.evaluatorRunId, "adjudication.evaluatorRunId");
    add(errors, ![...(Array.isArray(result.arms) ? result.arms.map((arm) => arm?.runId) : []), ...(Array.isArray(result.arms) ? result.arms.map((arm) => arm?.sessionId) : [])].includes(result.adjudication.evaluatorRunId), "evaluatorRunId must be separate from arm run and session identities");
    date(errors, result.adjudication.recordedAt, "adjudication.recordedAt");
    add(errors, ["accepted", "rejected", "inconclusive"].includes(result.adjudication.outcome), "adjudication.outcome is invalid");
    add(errors, Array.isArray(result.adjudication.evidenceRefs) && result.adjudication.evidenceRefs.length > 0, "adjudication.evidenceRefs must not be empty");
  }
  if (result.measurements !== undefined) {
    add(errors, Array.isArray(result.measurements), "measurements must be an array");
    if (Array.isArray(result.measurements)) {
      const seenMeasurements = new Set();
      result.measurements.forEach((measurement, index) => validateMeasurement(errors, measurement, `measurements[${index}]`, task, seenMeasurements));
    }
  }
  if (seen.contaminated) add(errors, result.status === "CONTAMINATED", "a contaminated arm must make the result CONTAMINATED");
  return { ok: errors.length === 0, errors };
}

export function validateObservedPair(task, result) {
  const taskValidation = validateObservedTask(task);
  const resultValidation = validateObservedResult(result, task);
  return { ok: taskValidation.ok && resultValidation.ok, errors: [...taskValidation.errors, ...resultValidation.errors] };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task" || arg === "--result") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      values[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("node scripts/validate-observed-task-v2.mjs --task <task.json> --result <result.json>");
      return undefined;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!values.task || !values.result) throw new Error("--task and --result are required");
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args) return 0;
  const task = await readJson(args.task);
  const result = await readJson(args.result);
  const validation = validateObservedPair(task, result);
  console.log(JSON.stringify({ ok: validation.ok, task: args.task, result: args.result, errors: validation.errors }, null, 2));
  if (!validation.ok) process.exitCode = 1;
  return validation.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
