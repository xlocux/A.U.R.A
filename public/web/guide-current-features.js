"use strict";

(function initAuraGuideCurrentFeatures() {
  function boot() {
    const panel = document.getElementById("tab-guide");
    if (!panel || document.getElementById("guideCurrentFeatures")) return;
    const section = document.createElement("div");
    section.id = "guideCurrentFeatures";
    section.className = "pane guide-deep-section";
    section.innerHTML = `
      <h2>Current UI, security, and analytics updates</h2>
      <div class="guide-deep-grid">
        <article class="guide-deep-card"><div class="guide-deep-head"><strong>Login persistence</strong><em>security</em></div><p>A.U.R.A keeps the browser session with a persistent HttpOnly SameSite=Lax cookie. Raw session values are not stored in localStorage. Legacy localStorage auth tokens are removed on page load.</p></article>
        <article class="guide-deep-card"><div class="guide-deep-head"><strong>Settings &gt; Security</strong><em>settings</em></div><p>Use Security to change the local username/password and review last login metadata. The header profile opens a dropdown menu, and Logout is available inside that menu. Passwords are salted PBKDF2 hashes in SQLite.</p></article>
        <article class="guide-deep-card"><div class="guide-deep-head"><strong>Settings &gt; Storage</strong><em>storage</em></div><p>Storage documents local paths for the SQLite DB, run artifacts, generated wordlists, and target configs. Backup, cleanup, pruning, and vacuum actions belong here next.</p></article>
        <article class="guide-deep-card"><div class="guide-deep-head"><strong>Topology charts</strong><em>analytics</em></div><p>Topology has Graph, Dashboard, Sources, and Technologies views. Dashboard/Sources/Technologies read run endpoints and flatten the result tree so charts remain populated even when the graph uses nested nodes.</p></article>
        <article class="guide-deep-card"><div class="guide-deep-head"><strong>Topology fullscreen</strong><em>workflow</em></div><p>Use Fullscreen in Graph view when the relationship map is too small. Escape or Close returns to normal layout.</p></article>
        <article class="guide-deep-card"><div class="guide-deep-head"><strong>Unified Logs</strong><em>workflow</em></div><p>AI Log and Runs & Logs are grouped into Logs with Timeline, Run Events, Tool Results, AI Decisions, Correlation, and Warnings & Errors views. These views stay inside Logs instead of redirecting to Results.</p></article>
        <article class="guide-deep-card"><div class="guide-deep-head"><strong>TLD correlation</strong><em>scope</em></div><p>Alternate TLD candidates are scored deterministically from CT, DNS, WHOIS/RDAP, IP/CIDR, favicon, nameserver, and SAN evidence. Only 100% confidence is auto-promoted; 60-99% stays reviewable with reasoning in Results and AI Log.</p></article>
      </div>
    `;
    panel.appendChild(section);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();