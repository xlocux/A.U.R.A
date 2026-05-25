"use strict";

(function initAuraWordlistMetadata() {
  const metadataCache = new Map();

  function boot() {
    const rows = document.getElementById("wordlistRows");
    if (!rows) return;
    ensureHeader();
    injectCategoryHelp();
    injectStyles();
    enhanceRows();
    new MutationObserver(() => {
      ensureHeader();
      enhanceRows();
    }).observe(rows, { childList: true });
  }

  function ensureHeader() {
    const rows = document.getElementById("wordlistRows");
    const header = rows?.closest("table")?.querySelector("thead tr");
    if (!header || header.dataset.wordlistMetadataHeader === "true") return;
    const cells = [...header.children];
    const pathCell = cells.find((cell) => cell.textContent.trim().toLowerCase() === "path");
    if (!pathCell) return;
    pathCell.insertAdjacentHTML("beforebegin", "<th>Size</th><th>Lines</th>");
    header.dataset.wordlistMetadataHeader = "true";
  }

  function enhanceRows() {
    document.querySelectorAll("#wordlistRows tr").forEach((row) => {
      if (row.dataset.wordlistMetadataRow === "true") return;
      const button = row.querySelector("[data-wordlist-preview]");
      const id = button?.dataset.wordlistPreview;
      if (!id) return;
      const cells = [...row.children];
      const pathCell = cells[3];
      if (!pathCell) return;
      pathCell.insertAdjacentHTML("beforebegin", `<td class="wordlist-size" data-wordlist-size="${escapeHtml(id)}">…</td><td class="wordlist-lines" data-wordlist-lines="${escapeHtml(id)}">…</td>`);
      row.dataset.wordlistMetadataRow = "true";
      loadMetadata(id, row).catch(() => updateMetadataCells(row, { available: false }));
    });
  }

  async function loadMetadata(id, row) {
    if (!metadataCache.has(id)) {
      metadataCache.set(id, fetch(`/api/wordlists/${encodeURIComponent(id)}/metadata`).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Metadata unavailable");
        return data.metadata || {};
      }));
    }
    updateMetadataCells(row, await metadataCache.get(id));
  }

  function updateMetadataCells(row, metadata) {
    const size = row.querySelector(".wordlist-size");
    const lines = row.querySelector(".wordlist-lines");
    if (!size || !lines) return;
    if (!metadata.available) {
      size.textContent = "missing";
      lines.textContent = "-";
      size.classList.add("muted");
      lines.classList.add("muted");
      return;
    }
    size.textContent = formatBytes(metadata.sizeBytes || 0);
    lines.textContent = formatCount(metadata.lineCount || 0);
  }

  function injectCategoryHelp() {
    const panel = document.getElementById("tab-wordlists");
    if (!panel || document.getElementById("wordlistCategoryHelp")) return;
    const generatePane = [...panel.querySelectorAll(".pane")].find((pane) => /generate from db/i.test(pane.querySelector("h2")?.textContent || ""));
    const help = document.createElement("div");
    help.id = "wordlistCategoryHelp";
    help.className = "notice muted compact-notice wordlist-category-help";
    help.innerHTML = [
      "<strong>Category guide:</strong>",
      "<b>domains</b> = raw domain/subdomain names for DNS tools and generic discovery.",
      "<b>smart-domains</b> = target-aware domain words derived from observed assets, brand terms, technologies, and stored recon evidence.",
      "Use the active target to build a target-specific wordlist; clear/select no target only when you intentionally want a global DB-derived list."
    ].join(" ");
    if (generatePane) generatePane.appendChild(help);
    else panel.insertBefore(help, panel.firstChild);
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    const units = ["B", "KB", "MB", "GB"];
    let amount = bytes;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024;
      index += 1;
    }
    return `${amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
  }

  function formatCount(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

  function injectStyles() {
    if (document.getElementById("aura-wordlist-metadata-style")) return;
    const style = document.createElement("style");
    style.id = "aura-wordlist-metadata-style";
    style.textContent = `
      #tab-wordlists .row-actions {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: nowrap;
        white-space: nowrap;
      }
      #tab-wordlists .row-actions button {
        margin: 0;
      }
      #tab-wordlists .wordlist-size,
      #tab-wordlists .wordlist-lines {
        white-space: nowrap;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      #tab-wordlists table {
        min-width: 1060px;
      }
      #tab-wordlists th:nth-child(4),
      #tab-wordlists td:nth-child(4),
      #tab-wordlists th:nth-child(5),
      #tab-wordlists td:nth-child(5) {
        width: 90px;
      }
      #tab-wordlists th:nth-child(6),
      #tab-wordlists td:nth-child(6) {
        width: auto;
      }
      #tab-wordlists th:nth-child(7),
      #tab-wordlists td:nth-child(7) {
        width: 210px;
      }
      .wordlist-category-help {
        margin-top: 9px;
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
