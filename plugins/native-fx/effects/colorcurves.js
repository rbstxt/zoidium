"use strict";

(function (global, effect) {
  const CONTROL_ID = "native-fx/color-curves";
  const SHADER_URL = "/plugins/native-fx/shaders/fx_colorcurves.glsl";
  const STYLE_URL = "/plugins/native-fx/colorcurves.css";
  const STYLE_ID = "zoidium-color-curves-style";
  const LUT_SIZE = 256;
  const MAX_POINTS = 16;
  const CHANNELS = [
    { id: "composite", shortName: "RGB", name: "RGB" },
    { id: "red", shortName: "R", name: "Red" },
    { id: "green", shortName: "G", name: "Green" },
    { id: "blue", shortName: "B", name: "Blue" },
  ];

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function roundPoint(value) {
    return Math.round(clamp(Number(value) || 0, 0, 1) * 10000) / 10000;
  }

  function identityPoints() {
    return [[0, 0], [1, 1]];
  }

  function defaultState() {
    return {
      version: 1,
      composite: identityPoints(),
      red: identityPoints(),
      green: identityPoints(),
      blue: identityPoints(),
    };
  }

  function sanitizePoints(value) {
    const points = Array.isArray(value)
      ? value
          .map((point) => {
            if (Array.isArray(point)) return [roundPoint(point[0]), roundPoint(point[1])];
            if (point && typeof point === "object") {
              return [roundPoint(point.x), roundPoint(point.y)];
            }
            return null;
          })
          .filter(Boolean)
          .sort((first, second) => first[0] - second[0])
      : [];

    const unique = [];
    for (const point of points) {
      if (unique.length && Math.abs(unique[unique.length - 1][0] - point[0]) < 0.0001) {
        unique[unique.length - 1] = point;
      } else {
        unique.push(point);
      }
    }
    if (!unique.length || unique[0][0] > 0.0001) unique.unshift([0, 0]);
    else unique[0][0] = 0;
    if (unique[unique.length - 1][0] < 0.9999) unique.push([1, 1]);
    else unique[unique.length - 1][0] = 1;
    if (unique.length > MAX_POINTS) {
      const middle = unique.slice(1, -1).slice(0, MAX_POINTS - 2);
      return [unique[0], ...middle, unique[unique.length - 1]];
    }
    return unique;
  }

  function parseState(value) {
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch (_error) {
        parsed = null;
      }
    }
    const fallback = defaultState();
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      version: 1,
      composite: sanitizePoints(parsed.composite),
      red: sanitizePoints(parsed.red),
      green: sanitizePoints(parsed.green),
      blue: sanitizePoints(parsed.blue),
    };
  }

  function serializeState(state) {
    const normalized = { version: 1 };
    for (const channel of CHANNELS) {
      normalized[channel.id] = sanitizePoints(state[channel.id]).map((point) => [
        roundPoint(point[0]),
        roundPoint(point[1]),
      ]);
    }
    return JSON.stringify(normalized);
  }

  function createSampler(value) {
    const points = sanitizePoints(value);
    const count = points.length;
    const widths = [];
    const slopes = [];
    const tangents = new Array(count).fill(0);
    for (let index = 0; index < count - 1; index += 1) {
      const width = Math.max(points[index + 1][0] - points[index][0], 0.0001);
      widths[index] = width;
      slopes[index] = (points[index + 1][1] - points[index][1]) / width;
    }
    tangents[0] = slopes[0];
    tangents[count - 1] = slopes[count - 2];
    for (let index = 1; index < count - 1; index += 1) {
      const previous = slopes[index - 1];
      const next = slopes[index];
      if (previous === 0 || next === 0 || previous * next <= 0) {
        tangents[index] = 0;
      } else {
        const previousWidth = widths[index - 1];
        const nextWidth = widths[index];
        const firstWeight = 2 * nextWidth + previousWidth;
        const secondWeight = nextWidth + 2 * previousWidth;
        tangents[index] =
          (firstWeight + secondWeight) /
          (firstWeight / previous + secondWeight / next);
      }
    }

    return function sampleCurve(input) {
      const x = clamp(input, 0, 1);
      let index = 0;
      while (index < count - 2 && x > points[index + 1][0]) index += 1;
      const start = points[index];
      const end = points[index + 1];
      const width = widths[index];
      const t = clamp((x - start[0]) / width, 0, 1);
      const t2 = t * t;
      const t3 = t2 * t;
      const value =
        (2 * t3 - 3 * t2 + 1) * start[1] +
        (t3 - 2 * t2 + t) * width * tangents[index] +
        (-2 * t3 + 3 * t2) * end[1] +
        (t3 - t2) * width * tangents[index + 1];
      return clamp(value, 0, 1);
    };
  }

  function buildLut(value) {
    const state = parseState(value);
    const composite = createSampler(state.composite);
    const red = createSampler(state.red);
    const green = createSampler(state.green);
    const blue = createSampler(state.blue);
    const data = new Uint8Array(LUT_SIZE * 4);
    for (let index = 0; index < LUT_SIZE; index += 1) {
      const common = composite(index / (LUT_SIZE - 1));
      const offset = index * 4;
      data[offset] = Math.round(red(common) * 255);
      data[offset + 1] = Math.round(green(common) * 255);
      data[offset + 2] = Math.round(blue(common) * 255);
      data[offset + 3] = 255;
    }
    return data;
  }

  function installStyle(getAsset) {
    if (!global.document || global.document.getElementById(STYLE_ID)) return;
    const bundled = typeof getAsset === "function" ? getAsset("text", STYLE_URL) : null;
    if (typeof bundled === "string") {
      const style = global.document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = bundled;
      global.document.head.appendChild(style);
      return;
    }
    const link = global.document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    global.document.head.appendChild(link);
  }

  function svgElement(document, name, className) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    if (className) element.setAttribute("class", className);
    return element;
  }

  function curvePath(points) {
    const sample = createSampler(points);
    const segments = 96;
    let result = "";
    for (let index = 0; index <= segments; index += 1) {
      const x = index / segments;
      const command = index === 0 ? "M" : "L";
      result += `${command}${(x * 256).toFixed(2)} ${((1 - sample(x)) * 256).toFixed(2)} `;
    }
    return result.trim();
  }

  function createCurveControl(property, context) {
    const document = context.document;
    const controls = context.controls;
    const root = document.createElement("div");
    root.className = "editbox zoidium-color-curves-control";
    const editor = document.createElement("div");
    editor.className = "zoidium-color-curves-editor";
    root.appendChild(editor);

    const toolbar = document.createElement("div");
    toolbar.className = "zoidium-color-curves-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Curve channel");
    editor.appendChild(toolbar);

    const channelButtons = new Map();
    for (const channel of CHANNELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zoidium-color-curves-channel";
      button.dataset.channel = channel.id;
      button.textContent = channel.shortName;
      button.title = `${channel.name} curve`;
      button.setAttribute("aria-label", button.title);
      toolbar.appendChild(button);
      channelButtons.set(channel.id, button);
    }

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "zoidium-color-curves-reset";
    reset.title = "Reset current curve";
    reset.setAttribute("aria-label", reset.title);
    if (context.PZ?.ui?.generateIcon) reset.appendChild(context.PZ.ui.generateIcon("reset"));
    const resetLabel = document.createElement("span");
    resetLabel.textContent = "Reset";
    reset.appendChild(resetLabel);
    toolbar.appendChild(reset);

    const graph = document.createElement("div");
    graph.className = "zoidium-color-curves-graph";
    graph.tabIndex = 0;
    graph.setAttribute("role", "application");
    graph.setAttribute(
      "aria-label",
      "Color curve graph. Click to add a point, drag to adjust it, and press Delete to remove it."
    );
    editor.appendChild(graph);

    const svg = svgElement(document, "svg", "zoidium-color-curves-svg");
    svg.setAttribute("viewBox", "0 0 256 256");
    svg.setAttribute("preserveAspectRatio", "none");
    graph.appendChild(svg);
    const diagonal = svgElement(document, "path", "zoidium-color-curves-diagonal");
    diagonal.setAttribute("d", "M0 256 L256 0");
    svg.appendChild(diagonal);
    const referencePath = svgElement(document, "path", "zoidium-color-curves-reference");
    svg.appendChild(referencePath);
    const activePath = svgElement(document, "path", "zoidium-color-curves-active");
    svg.appendChild(activePath);
    const pointsLayer = svgElement(document, "g", "zoidium-color-curves-points");
    svg.appendChild(pointsLayer);

    const footer = document.createElement("div");
    footer.className = "zoidium-color-curves-footer";
    const status = document.createElement("span");
    status.className = "zoidium-color-curves-status";
    status.setAttribute("aria-live", "polite");
    footer.appendChild(status);
    const hint = document.createElement("span");
    hint.className = "zoidium-color-curves-hint";
    hint.textContent = "Click to add";
    footer.appendChild(hint);
    editor.appendChild(footer);

    let state = parseState(property.get());
    let activeChannel = "composite";
    let selectedIndex = null;
    let drag = null;
    let editing = false;

    function activePoints() {
      return state[activeChannel];
    }

    function updateStatus() {
      const points = activePoints();
      const point = selectedIndex == null ? null : points[selectedIndex];
      if (!point) {
        status.textContent = `${CHANNELS.find((channel) => channel.id === activeChannel).name} curve`;
        return;
      }
      status.textContent = `Input ${Math.round(point[0] * 255)}  Output ${Math.round(point[1] * 255)}`;
    }

    function draw() {
      editor.dataset.channel = activeChannel;
      for (const channel of CHANNELS) {
        const button = channelButtons.get(channel.id);
        const selected = channel.id === activeChannel;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
      if (activeChannel === "composite") {
        referencePath.removeAttribute("d");
      } else {
        referencePath.setAttribute("d", curvePath(state.composite));
      }
      activePath.setAttribute("d", curvePath(activePoints()));
      pointsLayer.replaceChildren();
      activePoints().forEach((point, index) => {
        const group = svgElement(document, "g", "zoidium-color-curves-point-wrap");
        group.dataset.pointIndex = String(index);
        if (index === selectedIndex) group.classList.add("is-selected");
        group.setAttribute("transform", `translate(${point[0] * 256} ${(1 - point[1]) * 256})`);
        const hit = svgElement(document, "circle", "zoidium-color-curves-point-hit");
        hit.setAttribute("r", "11");
        group.appendChild(hit);
        const visible = svgElement(document, "circle", "zoidium-color-curves-point");
        visible.setAttribute("r", "4.5");
        group.appendChild(visible);
        pointsLayer.appendChild(group);
      });
      updateStatus();
    }

    function beginEdit() {
      editing = true;
      controls.editStart.call(editor, property);
    }

    function setPropertyValue() {
      property.set(serializeState(state));
      draw();
    }

    function finishEdit(discard) {
      controls.editFinish.call(editor, property, Boolean(discard));
      editing = false;
      root.pz_update();
    }

    function pointFromEvent(event) {
      const bounds = graph.getBoundingClientRect();
      return [
        clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
        clamp(1 - (event.clientY - bounds.top) / bounds.height, 0, 1),
      ];
    }

    function moveSelected(point) {
      const points = activePoints();
      if (selectedIndex == null || !points[selectedIndex]) return;
      const current = points[selectedIndex];
      const last = points.length - 1;
      const minimumX = selectedIndex === 0 ? 0 : points[selectedIndex - 1][0] + 1 / 1024;
      const maximumX = selectedIndex === last ? 1 : points[selectedIndex + 1][0] - 1 / 1024;
      current[0] = selectedIndex === 0 ? 0 : selectedIndex === last ? 1 : clamp(point[0], minimumX, maximumX);
      current[1] = clamp(point[1], 0, 1);
    }

    function graphPointerDown(event) {
      if (event.button !== 0 || drag) return;
      const pointTarget = event.target.closest?.("[data-point-index]");
      const points = activePoints();
      let created = false;
      if (pointTarget) {
        selectedIndex = Number(pointTarget.dataset.pointIndex);
      } else {
        if (points.length >= MAX_POINTS) return;
        const point = pointFromEvent(event);
        point[0] = clamp(point[0], 1 / 1024, 1 - 1 / 1024);
        selectedIndex = points.findIndex((candidate) => candidate[0] > point[0]);
        if (selectedIndex < 0) selectedIndex = points.length - 1;
        beginEdit();
        points.splice(selectedIndex, 0, point);
        created = true;
        setPropertyValue();
      }
      if (!created) beginEdit();
      drag = {
        pointerId: event.pointerId,
        created,
        moved: created,
        start: points[selectedIndex].slice(),
      };
      graph.focus();
      try {
        graph.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Pointer capture is optional; window listeners still finish the edit.
      }
      draw();
      event.preventDefault();
      event.stopPropagation();
    }

    function graphPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const next = pointFromEvent(event);
      const current = activePoints()[selectedIndex];
      moveSelected(next);
      if (Math.abs(current[0] - drag.start[0]) > 0.0001 || Math.abs(current[1] - drag.start[1]) > 0.0001) {
        drag.moved = true;
      }
      setPropertyValue();
      event.preventDefault();
    }

    function graphPointerUp(event) {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const discard = !drag.moved;
      try {
        graph.releasePointerCapture(drag.pointerId);
      } catch (_error) {
        // The pointer may already have been released by the browser.
      }
      drag = null;
      finishEdit(discard);
      event?.preventDefault?.();
    }

    function removeSelected() {
      const points = activePoints();
      if (selectedIndex == null || selectedIndex === 0 || selectedIndex === points.length - 1) return;
      beginEdit();
      points.splice(selectedIndex, 1);
      selectedIndex = Math.min(selectedIndex, points.length - 1);
      setPropertyValue();
      finishEdit(false);
    }

    function graphKeyDown(event) {
      if (event.key === "Escape") {
        selectedIndex = null;
        draw();
        event.stopPropagation();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        removeSelected();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const points = activePoints();
      if (selectedIndex == null || !points[selectedIndex]) return;
      const step = (event.shiftKey ? 10 : 1) / 255;
      const point = points[selectedIndex].slice();
      if (event.key === "ArrowLeft") point[0] -= step;
      if (event.key === "ArrowRight") point[0] += step;
      if (event.key === "ArrowUp") point[1] += step;
      if (event.key === "ArrowDown") point[1] -= step;
      beginEdit();
      moveSelected(point);
      setPropertyValue();
      finishEdit(false);
      event.preventDefault();
      event.stopPropagation();
    }

    for (const channel of CHANNELS) {
      channelButtons.get(channel.id).addEventListener("click", (event) => {
        activeChannel = channel.id;
        selectedIndex = null;
        draw();
        event.stopPropagation();
      });
    }

    reset.addEventListener("click", (event) => {
      event.stopPropagation();
      const points = activePoints();
      if (points.length === 2 && points[0][1] === 0 && points[1][1] === 1) return;
      beginEdit();
      state[activeChannel] = identityPoints();
      selectedIndex = null;
      setPropertyValue();
      finishEdit(false);
    });
    graph.addEventListener("pointerdown", graphPointerDown);
    graph.addEventListener("pointermove", graphPointerMove);
    graph.addEventListener("pointerup", graphPointerUp);
    graph.addEventListener("pointercancel", graphPointerUp);
    graph.addEventListener("keydown", graphKeyDown);
    graph.addEventListener("contextmenu", (event) => {
      const pointTarget = event.target.closest?.("[data-point-index]");
      if (pointTarget) {
        selectedIndex = Number(pointTarget.dataset.pointIndex);
        removeSelected();
      }
      event.preventDefault();
      event.stopPropagation();
    });

    root.pz_update = function updateCurveControl() {
      if (editing) return;
      state = parseState(property.get());
      const points = activePoints();
      if (selectedIndex != null && !points[selectedIndex]) selectedIndex = null;
      draw();
    };
    const queueTask = global.queueMicrotask || ((callback) => global.setTimeout(callback, 0));
    queueTask(() => root.closest("li")?.classList.add("zoidium-color-curves-row"));
    draw();
    return root;
  }

  const ColorCurves = global.ZoidiumColorCurves || Object.freeze({
    buildLut,
    createCurveControl,
    defaultValue: serializeState(defaultState()),
    install(getAsset) {
      installStyle(getAsset);
      global.ZoidiumPluginApis.propertyControls.register(CONTROL_ID, {
        type: global.PZ.property.type.TEXT,
        create: createCurveControl,
      });
    },
  });
  global.ZoidiumColorCurves = ColorCurves;
  ColorCurves.install(effect._zoidiumGetAsset);

  global.ZoidiumPluginApis.defineFilter.call(effect, {
    displayName: "Color Curves",
    fragShaderUrl: SHADER_URL,
    uniforms: {
      uvScale: { type: "v2", value: new global.THREE.Vector2(1, 1) },
      curveLUT: { type: "t", value: null },
    },
    properties: {
      enabled: {
        dynamic: true,
        name: "Enabled",
        type: global.PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
      },
      curves: {
        name: "Curves",
        type: global.PZ.property.type.TEXT,
        value: ColorCurves.defaultValue,
        zoidiumControl: CONTROL_ID,
        changed() {
          if (this.parentObject) this.parentObject._zoidiumCurvesDirty = true;
        },
      },
    },
    onLoad(effect) {
      const texture = new global.THREE.DataTexture(
        ColorCurves.buildLut(effect.properties.curves.get()),
        LUT_SIZE,
        1,
        global.THREE.RGBAFormat,
        global.THREE.UnsignedByteType
      );
      texture.name = "Zoidium Color Curves LUT";
      texture.wrapS = global.THREE.ClampToEdgeWrapping;
      texture.wrapT = global.THREE.ClampToEdgeWrapping;
      texture.minFilter = global.THREE.LinearFilter;
      texture.magFilter = global.THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      effect._zoidiumCurveTexture = texture;
      effect._zoidiumCurveValue = null;
      effect._zoidiumCurvesDirty = true;
      effect.pass.uniforms.curveLUT.value = texture;
    },
    onUnload(effect) {
      effect._zoidiumCurveTexture?.dispose();
      effect._zoidiumCurveTexture = null;
    },
    update(frame, uniforms) {
      this.pass.enabled = this.properties.enabled.get(frame) === 1;
      const value = this.properties.curves.get();
      if (!this._zoidiumCurvesDirty && value === this._zoidiumCurveValue) return;
      this._zoidiumCurveTexture.image.data.set(ColorCurves.buildLut(value));
      this._zoidiumCurveTexture.needsUpdate = true;
      uniforms.curveLUT.value = this._zoidiumCurveTexture;
      this._zoidiumCurveValue = value;
      this._zoidiumCurvesDirty = false;
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this, this);
