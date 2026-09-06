(function installRenderAspectRatioPatch() {
  "use strict";

  const DEFAULT_ASPECT_RATIO = [16, 9];
  const DEFAULT_ASPECT_RATIO_MODE = 0;
  const BLACK_FILL_MODE = "black fill";
  const PATCH_MARKER = "__zoidiumRenderAspectRatioPatch";

  function isFinitePositive(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function normalizeAspectRatio(value, fallback = DEFAULT_ASPECT_RATIO) {
    let width;
    let height;

    if (Array.isArray(value)) {
      [width, height] = value;
    } else if (typeof value === "string") {
      const match = value.trim().match(
        /^([0-9]+(?:\.[0-9]+)?)\s*[:x/]\s*([0-9]+(?:\.[0-9]+)?)$/i,
      );
      if (match) {
        width = match[1];
        height = match[2];
      }
    } else if (value && typeof value === "object") {
      width = value.width ?? value.x;
      height = value.height ?? value.y;
    }

    if (!isFinitePositive(width) || !isFinitePositive(height)) {
      return fallback.slice();
    }

    return [Number(width), Number(height)];
  }

  function getProjectResolution(sequence) {
    const resolution = sequence?.properties?.resolution?.get?.();
    if (Array.isArray(resolution) && isFinitePositive(resolution[0]) && isFinitePositive(resolution[1])) {
      return [Number(resolution[0]), Number(resolution[1])];
    }
    return [1920, 1080];
  }

  function normalizeAspectRatioMode(value, fallback = "cover") {
    if (value === 1 || String(value).toLowerCase() === BLACK_FILL_MODE) return "contain";
    if (["contain", "black-fill", "black_fill", "letterbox"].includes(String(value).toLowerCase())) {
      return "contain";
    }
    if (value === 0 || String(value).toLowerCase() === "crop" || String(value).toLowerCase() === "cover") {
      return "cover";
    }
    return fallback;
  }

  function makeEven(value) {
    return Math.max(1, Math.round(Number(value) / 2) * 2);
  }

  function getOutputSize(width, height, aspectRatio) {
    const baseWidth = isFinitePositive(width) ? Number(width) : 1920;
    const baseHeight = isFinitePositive(height) ? Number(height) : 1080;
    const longEdge = Math.max(baseWidth, baseHeight);
    const ratio = aspectRatio[0] / aspectRatio[1];
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return [1920, 1080];
    }

    if (ratio >= 1) {
      return [makeEven(longEdge), makeEven(longEdge / ratio)];
    }
    return [makeEven(longEdge * ratio), makeEven(longEdge)];
  }

  function syncExportParams(params) {
    if (!params || typeof params !== "object") return null;

    const aspectRatio = normalizeAspectRatio(
      params.aspectRatio,
      DEFAULT_ASPECT_RATIO,
    );
    const mode = normalizeAspectRatioMode(params.aspectRatioMode, "cover");
    const outputSize = getOutputSize(params.width, params.height, aspectRatio);

    params.width = outputSize[0];
    params.height = outputSize[1];
    params.aspectRatio = aspectRatio.slice();
    params.aspectRatioMode = mode === "contain" ? 1 : DEFAULT_ASPECT_RATIO_MODE;

    return { aspectRatio, mode, outputSize };
  }

  function captureCamera(camera) {
    return {
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
      near: camera.near,
      far: camera.far,
      zoom: camera.zoom,
    };
  }

  function restoreCamera(camera, state) {
    Object.assign(camera, state);
    camera.updateProjectionMatrix();
  }

  function configureCamera(camera, config) {
    if (!camera || !config) return;

    if (config.mode === "contain") {
      camera.left = -config.projectWidth / 2;
      camera.right = config.projectWidth / 2;
      camera.top = config.projectHeight / 2;
      camera.bottom = -config.projectHeight / 2;
    } else {
      const viewWidth = config.outputWidth / config.scale;
      const viewHeight = config.outputHeight / config.scale;
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
    }

    camera.updateProjectionMatrix();
  }

  function createAspectRenderContext(compositor, config) {
    const viewportPatches = new Map();
    const contentWidth = config.contentWidth;
    const contentHeight = config.contentHeight;
    const mixUvScale = compositor.mixPass?.uniforms?.uvScale?.value;
    const previousMixScale = mixUvScale?.clone?.();
    const context = { forceContentViewport: false };

    if (mixUvScale?.set) {
      mixUvScale.set(
        contentWidth / config.outputWidth,
        contentHeight / config.outputHeight,
      );
    }

    function patchTarget(target) {
      const viewport = target?.viewport;
      if (!viewport || typeof viewport.set !== "function") return;
      if (viewportPatches.has(viewport)) return;

      const originalSet = viewport.set;
      const previousState = {
        x: viewport.x,
        y: viewport.y,
        z: viewport.z,
        w: viewport.w,
      };
      const forcedSet = function setAspectViewport() {
        const width = context.forceContentViewport
          ? contentWidth
          : arguments[2] ?? contentWidth;
        const height = context.forceContentViewport
          ? contentHeight
          : arguments[3] ?? contentHeight;
        return originalSet.call(this, 0, 0, width, height);
      };

      viewportPatches.set(viewport, { originalSet, forcedSet, previousState });
      viewport.set = forcedSet;
      originalSet.call(viewport, 0, 0, contentWidth, contentHeight);
    }

    function patchAllBuffers() {
      patchTarget(compositor.readBuffer);
      patchTarget(compositor.writeBuffer);
      for (const target of compositor.screenBuffers || []) patchTarget(target);
      for (const target of compositor.accumBuffers || []) patchTarget(target);
    }

    function restore() {
      for (const [viewport, patch] of viewportPatches) {
        patch.originalSet.call(
          viewport,
          patch.previousState.x,
          patch.previousState.y,
          patch.previousState.z,
          patch.previousState.w,
        );
        if (viewport.set === patch.forcedSet) viewport.set = patch.originalSet;
      }
      viewportPatches.clear();
      if (previousMixScale && mixUvScale?.copy) mixUvScale.copy(previousMixScale);
    }

    function renderFinalCopy(originalRender, pass, renderer, args) {
      const uniforms = pass.uniforms || {};
      const uvScale = uniforms.uvScale?.value;
      const uvOffset = uniforms.uvOffset?.value;
      const previousScale = uvScale?.clone?.();
      const previousOffset = uvOffset?.clone?.();

      if (uvScale?.set) {
        uvScale.set(
          config.contentWidth / config.outputWidth,
          config.contentHeight / config.outputHeight,
        );
      }
      if (uvOffset?.set) uvOffset.set(0, 0);

      const previousClearColor = renderer.getClearColor?.()?.clone?.();
      const previousClearAlpha = renderer.getClearAlpha?.();
      const previousAutoClear = renderer.autoClear;
      const originalSetRenderTarget = renderer.setRenderTarget;
      originalSetRenderTarget?.call(renderer, null);
      renderer.setViewport?.(0, 0, config.outputWidth, config.outputHeight);
      renderer.setClearColor?.(0, 1);
      renderer.clear?.(true, true, true);

      const setContentViewport = () => {
        renderer.setViewport?.(
          config.outputX,
          config.outputY,
          config.contentWidth,
          config.contentHeight,
        );
      };
      setContentViewport();

      if (typeof originalSetRenderTarget === "function") {
        renderer.setRenderTarget = function setFinalAspectRenderTarget(target) {
          const result = originalSetRenderTarget.apply(this, arguments);
          if (target === null) setContentViewport();
          return result;
        };
      }

      try {
        // ShaderPass uses renderer.render(), whose default auto-clear would
        // otherwise erase the black bars immediately before drawing the copy.
        renderer.autoClear = false;
        return originalRender.apply(pass, args);
      } finally {
        renderer.autoClear = previousAutoClear;
        if (typeof originalSetRenderTarget === "function") {
          renderer.setRenderTarget = originalSetRenderTarget;
        }
        if (previousClearColor) {
          if (previousClearAlpha === undefined) renderer.setClearColor(previousClearColor);
          else renderer.setClearColor(previousClearColor, previousClearAlpha);
        }
        if (previousScale && uvScale?.copy) uvScale.copy(previousScale);
        if (previousOffset && uvOffset?.copy) uvOffset.copy(previousOffset);
      }
    }

    patchAllBuffers();
    return Object.assign(context, { patchAllBuffers, renderFinalCopy, restore });
  }

  function createCompositorConfig(compositor) {
    const renderSettings = compositor?.__zoidiumRenderSettings;
    if (!renderSettings) return null;

    const sequence = compositor?._sequence;
    const projectResolution = getProjectResolution(sequence);
    const outputWidth = compositor?.readBuffer?.width;
    const outputHeight = compositor?.readBuffer?.height;
    if (!isFinitePositive(outputWidth) || !isFinitePositive(outputHeight)) return null;

    const scaleX = outputWidth / projectResolution[0];
    const scaleY = outputHeight / projectResolution[1];
    const mode = normalizeAspectRatioMode(renderSettings.mode, "cover");
    const scale = mode === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
    const contentWidth =
      mode === "contain"
        ? Math.max(1, Math.min(outputWidth, Math.round(projectResolution[0] * scale)))
        : outputWidth;
    const contentHeight =
      mode === "contain"
        ? Math.max(1, Math.min(outputHeight, Math.round(projectResolution[1] * scale)))
        : outputHeight;

    return {
      mode,
      projectWidth: projectResolution[0],
      projectHeight: projectResolution[1],
      outputWidth,
      outputHeight,
      scale,
      contentWidth,
      contentHeight,
      outputX: Math.floor((outputWidth - contentWidth) / 2),
      outputY: Math.floor((outputHeight - contentHeight) / 2),
    };
  }

  function installCompositorPatch() {
    const prototype = PZ.compositor?.prototype;
    if (!prototype || prototype[PATCH_MARKER]) return;

    const originalRenderSequence = prototype.renderSequence;
    const originalRenderLayer = prototype.renderLayer;
    const originalCompositeScene = prototype.compositeScene;

    prototype.renderSequence = function renderSequenceWithAspectRatio(frame) {
      const config = createCompositorConfig(this);
      if (!config || !this.camera) {
        return originalRenderSequence.apply(this, arguments);
      }

      const previousConfig = this.__zoidiumAspectConfig;
      const previousContext = this.__zoidiumAspectContext;
      const previousRatioDescriptor = Object.getOwnPropertyDescriptor(this, "ratio");
      const previousCamera = captureCamera(this.camera);
      const context = createAspectRenderContext(this, config);
      const previousCopyRender = this.copyPass?.render;

      this.__zoidiumAspectConfig = config;
      this.__zoidiumAspectContext = context;
      Object.defineProperty(this, "ratio", {
        configurable: true,
        enumerable: true,
        get() {
          return config.scale;
        },
        set() {},
      });
      configureCamera(this.camera, config);

      if (this.copyPass && typeof previousCopyRender === "function") {
        this.copyPass.render = function renderFinalAspectCopy(renderer, writeBuffer, readBuffer) {
          if (writeBuffer === null && readBuffer === null) {
            return context.renderFinalCopy(
              previousCopyRender,
              this,
              renderer,
              arguments,
            );
          }
          return previousCopyRender.apply(this, arguments);
        };
      }

      try {
        return originalRenderSequence.apply(this, arguments);
      } finally {
        if (this.copyPass?.render !== previousCopyRender && previousCopyRender !== undefined) {
          this.copyPass.render = previousCopyRender;
        }
        context.restore();
        restoreCamera(this.camera, previousCamera);
        this.__zoidiumAspectConfig = previousConfig;
        this.__zoidiumAspectContext = previousContext;
        if (previousRatioDescriptor) {
          Object.defineProperty(this, "ratio", previousRatioDescriptor);
        } else {
          delete this.ratio;
        }
      }
    };

    prototype.renderLayer = function renderLayerWithAspectRatio(layer, screenIndex, renderToScreen) {
      const context = this.__zoidiumAspectContext;
      if (!context) return originalRenderLayer.apply(this, arguments);

      if (
        PZ.layer?.composite &&
        layer instanceof PZ.layer.composite &&
        !this.screenBuffers?.[screenIndex + 1] &&
        this.readBuffer?.clone
      ) {
        this.screenBuffers[screenIndex + 1] = this.readBuffer.clone();
      }
      context.patchAllBuffers();

      try {
        return originalRenderLayer.apply(this, arguments);
      } finally {
        context.patchAllBuffers();
      }
    };

    prototype.compositeScene = function compositeSceneWithAspectRatio() {
      const context = this.__zoidiumAspectContext;
      if (!context) return originalCompositeScene.apply(this, arguments);

      const previousForceContentViewport = context.forceContentViewport;
      context.forceContentViewport = true;
      try {
        return originalCompositeScene.apply(this, arguments);
      } finally {
        context.forceContentViewport = previousForceContentViewport;
        context.patchAllBuffers();
      }
    };

    prototype[PATCH_MARKER] = true;
  }

  function installExportPatch() {
    if (!PZ.export || PZ.export.__zoidiumAspectRatioPatch) return;

    const OriginalExport = PZ.export;
    const Export = function exportWithAspectRatio(sequence, params) {
      const isAspectRender =
        params?.__zoidiumDeviceRender || params?.__zoidiumAspectRender;
      const settings = isAspectRender ? syncExportParams(params) : null;
      const result = OriginalExport.apply(this, arguments);
      if (this.compositor) {
        if (settings) this.compositor.__zoidiumRenderSettings = settings;
        else delete this.compositor.__zoidiumRenderSettings;
      }
      return result;
    };

    Export.prototype = OriginalExport.prototype;
    Object.setPrototypeOf(Export, OriginalExport);
    Export.__zoidiumAspectRatioPatch = true;
    PZ.export = Export;
  }

  function readPositiveInteger(value, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function createDeviceAspectRatioInput(owner) {
    const row = document.createElement("div");
    row.classList.add("proprow", "noselect");

    const title = document.createElement("span");
    title.innerText = "Aspect ratio";
    row.appendChild(title);

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.alignItems = "center";

    const widthInput = document.createElement("input");
    widthInput.classList.add("pz-inputbox");
    widthInput.type = "text";
    widthInput.inputMode = "numeric";
    widthInput.autocomplete = "off";
    widthInput.setAttribute("aria-label", "Aspect ratio width");
    widthInput.style.width = "90px";

    const separator = document.createElement("span");
    separator.innerText = ":";
    separator.style.margin = "0 8px";

    const heightInput = document.createElement("input");
    heightInput.classList.add("pz-inputbox");
    heightInput.type = "text";
    heightInput.inputMode = "numeric";
    heightInput.autocomplete = "off";
    heightInput.setAttribute("aria-label", "Aspect ratio height");
    heightInput.style.width = "90px";

    controls.appendChild(widthInput);
    controls.appendChild(separator);
    controls.appendChild(heightInput);
    row.appendChild(controls);

    function update() {
      const [width, height] = normalizeAspectRatio(
        owner.params.aspectRatio,
        DEFAULT_ASPECT_RATIO,
      );
      widthInput.value = String(width);
      heightInput.value = String(height);
    }

    function commit() {
      const [currentWidth, currentHeight] = normalizeAspectRatio(
        owner.params.aspectRatio,
        DEFAULT_ASPECT_RATIO,
      );
      owner.params.aspectRatio = [
        readPositiveInteger(widthInput.value, currentWidth),
        readPositiveInteger(heightInput.value, currentHeight),
      ];
      syncExportParams(owner.params);
      update();
    }

    widthInput.onchange = commit;
    heightInput.onchange = commit;
    row.pz_update = update;
    update();
    return row;
  }

  function installDeviceExportPatch() {
    const prototype = PZ.ui?.export?.device?.prototype;
    if (!prototype || prototype.__zoidiumAspectRatioPatch) return;

    const originalCreateOptionsPage = prototype.createOptionsPage;
    prototype.createOptionsPage = function createOptionsPageWithAspectRatio() {
      const page = originalCreateOptionsPage.apply(this, arguments);
      if (!page || !this.params) return page;

      Object.defineProperty(this.params, "__zoidiumDeviceRender", {
        configurable: true,
        enumerable: false,
        value: true,
        writable: true,
      });
      this.params.aspectRatio = DEFAULT_ASPECT_RATIO.slice();
      this.params.aspectRatioMode = DEFAULT_ASPECT_RATIO_MODE;

      const owner = this;
      const aspectRatioRow = createDeviceAspectRatioInput(this);
      const modeRow = PZ.ui.controls.legacy.generateDropdown(
        {
          title: "Aspect ratio mode",
          items: "crop;black fill",
          get() {
            return normalizeAspectRatioMode(owner.params.aspectRatioMode, "cover") === "contain"
              ? 1
              : 0;
          },
          set(value) {
            owner.params.aspectRatioMode = value;
          },
        },
        this,
      );

      const resolutionSelect = page.querySelector("select.pz-inputbox");
      if (resolutionSelect) {
        const originalChange = resolutionSelect.onchange;
        resolutionSelect.onchange = (event) => {
          originalChange?.call(resolutionSelect, event);
          syncExportParams(this.params);
          aspectRatioRow.pz_update();
        };

        const resolutionRow = resolutionSelect.parentElement?.parentElement;
        if (resolutionRow?.parentElement) {
          resolutionRow.parentElement.insertBefore(aspectRatioRow, resolutionRow.nextSibling);
          resolutionRow.parentElement.insertBefore(modeRow, aspectRatioRow.nextSibling);
        } else {
          page.appendChild(aspectRatioRow);
          page.appendChild(modeRow);
        }
      } else {
        page.appendChild(aspectRatioRow);
        page.appendChild(modeRow);
      }

      return page;
    };
    prototype.__zoidiumAspectRatioPatch = true;
  }

  installCompositorPatch();
  installExportPatch();
  installDeviceExportPatch();
})();
