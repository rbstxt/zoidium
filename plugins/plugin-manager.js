(function () {
  "use strict";

  const REGISTRY_URL = "./plugins/registry.json";
  const STORAGE_PREFIX = "zoidium.plugin.enabled.";
  const pluginStates = new Map();

  function storageKey(pluginId) {
    return `${STORAGE_PREFIX}${pluginId}`;
  }

  function isPersistedEnabled(pluginId) {
    try {
      return localStorage.getItem(storageKey(pluginId)) === "true";
    } catch (_error) {
      return false;
    }
  }

  function persistEnabled(pluginId, enabled) {
    try {
      localStorage.setItem(storageKey(pluginId), String(enabled));
    } catch (_error) {
      // Plugin state still applies for the current session.
    }
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
  }

  async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  }

  function validateManifest(plugin, manifest) {
    if (manifest.schemaVersion !== 1 || manifest.id !== plugin.id) {
      throw new Error(`Invalid plugin manifest: ${plugin.id}`);
    }
    if (!Array.isArray(manifest.effects)) {
      throw new Error(`Plugin has no effects array: ${plugin.id}`);
    }
    for (const effect of manifest.effects) {
      if (!effect.id || !effect.name || !effect.shader || !effect.preset) {
        throw new Error(`Invalid effect entry in ${plugin.id}`);
      }
    }
  }

  function getEffectTypes() {
    return PZ.ui.objectTypes.get(PZ.effect);
  }

  function insertionIndex(effects) {
    const miscIndex = effects.findIndex(
      (entry) => entry && entry.category === true && entry.name === "MISC"
    );
    return miscIndex < 0 ? effects.length : miscIndex;
  }

  function createLazyEffectData(effect, cache) {
    return async function () {
      if (!cache.has(effect.id)) {
        cache.set(
          effect.id,
          Promise.all([fetchJson(effect.preset), fetchText(effect.shader)]).then(
            ([preset, shader]) => {
              if (preset.type !== 1 || !preset.properties) {
                throw new Error(`Invalid shader preset: ${effect.id}`);
              }
              preset.properties.fragShader = shader;
              return preset;
            }
          )
        );
      }
      const data = await cache.get(effect.id);
      return JSON.parse(JSON.stringify(data));
    };
  }

  function registerManifest(plugin, manifest, state) {
    const effects = getEffectTypes();
    if (effects.some((entry) => entry?._zoidiumPluginId === plugin.id)) return;

    const entries = [
      {
        name: manifest.category || manifest.name.toUpperCase(),
        category: true,
        _zoidiumPluginId: plugin.id,
      },
      ...manifest.effects.map((effect) => ({
        name: effect.name,
        desc: effect.description || `${effect.name} — ${manifest.name}`,
        type: 1,
        data: createLazyEffectData(effect, state.effectCache),
        _zoidiumPluginId: plugin.id,
        _zoidiumPluginEffectId: effect.id,
      })),
    ];

    effects.splice(insertionIndex(effects), 0, ...entries);
  }

  function unregisterPlugin(pluginId) {
    const effects = getEffectTypes();
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      if (effects[index]?._zoidiumPluginId === pluginId) effects.splice(index, 1);
    }
  }

  function updateCard(state, phase, message) {
    const enabled = phase === "enabled";
    state.card.dataset.enabled = String(enabled);
    state.card.dataset.phase = phase;
    state.toggle.checked = enabled;
    state.toggle.disabled = phase === "loading";
    state.status.dataset.state = phase;
    state.status.textContent = message || phase;
  }

  function emitState(pluginId, enabled, effectCount) {
    document.dispatchEvent(
      new CustomEvent("zoidium:plugin-state-change", {
        detail: { pluginId, enabled, effectCount },
      })
    );
  }

  async function enablePlugin(state, persist) {
    updateCard(state, "loading", "Loading…");
    try {
      if (!state.manifest) {
        state.manifest = await fetchJson(state.plugin.manifest);
        validateManifest(state.plugin, state.manifest);
      }
      registerManifest(state.plugin, state.manifest, state);
      if (persist) persistEnabled(state.plugin.id, true);
      updateCard(state, "enabled", `${state.manifest.effects.length} active`);
      emitState(state.plugin.id, true, state.manifest.effects.length);
    } catch (error) {
      unregisterPlugin(state.plugin.id);
      persistEnabled(state.plugin.id, false);
      updateCard(state, "error", "Load failed");
      console.error(`[Zoidium] failed to enable ${state.plugin.name}:`, error);
    }
  }

  function disablePlugin(state, persist) {
    unregisterPlugin(state.plugin.id);
    if (persist) persistEnabled(state.plugin.id, false);
    updateCard(state, "disabled", "Disabled");
    emitState(state.plugin.id, false, 0);
  }

  function createPluginCard(plugin) {
    const card = document.createElement("div");
    card.className = "zoidium-plugin-entry";
    card.dataset.pluginId = plugin.id;
    card.dataset.enabled = "false";
    card.innerHTML = `
      <div class="proprow noselect zoidium-plugin-row">
        <span class="zoidium-plugin-copy">
          <span class="zoidium-plugin-name">${plugin.name}</span>
          <span class="zoidium-plugin-meta">${plugin.effectCount} ${plugin.format} · v${plugin.version} · <span class="zoidium-plugin-state" data-state="disabled">Disabled</span></span>
        </span>
        <label class="zoidium-plugin-switch" title="Toggle ${plugin.name}">
          <input type="checkbox" role="switch" aria-label="Enable ${plugin.name}">
          <span class="zoidium-plugin-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="proprow noselect">
        <span class="zoidium-plugin-description">${plugin.description}</span>
      </div>`;

    const state = {
      plugin,
      card,
      toggle: card.querySelector("input"),
      status: card.querySelector(".zoidium-plugin-state"),
      manifest: null,
      effectCache: new Map(),
    };
    pluginStates.set(plugin.id, state);

    state.toggle.addEventListener("change", () => {
      if (state.toggle.checked) enablePlugin(state, true);
      else disablePlugin(state, true);
    });
    return card;
  }

  function createPanel(registry) {
    const panel = document.createElement("section");
    panel.className = "editorpanel zoidium-plugin-panel";
    panel.setAttribute("aria-label", "Plugin Manager");
    panel.tabIndex = 0;
    panel.style.display = "none";
    panel.innerHTML = `
      <div class="proprow proptitle noselect" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 5px;">
        <span class="proplabel" title="Plugins" style="font-size: 18px; font-weight: bold;">Plugins</span>
      </div>
      <div class="zoidium-plugin-list"></div>`;

    const list = panel.querySelector(".zoidium-plugin-list");
    for (const plugin of registry.plugins) list.appendChild(createPluginCard(plugin));

    const spacer = document.createElement("div");
    spacer.className = "proprow spacer";
    list.appendChild(spacer);

    const noteRow = document.createElement("div");
    noteRow.className = "proprow noselect";
    const note = document.createElement("span");
    note.className = "zoidium-plugin-note";
    note.textContent = "Shader data is loaded only when a pack is enabled and an effect is selected.";
    noteRow.appendChild(note);
    list.appendChild(noteRow);
    return panel;
  }

  function createTab(panel) {
    const tabs = document.querySelector(".elevatortabs");
    const controls = document.querySelector(".elevatorcontrols");
    if (!tabs || !controls) throw new Error("Zoidium sidebar is unavailable");
    const elevator = tabs.parentElement?.parentElement?.pz_panel;
    if (!elevator || typeof elevator.changeTab !== "function") {
      throw new Error("Zoidium elevator controller is unavailable");
    }

    const pluginPanel = {
      title: "Plugins",
      icon: "plugin-manager",
      el: panel,
      editor: elevator.editor,
      enabled: false,
      needsResize: false,
      resize() {},
    };

    const tab = document.createElement("a");
    tab.className = "zoidium-plugin-tab";
    tab.title = "Plugins";
    tab.pz_tab = pluginPanel;
    tab.pz_container = panel;
    tab.innerHTML = `
      <svg aria-hidden="true">
        <use href="./assets/images/zoidium.plugins.svg#plugin-manager"></use>
      </svg>
      <span>Plugins</span>`;

    const aboutTab = Array.from(tabs.children).find((item) => item.title === "About");
    tabs.insertBefore(tab, aboutTab || null);
    controls.appendChild(panel);
    elevator.panels.push(pluginPanel);
    tab.onclick = elevator.buttonClick.bind(elevator);
    tab.onkeydown = elevator.buttonKeyDown;
  }

  async function initialize() {
    if (typeof PZ === "undefined" || !PZ.effect || !PZ.ui?.objectTypes) {
      setTimeout(initialize, 50);
      return;
    }
    if (document.querySelector(".zoidium-plugin-tab")) return;

    try {
      const registry = await fetchJson(REGISTRY_URL);
      if (registry.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
        throw new Error("Invalid plugin registry");
      }
      const panel = createPanel(registry);
      createTab(panel);

      for (const state of pluginStates.values()) {
        if (isPersistedEnabled(state.plugin.id)) await enablePlugin(state, false);
      }
    } catch (error) {
      console.error("[Zoidium] plugin manager failed to initialize:", error);
    }
  }

  initialize();
})();
