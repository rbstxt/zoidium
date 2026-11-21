(function installRenderTimeColumn(global) {
  "use strict";

  const PZ = global.PZ;
  const timing = global.ZoidiumRenderTime;
  const timeline = PZ?.ui?.timeline?.prototype;
  if (!timing || !timeline?.create) return;
  const controls = new Set();
  const timelines = new WeakMap();
  const gutters = new WeakMap();
  const rows = new Set();
  const entries = new WeakMap();
  const explanation = "Render Time for the last preview frame. GPU measures elapsed draw time. CPU measures draw submission. Worker and media waits are excluded.";

  const width = "92px";
  const style = global.document.createElement("style");
  style.textContent = `
    .zoidium-render-time-keyframe, .zoidium-render-time-keyframe-lane { display: block !important; }
    .zoidium-render-time-keyframe {
      position: relative;
      padding-right: calc(${width} + 24px) !important;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .zoidium-render-time-keyframe::after {
      content: attr(data-render-time);
      position: absolute;
      inset: 0 24px 0 auto;
      box-sizing: border-box;
      width: ${width};
      padding: 0 5px;
      color: var(--zoidium-render-time-color);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
  `;
  global.document.head.appendChild(style);

  function gutter(timeline, tracks = timeline.tracks) {
    const keyframes = timeline.keyframes;
    const header = timeline.timestamp.parentNode;
    if (!tracks || !keyframes) return;
    let layout = gutters.get(timeline);
    if (!layout && timing.enabled) {
      layout = [
        ...[header, keyframes.labels, tracks.labels, tracks.videoLabels, tracks.audioLabels].map(el => [el, "width", el.style.width]),
        ...[timeline.timerule, timeline.scrollBar, timeline.markermask, keyframes.container, tracks.container].map(el => [el, "left", el.style.left]),
      ];
      gutters.set(timeline, layout);
    }
    if (!layout) return;
    for (const [el, property, initial] of layout) {
      el.style[property] = timing.enabled ? "calc(" + initial + " + 40px)" : initial;
    }
    if (!timing.enabled) gutters.delete(timeline);
  }

  function renderCell(entry) {
    const { row, editor, object, kind } = entry;
    if (!timing.enabled) {
      if (kind === "keyframe") {
        row.classList.remove("zoidium-render-time-keyframe");
        entry.lane.classList.remove("zoidium-render-time-keyframe-lane");
        delete row.dataset.renderTime;
        row.title = row.textContent;
        row.style.removeProperty("--zoidium-render-time-color");
      }
      if (entry.cell) {
        entry.cell.remove();
        entry.cell = null;
        if (kind === "track") row.style.gridTemplateColumns = entry.columns;
      }
      return;
    }
    if (!entry.cell && kind !== "keyframe") {
      const cell = row.ownerDocument.createElement("span");
      cell.className = "zoidium-render-time-cell zoidium-render-time-" + kind;
      cell.style.cssText = "display:inline-block;box-sizing:border-box;width:" + width + ";padding:0 5px;" +
        "font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap";
      if (kind === "track") {
        entry.columns = row.style.gridTemplateColumns;
        row.insertBefore(cell, row.lastElementChild);
        row.style.gridTemplateColumns = ["minmax(0, 1fr)", ...Array(row.children.length - 1).fill("auto")].join(" ");
      } else {
        row.children[1].appendChild(cell);
      }
      entry.cell = cell;
    }

    const cell = entry.cell;
    const value = kind === "track" ? timing.readTrack(editor, object) : timing.read(editor, object);
    const percent = value?.budget ? value.ms / value.budget * 100 : 0;
    const level = percent >= 50 ? "heavy" : percent >= 10 ? "moderate" : "light";
    const color = {
      heavy: "var(--zui-danger, #df9b9b)",
      moderate: "color-mix(in srgb, var(--zui-danger, #df9b9b) 60%, var(--zui-text, #ccc))",
      light: "var(--zui-text-muted, #999)",
    }[level];
    let text = "—";
    let title = "No draw in the last preview frame";
    if (value?.cached) {
      text = "Cached";
      title = "The preview reused rendered pixels";
    } else if (value) {
      const ms = value.ms < 10 ? value.ms.toFixed(2) : value.ms.toFixed(1);
      text = ms + " ms " + value.basis + (value.samplesCached ? "*" : "");
      title = ms + " ms " + (value.basis === "GPU" ? "GPU draw time" : "CPU draw submission");
      if (value.budget) title += " · " + Math.round(percent) + "% of frame budget";
      if (value.samplesCached) title += " · Reused temporal samples";
    }
    if (kind === "keyframe") {
      row.classList.add("zoidium-render-time-keyframe");
      entry.lane.classList.add("zoidium-render-time-keyframe-lane");
      if (row.dataset.renderTime !== text) row.dataset.renderTime = text;
      const tooltip = row.textContent + " · " + title;
      if (row.title !== tooltip) row.title = tooltip;
      row.style.setProperty("--zoidium-render-time-color", color);
      return;
    }
    if (cell.textContent !== text) cell.textContent = text;
    if (cell.title !== title) cell.title = title;
    if (cell.dataset.load !== level) {
      cell.dataset.load = level;
      cell.style.color = color;
      cell.style.fontWeight = level === "heavy" ? "600" : "";
    }
  }

  function remember(row, editor, object, kind, lane) {
    const ref = new WeakRef(row);
    const entry = { row, editor, object, kind, lane, ref, cell: null };
    entries.set(row, entry);
    rows.add(ref);
    if (timing.enabled) renderCell(entry);
  }

  function forget(row) {
    const entry = entries.get(row);
    if (entry) rows.delete(entry.ref);
    entries.delete(row);
  }

  function updateToggle(button) {
    button.setAttribute("aria-pressed", String(timing.enabled));
    button.style.color = timing.enabled ? "var(--zui-value, #70c29d)" : "var(--zui-text-muted, #999)";
  }

  function refresh(updateToggles) {
    if (updateToggles) {
      for (const ref of controls) {
        const button = ref.deref();
        if (!button) {
          controls.delete(ref);
          continue;
        }
        updateToggle(button);
        const panel = timelines.get(button);
        gutter(panel);
        panel.resize?.();
      }
    }
    for (const ref of rows) {
      const row = ref.deref();
      if (row) renderCell(entries.get(row));
      else rows.delete(ref);
    }
  }

  const create = timeline.create;
  timeline.create = function () {
    const result = create.apply(this, arguments);
    const header = this.timestamp.parentNode;
    const button = header.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "zoidium-render-time-toggle";
    button.textContent = "Render Time";
    button.title = explanation;
    button.style.cssText = "position:absolute;right:4px;top:4px;height:22px;padding:0 5px;" +
      "font:inherit;font-size:11px;white-space:nowrap;border:1px solid var(--zui-border, #444);border-radius:3px;" +
      "background:var(--zui-bg-input, #222);cursor:pointer";
    button.onclick = event => {
      event.stopPropagation();
      timing.setEnabled(!timing.enabled);
    };
    button.addEventListener("mousedown", event => event.stopPropagation());
    header.appendChild(button);
    this.timestamp.style.width = "calc(100% - 84px)";
    const input = header.querySelector('[aria-label="Jump to frame or timecode"]');
    if (input) input.style.width = "calc(100% - 84px)";
    controls.add(new WeakRef(button));
    timelines.set(button, this);
    updateToggle(button);
    return result;
  };

  const tracks = PZ.ui.timeline.tracks?.prototype;
  if (tracks?.createTrackLabel) {
    const createTracks = tracks.create;
    tracks.create = function () {
      const result = createTracks.apply(this, arguments);
      gutter(this.timeline, this);
      return result;
    };
    const createTrackLabel = tracks.createTrackLabel;
    tracks.createTrackLabel = function (track, type) {
      const row = createTrackLabel.apply(this, arguments);
      if (type === 0) remember(row, this.timeline.editor, track, "track");
      return row;
    };
  }

  const keyframes = PZ.ui.timeline.keyframes?.prototype;
  if (keyframes?.createKeyframeTrack) {
    const createTrack = keyframes.createKeyframeTrack;
    const unloadTrack = keyframes.unloadKeyframeTrack;
    keyframes.createKeyframeTrack = function (parent, object) {
      const lane = createTrack.apply(this, arguments);
      if (lane?.pz_label && (object instanceof PZ.layer || object instanceof PZ.effect)) {
        remember(lane.pz_label, this.timeline.editor, object, "keyframe", lane);
      }
      return lane;
    };
    keyframes.unloadKeyframeTrack = function (lane) {
      forget(lane.pz_label);
      return unloadTrack.apply(this, arguments);
    };
  }

  const edit = PZ.ui.edit?.prototype;
  if (edit?.generateListItem) {
    const unload = edit.unloadListItem;
    edit.unloadListItem = function (row) {
      forget(row);
      return unload.apply(this, arguments);
    };
    const generate = edit.generateListItem;
    edit.generateListItem = function (parent, object) {
      const row = generate.apply(this, arguments);
      if (object instanceof PZ.layer || object instanceof PZ.effect) remember(row, this.editor, object, "object");
      return row;
    };
  }

  global.ZoidiumRenderTimeColumn = { refresh };
})(window);
