"use strict";

const { normalizeDomain, rootForDomain } = require("./domain-utils");

const CORRELATION_TECHNIQUES = [
  {
    id: "whois_rdap_overlap",
    label: "WHOIS/RDAP overlap",
    description: "same organization, registrant, abuse/contact email, registrar account, nameserver, or date pattern"
  },
  {
    id: "nameserver_correlation",
    label: "Nameserver correlation",
    description: "same custom nameserver or same DNS cluster used by the target"
  },
  {
    id: "mx_spf_dmarc_correlation",
    label: "MX/SPF/DMARC correlation",
    description: "same mail providers, SPF includes, DMARC policy, or recurring corporate email domains"
  },
  {
    id: "certificate_correlation",
    label: "Certificate correlation",
    description: "shared SANs, certificate organization, issuer/timing pattern, or CT log evidence"
  },
  {
    id: "tracking_identifier_correlation",
    label: "Analytics/pixel IDs",
    description: "shared Google Analytics, GTM, Meta Pixel, Hotjar, Segment, Plausible, or similar tracking identifiers"
  },
  {
    id: "favicon_hash_correlation",
    label: "Favicon hash",
    description: "same favicon hash or Shodan/Censys favicon pivot evidence"
  },
  {
    id: "http_fingerprint_correlation",
    label: "HTTP fingerprint",
    description: "same title, headers, redirect chain, body hash, or response similarity"
  },
  {
    id: "technology_stack_similarity",
    label: "Technology stack similarity",
    description: "same CMS, CDN, framework, WAF, cookie names, or version patterns"
  },
  {
    id: "brand_string_matching",
    label: "Brand/string matching",
    description: "brand, product, acquisition, legacy, or campaign naming overlap"
  },
  {
    id: "asn_ip_passive_dns",
    label: "ASN/IP/passive DNS",
    description: "historical IP, origin, reverse IP, shared certificate/IP, or netblock evidence"
  },
  {
    id: "csp_header_intelligence",
    label: "CSP/header intelligence",
    description: "connect-src, script-src, img-src, frame-src, report-uri, or security header references"
  },
  {
    id: "javascript_reference_correlation",
    label: "JavaScript references",
    description: "domains, endpoints, API hosts, workspace IDs, account IDs, or config objects in JS"
  },
  {
    id: "app_association_files",
    label: "App association files",
    description: "assetlinks.json, apple-app-site-association, app IDs, or mobile bundle identifiers"
  },
  {
    id: "code_search_correlation",
    label: "GitHub/code search",
    description: "domain references in repos, orgs, files, API collections, or public source metadata"
  },
  {
    id: "archive_crawl_correlation",
    label: "Wayback/Common Crawl",
    description: "historical cross-domain links, redirects, legacy assets, parameters, or archived app surfaces"
  }
];

function runCandidateCorrelation({ store, runId, targetName, rootDomains, leads }) {
  const normalizedRoots = rootDomains.map(normalizeDomain).filter(Boolean);
  const candidateLeads = (leads || []).filter((lead) => normalizeDomain(lead.value || lead.domain));
  if (candidateLeads.length === 0) {
    appendAiLog(store, runId, "No candidate domains are available for correlation scoring yet.", { stage: "empty" });
    return [];
  }

  appendAiLog(store, runId, `Starting candidate correlation for ${candidateLeads.length} review leads. I will not scan or promote unknown-scope candidates automatically.`, {
    stage: "start",
    candidateCount: candidateLeads.length
  });
  for (const technique of CORRELATION_TECHNIQUES) {
    appendAiLog(store, runId, `I will use ${technique.label}: ${technique.description}.`, {
      stage: "technique",
      technique: technique.id
    });
  }

  const scored = candidateLeads.map((lead) => scoreCandidate({ lead, rootDomains: normalizedRoots }));
  const rescoredLeads = scored.map((item) => ({
    ...item.lead,
    confidence: confidenceForScore(item.score),
    status: item.score >= 80 ? "best_candidate" : item.score >= 50 ? "review" : "weak_lead",
    metadata: {
      ...(item.lead.metadata || {}),
      correlationScore: item.score,
      correlationRationale: item.rationale,
      correlationTechniques: item.techniques,
      recommendedAction: actionForScore(item.score)
    }
  }));
  store.saveAssetLeads(runId, targetName, rescoredLeads);

  const reviewable = scored.filter((item) => item.score >= 50).sort((a, b) => b.score - a.score);
  if (reviewable.length === 0) {
    appendAiLog(store, runId, "Correlation complete: no strong candidates found. Keep these as leads, but do not spend scan time on them yet.", {
      stage: "summary",
      bestCount: 0
    });
  } else {
    appendAiLog(store, runId, `Correlation complete: ${reviewable.length} candidates look worth review. They are all saved and filterable in Discovery Leads and Results Explorer.`, {
      stage: "summary",
      best: reviewable.map((item) => ({ domain: item.domain, score: item.score, rationale: item.rationale }))
    });
  }
  return rescoredLeads;
}

