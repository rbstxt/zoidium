(function installRenderTimeColumn(global) {
  "use strict";

  const PZ = global.PZ;
  const timing = global.ZoidiumRenderTime;
  const timeline = PZ?.ui?.timeline?.prototype;
  if (!timing || !timeline?.create) return;
  const controls = new Set();
  const rows = new Set();
  const entries = new WeakMap();
  const explanation = "Render Time for the last preview frame. GPU measures elapsed draw time. CPU measures draw submission. Worker and media waits are excluded.";

  function renderCell(entry) {
    const { row, editor, object, kind } = entry;
    if (!timing.enabled) {
      if (entry.cell) {
        entry.cell.remove();
        entry.cell = null;
        if (kind === "track") row.style.gridTemplateColumns = entry.columns;
      }
      return;
    }
    if (!entry.cell) {
      const cell = row.ownerDocument.createElement("span");
      cell.className = "zoidium-render-time-cell zoidium-render-time-" + kind;
      cell.style.cssText = "display:inline-block;box-sizing:border-box;width:100px;padding:0 5px;" +
        "font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap";
      if (kind === "track") {
        entry.columns = row.style.gridTemplateColumns;
        row.insertBefore(cell, row.lastElementChild);
        row.style.gridTemplateColumns = ["minmax(0, 1fr)", ...Array(row.children.length - 1).fill("auto")].join(" ");
      } else {
        row.children[1].insertBefore(cell, row.children[1].firstChild);
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
    if (cell.textContent !== text) cell.textContent = text;
    if (cell.title !== title) cell.title = title;
    if (cell.dataset.load !== level) {
      cell.dataset.load = level;
      cell.style.color = color;
      cell.style.fontWeight = level === "heavy" ? "600" : "";
    }
  }

  function remember(row, editor, object, kind) {
    const entry = { row, editor, object, kind, cell: null };
    entries.set(row, entry);
    rows.add(new WeakRef(row));
    if (timing.enabled) renderCell(entry);
  }

  function updateToggle(button) {
    button.setAttribute("aria-pressed", String(timing.enabled));
    button.style.color = timing.enabled ? "var(--zui-value, #70c29d)" : "var(--zui-text-muted, #999)";
  }

  function refresh(updateToggles) {
    if (updateToggles) {
      for (const ref of controls) {
        const button = ref.deref();
        if (button) updateToggle(button);
        else controls.delete(ref);
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
    button.className = "actionbutton zoidium-render-time-toggle";
    button.textContent = "Render Time";
    button.title = explanation;
    button.style.cssText = "position:absolute;right:4px;top:4px;height:22px;padding:0 5px;" +
      "font-size:11px;border:1px solid var(--zui-border, #444);border-radius:3px;" +
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
    updateToggle(button);
    return result;
  };

  const tracks = PZ.ui.timeline.tracks?.prototype;
  if (tracks?.createTrackLabel) {
    const createTrackLabel = tracks.createTrackLabel;
    tracks.createTrackLabel = function (track, type) {
      const row = createTrackLabel.apply(this, arguments);
      if (type === 0) remember(row, this.timeline.editor, track, "track");
      return row;
    };
  }

  const edit = PZ.ui.edit?.prototype;
  if (edit?.generateListItem) {
    const generate = edit.generateListItem;
    edit.generateListItem = function (parent, object) {
      const row = generate.apply(this, arguments);
      if (object instanceof PZ.layer || object instanceof PZ.effect) remember(row, this.editor, object, "object");
      return row;
    };
  }

  global.ZoidiumRenderTimeColumn = { refresh };
})(window);
