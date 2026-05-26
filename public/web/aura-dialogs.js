"use strict";

(function initAuraDialogs() {
  const ICONS = {
    confirm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg>',
    danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>'
  };

  function ensureDialog() {
    let modal = document.getElementById("auraDialogModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "auraDialogModal";
    modal.className = "aura-dialog-modal hidden";
    modal.innerHTML = `
      <div class="aura-dialog" role="dialog" aria-modal="true" aria-labelledby="auraDialogTitle" aria-describedby="auraDialogMessage">
        <div class="aura-dialog-icon" id="auraDialogIcon"></div>
        <div class="aura-dialog-content">
          <h3 id="auraDialogTitle">Confirm action</h3>
          <p id="auraDialogMessage"></p>
        </div>
        <div class="aura-dialog-actions">
          <button id="auraDialogCancel" type="button" class="aura-dialog-secondary">Cancel</button>
          <button id="auraDialogConfirm" type="button" class="aura-dialog-primary">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function open(options = {}) {
    const modal = ensureDialog();
    const tone = options.tone || "confirm";
    const title = options.title || (tone === "danger" ? "Confirm destructive action" : "Confirm action");
    const confirmLabel = options.confirmLabel || "Confirm";
    const cancelLabel = options.cancelLabel || "Cancel";
    const showCancel = options.showCancel !== false;
    const dialog = modal.querySelector(".aura-dialog");
    const confirm = modal.querySelector("#auraDialogConfirm");
    const cancel = modal.querySelector("#auraDialogCancel");
    modal.querySelector("#auraDialogIcon").innerHTML = ICONS[tone] || ICONS.confirm;
    modal.querySelector("#auraDialogTitle").textContent = title;
    modal.querySelector("#auraDialogMessage").textContent = options.message || "";
    modal.dataset.tone = tone;
    confirm.textContent = confirmLabel;
    confirm.classList.toggle("danger-button", tone === "danger");
    cancel.textContent = cancelLabel;
    cancel.hidden = !showCancel;
    modal.classList.remove("hidden");
    confirm.focus({ preventScroll: true });

    return new Promise((resolve) => {
      function close(result) {
        modal.classList.add("hidden");
        modal.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKeydown);
        confirm.removeEventListener("click", onConfirm);
        cancel.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onConfirm() { close(true); }
      function onCancel() { close(false); }
      function onClick(event) { if (event.target === modal) close(false); }
      function onKeydown(event) {
        if (event.key === "Escape") close(false);
        if (event.key === "Tab") {
          const focusables = [...dialog.querySelectorAll("button:not([hidden])")];
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      modal.addEventListener("click", onClick);
      document.addEventListener("keydown", onKeydown);
      confirm.addEventListener("click", onConfirm);
      cancel.addEventListener("click", onCancel);
    });
  }

  window.AuraDialogs = {
    confirm: (options) => open({ ...options, showCancel: true }),
    alert: (options) => open({ ...options, showCancel: false, confirmLabel: options?.confirmLabel || "OK", tone: options?.tone || "info" })
  };
})();
