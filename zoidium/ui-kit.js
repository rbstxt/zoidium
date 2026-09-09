(function (global) {
  "use strict";

  // Shared helpers for extending the CM3 editor chrome. New panels, tabs,
  // headers, and notifications should go through this module instead of
  // copying the elevator/legacy boilerplate into each feature file.
  //
  // This module is a required dependency: zoidium/runtime-config.js loads it
  // before every consumer (project-restore, settings, plugin-manager), so
  // callers use ZoidiumUI directly and must not reimplement its builders as
  // a fallback. A missing UI kit is a fatal startup error, not a silent skip.
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

  global.ZoidiumUI = Object.freeze({
    getElevator: getElevator,
    createMenubarTab: createMenubarTab,
    createPageHeader: createPageHeader,
    notify: notify,
    createSearchBox: createSearchBox,
    attachSearchFilter: attachSearchFilter,
    createButton: createButton,
  });
})(window);
