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

test("candidate correlation auto-promotes TLD candidates at 100 percent only", () => {
  const savedDomains = [];
  const store = {
    appendEvent() {},
    saveAssetLeads() {},
    saveDomains(runId, targetName, domains) {
      savedDomains.push({ runId, targetName, domains });
      return domains.length;
    },
    listDomains() { return []; },
    listHttpServices() { return []; },
    listAssetLeads() { return []; }
  };
  const result = runCandidateCorrelation({
    store,
    runId: 7,
    targetName: "acme",
    rootDomains: ["acme.com"],
    existingObservations: [
      { id: "domain:api.acme.com", type: "domain", value: "api.acme.com" },
      { id: "ip:10.20.30.40", type: "ip_address", value: "10.20.30.40", registrable_label: "acme" },
      { id: "ns:acme", type: "dns_record", record_type: "NS", value: ["ns1.acme.com"], registrable_label: "acme" }
    ],
    leads: [{
      value: "acme.io",
      source: "alternate-tld-correlation",
      metadata: {
        sourceTools: ["crt_sh"],
        certificateSans: ["api.acme.com"],
        hasDnsResolution: true,
        dnsRecords: { a_record: "10.20.30.40" },
        nameservers: ["ns1.acme.com"]
      }
    }]
  });
  assert.equal(result[0].status, "auto_promoted");
  assert.equal(result[0].metadata.correlationEngineResult.confidence_score, 100);
  assert.equal(savedDomains[0].domains[0].kind, "promoted_asset");
});

test("TLD candidates do not corroborate themselves from their own lead metadata", () => {
  const { buildExistingObservations, buildTldCandidateFromLead, calculateTLDConfidence } = require("../src/recon/tld-correlation-engine");
  const lead = {
    value: "acme.io",
    metadata: { sourceTools: ["crt_sh"], certificateSans: ["acme.io"], aRecord: "203.0.113.7", organization: "Third Party Ltd" }
  };
  const observations = buildExistingObservations({ rootDomains: ["acme.com"], assetLeads: [lead] });
  const result = calculateTLDConfidence(buildTldCandidateFromLead(lead), observations);
  assert.ok(result.confidence_score < 100, `self-referential evidence must not reach 100 (got ${result.confidence_score})`);
  assert.notEqual(result.promotion_eligible, true);
});
