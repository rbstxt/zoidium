"use strict";

const PlayerPlus = (() => {
  const STYLE_ID = "zoidium-player-plus-style";
  const QUALITY_STORAGE_KEY = "zoidium.player-plus.quality";
  const QUALITY_OPTIONS = [
    { value: 1, label: "Full quality" },
    { value: 0.5, label: "1/2 quality" },
    { value: 0.25, label: "1/4 quality" },
    { value: 0.125, label: "1/8 quality" },
  ];
  const state = {
    active: false,
    editor: null,
    PZ: null,
    document: null,
    window: null,
    toolbar: null,
    pauseButton: null,
    pauseIcon: null,
    qualitySelect: null,
    toolbarObserver: null,
    style: null,
    quality: 1,
    paused: false,
    viewports: new Set(),
    viewportPrototype: null,
    originalRenderPipeline: null,
    patchedRenderPipeline: null,
    originalResize: null,
    patchedResize: null,
  };

  function readStoredQuality() {
    try {
      const value = Number(state.window?.localStorage?.getItem(QUALITY_STORAGE_KEY));
      return QUALITY_OPTIONS.some((option) => option.value === value) ? value : 1;
    } catch (_error) {
      return 1;
    }
  }

  function storeQuality(value) {
    try {
      state.window?.localStorage?.setItem(QUALITY_STORAGE_KEY, String(value));
    } catch (_error) {
      // The setting still applies for the current session if storage is blocked.
    }
  }

  function installStyle() {
    const existing = state.document.getElementById(STYLE_ID);
    if (existing) {
      state.style = existing;
      return;
    }
    const style = state.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .zoidium-player-plus-toolbar {
        padding-left: 40px !important;
        padding-right: 125px !important;
        position: absolute !important;
      }

      .zoidium-player-plus-pause {
        background: transparent !important;
        border: 2px solid transparent !important;
        box-sizing: border-box;
        cursor: pointer;
        height: 29px !important;
        left: 5px;
        margin: 0 !important;
        padding: 0 !important;
        position: absolute !important;
        top: 5px;
        width: 30px;
      }

      .zoidium-player-plus-pause:focus-visible {
        border-color: #384668 !important;
        outline: 0;
      }

      .zoidium-player-plus-pause svg {
        fill: #acacac;
        height: 25px;
        pointer-events: none;
        width: 25px;
      }

      .zoidium-player-plus-pause.is-paused svg {
        fill: #4f7dbf;
      }

      .zoidium-player-plus-quality {
        background: #2a2a2a;
        border: 1px solid #555;
        border-radius: 2px;
        box-sizing: border-box;
        color: #acacac;
        cursor: pointer;
        font-family: "Source Code Pro", monospace;
        font-size: 12px;
        height: 27px;
        line-height: 25px;
        min-width: 112px;
        padding: 0 4px;
        position: absolute;
        right: 5px;
        text-align: left;
        top: 6px;
        z-index: 2;
      }

      .zoidium-player-plus-quality:focus-visible {
        border-color: #384668;
        outline: 0;
      }

      .zoidium-player-plus-quality option {
        background: #2a2a2a;
        color: #ccc;
      }
    `;
    state.document.head.appendChild(style);
    state.style = style;
  }

  function findPlaybackToolbar() {
    if (!state.document) return null;
    const toolbars = state.document.querySelectorAll(".toolbarpanel");
    for (const toolbar of toolbars) {
      if (toolbar.querySelector('button[title="play (space)"]')) return toolbar;
    }
    return null;
  }

  function viewportConstructor() {
    return state.PZ?.ui?.viewport || null;
  }

  function registerViewport(viewport) {
    const constructor = viewportConstructor();
    if (!viewport || !constructor || !(viewport instanceof constructor)) return null;
    state.viewports.add(viewport);
    if (!viewport.__zoidiumPlayerPlusFrame) {
      const originalFrame = viewport._renderFn;
      if (typeof originalFrame === "function") {
        const guardedFrame = () => {
          if (viewport.__zoidiumPlayerPlusPaused) {
            viewport.animFrameReq = null;
            return;
          }
          return originalFrame();
        };
        viewport.__zoidiumPlayerPlusOriginalFrame = originalFrame;
        viewport.__zoidiumPlayerPlusFrame = guardedFrame;
        viewport._renderFn = guardedFrame;
      }
    }
    return viewport;
  }

  function getViewports() {
    const viewports = new Set(state.viewports);
    const constructor = viewportConstructor();
    if (constructor && state.document) {
      state.document.querySelectorAll("canvas").forEach((canvas) => {
        const panel = canvas.parentElement?.pz_panel;
        if (panel instanceof constructor) viewports.add(panel);
      });
    }
    return Array.from(viewports).map(registerViewport).filter(Boolean);
  }

  function applyQualityToViewport(viewport) {
    if (!viewport?.renderer || !viewport.canvas || !viewport.compositor) return;
    const cssWidth = parseFloat(viewport.canvas.style.width) || viewport.canvas.clientWidth;
    const cssHeight = parseFloat(viewport.canvas.style.height) || viewport.canvas.clientHeight;
    if (!(cssWidth > 0) || !(cssHeight > 0)) return;

    const devicePixelRatio = state.window?.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(cssWidth * devicePixelRatio * state.quality));
    const height = Math.max(1, Math.round(cssHeight * devicePixelRatio * state.quality));
    if (viewport.canvas.width !== width || viewport.canvas.height !== height) {
      viewport.renderer.setDrawingBufferSize(width, height, 1);
      viewport.compositor.setSize(viewport.canvas.width, viewport.canvas.height);
      if (viewport.camera) {
        viewport.camera.aspect = viewport.canvas.width / viewport.canvas.height;
        viewport.camera.updateProjectionMatrix();
      }
    }
  }

  function applyQualityToAllViewports() {
    for (const viewport of getViewports()) applyQualityToViewport(viewport);
  }

  function installViewportPatches() {
    const constructor = viewportConstructor();
    const prototype = constructor?.prototype;
    if (!prototype || state.viewportPrototype === prototype) return;
    state.viewportPrototype = prototype;

    state.originalRenderPipeline = prototype._render;
    state.patchedRenderPipeline = function () {
      registerViewport(this);
      if (this.__zoidiumPlayerPlusPaused) {
        if (this.animFrameReq != null) {
          state.window.cancelAnimationFrame(this.animFrameReq);
          this.animFrameReq = null;
        }
        return;
      }
      return state.originalRenderPipeline.apply(this, arguments);
    };
    prototype._render = state.patchedRenderPipeline;

    state.originalResize = prototype.resize;
    state.patchedResize = function () {
      registerViewport(this);
      const result = state.originalResize.apply(this, arguments);
      applyQualityToViewport(this);
      return result;
    };
    prototype.resize = state.patchedResize;
  }

  function restoreViewportPatches() {
    const prototype = state.viewportPrototype;
    if (!prototype) return;
    if (prototype._render === state.patchedRenderPipeline) {
      prototype._render = state.originalRenderPipeline;
    }
    if (prototype.resize === state.patchedResize) prototype.resize = state.originalResize;
    for (const viewport of state.viewports) {
      if (viewport.__zoidiumPlayerPlusFrame === viewport._renderFn) {
        viewport._renderFn = viewport.__zoidiumPlayerPlusOriginalFrame;
      }
      delete viewport.__zoidiumPlayerPlusFrame;
      delete viewport.__zoidiumPlayerPlusOriginalFrame;
      delete viewport.__zoidiumPlayerPlusPaused;
    }
    state.viewports.clear();
    state.viewportPrototype = null;
    state.originalRenderPipeline = null;
    state.patchedRenderPipeline = null;
    state.originalResize = null;
    state.patchedResize = null;
  }

  function setDrawingPaused(paused) {
    const next = Boolean(paused);
    state.paused = next;
    const viewports = getViewports();
    for (const viewport of viewports) {
      viewport.__zoidiumPlayerPlusPaused = next;
      if (next) {
        if (viewport.animFrameReq != null) {
          state.window.cancelAnimationFrame(viewport.animFrameReq);
          viewport.animFrameReq = null;
        }
      } else if (viewport.enabled && typeof viewport._renderFn === "function") {
        viewport.animFrameReq = state.window.requestAnimationFrame(viewport._renderFn);
      }
    }
    updatePauseButton();
  }

  function updatePauseButton() {
    const button = state.pauseButton;
    if (!button) return;
    button.classList.toggle("is-paused", state.paused);
    button.setAttribute("aria-pressed", String(state.paused));
    button.title = state.paused ? "Resume drawing" : "Pause drawing";
    button.setAttribute("aria-label", button.title);
    if (state.pauseIcon && state.PZ?.ui?.switchIcon) {
      state.PZ.ui.switchIcon(state.pauseIcon, state.paused ? "play" : "pause");
      state.pauseIcon.style.fill = state.paused ? "#4f7dbf" : "#acacac";
    }
  }

  function createPauseButton(toolbar) {
    const button = state.document.createElement("button");
    button.className = "zoidium-player-plus-pause";
    button.type = "button";
    button.addEventListener("click", () => setDrawingPaused(!state.paused));
    const icon = state.PZ.ui.generateIcon("pause");
    button.appendChild(icon);
    toolbar.insertBefore(button, toolbar.firstElementChild);
    state.pauseButton = button;
    state.pauseIcon = icon;
    updatePauseButton();
  }

  function createQualitySelect(toolbar) {
    const select = state.document.createElement("select");
    select.className = "zoidium-player-plus-quality";
    select.title = "Preview quality";
    select.setAttribute("aria-label", "Preview quality");
    for (const option of QUALITY_OPTIONS) {
      const element = state.document.createElement("option");
      element.value = String(option.value);
      element.textContent = option.label;
      select.appendChild(element);
    }
    select.value = String(state.quality);
    select.addEventListener("change", () => {
      const value = Number(select.value);
      if (!QUALITY_OPTIONS.some((option) => option.value === value)) return;
      state.quality = value;
      storeQuality(value);
      applyQualityToAllViewports();
    });
    toolbar.appendChild(select);
    state.qualitySelect = select;
  }

  function installControls(toolbar) {
    if (!toolbar) return;
    if (toolbar.dataset.zoidiumPlayerPlus === "true") {
      const pauseButton = toolbar.querySelector(".zoidium-player-plus-pause");
      const qualitySelect = toolbar.querySelector(".zoidium-player-plus-quality");
      if (pauseButton && qualitySelect) {
        state.toolbar = toolbar;
        state.pauseButton = pauseButton;
        state.pauseIcon = pauseButton.querySelector("svg");
        state.qualitySelect = qualitySelect;
        updatePauseButton();
        return;
      }
      delete toolbar.dataset.zoidiumPlayerPlus;
    }
    toolbar.dataset.zoidiumPlayerPlus = "true";
    toolbar.classList.add("zoidium-player-plus-toolbar");
    state.toolbar = toolbar;
    createPauseButton(toolbar);
    createQualitySelect(toolbar);
    applyQualityToAllViewports();
  }

  function watchForToolbar() {
    const root = state.document.body || state.document.documentElement;
    if (!root) return;
    const install = () => {
      const toolbar = findPlaybackToolbar();
      if (!toolbar) return false;
      installControls(toolbar);
      state.toolbarObserver?.disconnect();
      state.toolbarObserver = null;
      return true;
    };
    if (install()) return;
    state.toolbarObserver = new MutationObserver(install);
    state.toolbarObserver.observe(root, { childList: true, subtree: true });
  }

  function removeControls() {
    if (state.toolbar) {
      state.toolbar.classList.remove("zoidium-player-plus-toolbar");
      delete state.toolbar.dataset.zoidiumPlayerPlus;
    }
    state.pauseButton?.remove();
    state.qualitySelect?.remove();
    state.toolbar = null;
    state.pauseButton = null;
    state.pauseIcon = null;
    state.qualitySelect = null;
  }

  async function activate(context) {
    if (state.active) return;
    state.active = true;
    state.editor = context.editor;
    state.window = context.window || window;
    state.document = context.document || document;
    state.PZ = context.PZ || state.window.PZ;
    state.quality = readStoredQuality();
    installStyle();
    installViewportPatches();
    watchForToolbar();
    // The initial project may finish sizing the viewport just after activation.
    state.window.requestAnimationFrame(applyQualityToAllViewports);
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    state.toolbarObserver?.disconnect();
    state.toolbarObserver = null;
    setDrawingPaused(false);
    removeControls();
    restoreViewportPatches();
    state.style?.remove();
    state.style = null;
    state.editor = null;
    state.PZ = null;
    state.document = null;
    state.window = null;
    state.quality = 1;
    state.paused = false;
  }

  return { activate, deactivate };
})();

module.exports = PlayerPlus;
