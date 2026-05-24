"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { runCandidateCorrelation } = require("../src/recon/candidate-correlation");

test("candidate correlation summary includes techniques used as evidence", () => {
  const events = [];
  const saved = [];
  const store = {
    appendEvent(runId, event) {
      events.push({ runId, ...event });
    },
    saveAssetLeads(runId, targetName, leads) {
      saved.push({ runId, targetName, leads });
      return leads.length;
    }
  };

  const result = runCandidateCorrelation({
    store,
    runId: 42,
    targetName: "example",
    rootDomains: ["example.com"],
    leads: [{
      value: "candidate.test",
      source: "whoisxmlapi",
      matchTerms: ["example"],
      metadata: { nameserverOverlap: true }
    }]
  });

  assert.equal(result.length, 1);
  const summary = events.find((event) => event.payload?.stage === "summary");
  assert.ok(summary);
  assert.deepEqual(summary.payload.best[0].techniques, ["whois_rdap_overlap", "nameserver_correlation"]);
  assert.equal(saved[0].leads[0].metadata.correlationTechniques.includes("whois_rdap_overlap"), true);
});
