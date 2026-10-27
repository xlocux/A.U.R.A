"use strict";

// Remembers the sub-section you were on (Settings, Logs, Topology, Results and its Assets tables), so a page
// refresh brings you back to it instead of the first entry. The main tab is already restored by app.js.
// Each group is restored once per page load, the first time its tab is on screen (some button rows are injected
// late, so it waits for them). If something already picked another entry before that (a link that opens a
// specific section), that choice wins. After that, every change of the active entry is saved, whoever made it.
(function initSubtabMemory() {
  const KEY = "aura.subtabs";
  const GROUPS = [
    { id: "settings", tab: "settings", buttons: "#tab-settings .settings-tab[data-settings-panel]", value: (b) => b.dataset.settingsPanel, sidebar: "#settingsSubmenu" },
    { id: "logs", tab: "logs", buttons: "#tab-logs [data-log-subtab]", value: (b) => b.dataset.logSubtab, sidebar: "#logsSubmenu" },
    { id: "topology", tab: "topology", buttons: "#tab-topology .topology-view-tabs [data-topology-view]", value: (b) => b.dataset.topologyView, sidebar: "#topologySubmenu" },
    { id: "results", tab: "results", buttons: ".result-subtab[data-results-view]", value: (b) => b.dataset.resultsView },
    { id: "assets", tab: "results", buttons: ".assets-tab[data-asset]", value: (b) => b.dataset.asset }
  ];
  const ALL = GROUPS.map((g) => g.buttons).join(", ");
  const state = new Map(GROUPS.map((g) => [g.id, { restored: false, initial: undefined }]));

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const write = (id, value) => { const saved = read(); if (saved[id] === value) return; saved[id] = value; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage unavailable */ } };
  const buttons = (g) => [...document.querySelectorAll(g.buttons)];
  const activeValue = (g) => { const b = buttons(g).find((x) => x.classList.contains("active")); return b ? g.value(b) : undefined; };
  const tabShown = (g) => Boolean(document.getElementById(`tab-${g.tab}`)?.classList.contains("active"));
  function syncSidebar(g, value) {
    if (!g.sidebar) return;
    document.querySelectorAll(`${g.sidebar} .nav-subitem`).forEach((item) => item.classList.toggle("active", item.dataset.submenuValue === value));
  }

  function tryRestore(g) {
    const st = state.get(g.id);
    if (st.restored) return;
    const list = buttons(g);
    if (!list.length) return; // not built yet
    if (st.initial === undefined) st.initial = activeValue(g) ?? null;
    if (!tabShown(g)) return;
    st.restored = true;
    const current = activeValue(g) ?? null;
    if (current !== st.initial) return; // someone already opened a specific entry
    const wanted = read()[g.id];
    const button = wanted && list.find((b) => g.value(b) === wanted);
    if (!button || button.classList.contains("active")) return;
    button.click();
    syncSidebar(g, wanted);
  }
  const pending = () => GROUPS.some((g) => !state.get(g.id).restored);
  const restoreAll = () => GROUPS.forEach(tryRestore);

  // One observer does both jobs: it saves the entry that becomes active, and notices tabs/buttons appearing.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const el = record.target;
      if (record.type !== "attributes" || !el.matches || !el.classList.contains("active") || !el.matches(ALL)) continue;
      for (const g of GROUPS) {
        if (!el.matches(g.buttons)) continue;
        const st = state.get(g.id);
        if (st.restored) write(g.id, g.value(el));
        else if (st.initial === undefined) st.initial = null; // changed before we first saw it: treat as a choice
      }
    }
    // only a tab switch or new nodes can make a pending group restorable
    if (pending() && records.some((r) => r.type === "childList" || r.target.classList?.contains("tab-panel"))) restoreAll();
  });

  function boot() {
    for (const g of GROUPS) { const list = buttons(g); if (list.length) state.get(g.id).initial = activeValue(g) ?? null; }
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });
    restoreAll();
    // late layouts (Logs, Topology, the Security entry) are injected after boot
    setTimeout(restoreAll, 800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
