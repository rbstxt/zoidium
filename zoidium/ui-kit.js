(function (global) {
  "use strict";

  // Shared helpers for extending the CM3 editor chrome. New panels, tabs,
  // headers, and notifications should go through this module instead of
  // copying the elevator/legacy boilerplate into each feature file.
  //
  // Usage:
  //   var header = global.ZoidiumUI.createPageHeader("My Panel");
  //   panel.appendChild(header);
  //
  //   global.ZoidiumUI.createMenubarTab({
  //     title: "My Panel",
  //     icon: "settings",
  //     panel: panel,
  //     tabClass: "zoidium-my-panel-tab",
  //   });
  //
  //   global.ZoidiumUI.notify({ title: "Saved.", message: "Done." });
  //
  //   var search = global.ZoidiumUI.createSearchBox({ placeholder: "type to filter" });
  //   panel.appendChild(search.wrap);
  //   global.ZoidiumUI.attachSearchFilter(search.input, list);
  //
  //   var button = global.ZoidiumUI.createButton({ title: "Download", onClick: onDownload });
  //
  //   var layoutRow = global.ZoidiumUI.createDropdownRow({
  //     title: "Editor layout", items: ["A", "B"],
  //     get: function () { return 0; },
  //     set: function (index) {},
  //   });
  //
  //   var hueRow = global.ZoidiumUI.createTextInputRow({
  //     title: "Hue shift", get: function () { return "0"; },
  //     set: function (value) {}, inputWidth: "80px",
  //   });
  //
  //   var interval = global.ZoidiumUI.createSelectRow({
  //     title: "Automatic backup interval",
  //     options: [{ value: "5", label: "5 minutes" }],
  //     value: "5",
  //     onChange: function (value) {},
  //   });
  //   panel.appendChild(interval.row);

  function getElevator() {
    if (!global.document) return null;
    var tabs = global.document.querySelector(".elevatortabs");
    var controls = global.document.querySelector(".elevatorcontrols");
    if (!tabs || !controls) return null;
    var elevator = tabs.parentElement && tabs.parentElement.parentElement
      ? tabs.parentElement.parentElement.pz_panel
      : null;
    if (!elevator || typeof elevator.changeTab !== "function") return null;
    return { tabs: tabs, controls: controls, elevator: elevator };
  }

  function legacyControls() {
    var PZ = global.PZ;
    return (PZ && PZ.ui && PZ.ui.controls && PZ.ui.controls.legacy) || null;
  }

  function findAboutTab(tabs) {
    return Array.from(tabs.children).find(function (item) {
      return item.title === "About";
    }) || null;
  }

  // Creates an elevator menubar tab for a full-area panel. Returns the tab
  // element, or null when the sidebar is unavailable. When a tab with the
  // same tabClass already exists, the existing tab is returned so repeated
  // installs stay idempotent.
  function createMenubarTab(options) {
    var config = options || {};
    if (!config.title || !config.panel) return null;
    if (!global.document) return null;
    if (config.tabClass && global.document.querySelector("." + config.tabClass)) {
      return global.document.querySelector("." + config.tabClass);
    }
    var PZ = global.PZ;
    if (!PZ || !PZ.ui || typeof PZ.ui.generateIcon !== "function") return null;
    var hosts = getElevator();
    if (!hosts) return null;

    var panel = config.panel;
    panel.style.top = "0";
    panel.style.left = "0";
    panel.style.width = "100%";
    panel.style.height = "100%";

    var descriptor = {
      title: config.title,
      icon: config.icon || "settings",
      el: panel,
      editor: config.editor || hosts.elevator.editor,
      enabled: false,
      needsResize: false,
      resize: function () {},
    };
    var tab = global.document.createElement("a");
    if (config.tabClass) tab.className = config.tabClass;
    tab.title = config.title;
    tab.pz_tab = descriptor;
    tab.pz_container = panel;
    tab.appendChild(PZ.ui.generateIcon(descriptor.icon));
    var label = global.document.createElement("span");
    label.textContent = config.title;
    tab.appendChild(label);

    var aboutTab = findAboutTab(hosts.tabs);
    if (config.position === "afterAbout") {
      if (aboutTab && aboutTab.nextElementSibling) hosts.tabs.insertBefore(tab, aboutTab.nextElementSibling);
      else hosts.tabs.appendChild(tab);
    } else if (aboutTab) {
      hosts.tabs.insertBefore(tab, aboutTab);
    } else {
      hosts.tabs.appendChild(tab);
    }
    hosts.controls.appendChild(panel);
    hosts.elevator.panels.push(descriptor);
    tab.onclick = hosts.elevator.buttonClick.bind(hosts.elevator);
    tab.onkeydown = hosts.elevator.buttonKeyDown;
    return tab;
  }

  // Builds the standard page header used at the top of sidebar panels such
  // as Plugins and Restore. The returned element carries the CM3
  // proprow/proptitle chrome; callers may add their own layout class.
  function createPageHeader(title) {
    var header = global.document.createElement("div");
    header.className = "proprow proptitle noselect";
    header.style.textOverflow = "ellipsis";
    header.style.overflow = "hidden";
    header.style.whiteSpace = "nowrap";
    header.style.paddingRight = "5px";
    var label = global.document.createElement("span");
    label.className = "proplabel";
    label.title = title || "";
    label.textContent = title || "";
    label.style.fontSize = "18px";
    label.style.fontWeight = "bold";
    header.appendChild(label);
    return header;
  }

  // Sends a toast notification through the shared renderer in
  // project-restore.js. Keeps feature files free of direct CustomEvent
  // construction for the common case.
  function notify(detail) {
    global.dispatchEvent(new CustomEvent("zoidium:notification", {
      detail: detail || {},
    }));
  }

  // Builds the filter search row used above panel lists (Plugins panel,
  // CM3 pickers). Returns { wrap, input }; wire it with
  // attachSearchFilter. Falls back to plain CM3 classes when document
  // is unavailable is not a case callers need to handle.
  function createSearchBox(options) {
    var config = options || {};
    var placeholder = config.placeholder || "type to filter";
    var wrap = global.document.createElement("div");
    wrap.className = "zoidium-plugin-search";
    var input = global.document.createElement("input");
    input.className = "pz-filterbox";
    input.type = "text";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", config.ariaLabel || placeholder);
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  // Filters list children as the user types. Entries match against
  // dataset.searchText when present, otherwise their text content.
  // Escape clears the query. Returns the update function so callers can
  // re-run it after the list changes.
  function attachSearchFilter(input, list, options) {
    var config = options || {};
    var entrySelector = config.entrySelector || ".zoidium-plugin-entry";
    function entryText(entry) {
      if (typeof config.getText === "function") return config.getText(entry);
      if (entry.dataset && entry.dataset.searchText) return entry.dataset.searchText;
      return String(entry.textContent || "").toLowerCase();
    }
    function update() {
      var query = String(input.value || "").replace(/\s+/g, " ").trim().toLowerCase();
      Array.from(list.querySelectorAll(entrySelector)).forEach(function (entry) {
        entry.hidden = Boolean(query) && entryText(entry).indexOf(query) === -1;
      });
    }
    input.addEventListener("input", update);
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      input.value = "";
      update();
    });
    return update;
  }

  // Creates a CM3 chrome button (same builder behind Settings rows and
  // the debug-log download button). Falls back to a plain proprow
  // button when the legacy controls are unavailable.
  function createButton(options) {
    var config = options || {};
    var legacy = legacyControls();
    if (legacy && typeof legacy.generateButton === "function") {
      return legacy.generateButton({
        title: config.title || "",
        clickfn: typeof config.onClick === "function" ? config.onClick : function () {},
      });
    }
    var button = global.document.createElement("button");
    button.type = "button";
    button.className = "proprow propbutton";
    button.textContent = config.title || "";
    if (typeof config.onClick === "function") button.addEventListener("click", config.onClick);
    return button;
  }

  // Builds the panel title row (Settings header, debug-log section
  // header). Prefers the legacy builder so titles stay identical to
  // CM3 panels; the fallback carries the same proprow/proptitle chrome.
  function createTitleRow(title) {
    var legacy = legacyControls();
    if (legacy && typeof legacy.generateTitle === "function") {
      return legacy.generateTitle({ title: title || "" });
    }
    var row = global.document.createElement("div");
    row.className = "proprow proptitle noselect";
    row.style.textOverflow = "ellipsis";
    row.style.overflow = "hidden";
    row.style.whiteSpace = "nowrap";
    row.style.paddingRight = "5px";
    var label = global.document.createElement("span");
    label.className = "proplabel";
    label.title = title || "";
    label.textContent = title || "";
    label.style.fontSize = "18px";
    label.style.fontWeight = "bold";
    row.appendChild(label);
    return row;
  }

  // Builds the small explanatory row below a setting (Settings layout
  // note, debug-log description). Accepts either a plain string or
  // { content, get, scope } for live text.
  function createDescriptionRow(options) {
    var legacy = legacyControls();
    var config = (typeof options === "string") ? { content: options } : (options || {});
    if (legacy && typeof legacy.generateDescription === "function") {
      var descriptor = {};
      if (typeof config.get === "function") descriptor.get = config.get;
      else descriptor.content = config.content || "";
      return legacy.generateDescription(descriptor, config.scope || {});
    }
    var row = global.document.createElement("div");
    row.className = "proprow noselect";
    var text = global.document.createElement("span");
    row.appendChild(text);
    row.pz_update = function () {
      text.innerHTML = typeof config.get === "function"
        ? config.get.call(config.scope || {})
        : (config.content || "");
    };
    row.pz_update();
    return row;
  }

  // Builds the spacer row between panel sections. Prefers the legacy
  // builder; the fallback carries the same proprow/spacer chrome.
  function createSpacer() {
    var legacy = legacyControls();
    if (legacy && typeof legacy.generateSpacer === "function") {
      return legacy.generateSpacer();
    }
    var spacer = global.document.createElement("div");
    spacer.className = "proprow spacer";
    return spacer;
  }

  // Builds an index-based dropdown row with the same chrome as CM3
  // native panels (Settings rows, Device render selects): label on the
  // left, control pinned to the right edge by the shared .proprow grid.
  // items is an array of labels; get returns the selected index and set
  // receives it. Falls back to identical DOM when legacy is unavailable.
  function createDropdownRow(options) {
    var config = options || {};
    var legacy = legacyControls();
    var items = Array.isArray(config.items) ? config.items : [];
    var scope = config.scope || {};
    var get = typeof config.get === "function" ? config.get : function () { return 0; };
    var set = typeof config.set === "function" ? config.set : function () {};
    if (legacy && typeof legacy.generateDropdown === "function") {
      return legacy.generateDropdown({
        title: config.title || "",
        items: items.join(";"),
        get: function () { return get.call(scope); },
        set: function (index) { set.call(scope, index); },
      }, scope);
    }
    var row = global.document.createElement("div");
    row.className = "proprow noselect";
    if (config.rowClass) row.classList.add(config.rowClass);
    var label = global.document.createElement("span");
    label.textContent = config.title || "";
    row.appendChild(label);
    var holder = global.document.createElement("div");
    var select = global.document.createElement("select");
    select.className = "pz-inputbox";
    if (config.selectClass) select.classList.add(config.selectClass);
    if (config.ariaLabel || config.title) {
      select.setAttribute("aria-label", config.ariaLabel || config.title);
    }
    items.forEach(function (item) {
      var option = global.document.createElement("option");
      option.textContent = item;
      select.appendChild(option);
    });
    select.addEventListener("change", function () {
      set.call(scope, select.selectedIndex);
    });
    holder.appendChild(select);
    row.appendChild(holder);
    row.pz_update = function () {
      select.selectedIndex = get.call(scope);
    };
    row.pz_update();
    return row;
  }

  // Builds a text-input row with the same chrome as CM3 native panels.
  // inputWidth overrides the 250px legacy default; numeric fields such
  // as Hue shift use "80px" to match the Frame rate field on the Device
  // render panel.
  function createTextInputRow(options) {
    var config = options || {};
    var legacy = legacyControls();
    var scope = config.scope || {};
    var get = typeof config.get === "function" ? config.get : function () { return ""; };
    var set = typeof config.set === "function" ? config.set : function () {};
    if (legacy && typeof legacy.generateTextInput === "function") {
      var row = legacy.generateTextInput({
        title: config.title || "",
        get: function () { return get.call(scope); },
        set: function (value) { set.call(scope, value); },
      }, scope);
      if (config.inputWidth && row && row.querySelector) {
        var legacyInput = row.querySelector("input");
        if (legacyInput) legacyInput.style.width = config.inputWidth;
      }
      if (config.rowClass && row && row.classList) row.classList.add(config.rowClass);
      return row;
    }
    var fallback = global.document.createElement("div");
    fallback.className = "proprow noselect";
    if (config.rowClass) fallback.classList.add(config.rowClass);
    var label = global.document.createElement("span");
    label.textContent = config.title || "";
    fallback.appendChild(label);
    var input = global.document.createElement("input");
    input.className = "pz-inputbox";
    input.style.width = config.inputWidth || "250px";
    if (config.ariaLabel || config.title) {
      input.setAttribute("aria-label", config.ariaLabel || config.title);
    }
    input.addEventListener("change", function () {
      set.call(scope, input.value);
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") input.blur();
    });
    fallback.appendChild(input);
    fallback.pz_update = function () {
      input.value = get.call(scope);
    };
    fallback.pz_update();
    return fallback;
  }

  // Builds a value-based select row for hand-rolled dropdowns that the
  // legacy index-based builder cannot express (Restore backup
  // interval). Same .proprow grid chrome as createDropdownRow, so the
  // control pins to the right edge like every Settings row. Returns
  // { row, select, sync } so callers can set options and read changes.
  function createSelectRow(options) {
    var config = options || {};
    var row = global.document.createElement("div");
    row.className = "proprow noselect";
    if (config.rowClass) row.classList.add(config.rowClass);
    var label = global.document.createElement("span");
    label.textContent = config.title || "";
    row.appendChild(label);
    var select = global.document.createElement("select");
    select.className = "pz-inputbox";
    if (config.selectClass) select.classList.add(config.selectClass);
    select.setAttribute("aria-label", config.ariaLabel || config.title || "");
    (Array.isArray(config.options) ? config.options : []).forEach(function (item) {
      var option = global.document.createElement("option");
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });
    var initial = typeof config.get === "function"
      ? config.get()
      : (config.value !== undefined ? config.value : "");
    select.value = String(initial);
    select.addEventListener("change", function () {
      if (typeof config.onChange === "function") config.onChange(select.value, select);
    });
    row.appendChild(select);
    function sync(value) {
      select.value = String(value);
    }
    row.pz_update = function () {
      if (typeof config.get === "function") select.value = String(config.get());
    };
    return { row: row, select: select, sync: sync };
  }

  global.ZoidiumUI = Object.freeze({
    getElevator: getElevator,
    createMenubarTab: createMenubarTab,
    createPageHeader: createPageHeader,
    notify: notify,
    createSearchBox: createSearchBox,
    attachSearchFilter: attachSearchFilter,
    createButton: createButton,
    createTitleRow: createTitleRow,
    createDescriptionRow: createDescriptionRow,
    createSpacer: createSpacer,
    createDropdownRow: createDropdownRow,
    createTextInputRow: createTextInputRow,
    createSelectRow: createSelectRow,
  });
})(window);
