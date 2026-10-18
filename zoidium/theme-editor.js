(function (global) {
  "use strict";
  var builder = global.ZoidiumUIBuilder, model = builder.themeModel, state = builder.themeEditor;
  var labels = { focus: "Focus/selection", link: "Link text", clip: "Clip", clipSelected: "Selected clip", clipSelection: "Selection band" };
  function el(tag, className, text) {
    var node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, fn, label) {
    var node = el("button", "pz-inputbox", text); node.type = "button";
    if (label) { node.setAttribute("aria-label", label); node.title = label; }
    node.addEventListener("click", fn);
    return node;
  }
  function rgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16) / 255; }); }
  function hex(rgbColor) { return "#" + rgbColor.slice(0, 3).map(function (v) { return Math.round(v * 255).toString(16).padStart(2, "0"); }).join(""); }
  function rename() {
    var current = state.selected();
    if (!current) return;
    var value, field;
    var win = global.ZoidiumUI.openWindow({
      id: "zoidium:theme-name", title: "Rename theme", width: 380, height: 170, placement: "center",
      minWidth: 300, minHeight: 160, resizable: false, collapsible: false,
      mount: function (body, mounted) {
        field = el("input", "pz-inputbox zoidium-theme-name"); field.value = current.name; field.maxLength = 100;
        field.setAttribute("aria-label", "Theme name"); body.appendChild(field);
        value = function () {
          if (!field.value.trim() || state.selected()?.id !== current.id) return;
          state.rename(field.value); mounted.close();
        };
        field.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); value(); } });
        mounted.setFooter([{ title: "Cancel", onClick: function () { mounted.close(); } }, { title: "Rename", variant: "primary", onClick: value }]);
      },
    });
    if (win) { field.focus(); field.select(); }
  }
  state.open = function () {
    var existing = global.ZoidiumUI.getWindow("zoidium:theme-editor");
    if (existing) { existing.reveal(); return existing; }
    state.openSession();
    return global.ZoidiumUI.openWindow({
      id: "zoidium:theme-editor", title: "Theme Editor", persistKey: "zoidium.theme-editor",
      width: 560, height: 640, minWidth: 500, minHeight: 400, resizable: true,
      className: "zoidium-theme-editor",
      mount: function (body, win) {
        var rows = [], clipRows = [], pickers = [], signature = "", disposed = false;
        var toolbar = el("div", "zoidium-theme-toolbar");
        var select = el("select", "pz-inputbox zoidium-theme-select");
        select.setAttribute("aria-label", "Theme"); toolbar.appendChild(select);
        select.addEventListener("change", function () { state.select(select.value); });
        toolbar.appendChild(button("Duplicate", function () { state.duplicate(); }));
        var renameButton = button("Rename", rename), deleteButton = button("Delete", async function () {
          var id = state.selected()?.id;
          if (!id) return;
          if (await global.ZoidiumUI.confirm({ title: "Delete theme", message: 'Delete "' + state.name() + '"?', confirmLabel: "Delete", danger: true })) {
            if (state.selected()?.id === id) state.remove();
          }
        });
        toolbar.append(renameButton, deleteButton);
        var file = el("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true;
        file.setAttribute("aria-label", "Import theme file");
        file.addEventListener("change", async function () {
          try {
            var source = file.files[0];
            if (!source) return;
            if (source.size > 262144) throw new Error("Choose a theme JSON file smaller than 256 KB.");
            var text = await source.text();
            if (!disposed) state.import(text);
          } catch (error) { status.textContent = error.message; }
          finally { file.value = ""; }
        });
        toolbar.appendChild(button("Import…", function () { file.click(); }));
        toolbar.appendChild(button("Export…", function () {
          var blob = new Blob([state.export()], { type: "application/json" });
          var url = URL.createObjectURL(blob), link = el("a");
          link.href = url; link.download = state.name().replace(/[^a-z0-9 _-]/gi, "_") + ".json";
          global.document.body.appendChild(link); link.click(); link.remove();
          global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }));
        body.append(toolbar, file);
        var statusRow = el("div", "zoidium-theme-status-row");
        var status = el("span", "zoidium-theme-status"); status.setAttribute("role", "status");
        var undoButton = button("↶", state.undo, "Undo theme edit"), redoButton = button("↷", state.redo, "Redo theme edit");
        statusRow.append(status, undoButton, redoButton); body.appendChild(statusRow);

        function colorRow(label, section, key) {
          var row = el("div", "zoidium-theme-color-row");
          row.appendChild(el("span", "zoidium-theme-color-label", label));
          var input = el("input", "pz-inputbox zoidium-theme-hex"); input.type = "text"; input.spellcheck = false;
          input.maxLength = 7; input.setAttribute("aria-label", label + " hex color");
          input.setAttribute("aria-description", "Enter a six-digit hex color, then press Enter to apply.");
          var picker = new global.PZ.ui.colorPicker({
            editStart: function () { state.beginPreview(); },
            editFinish: function (cancelled) { state.finishPreview(cancelled); },
            changed: function (value) { state.preview(section, key, hex(value)); },
          });
          pickers.push(picker);
          picker.el.setAttribute("aria-label", label + " color"); picker.el.title = label + " color";
          row.append(picker.el, input);
          function applyInput() {
            var value = model.color(input.value);
            input.setAttribute("aria-invalid", value ? "false" : "true");
            if (value) state.edit(section, key, value);
          }
          input.addEventListener("input", function () { input.setAttribute("aria-invalid", model.color(input.value) ? "false" : "true"); });
          input.addEventListener("keydown", function (event) {
            if (event.key === "Enter") { event.preventDefault(); applyInput(); }
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); refresh(); }
          });
          var mode, reset;
          if (section !== "main") {
            mode = el("select", "pz-inputbox zoidium-theme-mode"); mode.setAttribute("aria-label", label + " color mode");
            ["Auto", "Custom"].forEach(function (text) { var option = el("option", "", text); option.value = text.toLowerCase(); mode.appendChild(option); });
            mode.addEventListener("change", function () {
              state.edit(section, key, mode.value === "auto" ? null : currentColor());
            });
            reset = button("↶", function () { state.edit(section, key, null); }, "Reset " + label + " color to Auto");
            row.append(mode, reset);
          }
          function currentColor() {
            var theme = state.selected(), palette = state.palette();
            if (section === "main") return theme ? theme.main : palette.focus;
            return section === "overrides" ? palette[key] : theme?.clips[key] || palette.clip;
          }
          function update() {
            var value = currentColor(), custom = Boolean(state.selected()?.[section]?.[key]);
            if (!picker.editing) picker.update(rgb(value));
            if (global.document.activeElement !== input || input.getAttribute("aria-invalid") !== "true") {
              input.value = value; input.setAttribute("aria-invalid", "false");
            }
            if (mode) { mode.value = custom ? "custom" : "auto"; reset.disabled = !custom; }
          }
          update();
          return { element: row, update: update, picker: picker };
        }
        function addRow(parent, label, section, key, target) {
          var row = colorRow(label, section, key); parent.appendChild(row.element); target.push(row);
        }
        body.appendChild(el("h3", "zoidium-theme-heading", "Main color"));
        addRow(body, "Main", "main", null, rows);
        var preview = el("div", "zoidium-theme-preview");
        Object.keys(labels).forEach(function (key) {
          var item = el("div", "zoidium-theme-preview-item");
          item.dataset.color = key; item.title = labels[key];
          item.appendChild(el("span", "", labels[key])); preview.appendChild(item);
        });
        body.appendChild(preview);
        var advanced = el("details", "zoidium-theme-advanced");
        advanced.appendChild(el("summary", "zoidium-theme-heading", "Advanced"));
        Object.keys(labels).forEach(function (key) { addRow(advanced, labels[key], "overrides", key, rows); });
        body.appendChild(advanced);
        var clipHeading = el("div", "zoidium-theme-clip-heading");
        clipHeading.appendChild(el("h3", "zoidium-theme-heading", "Clip colors by layer type"));
        var resetAll = button("Reset all", state.resetClips); resetAll.classList.add("zoidium-theme-link"); clipHeading.appendChild(resetAll);
        body.appendChild(clipHeading);
        var clips = el("div", "zoidium-theme-clips"); body.appendChild(clips);
        win.setFooter([{ title: "Revert", onClick: state.revert }, { title: "Done", variant: "primary", onClick: function () { win.close(); } }]);
        var revertButton = win.footer.querySelector("button");
        function refresh() {
          if (disposed) return;
          var options = model.PRESETS.map(function (preset) { return { value: preset.value, label: preset.label, group: "Built-in" }; })
            .concat(state.themes().map(function (theme) { return { value: theme.id, label: theme.name, group: "My themes" }; }));
          select.replaceChildren();
          ["Built-in", "My themes"].forEach(function (name) {
            var group = el("optgroup"); group.label = name;
            options.filter(function (item) { return item.group === name; }).forEach(function (item) {
              var option = el("option", "", item.label); option.value = item.value; group.appendChild(option);
            }); select.appendChild(group);
          });
          select.value = state.selection(); renameButton.disabled = deleteButton.disabled = !state.selected();
          rows.forEach(function (row) { row.update(); });
          var palette = state.palette();
          Array.from(preview.children).forEach(function (item) {
            var color = palette[item.dataset.color]; item.style.backgroundColor = color; item.style.color = model.labelColor(color);
          });
          var types = builder.themeClips.types(), nextSignature = JSON.stringify(types);
          if (signature !== nextSignature) {
            clipRows.forEach(function (row) { if (row.picker.editing) row.picker.close(true); });
            clipRows = []; clips.replaceChildren(); signature = nextSignature;
            types.forEach(function (type) { addRow(clips, type.name, "clips", type.key, clipRows); });
          }
          clipRows.forEach(function (row) { row.update(); });
          status.textContent = state.status() || (state.selected() ? "Changes save automatically. Undo is available in this window." : "Built-in preset. Editing creates a copy in My themes.");
          undoButton.disabled = !state.canUndo(); redoButton.disabled = !state.canRedo();
          revertButton.disabled = !state.isDirty(); resetAll.disabled = !Object.keys(state.selected()?.clips || {}).length;
        }
        function onKey(event) {
          var typing = /^(INPUT|TEXTAREA)$/.test(event.target.tagName);
          if ((event.ctrlKey || event.metaKey) && !typing && /^(z|y)$/i.test(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (event.key.toLowerCase() === "y" || event.shiftKey) state.redo(); else state.undo();
          }
        }
        win.element.addEventListener("keydown", onKey);
        global.addEventListener("zoidium:theme-changed", refresh);
        global.addEventListener("zoidium:theme-types-changed", refresh);
        refresh();
        return function () {
          disposed = true;
          global.removeEventListener("zoidium:theme-changed", refresh);
          global.removeEventListener("zoidium:theme-types-changed", refresh);
          win.element.removeEventListener("keydown", onKey);
          pickers.forEach(function (picker) { if (picker.editing) picker.close(false); });
        };
      },
    });
  };
})(window);
