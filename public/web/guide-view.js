"use strict";

(function initAuraGuideView() {
  const GUIDE_CONTEXT = [
    "A.U.R.A is a local-first recon workbench for authorized bug bounty and security research scopes.",
    "Core workflow: define target and scope, confirm authorization, collect passive signals, run controlled local tools, save raw artifacts, parse normalized observations, review deltas, then plan focused follow-ups.",
    "Passive sources include crt.sh, Wayback CDX, RapidDNS, Rapid7 FDNS, and configured provider APIs such as Censys, Shodan, VirusTotal, urlscan, SecurityTrails, Cert Spotter, BinaryEdge, Hunter.io, PassiveTotal, ZoomEye, Spyse, and Intelligence X.",
    "WSL tools include subfinder for subdomain discovery, dnsx and puredns for DNS validation, gau for archived URL mining, httpx for HTTP status, title, technology, and selected port probing, plus screenshot tools for visual triage.",
    "URL mining filters static assets from parsed observations while preserving raw tool artifacts. Default excluded path extensions are jpg, jpeg, gif, css, tif, tiff, png, ttf, woff, woff2, ico, pdf, svg, and txt.",
    "httpx probes the configured default ports, including 80, 443, 8009, 8080, 8081, 8090, 8180, 8443, 27000, 27001, 5000, 5001, 9001, 81, 9443, 25, and 23.",
    "AI assistance should explain evidence, summarize run status, suggest safe next steps, and avoid out-of-scope, destructive, credential replay, or unconfirmed active testing."
  ].join("\n");

  function boot() {
    injectStyles();
    injectTab();
    injectPanel();
    bindGuideActions();
  }

  function injectTab() {
    const tabs = document.querySelector(".tabs");
    if (!tabs || document.querySelector('[data-tab="guide"]')) return;
    const button = document.createElement("button");
    button.className = "tab";
    button.dataset.tab = "guide";
    button.type = "button";
    button.textContent = "Guide";
    const settings = tabs.querySelector('[data-tab="settings"]');
    tabs.insertBefore(button, settings || null);
    button.addEventListener("click", () => activateGuideTab());
  }

  function injectPanel() {
    const main = document.querySelector(".workspace-main");
    if (!main || document.getElementById("tab-guide")) return;
    const section = document.createElement("section");
    section.id = "tab-guide";
    section.className = "tab-panel guide-panel";
    section.innerHTML = guideHtml();
    main.appendChild(section);
  }

  function activateGuideTab() {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "guide"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "tab-guide"));
  }

  function bindGuideActions() {
    document.querySelectorAll("[data-guide-ai]").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => {
        const question = button.dataset.guideAi;
        const prompt = document.getElementById("aiPrompt");
        if (prompt) {
          prompt.value = question;
          prompt.focus();
        }
        window.AuraAiAgent?.appendMessage?.("assistant insight", `Guide prompt ready: ${question}`);
      });
    });
  }

  function guideHtml() {
    return `
      <div class="guide-hero pane">
        <div>
          <span class="eyebrow">A.U.R.A Guide</span>
          <h2>How A.U.R.A works</h2>
          <p>A.U.R.A is a local-first recon workbench for authorized bug bounty and security research. It helps you collect evidence, preserve raw artifacts, normalize observations, compare runs, and decide the smallest safe next step.</p>
        </div>
        <div class="guide-hero-actions">
          <button type="button" data-guide-ai="Explain the current A.U.R.A workflow and tell me where I should start.">Ask AI: where to start</button>
          <button type="button" data-guide-ai="Explain the safest next recon step for the currently loaded target and run.">Ask AI: next step</button>
        </div>
      </div>
      <div class="guide-grid">
        <article class="pane guide-card">
          <h2>1. Target and scope</h2>
          <p>Create a target with in-scope and out-of-scope domains or URLs. A.U.R.A treats scope as a control boundary: unknown assets become review leads, not automatic scan targets.</p>
          <ul>
            <li>Use exact domains, wildcards, and program URLs.</li>
            <li>Keep exclusions explicit.</li>
            <li>Confirm authorization before active recon.</li>
          </ul>
        </article>
        <article class="pane guide-card">
          <h2>2. Passive discovery</h2>
          <p>Passive sources expand known surface without direct probing. A.U.R.A can query public sources and optional API providers, then save domains with provider metadata.</p>
          <ul>
            <li>crt.sh and Wayback CDX for public historical signals.</li>
            <li>RapidDNS and Rapid7 FDNS for DNS intelligence.</li>
            <li>Provider APIs for certificate, DNS, host, and URL intelligence.</li>
          </ul>
        </article>
        <article class="pane guide-card">
          <h2>3. Local tool phase</h2>
          <p>WSL/Kali tools run locally and produce raw stdout/stderr artifacts before parsers extract normalized data.</p>
          <ul>
            <li>subfinder discovers subdomains.</li>
            <li>dnsx and puredns validate DNS records.</li>
            <li>gau mines archived URLs and parameters.</li>
            <li>httpx probes HTTP services, titles, technologies, and selected ports.</li>
          </ul>
        </article>
        <article class="pane guide-card">
          <h2>4. URL and parameter mining</h2>
          <p>Archived URL mining is useful for endpoints, old paths, parameters, and forgotten surfaces. Parsed URL observations exclude static path extensions by default.</p>
          <code>jpg jpeg gif css tif tiff png ttf woff woff2 ico pdf svg txt</code>
          <p>Raw outputs remain available in tool artifacts so nothing is lost.</p>
        </article>
        <article class="pane guide-card">
          <h2>5. HTTP and technology enrichment</h2>
          <p>httpx checks common web and service ports, then A.U.R.A groups live services by status, title, technology, host, and scheme.</p>
          <code>80,443,8009,8080,8081,8090,8180,8443,27000,27001,5000,5001,9001,81,9443,25,23</code>
          <p>Technology results help prioritize targeted, user-confirmed follow-up.</p>
        </article>
        <article class="pane guide-card">
          <h2>6. Screenshots and visual triage</h2>
          <p>Screenshot tools capture visual evidence for live HTTP services. Use this to spot login panels, admin portals, old branding, error pages, and unusual applications.</p>
          <ul>
            <li>gowitness is the default screenshot path.</li>
            <li>Aquatone and EyeWitness can be enabled when installed.</li>
            <li>Screenshots are grouped by run and tool.</li>
          </ul>
        </article>
        <article class="pane guide-card">
          <h2>7. Results, deltas, and search</h2>
          <p>Results Explorer joins domains, services, URLs, screenshots, technologies, and candidates. Delta view shows what changed compared with the previous run.</p>
          <ul>
            <li>Prioritize new domains and new services first.</li>
            <li>Use Search to pivot by technology, path, title, or keyword.</li>
            <li>Export filtered views for Burp, Caido, Nuclei, CSV, JSON, or Markdown workflows.</li>
          </ul>
        </article>
        <article class="pane guide-card">
          <h2>8. AI assistant behavior</h2>
          <p>The AI assistant is guide-aware. It should explain what each phase does, summarize run status, identify missing tools, and propose safe next steps based on stored evidence.</p>
          <ul>
            <li>It should not invent target-specific facts.</li>
            <li>It should ask for confirmation before active follow-up.</li>
            <li>It should avoid destructive, credential replay, or out-of-scope activity.</li>
          </ul>
          <button type="button" data-guide-ai="Using the Guide and current run context, summarize what A.U.R.A has collected and recommend one safe next action.">Ask AI to summarize this run</button>
        </article>
      </div>
    `;
  }

  function injectStyles() {
    if (document.getElementById("aura-guide-style")) return;
    const style = document.createElement("style");
    style.id = "aura-guide-style";
    style.textContent = `
      .guide-panel { display: none; }
      .guide-panel.active { display: block; }
      .guide-hero { display: flex; justify-content: space-between; gap: 18px; padding: 18px; margin-bottom: 12px; }
      .guide-hero h2 { padding: 0; border: 0; font-size: 24px; }
      .guide-hero p { max-width: 860px; color: var(--muted); line-height: 1.55; }
      .guide-hero-actions { display: grid; gap: 8px; align-content: start; min-width: 210px; }
      .guide-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .guide-card { padding: 14px; }
      .guide-card h2 { padding: 0 0 8px; margin: 0 0 8px; }
      .guide-card p, .guide-card li { color: var(--muted); line-height: 1.45; }
      .guide-card ul { margin: 8px 0 0; padding-left: 18px; }
      .guide-card code { display: block; margin: 8px 0; padding: 8px; border: 1px solid var(--line); border-radius: 7px; color: var(--accent-2); background: rgba(8, 10, 14, .52); overflow-wrap: anywhere; }
      .eyebrow { display: inline-block; color: var(--accent-2); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
      @media (max-width: 900px) { .guide-hero, .guide-grid { grid-template-columns: 1fr; display: grid; } }
    `;
    document.head.appendChild(style);
  }

  window.AuraGuide = {
    agentContext: () => GUIDE_CONTEXT,
    activate: activateGuideTab
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
