"use strict";

function classifyRecoveryNeed({ stage, inputCount = 0, outputCount = 0, toolResult = null, stderr = "", stdout = "", artifactCount = 0 } = {}) {
  const combined = [stderr, stdout, toolResult?.stderr, toolResult?.stdout, toolResult?.errorMessage].filter(Boolean).join("\n").slice(0, 30000);
  const status = toolResult?.status || "unknown";
  const reasons = [];
  if (status === "timeout" || status === "timed_out") reasons.push("tool_timeout");
  if (/command not found|not found|executable file not found|exit status 127/i.test(combined)) reasons.push("tool_missing_or_not_on_path");
  if (/invalid option|unknown shorthand|usage:/i.test(combined) && stage === "httpx") reasons.push("possible_httpx_identity_or_flag_mismatch");
  if (/chrome|chromium|browser|playwright|selenium|no usable sandbox|zygote/i.test(combined)) reasons.push("screenshot_browser_dependency");
  if (/permission denied|read-only file system|no such file or directory/i.test(combined)) reasons.push("artifact_filesystem_issue");
  if (inputCount > 0 && outputCount === 0) reasons.push("zero_parsed_output");
  if (artifactCount === 0 && stage === "screenshots" && inputCount > 0) reasons.push("missing_screenshot_artifacts");

  const severity = reasons.includes("tool_missing_or_not_on_path") || reasons.includes("possible_httpx_identity_or_flag_mismatch")
    ? "blocked"
    : reasons.length ? "degraded" : "healthy";

  return {
    stage,
    severity,
    reasons,
    recommendation: recommendationFor({ stage, severity, reasons, inputCount, outputCount }),
    aiAwareSummary: buildAiAwareSummary({ stage, severity, reasons, inputCount, outputCount })
  };
}

function recommendationFor({ stage, severity, reasons, inputCount, outputCount }) {
  if (severity === "healthy") return "No recovery action required.";
  if (reasons.includes("tool_missing_or_not_on_path")) return "Run Settings > Environment > Install/Update, then re-run environment check. Do not start full recon until the binary is visible on terminal PATH.";
  if (reasons.includes("possible_httpx_identity_or_flag_mismatch")) return "Verify the expected ProjectDiscovery httpx binary is installed. A different httpx binary can produce zero parsed services and block tech/screenshots.";
  if (reasons.includes("screenshot_browser_dependency")) return "Install Chromium/browser dependencies and re-run screenshot follow-up only; HTTP/tech evidence can remain preserved.";
  if (reasons.includes("artifact_filesystem_issue")) return "Check write permissions under data/recon-runs and preserve raw stdout/stderr before retrying.";
  if (reasons.includes("zero_parsed_output") && inputCount > 500) return "Retry with adaptive batching and lower concurrency. A single oversized process likely starved or timed out.";
  if (outputCount === 0) return `Inspect raw ${stage} artifacts and parser expectations before retrying downstream phases.`;
  return "Keep partial evidence, retry only the missing/degraded stage, and avoid repeating completed phases.";
}

function buildAiAwareSummary({ stage, severity, reasons, inputCount, outputCount }) {
  return `AI recovery classifier marked ${stage} as ${severity}: ${outputCount}/${inputCount} usable outputs. Reasons: ${reasons.length ? reasons.join(", ") : "none"}.`;
}

module.exports = {
  classifyRecoveryNeed
};
