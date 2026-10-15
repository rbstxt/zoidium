(function (global) {
  "use strict";

  // Sidebar and menubar builders for the Zoidium UI kit: elevator tabs, side
  // panels, page headers, the filter search row and the CM3 chrome button.
  // Loaded before zoidium/ui-kit.js, which assembles the frozen ZoidiumUI
  // surface (see postInitScripts in zoidium/runtime-config.js). This file
  // registers its builders on global.ZoidiumUIBuilder; it owns no public
  // surface itself.

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

  function findTabByTitle(tabs, title) {
    return Array.from(tabs.children).find(function (item) {
      return item.title === title;
    }) || null;
  }

  function findAboutTab(tabs) {
    return findTabByTitle(tabs, "About");
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
    // The elevator hides every container except the selected tab's
    // (display: none / block). A new tab is never selected, so start hidden.
    panel.style.display = "none";
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
    tab.pz_elevator = hosts.elevator;
    tab.pz_container = panel;
    tab.appendChild(PZ.ui.generateIcon(descriptor.icon));
    var label = global.document.createElement("span");
    label.textContent = config.title;
    tab.appendChild(label);

    var aboutTab = findAboutTab(hosts.tabs);
    // "after:<Tab title>" places the tab right below an existing tab, e.g.
    // "after:Effects"; an unknown title falls back to the default slot.
    var afterTitle = typeof config.position === "string" && config.position.indexOf("after:") === 0
      ? config.position.slice(6)
      : null;
    var afterTab = afterTitle ? findTabByTitle(hosts.tabs, afterTitle) : null;
    if (afterTab) {
      hosts.tabs.insertBefore(tab, afterTab.nextElementSibling);
    } else if (config.position === "afterAbout") {
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

  var previewOwners = new WeakMap();
  // One custom editor may borrow a viewport at a time.
  function acquirePreview(viewport, close) {
    if (!viewport) return function () {};
    var previous = previewOwners.get(viewport);
    if (previous) previous.close();
    var owner = { close: close };
    previewOwners.set(viewport, owner);
    return function () {
      if (previewOwners.get(viewport) === owner) previewOwners.delete(viewport);
    };
  }

  // Removes a tab returned by createMenubarTab and releases its panel.
  function removeMenubarTab(tab) {
    if (!tab || !tab.pz_tab) return false;
    var descriptor = tab.pz_tab;
    var elevator = tab.pz_elevator;
    var tabs = tab.parentElement;
    if (elevator && elevator.activePanel === descriptor) {
      var replacement = tabs && Array.from(tabs.children).find(function (candidate) {
        return candidate !== tab && candidate.pz_tab && !candidate.disabled;
      });
      if (replacement) elevator.changeTab(replacement);
      else elevator.activePanel = null;
    }
    descriptor.enabled = false;
    if (elevator && Array.isArray(elevator.panels)) {
      var index = elevator.panels.indexOf(descriptor);
      if (index >= 0) elevator.panels.splice(index, 1);
    }
    tab.onclick = null;
    tab.onkeydown = null;
    if (tab.pz_container) tab.pz_container.remove();
    tab.remove();
    tab.pz_tab = null;
    tab.pz_container = null;
    tab.pz_elevator = null;
    return true;
  }

  // Creates a sidebar panel with the standard CM3 page chrome: a page header,
  // a scrolling body and the panel background every built-in panel uses.
  // Plugins add sidebar panels only through this builder (or
  // context.ui.sidePanel, which removes the panel on disable) so new panels
  // look and scroll like Plugins, Settings and the CM3 panels.
  //   var side = ZoidiumUI.createSidePanel({ title: "Compositions", icon: "layers" });
  //   side.body.appendChild(...);
  //   side.remove();
  // Returns null when the sidebar is unavailable.
  function createSidePanel(options) {
    var config = options || {};
    if (!config.title || !global.document) return null;
    var panel = el("div", "editorpanel zoidium-side-panel" + (config.className ? " " + config.className : ""));
    var header = config.header === false ? null : createPageHeader(config.title);
    if (header) {
      header.classList.add("zoidium-side-panel-header");
      panel.appendChild(header);
    }
    var body = el("div", "zoidium-side-panel-body");
    panel.appendChild(body);
    var tab = createMenubarTab({
      title: config.tabTitle || config.title,
      icon: config.icon,
      panel: panel,
      tabClass: config.tabClass,
      position: config.position,
      editor: config.editor,
    });
    if (!tab) return null;
    return {
      element: panel,
      header: header,
      body: body,
      tab: tab,
      setTitle: function (title) {
        var label = header && header.querySelector(".proplabel");
        if (label) {
          label.textContent = title || "";
          label.title = title || "";
        }
      },
      remove: function () { return removeMenubarTab(tab); },
    };
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
    label.style.fontSize = "var(--zui-font-size-title)";
    label.style.fontWeight = "bold";
    header.appendChild(label);
    return header;
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
  // Escape clears the query. onUpdate runs after every pass so callers can
  // react to the visible set (for example hiding empty group headers).
  // Returns the update function so callers can re-run it after the list
  // changes.
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
      if (typeof config.onUpdate === "function") config.onUpdate();
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
  // button when the legacy controls are unavailable. options: { title,
  // hint, icon (a PZ.ui.generateIcon name, rendered before the title and
  // replacing the visible label), className, onClick }.
  function createButton(options) {
    var config = options || {};
    var legacy = legacyControls();
    var button;
    if (legacy && typeof legacy.generateButton === "function") {
      button = legacy.generateButton({
        title: config.icon ? "" : (config.title || ""),
        clickfn: typeof config.onClick === "function" ? config.onClick : function () {},
      });
    } else {
      button = global.document.createElement("button");
      button.type = "button";
      button.className = "proprow propbutton";
      if (!config.icon) button.textContent = config.title || "";
      if (typeof config.onClick === "function") button.addEventListener("click", config.onClick);
    }
    if (config.icon && global.PZ && typeof global.PZ.ui.generateIcon === "function") {
      var icon = null;
      // Icon generation is decorative; a failure keeps the text button.
      try { icon = global.PZ.ui.generateIcon(config.icon); } catch (_error) { icon = null; }
      if (icon) {
        if (typeof icon.setAttribute === "function") icon.setAttribute("aria-hidden", "true");
        if (typeof button.insertBefore === "function") button.insertBefore(icon, button.firstChild || null);
        else if (typeof button.appendChild === "function") button.appendChild(icon);
      }
    }
    if (config.className && button.classList && typeof button.classList.add === "function") {
      String(config.className).split(/\s+/).forEach(function (name) {
        if (name) button.classList.add(name);
      });
    }
    if (config.title) {
      if (!button.title) button.title = config.title;
      if (typeof button.getAttribute === "function" && typeof button.setAttribute === "function"
        && !button.getAttribute("aria-label")) {
        button.setAttribute("aria-label", config.title);
      }
    }
    if (config.hint) button.title = config.hint;
    return button;
  }

  function el(tag, className, text) {
    var node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }


  var builder = global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {};
  builder.panels = {
    getElevator: getElevator,
    createMenubarTab: createMenubarTab,
    removeMenubarTab: removeMenubarTab,
    createSidePanel: createSidePanel,
    acquirePreview: acquirePreview,
    createPageHeader: createPageHeader,
    createSearchBox: createSearchBox,
    attachSearchFilter: attachSearchFilter,
    createButton: createButton,
  };
})(window);
