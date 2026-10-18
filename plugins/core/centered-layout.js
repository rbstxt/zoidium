(function installCenteredLayout(global) {
  "use strict";

  // "Clipmaker 3 (centered viewport)": the Clipmaker 3 editor with a second
  // tab sidebar on the right, so the preview sits between two columns of
  // panels. CM3 builds its panel tree in CM.setUpEditor and hands the root to
  // the main window's setPanel; this pre-init patch rearranges that root once.
  // Tabs move between the sidebars from their right-click menu, and the
  // arrangement is remembered with the other editor settings.
  var STORAGE_KEY = "zoidium.editor-settings";
  var LAYOUT = "clipmaker-centered";
  var DEFAULT_RIGHT = ["Objects", "Effects"];
  var PZ = global.PZ, CM = global.CM;

  function readSettings() {
    try {
      var value = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch (_error) {
      return {};
    }
  }

  function writeRightTabs(titles) {
    try {
      var settings = readSettings();
      settings.rightTabs = titles;
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_error) {
      // The arrangement still applies for this session.
    }
  }

  var settings = readSettings();
  if (settings.layout !== LAYOUT || !CM || typeof CM.createMainWindow !== "function" ||
      !PZ || !PZ.ui || typeof PZ.ui.elevator !== "function" || typeof PZ.ui.splitPanel !== "function") return;

  var rightTitles = Array.isArray(settings.rightTabs)
    ? settings.rightTabs.filter(function (title) { return typeof title === "string" && title; })
    : DEFAULT_RIGHT.slice();
  var left = null, right = null, keyframeOwner = null;

  function findElevator(panel, depth) {
    if (!panel || depth > 12) return null;
    if (panel instanceof PZ.ui.elevator) return panel;
    var children = panel.panels || [];
    for (var i = 0; i < children.length; i++) {
      var found = findElevator(children[i], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function tabOf(elevator, panel) {
    return Array.prototype.find.call(elevator.tabcontainer.children, function (tab) { return tab.pz_tab === panel; }) || null;
  }

  function controlsOf(elevator) {
    return elevator.el.querySelector(".elevatorcontrols");
  }

  // The timeline's keyframe lanes follow the Edit-type panel that was enabled
  // last, and a disabled one clears them. With two sidebars, hand the lanes to
  // the panel the user is working in, or to the other sidebar's panel when a
  // tab switch cleared them.
  // Objects and Effects are split panels; their lower half drives the lanes.
  function lanePanel(panel, depth) {
    if (!panel || depth > 4) return null;
    if (panel.options && panel.options.keyframePanel && panel.enabled) return panel;
    var children = panel.panels || [];
    for (var i = children.length - 1; i >= 0; i--) {
      var found = lanePanel(children[i], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function syncKeyframes(preferred) {
    var candidates = [preferred, preferred === left ? right : left];
    for (var i = 0; i < candidates.length; i++) {
      var panel = candidates[i] && lanePanel(candidates[i].activePanel, 0);
      var lanes = panel && panel.options.keyframePanel;
      if (!lanes) continue;
      if (keyframeOwner !== panel || !lanes.objects) lanes.objects = panel.objects;
      keyframeOwner = panel;
      return;
    }
    keyframeOwner = null;
  }

  function watchElevator(elevator) {
    var changeTab = elevator.changeTab;
    elevator.changeTab = function () {
      var result = changeTab.apply(this, arguments);
      if (left && right) syncKeyframes(elevator);
      return result;
    };
    elevator.el.addEventListener("pointerdown", function () {
      if (left && right && keyframeOwner !== lanePanel(elevator.activePanel, 0)) syncKeyframes(elevator);
    }, true);
    elevator.el.addEventListener("contextmenu", function (event) {
      var tab = event.target && event.target.closest && event.target.closest(".elevatortabs > a");
      if (!tab || !tab.pz_tab) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.clientX, event.clientY, tab, elevator);
    });
  }

  // Move one tab and its panel to the other sidebar. A sidebar keeps at least
  // one tab; the moved tab opens where it lands.
  function transfer(panel, from, to, select) {
    var tab = tabOf(from, panel);
    if (!tab || from.panels.length <= 1) return false;
    if (from.activePanel === panel) {
      var other = Array.prototype.find.call(from.tabcontainer.children, function (candidate) {
        return candidate !== tab && candidate.pz_tab && !candidate.disabled;
      });
      if (!other) return false;
      from.changeTab(other);
    }
    from.panels.splice(from.panels.indexOf(panel), 1);
    to.panels.push(panel);
    to.tabcontainer.appendChild(tab);
    controlsOf(to).appendChild(panel.el);
    panel.el.style.display = "none";
    panel.needsResize = true;
    tab.classList.remove("selected");
    tab.onclick = to.buttonClick.bind(to);
    tab.pz_elevator = to;
    if (select) to.changeTab(tab);
    return true;
  }

  function remember() {
    rightTitles = right.panels.map(function (panel) { return panel.title; }).filter(Boolean);
    writeRightTabs(rightTitles);
  }

  var menu = null;
  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    global.document.removeEventListener("pointerdown", outside, true);
  }
  function outside(event) {
    if (menu && !menu.contains(event.target)) closeMenu();
  }
  function openMenu(x, y, tab, elevator) {
    closeMenu();
    var toRight = elevator === left;
    var target = toRight ? right : left;
    var item = global.document.createElement("div");
    item.className = "zoidium-tab-menu-item";
    item.textContent = toRight ? "Move to right sidebar" : "Move to left sidebar";
    if (elevator.panels.length <= 1) item.classList.add("disabled");
    item.addEventListener("click", function () {
      closeMenu();
      if (transfer(tab.pz_tab, elevator, target, true)) remember();
    });
    menu = global.document.createElement("div");
    menu.className = "zoidium-tab-menu";
    menu.setAttribute("role", "menu");
    menu.appendChild(item);
    menu.style.left = Math.min(x, global.innerWidth - 220) + "px";
    menu.style.top = Math.min(y, global.innerHeight - 40) + "px";
    global.document.body.appendChild(menu);
    global.document.addEventListener("pointerdown", outside, true);
  }

  function installStyle() {
    var style = global.document.createElement("style");
    style.textContent =
      ".zoidium-tab-menu{position:fixed;z-index:10000;min-width:200px;padding:4px 0;background:#262626;" +
      "border:1px solid #474747;box-shadow:0 6px 18px rgba(0,0,0,.55);color:#ddd;font:inherit;font-size:13px}" +
      ".zoidium-tab-menu-item{padding:5px 14px;cursor:default;white-space:nowrap}" +
      ".zoidium-tab-menu-item:hover{background:#3d4d75}" +
      ".zoidium-tab-menu-item.disabled{color:#666;pointer-events:none}";
    global.document.head.appendChild(style);
  }

  function arrange(root) {
    left = findElevator(root, 0);
    if (!left || !root.panels || root.panels.length !== 2 || root.panels[0] === left) return root;
    var moving = left.panels.filter(function (panel) { return rightTitles.indexOf(panel.title) !== -1; });
    if (!moving.length || moving.length >= left.panels.length) {
      moving = left.panels.filter(function (panel) { return DEFAULT_RIGHT.indexOf(panel.title) !== -1; });
    }
    if (!moving.length) return root;
    var first = moving[0];
    right = new PZ.ui.elevator(CM, [first]);
    var firstTab = tabOf(right, first);
    // The new sidebar built its own tab for the first panel; drop the left one.
    var leftTab = tabOf(left, first);
    if (left.activePanel === first) left.changeTab(Array.prototype.find.call(left.tabcontainer.children, function (tab) { return tab !== leftTab && tab.pz_tab; }));
    left.panels.splice(left.panels.indexOf(first), 1);
    if (leftTab) leftTab.remove();
    for (var i = 1; i < moving.length; i++) transfer(moving[i], left, right, false);
    right.changeTab(firstTab);
    watchElevator(left);
    watchElevator(right);
    installStyle();
    // Tabs that plugins add later land on the left; honor the remembered side.
    new global.MutationObserver(function () {
      for (var j = left.panels.length - 1; j >= 0; j--) {
        var panel = left.panels[j];
        if (rightTitles.indexOf(panel.title) !== -1 && left.panels.length > 1) transfer(panel, left, right, false);
      }
    }).observe(left.tabcontainer, { childList: true });
    var center = new PZ.ui.splitPanel(CM, root.panels[1], right, 0.7, 1);
    return new PZ.ui.splitPanel(CM, root.panels[0], center, 0.22, 1);
  }

  // An Edit panel fixes its name column at half its width on the first resize.
  // The right sidebar is built and resized before it is attached (width 0),
  // which left a zero-width name column. Measure once the panel has a width.
  var editPrototype = PZ.ui.edit && PZ.ui.edit.prototype;
  if (editPrototype && typeof editPrototype.resize === "function") {
    var editResize = editPrototype.resize;
    editPrototype.resize = function () {
      if (!this.columnTemplate && this.el && this.el.clientWidth === 0) {
        this.needsResize = true;
        return;
      }
      return editResize.apply(this, arguments);
    };
  }

  var createMainWindow = CM.createMainWindow;
  CM.createMainWindow = function () {
    var win = createMainWindow.apply(this, arguments);
    if (!win || typeof win.setPanel !== "function") return win;
    var setPanel = win.setPanel;
    win.setPanel = function (root) {
      win.setPanel = setPanel;
      var arranged = root;
      try {
        arranged = arrange(root);
      } catch (error) {
        console.warn("[Zoidium] the centered viewport layout could not be built; using the standard layout", error);
        arranged = root;
      }
      return setPanel.call(this, arranged);
    };
    return win;
  };
})(window);
