"use strict";

(function (root) {
  const manager = root.ZoidiumPluginManagerInternals;
  function mountCommunityPanel(panel, registry) {
    const section = document.createElement("details");
    section.className = "zoidium-plugin-category zoidium-community-section";
    section.open = true;
    section.innerHTML = `<summary><span class="zoidium-plugin-category-heading"><span class="zoidium-plugin-category-name">Community</span></span></summary>
      <div class="zoidium-plugin-category-description">Local packages run in an isolated runtime with no network access. Activation is unavailable until rendering support lands.</div>
      <div class="zp-detail-content"><button type="button" data-community-import>Import plugin</button>
      <input type="file" accept=".json,application/json" aria-label="Choose a local community plugin" hidden>
      <button type="button" data-community-refresh>Refresh</button>
      <p class="zoidium-plugin-meta" role="status" aria-live="polite"></p></div>
      <div class="zoidium-plugin-category-list"></div>`;
    panel.appendChild(section);
    const input = section.querySelector("input"), importButton = section.querySelector("[data-community-import]");
    const refreshButton = section.querySelector("[data-community-refresh]");
    const status = section.querySelector('[role="status"]'), list = section.querySelector(".zoidium-plugin-category-list");
    let store, state, busy = false;
    function buttonsDisabled(disabled) {
      section.querySelectorAll("button").forEach(button => { button.disabled = disabled; });
    }
    async function run(action) {
      if (busy) return;
      busy = true; buttonsDisabled(true);
      try { state = await action(); render(); }
      catch (error) { status.textContent = error.message || "Community storage is unavailable."; }
      finally { busy = false; buttonsDisabled(!store); }
    }
    function button(parent, label, action) {
      const element = document.createElement("button"); element.type = "button"; element.textContent = label;
      element.addEventListener("click", () => { void run(action); }); parent.appendChild(element);
    }
    function render() {
      list.replaceChildren();
      status.textContent = state.safeMode ? "Community safe mode is enabled. No community code runs." :
        state.packages.length ? "Packages are stored locally. Community effects cannot run yet." : "No community plugins installed.";
      for (const item of state.packages) {
        const card = document.createElement("div"); card.className = "zoidium-plugin-entry";
        card.dataset.communityId = item.id; card.dataset.readiness = item.readiness;
        const details = document.createElement("details"); details.className = "zp-detail-body";
        const summary = document.createElement("summary"); summary.className = "proprow noselect zoidium-plugin-row";
        const copy = document.createElement("span"); copy.className = "zoidium-plugin-copy";
        const name = document.createElement("span"); name.className = "zoidium-plugin-name";
        name.textContent = item.manifest?.name || item.id;
        const meta = document.createElement("span"); meta.className = "zoidium-plugin-meta";
        meta.textContent = [item.installed ? "Installed" : "", item.readiness].filter(Boolean).join(" · ");
        copy.append(name, meta); summary.appendChild(copy); details.appendChild(summary);
        const content = document.createElement("div"); content.className = "zp-detail-content";
        const description = document.createElement("p"); description.className = "zoidium-plugin-description";
        description.textContent = item.manifest ? `${item.manifest.author} · Version ${item.manifest.version} · Isolated effects` : "Stored package data is unavailable.";
        const hash = document.createElement("p"); hash.className = "zoidium-plugin-meta zoidium-community-hash";
        hash.textContent = "Exact package hash: " + item.hash;
        const message = document.createElement("p"); message.className = "zoidium-plugin-meta";
        message.textContent = item.quarantine || "Unavailable until rendering support lands. Approval does not run this package.";
        const actions = document.createElement("div"); actions.className = "zoidium-community-actions";
        if (!item.quarantine && !item.approved) button(actions, "Approve", async () => {
          const approved = await root.ZoidiumUI.confirm({ title: `Approve "${item.manifest.name}"?`,
            message: `Approve only these exact package bytes?\n\n${item.hash}\n\nIsolated effects can change output and use bounded compute resources. No network access is allowed. Activation is unavailable until rendering support lands.`,
            confirmLabel: "Approve", cancelLabel: "Cancel" });
          return approved ? store.approve(item.id, item.hash, state.revision) : state;
        });
        if (item.pending && item.approved && !item.staged && !item.quarantine) {
          button(actions, "Select on reload", () => store.stageOnReload(item.id, state.revision));
        }
        if (item.pending || !item.approved) button(actions, "Cancel import", () => store.cancel(item.id, state.revision));
        if (item.previous) button(actions, "Roll back on reload", () => store.rollback(item.id, state.revision));
        button(actions, "Uninstall", () => store.uninstall(item.id, state.revision));
        content.append(description, hash, message, actions); details.appendChild(content); card.appendChild(details); list.appendChild(card);
      }
    }
    importButton.addEventListener("click", () => { input.value = ""; input.click(); });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void run(() => store.importFile(file, state.revision));
    });
    refreshButton.addEventListener("click", () => { void run(() => store.open()); });
    buttonsDisabled(true);
    // Storage and feature detection happen after first-party startup. No runner
    // or interpreter is loaded by this management-only entry point.
    const initialized = run(async () => {
      if (!root.ZoidiumCommunityStore) throw new Error("Community storage could not load. First-party plugins remain available.");
      store = root.ZoidiumCommunityStore.createStore({ occupied: registry.plugins.map(p => p.id) });
      try { return await store.open({ reload: true }); }
      catch (error) {
        try { await store.close(); } catch (_) { /* A failed database open can also reject close. */ }
        store = null; throw error;
      }
    });
    return { initialized, section };
  }
  manager.mountCommunityPanel = mountCommunityPanel;
})(window);
