(function (global) {
  "use strict";

  // Nodes and fields for the Zoidium node editor: inline value editors,
  // node rows and bodies, and full graph rendering on the editor scope.
  // Installed on the editor scope by nodeEditor() in
  // zoidium/ui-node-editor.js (see postInitScripts in
  // zoidium/runtime-config.js); it owns no public surface itself.

  var parts = global.ZoidiumNodeEditorParts = global.ZoidiumNodeEditorParts || {};

  // Defines the rendering helpers on cx. Parameter edits commit through
  // cx.setParam, which nodeEditor() provides.
  parts.createFields = function (cx) {
    function el(tag, className, text) {
      var node = cx.doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function svgEl(tag, className) {
      var node = cx.doc.createElementNS(C.SVG_NS, tag);
      if (className) node.setAttribute("class", className);
      return node;
    }

    var C = parts.consts;
    var KEY_SEP = C.KEY_SEP;
    var DRAG_PX = C.DRAG_PX;
    var MISSING_TINT = C.MISSING_TINT;
    var DEFAULT_SIZE = C.DEFAULT_SIZE;
    var base = parts.base;
    var hasOwn = base.hasOwn;
    var isObject = base.isObject;
    var finiteOr = base.finiteOr;
    var clamp = base.clamp;
    var decimalsFor = base.decimalsFor;
    var colorFor = base.colorFor;
    var tintForCategory = base.tintForCategory;
    var typeSpec = base.typeSpec;
    var findNode = base.findNode;
    var findPort = base.findPort;
    var anchorKey = base.anchorKey;
    var linkPathD = parts.graphTools.linkPathD;

      // ---- rendering -----------------------------------------------------

      function paramOr(node, key, fallback) {
        return hasOwn(node.params, key) ? node.params[key] : fallback;
      }

      function defaultFor(spec, key) {
        var list = spec.params.concat(spec.inputs);
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].id === key) return list[i].default;
        }
        return undefined;
      }

      function portTypeOf(nodeId, dir, portId) {
        var node = findNode(cx.graph, nodeId);
        var port = node ? findPort(cx.types, node.type, dir, portId) : null;
        return port ? port.type : "float";
      }

      function formatNumber(value, decimals) {
        return String(Number(Number(value).toFixed(decimals)));
      }

      function formatValue(value) {
        if (Array.isArray(value)) return value.map(function (item) { return formatValue(item); }).join(", ");
        if (typeof value === "number") return formatNumber(value, 3);
        return value == null ? "" : String(value);
      }

      function hexOf(value) {
        return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#000000";
      }

      function toVector(value, count) {
        var out = [];
        for (var i = 0; i < count; i += 1) {
          out.push(finiteOr(Array.isArray(value) ? value[i] : undefined, 0));
        }
        return out;
      }

      function readonlyText(value) {
        return el("span", "zoidium-node-editor-value", formatValue(value));
      }

      function numberField(value, spec, commit) {
        var decimals = decimalsFor(spec.step);
        var min = finiteOr(spec.min, null);
        var max = finiteOr(spec.max, null);
        var stepUnit = spec.step > 0 ? spec.step : 0.01;
        var committed = finiteOr(value, 0);
        var input = el("input", "zoidium-node-editor-control zoidium-node-editor-number");
        input.type = "text";
        input.spellcheck = false;
        input.autocomplete = "off";
        input.disabled = cx.readOnly;
        input.value = formatNumber(committed, decimals);
        var dirty = false;
        var drag = null;

        function clampValue(next) {
          var result = next;
          if (min !== null) result = Math.max(min, result);
          if (max !== null) result = Math.min(max, result);
          return Number(result.toFixed(decimals));
        }

        input.addEventListener("pointerdown", function (event) {
          if (cx.readOnly || event.button !== 0) return;
          drag = { id: event.pointerId, x: event.clientX, start: committed, value: committed, moved: false };
          event.preventDefault();
          try { input.setPointerCapture(event.pointerId); } catch (_error) { /* optional */ }
        });
        input.addEventListener("pointermove", function (event) {
          if (!drag || event.pointerId !== drag.id) return;
          var delta = event.clientX - drag.x;
          if (!drag.moved && Math.abs(delta) < DRAG_PX) return;
          drag.moved = true;
          var multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
          drag.value = clampValue(drag.start + delta * stepUnit * multiplier);
          input.value = formatNumber(drag.value, decimals);
        });
        input.addEventListener("pointerup", function (event) {
          if (!drag || event.pointerId !== drag.id) return;
          var done = drag;
          drag = null;
          try { input.releasePointerCapture(event.pointerId); } catch (_error) { /* optional */ }
          if (done.moved) {
            commit(done.value);
          } else {
            input.focus();
            input.select();
          }
        });
        input.addEventListener("pointercancel", function () {
          if (!drag) return;
          drag = null;
          input.value = formatNumber(committed, decimals);
        });
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            dirty = false;
            input.value = formatNumber(committed, decimals);
            input.blur();
          }
        });
        input.addEventListener("input", function () { dirty = true; });
        input.addEventListener("blur", function () {
          if (!dirty) return;
          dirty = false;
          if (cx.rendering || cx.destroyed) return;
          var parsed = Number(input.value.trim());
          if (input.value.trim() === "" || !Number.isFinite(parsed)) {
            input.value = formatNumber(committed, decimals);
            return;
          }
          var next = clampValue(parsed);
          if (next === committed) {
            input.value = formatNumber(committed, decimals);
            return;
          }
          commit(next);
        });
        return input;
      }

      function vectorField(value, spec, commit) {
        var count = Array.isArray(spec.default) ? clamp(spec.default.length, 2, 3) : 3;
        var base = toVector(value, count);
        var wrap = el("div", "zoidium-node-editor-vector");
        base.forEach(function (component, index) {
          wrap.appendChild(numberField(component, spec, function (next) {
            var copy = base.slice();
            copy[index] = next;
            commit(copy);
          }));
        });
        return wrap;
      }

      function colorField(value, commit) {
        var input = el("input", "zoidium-node-editor-control zoidium-node-editor-color");
        input.type = "color";
        input.value = hexOf(value);
        input.disabled = cx.readOnly;
        input.addEventListener("change", function () { commit(hexOf(input.value)); });
        return input;
      }

      function checkboxField(value, commit) {
        var input = el("input", "zoidium-node-editor-control zoidium-node-editor-check");
        input.type = "checkbox";
        input.checked = Boolean(value);
        input.disabled = cx.readOnly;
        input.addEventListener("change", function () { commit(input.checked); });
        return input;
      }

      function textField(value, commit) {
        var input = el("input", "zoidium-node-editor-control zoidium-node-editor-text");
        input.type = "text";
        input.spellcheck = false;
        input.value = value == null ? "" : String(value);
        input.disabled = cx.readOnly;
        input.addEventListener("change", function () { commit(input.value); });
        input.addEventListener("keydown", function (event) {
          if (event.key === "Escape") {
            event.preventDefault();
            input.value = value == null ? "" : String(value);
            input.blur();
          }
        });
        return input;
      }

      function selectField(value, options, commit) {
        var list = Array.isArray(options) ? options.filter(isObject) : [];
        var select = el("select", "zoidium-node-editor-control zoidium-node-editor-select");
        select.disabled = cx.readOnly;
        list.forEach(function (option, index) {
          var item = el("option", "", option.label != null ? String(option.label) : String(option.value));
          item.value = String(index);
          if (option.value === value) item.selected = true;
          select.appendChild(item);
        });
        select.addEventListener("change", function () {
          var option = list[Number(select.value)];
          if (option) commit(option.value);
        });
        return select;
      }

      // Inline value for an unlinked input with a default. Returns null for
      // types that have no inline editor.
      function inlineField(port, value, commit) {
        var type = port.type;
        if (type === "float" || type === "int" || type === "number") return numberField(value, port, commit);
        if (type === "color") return colorField(value, commit);
        if (type === "vector") return vectorField(value, port, commit);
        if (type === "bool" || type === "boolean") return checkboxField(value, commit);
        return null;
      }

      function rampField(value, node, param, commit) {
        var stops = JSON.parse(JSON.stringify(value));
        if (!cx.rampSelection) cx.rampSelection = new Map();
        var selected = Math.min(cx.rampSelection.get(node.id) || 0, stops.length - 1);
        var root = el("div", "zoidium-node-editor-control zoidium-node-editor-ramp");
        var track = el("div", "zoidium-node-editor-ramp-track");
        track.title = "Drag a stop to change its position. Use arrow keys for fine adjustment.";
        root.appendChild(track);
        var controls = el("div", "zoidium-node-editor-ramp-fields"); root.appendChild(controls);
        var handles = [];
        function remember() { cx.rampSelection.set(node.id, selected); }
        function save(refocus) {
          var stop = stops[selected];
          stops.sort(function (a, b) { return a[0] - b[0]; }); selected = stops.indexOf(stop); remember(); commit(stops);
          if (refocus) {
            var current = cx.nodeEls.get(node.id);
            var handle = current && current.querySelectorAll(".zoidium-node-editor-ramp-stop")[selected];
            if (handle) handle.focus({ preventScroll: true });
          }
        }
        function cssColor(s) { return "rgba(" + s.slice(1, 4).map(function (c) { return Math.round(c * 255); }).join(",") + "," + s[4] + ")"; }
        function paint() {
          var sorted = stops.slice().sort(function (a, b) { return a[0] - b[0]; });
          var mode = paramOr(node, "interpolation", 1);
          if (mode === 0) sorted = sorted.flatMap(function (s, index) { return index + 1 < sorted.length ? [s, [sorted[index + 1][0]].concat(s.slice(1))] : [s]; });
          else if (param.sample && mode > 1) sorted = Array.from({ length: 65 }, function (_, index) { return [index / 64].concat(Array.from(param.sample(sorted, index / 64, mode, new Float64Array(4)))); });
          track.style.backgroundImage = "linear-gradient(to right," + sorted.map(function (s) { return cssColor(s) + " " + s[0] * 100 + "%"; }).join(",") + ")";
          handles.forEach(function (h, index) {
            h.style.left = stops[index][0] * 100 + "%"; h.style.backgroundColor = cssColor(stops[index]);
            h.classList.toggle("selected", index === selected);
            h.setAttribute("aria-valuenow", String(stops[index][0]));
          });
        }
        function editControls() {
          controls.replaceChildren();
          var stop = stops[selected];
          var picker = colorField("#" + stop.slice(1, 4).map(function (c) { return Math.round(c * 255).toString(16).padStart(2, "0"); }).join(""), function (hex) {
            for (var c = 0; c < 3; c++) stop[c + 1] = parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) / 255;
            save();
          });
          picker.setAttribute("aria-label", "Stop color"); controls.appendChild(picker);
          [["Position", 0], ["Alpha", 4]].forEach(function (entry) {
            var label = el("label", "", entry[0]);
            var input = numberField(stop[entry[1]], { min: 0, max: 1, step: .001 }, function (v) { stop[entry[1]] = v; save(); });
            input.setAttribute("aria-label", "Stop " + entry[0].toLowerCase()); label.appendChild(input); controls.appendChild(label);
          });
          var add = el("button", "zoidium-node-editor-control", "+"); add.type = "button"; add.title = "Add color stop"; add.setAttribute("aria-label", add.title); add.disabled = cx.readOnly || stops.length >= 256;
          add.addEventListener("click", function () {
            var next = stops[selected + 1], pos = next ? (stop[0] + next[0]) / 2 : (stop[0] + 1) / 2;
            stops.push([pos].concat(stop.slice(1))); selected = stops.length - 1; save();
          }); controls.appendChild(add);
          var remove = el("button", "zoidium-node-editor-control", "−"); remove.type = "button"; remove.title = "Remove color stop"; remove.setAttribute("aria-label", remove.title); remove.disabled = cx.readOnly || stops.length <= 1;
          remove.addEventListener("click", removeSelected); controls.appendChild(remove);
        }
        function removeSelected() { if (cx.readOnly || stops.length <= 1) return; stops.splice(selected, 1); selected = Math.max(0, selected - 1); save(true); }
        stops.forEach(function (stop, index) {
          var handle = el("button", "zoidium-node-editor-control zoidium-node-editor-ramp-stop"); handle.type = "button";
          handle.setAttribute("role", "slider"); handle.setAttribute("aria-label", "Color stop " + (index + 1)); handle.setAttribute("aria-valuemin", "0"); handle.setAttribute("aria-valuemax", "1");
          handle.disabled = cx.readOnly; var drag = null;
          handle.addEventListener("pointerdown", function (event) {
            if (cx.readOnly || event.button !== 0) return;
            selected = index; remember(); editControls(); paint(); handle.focus();
            drag = { id: event.pointerId, start: stop[0] }; handle.setPointerCapture(event.pointerId); event.stopPropagation(); event.preventDefault();
          });
          handle.addEventListener("pointermove", function (event) {
            if (!drag || drag.id !== event.pointerId) return;
            var bounds = track.getBoundingClientRect(); stop[0] = Math.round(clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * 1000) / 1000; paint();
          });
          handle.addEventListener("pointerup", function (event) {
            if (!drag || drag.id !== event.pointerId) return;
            var changed = stop[0] !== drag.start; drag = null; handle.releasePointerCapture(event.pointerId); if (changed) save(true);
          });
          handle.addEventListener("pointercancel", function () { if (drag) stop[0] = drag.start; drag = null; paint(); });
          handle.addEventListener("keydown", function (event) {
            event.stopPropagation(); selected = index; remember();
            if (event.key === "Escape" && drag) { stop[0] = drag.start; drag = null; paint(); event.preventDefault(); }
            else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
            else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault(); stop[0] = event.key === "Home" ? 0 : event.key === "End" ? 1 : clamp(stop[0] + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? .1 : .01), 0, 1); save(true);
            }
          });
          handles.push(handle); track.appendChild(handle);
        });
        root.addEventListener("keydown", function (event) { event.stopPropagation(); });
        editControls(); paint(); return root;
      }

      function paramControl(node, param) {
        var value = paramOr(node, param.id, param.default);
        var commit = function (next) { cx.setParam(node.id, param.id, next, param.label); };
        if (param.control === "ramp") return rampField(value, node, param, commit);
        if (param.createControl) {
          var custom = param.createControl(value, commit); custom.classList.add("zoidium-node-editor-control");
          custom.addEventListener("keydown", function (event) { event.stopPropagation(); });
          if (cx.readOnly) { custom.style.pointerEvents = "none"; custom.querySelectorAll("button,input").forEach(function (control) { control.disabled = true; }); }
          return custom;
        }
        switch (param.control) {
          case "number": return numberField(value, param, commit);
          case "select": return selectField(value, param.options, commit);
          case "color": return colorField(value, commit);
          case "checkbox": return checkboxField(value, commit);
          case "text": return textField(value, commit);
          default: return readonlyText(value);
        }
      }

      function socketFor(node, dir, port) {
        var socket = el("span", "zoidium-node-editor-socket " + dir);
        socket.dataset.nodeId = node.id;
        socket.dataset.dir = dir;
        socket.dataset.port = port.id;
        socket.dataset.type = port.type;
        socket.style.background = colorFor(port.type);
        socket.title = port.label + " (" + port.type + ")";
        cx.socketEls.set(anchorKey(node.id, dir, port.id), socket);
        return socket;
      }

      function inputRow(node, port) {
        var row = el("div", "zoidium-node-editor-row in");
        row.appendChild(socketFor(node, "in", port));
        row.appendChild(el("span", "zoidium-node-editor-label", port.label));
        if (!cx.linkedInputs.has(node.id + KEY_SEP + port.id) && port.default !== undefined) {
          var field = inlineField(port, paramOr(node, port.id, port.default), function (next) {
            cx.setParam(node.id, port.id, next, port.label);
          });
          if (field) {
            if (port.type === "vector") row.classList.add("stacked");
            row.appendChild(field);
          }
        }
        return row;
      }

      function outputRow(node, port) {
        var row = el("div", "zoidium-node-editor-row out");
        row.appendChild(el("span", "zoidium-node-editor-label", port.label));
        row.appendChild(socketFor(node, "out", port));
        return row;
      }

      function paramsBlock(node, spec) {
        var block = el("div", "zoidium-node-editor-params");
        spec.params.forEach(function (param) {
          var row = el("div", "zoidium-node-editor-row param");
          if (["ramp", "curve"].includes(param.control)) row.classList.add("stacked");
          row.appendChild(el("span", "zoidium-node-editor-label", param.label));
          if (param.socket) row.insertBefore(socketFor(node, "in", { id: param.id, label: param.label, type: param.control === "color" ? "color" : "float" }), row.firstChild);
          var field = paramControl(node, param);
          if (param.socket && cx.linkedInputs.has(node.id + KEY_SEP + param.id)) {
            row.classList.add("linked");
            field.style.pointerEvents = "none";
            field.setAttribute("aria-disabled", "true");
            if (field.matches("input,select,button")) field.disabled = true;
            field.querySelectorAll("input,select,button").forEach(function (control) { control.disabled = true; });
          }
          row.appendChild(field);
          block.appendChild(row);
        });
        return block;
      }

      function missingBody(node) {
        var body = el("div", "zoidium-node-editor-missing");
        body.appendChild(el("p", "zoidium-node-editor-note", "Unknown node type \"" + node.type + "\". Its data is kept unchanged."));
        Object.keys(node.params || {}).forEach(function (key) {
          var row = el("div", "zoidium-node-editor-row param");
          row.appendChild(el("span", "zoidium-node-editor-label", key));
          row.appendChild(readonlyText(node.params[key]));
          body.appendChild(row);
        });
        return body;
      }

      function buildNode(node) {
        var spec = typeSpec(cx.types, node.type);
        var element = el("div", "zoidium-node-editor-node");
        element.dataset.nodeId = node.id;
        if (!cx.connectedNodes.has(node.id)) { element.classList.add("unconnected"); element.title = "Not connected to Output"; }
        element.style.left = node.x + "px";
        element.style.top = node.y + "px";
        if (cx.selected.has(node.id)) element.classList.add("selected");
        var head = el("div", "zoidium-node-editor-head");
        head.appendChild(el("span", "zoidium-node-editor-title", spec ? spec.title : "Missing: " + node.type));
        element.appendChild(head);
        if (!spec) {
          element.classList.add("missing");
          element.style.setProperty("--zne-tint", MISSING_TINT);
          element.appendChild(missingBody(node));
          return element;
        }
        element.style.setProperty("--zne-tint", spec.color || tintForCategory(spec.category));
        var toggle = el("button", "zoidium-node-editor-toggle");
        toggle.type = "button";
        toggle.title = cx.collapsed.has(node.id) ? "Expand" : "Collapse";
        toggle.setAttribute("aria-label", toggle.title);
        toggle.appendChild(el("span", "zoidium-node-editor-caret"));
        toggle.addEventListener("click", function (event) {
          event.stopPropagation();
          if (cx.collapsed.has(node.id)) cx.collapsed.delete(node.id);
          else cx.collapsed.add(node.id);
          render();
        });
        head.insertBefore(toggle, head.firstChild);
        if (cx.collapsed.has(node.id)) {
          element.classList.add("collapsed");
          return element;
        }
        var ports = el("div", "zoidium-node-editor-ports");
        spec.inputs.forEach(function (port) { if (!spec.params.some(function (param) { return param.socket && param.id === port.id; })) ports.appendChild(inputRow(node, port)); });
        spec.outputs.forEach(function (port) { ports.appendChild(outputRow(node, port)); });
        element.appendChild(ports);
        if (spec.params.length) element.appendChild(paramsBlock(node, spec));
        if (spec.hint) element.appendChild(el("p", "zoidium-node-editor-hint", spec.hint));
        return element;
      }

      function render() {
        if (cx.destroyed) return;
        cx.rendering = true;
        try {
          cx.nodeLayer.textContent = "";
          cx.linkLayer.textContent = "";
          cx.nodeEls.clear();
          cx.socketEls.clear();
          cx.linkEls.clear();
          cx.linkedInputs = new Set();
          cx.graph.links.forEach(function (link) {
            cx.linkedInputs.add(link.to.node + KEY_SEP + link.to.port);
          });
          cx.connectedNodes = parts.graphTools.connectedToOutput(cx.graph);
          cx.graph.nodes.forEach(function (node) {
            var element = buildNode(node);
            cx.nodeLayer.appendChild(element);
            cx.nodeEls.set(node.id, element);
          });
          cx.graph.links.forEach(function (link) {
            var path = svgEl("path", "zoidium-node-editor-link");
            path.setAttribute("stroke", colorFor(portTypeOf(link.from.node, "out", link.from.port)));
            cx.linkLayer.appendChild(path);
            cx.linkEls.set(link.id, path);
          });
        } finally {
          cx.rendering = false;
        }
        cx.measure();
        if (cx.pendingFrame) cx.frameNodes(null);
        redrawLinks();
      }

      function redrawLinks() {
        if (cx.destroyed) return;
        var index = cx.indexNodes();
        cx.graph.links.forEach(function (link) {
          var path = cx.linkEls.get(link.id);
          if (!path) return;
          var from = index.get(link.from.node);
          var to = index.get(link.to.node);
          if (!from || !to) {
            path.setAttribute("d", "");
            return;
          }
          var a = cx.anchorAt(from, "out", link.from.port);
          var b = cx.anchorAt(to, "in", link.to.port);
          path.setAttribute("d", linkPathD(a.x, a.y, b.x, b.y));
          var className = "zoidium-node-editor-link";
          if (cx.selected.has(to.id)) className += " lit";
          if (cx.pickedLinkId === link.id) className += " picked";
          path.setAttribute("class", className);
        });
      }

      function scheduleLinks() {
        if (cx.linkFrame || cx.destroyed) return;
        cx.linkFrame = global.requestAnimationFrame(function () {
          cx.linkFrame = 0;
          redrawLinks();
        });
      }

      function updateSelectionVisuals() {
        cx.nodeEls.forEach(function (element, nodeId) {
          element.classList.toggle("selected", cx.selected.has(nodeId));
        });
        scheduleLinks();
      }
    cx.rampField = rampField;
    cx.render = render;
    cx.redrawLinks = redrawLinks;
    cx.scheduleLinks = scheduleLinks;
    cx.updateSelectionVisuals = updateSelectionVisuals;
    cx.paramOr = paramOr;
    cx.defaultFor = defaultFor;
    cx.portTypeOf = portTypeOf;
  };
  // Reuse the exact Node Effect ramp widget in native property rows.
  parts.createRampControl = function (options) {
    var cx = { doc: options.document, readOnly: !!options.readOnly, nodeEls: new Map(), rampSelection: options.selection || new Map() };
    parts.createFields(cx);
    var node = { id: "ramp", params: { interpolation: options.interpolation } };
    var root = cx.rampField(options.stops, node, { sample: options.sample }, options.onChange);
    cx.nodeEls.set(node.id, root);
    return root;
  };
})(window);
