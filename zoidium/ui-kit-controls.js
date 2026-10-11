(function (global) {
  "use strict";

  // Form controls for the Zoidium UI kit: window contents that look and
  // behave like CM3 property rows. Loaded before zoidium/ui-kit.js, which
  // publishes the controls table on the frozen ZoidiumUI surface (see
  // postInitScripts in zoidium/runtime-config.js).

  // ---------------------------------------------------------------------
  // Form controls
  //
  // Builders for window contents that look and behave like CM3 property
  // rows. Each returns { element, get(), set(value), setDisabled(bool) }.
  // onInput fires continuously while the user drags; onChange fires once
  // when an edit is committed, which is where callers record undo history.

  function el(tag, className, text) {
    var node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function call(fn, value) {
    if (typeof fn === "function") fn(value);
  }

  function labeledRow(label, hint) {
    var row = el("div", "zoidium-field");
    var name = el("span", "zoidium-field-label", label || "");
    name.title = hint || label || "";
    row.appendChild(name);
    var slot = el("div", "zoidium-field-control");
    row.appendChild(slot);
    return { row: row, slot: slot };
  }

  function roundTo(value, step) {
    if (!step || !Number.isFinite(step)) return value;
    var decimals = (String(step).split(".")[1] || "").length;
    return Number((Math.round(value / step) * step).toFixed(Math.min(6, decimals)));
  }

  function formatNumber(value, step) {
    if (!Number.isFinite(value)) return "0";
    var decimals = step ? (String(step).split(".")[1] || "").length : 3;
    return String(Number(value.toFixed(Math.min(6, decimals))));
  }

  // CM3-style scrubbable number: drag horizontally to change, click to type.
  function number(options) {
    var config = options || {};
    var min = Number.isFinite(config.min) ? config.min : -Infinity;
    var max = Number.isFinite(config.max) ? config.max : Infinity;
    var step = Number(config.step) || 0.01;
    var value = clampNumber(Number(config.value) || 0, min, max);
    var parts = labeledRow(config.label, config.hint);
    var input = el("input", "pzinput zoidium-number");
    input.type = "text";
    input.inputMode = "decimal";
    input.spellcheck = false;
    input.value = formatNumber(value, step);
    if (config.unit) parts.slot.appendChild(el("span", "zoidium-field-unit", config.unit));
    parts.slot.insertBefore(input, parts.slot.firstChild);
    var editing = false;

    function apply(next, commit) {
      next = roundTo(clampNumber(Number(next), min, max), step);
      if (!Number.isFinite(next)) next = value;
      var changed = next !== value;
      value = next;
      input.value = formatNumber(value, step);
      if (changed || commit) call(commit ? config.onChange : config.onInput, value);
    }
    function stopEdit(commit) {
      if (!editing) return;
      editing = false;
      input.classList.remove("edit");
      if (commit) {
        var parsed = Number(String(input.value).replace(",", "."));
        if (Number.isFinite(parsed)) apply(parsed, true);
        else input.value = formatNumber(value, step);
      } else {
        input.value = formatNumber(value, step);
      }
    }
    input.readOnly = true;
    input.addEventListener("pointerdown", function (event) {
      if (editing || input.disabled || event.button !== 0) return;
      event.preventDefault();
      var startX = event.clientX;
      var startValue = value;
      var moved = false;
      var speed = Number(config.dragSpeed) || step;
      try { input.setPointerCapture(event.pointerId); } catch (_error) { /* optional */ }
      function move(moveEvent) {
        var delta = moveEvent.clientX - startX;
        if (!moved && Math.abs(delta) < 3) return;
        moved = true;
        var scale = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
        apply(startValue + delta * speed * scale, false);
      }
      function up() {
        input.removeEventListener("pointermove", move);
        input.removeEventListener("pointerup", up);
        input.removeEventListener("pointercancel", up);
        if (moved) {
          call(config.onChange, value);
          return;
        }
        editing = true;
        input.readOnly = false;
        input.classList.add("edit");
        input.focus();
        input.select();
      }
      input.addEventListener("pointermove", move);
      input.addEventListener("pointerup", up);
      input.addEventListener("pointercancel", up);
    });
    input.addEventListener("keydown", function (event) {
      if (!editing) return;
      if (event.key === "Enter") { stopEdit(true); input.readOnly = true; input.blur(); }
      if (event.key === "Escape") { event.preventDefault(); stopEdit(false); input.readOnly = true; input.blur(); }
    });
    input.addEventListener("blur", function () { stopEdit(true); input.readOnly = true; });

    return {
      element: parts.row,
      input: input,
      get: function () { return value; },
      set: function (next) {
        value = clampNumber(Number(next) || 0, min, max);
        if (!editing) input.value = formatNumber(value, step);
      },
      setDisabled: function (disabled) {
        input.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  // Range slider with an attached scrubbable number.
  function slider(options) {
    var config = options || {};
    var min = Number.isFinite(config.min) ? config.min : 0;
    var max = Number.isFinite(config.max) ? config.max : 1;
    var step = Number(config.step) || (max - min) / 100;
    var parts = labeledRow(config.label, config.hint);
    parts.row.classList.add("zoidium-field-slider");
    var range = el("input", "zoidium-range");
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    var numberControl = number({
      min: config.softLimit ? -Infinity : min,
      max: config.softLimit ? Infinity : max,
      step: step,
      value: config.value,
      unit: config.unit,
      dragSpeed: config.dragSpeed || (max - min) / 200,
      onInput: function (value) { range.value = String(value); call(config.onInput, value); },
      onChange: function (value) { range.value = String(value); call(config.onChange, value); },
    });
    var numberInput = numberControl.element.querySelector(".zoidium-field-control");
    range.value = String(numberControl.get());
    range.addEventListener("input", function () {
      numberControl.set(Number(range.value));
      call(config.onInput, numberControl.get());
    });
    range.addEventListener("change", function () {
      numberControl.set(Number(range.value));
      call(config.onChange, numberControl.get());
    });
    parts.slot.appendChild(range);
    parts.slot.appendChild(numberInput);
    return {
      element: parts.row,
      get: numberControl.get,
      set: function (value) { numberControl.set(value); range.value = String(numberControl.get()); },
      setDisabled: function (disabled) {
        range.disabled = Boolean(disabled);
        numberControl.setDisabled(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  function checkbox(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var box = el("input", "zoidium-checkbox");
    box.type = "checkbox";
    box.checked = Boolean(config.value);
    box.setAttribute("aria-label", config.label || "");
    box.addEventListener("change", function () { call(config.onChange, box.checked); });
    parts.slot.appendChild(box);
    parts.row.querySelector(".zoidium-field-label").addEventListener("click", function () {
      if (box.disabled) return;
      box.checked = !box.checked;
      call(config.onChange, box.checked);
    });
    return {
      element: parts.row,
      get: function () { return box.checked; },
      set: function (value) { box.checked = Boolean(value); },
      setDisabled: function (disabled) {
        box.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  // options: [{ value, label }] or plain strings.
  function select(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var node = el("select", "pz-inputbox zoidium-select");
    node.setAttribute("aria-label", config.label || "");
    // Items with a `group` field are placed in <optgroup>s in first-seen order.
    function fill(list) {
      node.textContent = "";
      var groups = {};
      (list || []).forEach(function (item) {
        var option = el("option");
        var value = item && typeof item === "object" ? item.value : item;
        option.value = String(value);
        option.textContent = item && typeof item === "object" ? String(item.label != null ? item.label : value) : String(item);
        var group = item && typeof item === "object" && item.group ? String(item.group) : "";
        if (!group) {
          node.appendChild(option);
          return;
        }
        if (!groups[group]) {
          groups[group] = el("optgroup");
          groups[group].label = group;
          node.appendChild(groups[group]);
        }
        groups[group].appendChild(option);
      });
    }
    fill(config.options);
    if (config.value != null) node.value = String(config.value);
    node.addEventListener("change", function () { call(config.onChange, node.value); });
    parts.slot.appendChild(node);
    return {
      element: parts.row,
      get: function () { return node.value; },
      set: function (value) { node.value = String(value); },
      setOptions: function (list, value) { fill(list); if (value != null) node.value = String(value); },
      setDisabled: function (disabled) {
        node.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  function color(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var node = el("input", "zoidium-color");
    node.type = "color";
    node.value = /^#[0-9a-f]{6}$/i.test(config.value || "") ? config.value : "#ffffff";
    var hex = el("span", "zoidium-color-hex", node.value);
    node.addEventListener("input", function () { hex.textContent = node.value; call(config.onInput, node.value); });
    node.addEventListener("change", function () { hex.textContent = node.value; call(config.onChange, node.value); });
    parts.slot.appendChild(hex);
    parts.slot.appendChild(node);
    return {
      element: parts.row,
      get: function () { return node.value; },
      set: function (value) {
        if (/^#[0-9a-f]{6}$/i.test(value || "")) { node.value = value; hex.textContent = value; }
      },
      setDisabled: function (disabled) {
        node.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  function text(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var node = el(config.multiline ? "textarea" : "input", "pz-inputbox zoidium-text");
    if (!config.multiline) node.type = "text";
    else node.rows = config.rows || 4;
    node.value = config.value != null ? String(config.value) : "";
    if (config.placeholder) node.placeholder = config.placeholder;
    node.spellcheck = false;
    node.addEventListener("input", function () { call(config.onInput, node.value); });
    node.addEventListener("change", function () { call(config.onChange, node.value); });
    if (config.multiline) parts.row.classList.add("zoidium-field-stacked");
    parts.slot.appendChild(node);
    return {
      element: parts.row,
      get: function () { return node.value; },
      set: function (value) { node.value = value != null ? String(value) : ""; },
      setDisabled: function (disabled) {
        node.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  // variant: "primary" | "danger" | undefined
  function button(options) {
    var config = options || {};
    var node = el("button", "proprow propbutton zoidium-button" + (config.variant ? " " + config.variant : ""), config.title || "");
    node.type = "button";
    if (config.hint) node.title = config.hint;
    if (config.disabled) node.disabled = true;
    node.addEventListener("click", function (event) {
      if (typeof config.onClick === "function") config.onClick(event);
    });
    return {
      element: node,
      get: function () { return node.textContent; },
      set: function (title) { node.textContent = title; },
      setDisabled: function (disabled) { node.disabled = Boolean(disabled); },
    };
  }

  function buttonRow(buttons) {
    var row = el("div", "zoidium-button-row");
    (buttons || []).forEach(function (spec) {
      if (spec) row.appendChild((spec.element ? spec : button(spec)).element);
    });
    return { element: row };
  }

  // Collapsible group with a CM3 section title.
  function section(options) {
    var config = typeof options === "string" ? { title: options } : (options || {});
    var wrap = el("div", "zoidium-section");
    var head = el("button", "zoidium-section-title noselect");
    head.type = "button";
    var caret = el("span", "zoidium-section-caret", "▾");
    head.appendChild(caret);
    head.appendChild(el("span", "", config.title || ""));
    var content = el("div", "zoidium-section-body");
    wrap.appendChild(head);
    wrap.appendChild(content);
    function setCollapsed(value) {
      wrap.classList.toggle("collapsed", Boolean(value));
      head.setAttribute("aria-expanded", value ? "false" : "true");
    }
    setCollapsed(config.collapsed);
    head.addEventListener("click", function () {
      setCollapsed(!wrap.classList.contains("collapsed"));
    });
    return { element: wrap, body: content, setCollapsed: setCollapsed };
  }

  // tabs: [{ id, title, render(body) }]. Panels render lazily on first show.
  function tabs(options) {
    var config = Array.isArray(options) ? { tabs: options } : (options || {});
    var wrap = el("div", "zoidium-tabs");
    var strip = el("div", "zoidium-tabstrip noselect");
    strip.setAttribute("role", "tablist");
    var panels = el("div", "zoidium-tabpanels");
    wrap.appendChild(strip);
    wrap.appendChild(panels);
    var entries = [];
    function show(id) {
      entries.forEach(function (entry) {
        var active = entry.spec.id === id;
        entry.tab.classList.toggle("selected", active);
        entry.tab.setAttribute("aria-selected", active ? "true" : "false");
        entry.panel.hidden = !active;
        if (active && !entry.rendered && typeof entry.spec.render === "function") {
          entry.rendered = true;
          entry.spec.render(entry.panel);
        }
      });
      call(config.onChange, id);
    }
    (config.tabs || []).forEach(function (spec) {
      var tab = el("button", "zoidium-tab", spec.title || spec.id);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      var panel = el("div", "zoidium-tabpanel");
      panel.hidden = true;
      tab.addEventListener("click", function () { show(spec.id); });
      strip.appendChild(tab);
      panels.appendChild(panel);
      entries.push({ spec: spec, tab: tab, panel: panel, rendered: false });
    });
    if (entries.length) show(config.value || entries[0].spec.id);
    return { element: wrap, show: show };
  }

  // Selectable list in CM3 option style. items: [{ id, title, detail }].
  function list(options) {
    var config = options || {};
    var node = el("ul", "pz-options zoidium-list");
    node.setAttribute("role", "listbox");
    var selected = config.value != null ? config.value : null;
    function render(items) {
      node.textContent = "";
      if (!items || !items.length) {
        node.appendChild(el("li", "zoidium-list-empty", config.emptyText || "Nothing here yet."));
        return;
      }
      items.forEach(function (item) {
        var row = el("li", item.id === selected ? "active" : "");
        row.tabIndex = 0;
        row.setAttribute("role", "option");
        row.dataset.id = String(item.id);
        row.appendChild(el("b", "", item.title || String(item.id)));
        if (item.detail && item.detail !== item.title) row.appendChild(el("span", "", item.detail));
        row.addEventListener("click", function () {
          selected = item.id;
          Array.from(node.children).forEach(function (child) {
            child.classList.toggle("active", child === row);
          });
          call(config.onSelect, item.id);
        });
        row.addEventListener("dblclick", function () { call(config.onActivate, item.id); });
        row.addEventListener("keydown", function (event) {
          if (event.key === "Enter") { row.click(); call(config.onActivate, item.id); }
        });
        node.appendChild(row);
      });
    }
    render(config.items);
    return {
      element: node,
      get: function () { return selected; },
      set: function (id) {
        selected = id;
        Array.from(node.children).forEach(function (child) {
          child.classList.toggle("active", child.dataset.id === String(id));
        });
      },
      setItems: render,
    };
  }

  function note(message, variant) {
    return { element: el("p", "zoidium-note" + (variant ? " " + variant : ""), message || "") };
  }

  var controls = Object.freeze({
    number: number,
    slider: slider,
    checkbox: checkbox,
    select: select,
    color: color,
    text: text,
    button: button,
    buttonRow: buttonRow,
    section: section,
    tabs: tabs,
    list: list,
    note: note,
  });

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }


  var builder = global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {};
  builder.controls = controls;
})(window);
