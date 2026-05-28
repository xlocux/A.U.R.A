"use strict";

function createStageContract({ stage, inputCount = 0, expectedArtifacts = [], aiAwareness = null } = {}) {
  return {
    stage,
    status: "running",
    inputCount: Number(inputCount || 0),
    outputCount: 0,
    outputRatio: 0,
    expectedArtifacts,
    artifacts: [],
    warnings: [],
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    aiAwareness: aiAwareness || `AI is watching ${stage} for missing evidence, partial output, parser drift, and blocked downstream phases.`
  };
}

function finishStageContract(contract, { outputCount = 0, artifacts = [], warnings = [], errors = [] } = {}) {
  const finished = {
    ...contract,
    outputCount: Number(outputCount || 0),
    artifacts: [...(contract.artifacts || []), ...artifacts].filter(Boolean),
    warnings: [...(contract.warnings || []), ...warnings].filter(Boolean),
    errors: [...(contract.errors || []), ...errors].filter(Boolean),
    finishedAt: new Date().toISOString()
  };
  finished.outputRatio = finished.inputCount > 0 ? Number((finished.outputCount / finished.inputCount).toFixed(4)) : 0;
  finished.status = classifyStageStatus(finished);
  return finished;
}

function classifyStageStatus(contract) {
  if (contract.errors?.length) return "failed";
  if (contract.inputCount > 0 && contract.outputCount === 0) return "degraded";
  if (contract.warnings?.length) return "degraded";
  return "completed";
}

function recordStageContract(store, runId, contract, { source = "stage-contract" } = {}) {
  const severity = contract.status === "completed" ? "ok" : contract.status === "running" ? "info" : "warn";
  store.appendEvent(runId, {
    phase: contract.stage,
    severity,
    source,
    message: `${contract.stage} ${contract.status}: ${contract.outputCount}/${contract.inputCount} outputs produced.`,
    payload: contract
  });
}

function appendAiStageInsight(store, runId, contract, insight = null) {
  const message = insight || buildDefaultInsight(contract);
  store.appendEvent(runId, {
    phase: "ai-stage-awareness",
    severity: contract.status === "completed" ? "ok" : "warn",
    source: "ai-stage-awareness",
    message,
    payload: { stage: contract.stage, status: contract.status, inputCount: contract.inputCount, outputCount: contract.outputCount, warnings: contract.warnings, errors: contract.errors }
  });
}

function buildDefaultInsight(contract) {
  if (contract.status === "completed") {
    return `AI stage awareness: ${contract.stage} produced evidence and downstream phases can continue.`;
  }
  if (contract.outputCount === 0 && contract.inputCount > 0) {
    return `AI stage awareness: ${contract.stage} produced no usable output from ${contract.inputCount} inputs. Downstream phases may be blocked; inspect raw artifacts, tool identity, batching, timeouts, and parser compatibility.`;
  }
  return `AI stage awareness: ${contract.stage} is degraded. A.U.R.A will preserve partial evidence and continue with safe downstream steps where possible.`;
}

module.exports = {
  appendAiStageInsight,
  createStageContract,
  finishStageContract,
  recordStageContract
};
