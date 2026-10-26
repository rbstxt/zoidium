"use strict";

(function (root) {
  const manager = root.ZoidiumPluginManagerInternals;
  function mountCommunityPanel(panel, registry) {
    const section = document.createElement("details");
    section.className = "zoidium-plugin-category zoidium-community-section";
    section.open = true;
    section.innerHTML = `<summary><span class="zoidium-plugin-category-heading"><span class="zoidium-plugin-category-name">Community</span></span></summary>
      <div class="zoidium-plugin-category-description">Developer preview. Local packages run in an isolated runtime with no network access. Export requires explicitly bypassing all community effects.</div>
      <div class="zp-detail-content"><button type="button" data-community-import>Import plugin</button>
      <input type="file" accept=".json,application/json" aria-label="Choose a local community plugin" hidden>
      <button type="button" data-community-refresh>Refresh</button>
      <button type="button" data-community-fallback>Export with missing or failed plugins</button>
      <p class="zoidium-plugin-meta" data-community-project-warnings role="status"></p>
      <p class="zoidium-plugin-meta" role="status" aria-live="polite"></p></div>
      <div class="zoidium-plugin-category-list"></div>`;
    panel.appendChild(section);
    const input = section.querySelector("input"), importButton = section.querySelector("[data-community-import]");
    const refreshButton = section.querySelector("[data-community-refresh]");
    const fallbackButton = section.querySelector("[data-community-fallback]");
    const warnings = section.querySelector("[data-community-project-warnings]");
    const status = section.querySelector('[role="status"]'), list = section.querySelector(".zoidium-plugin-category-list");
    let store, state, controller, busy = false;
    function buttonsDisabled(disabled) {
      section.querySelectorAll("button").forEach(button => { button.disabled = disabled; });
    }
    async function run(action) {
      if (busy) return;
      busy = true; buttonsDisabled(true);
      try {
        state = await action();
        await controller?.reconcile();
        if (controller) state = store.view();
        render();
      }
      catch (error) {
        if (store && state) { state = store.view(); render(); }
        status.textContent = error.message || "Community storage is unavailable.";
      }
      finally { busy = false; buttonsDisabled(!store); }
    }
    function button(parent, label, action) {
      const element = document.createElement("button"); element.type = "button"; element.textContent = label;
      element.addEventListener("click", () => { void run(action); }); parent.appendChild(element);
    }
    function render() {
      list.replaceChildren();
      renderWarnings();
      status.textContent = state.safeMode ? "Community safe mode is enabled. No community code runs." :
        state.packages.length ? "Packages are stored locally. Export requires explicitly bypassing all community effects." : "No community plugins installed.";
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
        message.textContent = item.quarantine || "Approval applies only to these exact bytes. Select for preview to register effects. Export requires explicitly bypassing all community effects.";
        const actions = document.createElement("div"); actions.className = "zoidium-community-actions";
        if (!item.quarantine && !item.approved) button(actions, "Approve", async () => {
          const approved = await root.ZoidiumUI.confirm({ title: `Approve "${item.manifest.name}"?`,
            message: `Approve only these exact package bytes?\n\n${item.hash}\n\nIsolated effects can change output and use bounded compute resources. No network access is allowed. Export requires explicitly bypassing all community effects.`,
            confirmLabel: "Approve", cancelLabel: "Cancel" });
          return approved ? store.approve(item.id, item.hash, state.revision) : state;
        });
        if (item.pending && item.approved && !item.staged && !item.quarantine) {
          button(actions, "Select on reload", () => store.stageOnReload(item.id, state.revision));
        }
        if (item.pending || !item.approved) button(actions, "Cancel import", () => store.cancel(item.id, state.revision));
        if (item.selected && item.approvals.includes(item.selected) && !item.quarantine && !state.safeMode) {
          button(actions, item.enabled ? "Disable preview" : "Select for preview", () => store.setEnabled(item.id, !item.enabled, state.revision));
        }
        if (item.previous) button(actions, "Roll back on reload", () => store.rollback(item.id, state.revision));
        button(actions, "Uninstall", () => store.uninstall(item.id, state.revision));
        content.append(description, hash, message, actions); details.appendChild(content); card.appendChild(details); list.appendChild(card);
      }
    }
    function renderWarnings() {
      if (!warnings) return;
      const project = root.CM?.project || root.VE?.project;
      const community = root.ZoidiumCommunityProjects;
      const plugins = project && community?.enabled() ? manager.projectPluginRequirements(project.toJSON()) : [];
      warnings.textContent = plugins.filter(plugin => community.isCommunity(plugin.id)).map(plugin => {
        const installed = state?.packages.find(item => item.id === plugin.id);
        const name = installed?.manifest?.name || plugin.name;
        return community.warning({ ...plugin, name }) + (installed ? ` Local status: ${installed.readiness}.` : " Package is not installed.");
      }).join("\n");
    }
    fallbackButton?.addEventListener("click", () => {
      void run(async () => {
        const project = root.CM?.project || root.VE?.project;
        const approved = await root.ZoidiumCommunityExport.requestFallback(project);
        root.ZoidiumUI.notify({ title: approved ? "Fallback export selected" : "Fallback export not selected",
          message: approved ? "The next export bypasses all community effects at every frame. Project records stay unchanged." : "Export still requires a new explicit choice." });
        return store.view();
      });
    });
    root.addEventListener?.("zoidium:project-changed", renderWarnings);
    root.document?.addEventListener?.("zoidium:project-load-complete", renderWarnings);
    importButton.addEventListener("click", () => { input.value = ""; input.click(); });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void run(() => store.importFile(file, state.revision));
    });
    refreshButton.addEventListener("click", () => { void run(() => store.open()); });
    buttonsDisabled(true);
    // Storage and preview activation happen after first-party startup.
    const initialized = run(async () => {
      if (!root.ZoidiumCommunityStore) throw new Error("Community storage could not load. First-party plugins remain available.");
      store = root.ZoidiumCommunityStore.createStore({ occupied: registry.plugins.map(p => p.id) });
      try {
        const view = await store.open({ reload: true });
        controller = root.ZoidiumCommunityEffects?.createController({ store });
        return view;
      }
      catch (error) {
        try { await store.close(); } catch (_) { /* A failed database open can also reject close. */ }
        store = null; throw error;
      }
    });
    return { initialized, section, dispose() { controller?.dispose(); store?.close(); section.remove?.();
      root.removeEventListener?.("zoidium:project-changed", renderWarnings);
      root.document?.removeEventListener?.("zoidium:project-load-complete", renderWarnings); } };
  }
  manager.mountCommunityPanel = mountCommunityPanel;
})(window);