function scoreCandidate({ lead, rootDomains }) {
  const domain = normalizeDomain(lead.value || lead.domain);
  const rootMatch = rootForDomain(domain, rootDomains);
  const metadata = lead.metadata || {};
  const techniques = [];
  const rationale = [];
  let score = 0;

  if (rootMatch) {
    score += 100;
    techniques.push("scope_match");
    rationale.push(`matches authorized root ${rootMatch}`);
  }

  if (lead.source === "rdap-associated-domain") {
    score += 75;
    techniques.push("whois_rdap_overlap");
    rationale.push("public RDAP associated domain evidence");
  }

  if (lead.source === "whoisxmlapi") {
    score += 55;
    techniques.push("whois_rdap_overlap");
    rationale.push("Reverse WHOIS provider returned this domain for target terms");
  }

  if (lead.source === "alternate-tld-correlation") {
    score += 25;
    techniques.push("brand_string_matching");
    rationale.push("same registrable label on another TLD");
  }

  const matchTerms = lead.matchTerms || [];
  if (matchTerms.length > 0) {
    score += Math.min(20, matchTerms.length * 5);
    rationale.push(`matched terms: ${matchTerms.join(", ")}`);
  }

  if (metadata.nameserverOverlap) {
    score += 25;
    techniques.push("nameserver_correlation");
    rationale.push("nameserver overlap");
  }
  if (metadata.mailProviderOverlap) {
    score += 20;
    techniques.push("mx_spf_dmarc_correlation");
    rationale.push("mail provider overlap");
  }
  if (metadata.certificateOverlap) {
    score += 30;
    techniques.push("certificate_correlation");
    rationale.push("certificate overlap");
  }
  if (metadata.trackingIdentifierOverlap) {
    score += 30;
    techniques.push("tracking_identifier_correlation");
    rationale.push("analytics or pixel identifier overlap");
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    lead,
    domain,
    score: boundedScore,
    techniques: [...new Set(techniques)],
    rationale: rationale.length ? rationale : ["no strong correlation evidence yet"]
  };
}

function confidenceForScore(score) {
  if (score >= 80) return "strong_candidate";
  if (score >= 50) return "review_candidate";
  if (score >= 20) return "weak_candidate";
  return "low_signal";
}

function actionForScore(score) {
  if (score >= 80) return "Ask the user to confirm scope before adding this candidate to authorized seeds.";
  if (score >= 50) return "Collect more passive evidence before considering active scanning.";
  if (score >= 20) return "Keep as a low-priority lead.";
  return "Do not scan unless new evidence appears.";
}

function appendAiLog(store, runId, message, payload = {}) {
  store.appendEvent(runId, {
    phase: "ai-correlation",
    severity: payload.stage === "summary" ? "ok" : "info",
    source: "ai-correlation",
    message,
    payload
  });
}

module.exports = {
  CORRELATION_TECHNIQUES,
  runCandidateCorrelation,
  scoreCandidate
};
