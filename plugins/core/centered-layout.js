(function installCenteredLayout(global) {
  "use strict";

  // "Clipmaker 3 Centered", "Video Editor 2 Centered" and "Video Editor 2
  // Centered 2" (full-height sidebar): the editor with a
  // second tab sidebar on the right, so the preview sits between two columns
  // of panels. Both editors build their panel tree in setUpEditor and hand the
  // root to the main window's setPanel; this pre-init patch rearranges that
  // root once. The runtime loader starts the base editor for these layouts.
  // A tab's right-click menu moves it up, down, to the top or bottom, or to
  // the other sidebar, and
  // the arrangement is remembered with the other editor settings.
  var STORAGE_KEY = "zoidium.editor-settings";
  // Video Editor's "centered 2" variant runs the right sidebar from the top of
  // the window to the bottom, beside the timeline as well as the preview.
  var LAYOUTS = { "clipmaker-centered": "clipmaker", "videoeditor-centered": "videoeditor", "videoeditor-centered2": "videoeditor" };
  var FULL_HEIGHT = { "videoeditor-centered2": true };
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

  function writeTabs(leftTitles, rightTitles) {
    try {
      var settings = readSettings();
      settings.leftTabs = leftTitles;
      settings.rightTabs = rightTitles;
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_error) {
      // The arrangement still applies for this session.
    }
  }

  var settings = readSettings();
  if (!Object.prototype.hasOwnProperty.call(LAYOUTS, settings.layout) || LAYOUTS[settings.layout] !== global.ZOIDIUM_LAYOUT || !CM || typeof CM.createMainWindow !== "function" ||
      !PZ || !PZ.ui || typeof PZ.ui.elevator !== "function" || typeof PZ.ui.splitPanel !== "function") return;

  var titleList = function (value) {
    return Array.isArray(value) ? value.filter(function (title) { return typeof title === "string" && title; }) : null;
  };
  var rightTitles = titleList(settings.rightTabs) || DEFAULT_RIGHT.slice();
  var leftTitles = titleList(settings.leftTabs) || [];
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

  function tabsOf(elevator) {
    return Array.prototype.filter.call(elevator.tabcontainer.children, function (tab) { return tab.pz_tab; });
  }

  function titlesOf(elevator) {
    return tabsOf(elevator).map(function (tab) { return tab.pz_tab.title; }).filter(Boolean);
  }

  // Put the remembered tabs back in their remembered order. They take the
  // slots they already occupy, so tabs that are not remembered (a plugin
  // installed since) stay where they were added. Nothing moves when the order
  // already matches, so this is safe to run from a mutation observer.
  function applyOrder(elevator, titles) {
    var tabs = tabsOf(elevator);
    var known = tabs.filter(function (tab) { return titles.indexOf(tab.pz_tab.title) !== -1; });
    var wanted = known.slice().sort(function (a, b) { return titles.indexOf(a.pz_tab.title) - titles.indexOf(b.pz_tab.title); });
    if (wanted.every(function (tab, i) { return tab === known[i]; })) return;
    var markers = known.map(function (tab) {
      var marker = global.document.createComment("");
      elevator.tabcontainer.insertBefore(marker, tab);
      return marker;
    });
    wanted.forEach(function (tab, i) { elevator.tabcontainer.insertBefore(tab, markers[i]); });
    markers.forEach(function (marker) { marker.remove(); });
    syncPanels(elevator);
  }

  // The elevator's panel list follows its tab order.
  function syncPanels(elevator) {
    var order = tabsOf(elevator).map(function (tab) { return tab.pz_tab; });
    elevator.panels.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  }

  // Move a tab to the top or bottom of its sidebar.
  function moveToEnd(tab, elevator, top) {
    var tabs = tabsOf(elevator), index = tabs.indexOf(tab);
    if (index < 0 || (top ? index === 0 : index === tabs.length - 1)) return false;
    if (top) elevator.tabcontainer.insertBefore(tab, tabs[0]);
    else elevator.tabcontainer.insertBefore(tab, tabs[tabs.length - 1].nextSibling);
    syncPanels(elevator);
    return true;
  }

  // Swap a tab with its neighbour in the same sidebar.
  function shift(tab, elevator, step) {
    var tabs = tabsOf(elevator), index = tabs.indexOf(tab), other = tabs[index + step];
    if (index < 0 || !other) return false;
    if (step < 0) elevator.tabcontainer.insertBefore(tab, other);
    else elevator.tabcontainer.insertBefore(other, tab);
    syncPanels(elevator);
    return true;
  }

  function remember() {
    rightTitles = titlesOf(right);
    leftTitles = titlesOf(left);
    writeTabs(leftTitles, rightTitles);
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
    var tabs = tabsOf(elevator), index = tabs.indexOf(tab);
    menu = global.document.createElement("div");
    menu.className = "zoidium-tab-menu";
    menu.setAttribute("role", "menu");
    function add(label, disabled, action) {
      var item = global.document.createElement("div");
      item.className = "zoidium-tab-menu-item";
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      if (disabled) item.classList.add("disabled");
      item.addEventListener("click", function () {
        closeMenu();
        if (action()) remember();
      });
      menu.appendChild(item);
    }
    var first = index <= 0, last = index < 0 || index >= tabs.length - 1;
    add("Move to top", first, function () { return moveToEnd(tab, elevator, true); });
    add("Move up", first, function () { return shift(tab, elevator, -1); });
    add("Move down", last, function () { return shift(tab, elevator, 1); });
    add("Move to bottom", last, function () { return moveToEnd(tab, elevator, false); });
    var separator = global.document.createElement("div");
    separator.className = "zoidium-tab-menu-separator";
    menu.appendChild(separator);
    add(toRight ? "Move to right sidebar" : "Move to left sidebar", elevator.panels.length <= 1,
      function () { return transfer(tab.pz_tab, elevator, target, true); });
    menu.style.left = Math.min(x, global.innerWidth - 220) + "px";
    menu.style.top = Math.min(y, global.innerHeight - 160) + "px";
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
      ".zoidium-tab-menu-item.disabled{color:#666;pointer-events:none}" +
      ".zoidium-tab-menu-separator{height:1px;margin:4px 0;background:#3a3a3a}" +
      // The right sidebar mirrors the left one: its tab column sits on the
      // window's outer edge and opens toward the preview.
      ".zoidium-right-sidebar>.elevator{left:auto;right:0}" +
      ".zoidium-right-sidebar>.elevator.open{box-shadow:-5px 0 10px rgba(0,0,0,.5)}" +
      ".zoidium-right-sidebar>.elevatorcontrols{left:0;right:60px}";
    global.document.head.appendChild(style);
  }

  function contains(panel, target, depth) {
    if (!panel || depth > 12) return false;
    if (panel === target) return true;
    return (panel.panels || []).some(function (child) { return contains(child, target, depth + 1); });
  }

  // The side-by-side split whose first half holds the sidebar: Clipmaker's
  // root, or the top row above Video Editor's full-width timeline.
  function columnSplit(panel, depth) {
    if (!panel || !panel.panels || panel.panels.length !== 2 || depth > 12) return null;
    if (panel.options && panel.options.direction === 1 && panel.panels[0] !== left &&
        contains(panel.panels[0], left, 0) && !contains(panel.panels[1], left, 0)) return panel;
    return columnSplit(panel.panels[0], depth + 1) || columnSplit(panel.panels[1], depth + 1);
  }

  // Rebuild the path from the root to the column split with fresh split
  // panels (a split adopts its children's elements when it is created).
  function rebuild(panel, column, replacement) {
    if (panel === column) return replacement;
    if (!panel.panels || !contains(panel, column, 0)) return panel;
    return new PZ.ui.splitPanel(CM, rebuild(panel.panels[0], column, replacement),
      rebuild(panel.panels[1], column, replacement), panel.ratio, panel.options.direction);
  }

  function arrange(root) {
    left = findElevator(root, 0);
    var column = left && columnSplit(root, 0);
    if (!column) return root;
    var moving = left.panels.filter(function (panel) { return rightTitles.indexOf(panel.title) !== -1; });
    if (!moving.length || moving.length >= left.panels.length) {
      moving = left.panels.filter(function (panel) { return DEFAULT_RIGHT.indexOf(panel.title) !== -1; });
    }
    if (!moving.length) return root;
    var first = moving[0];
    right = new PZ.ui.elevator(CM, [first]);
    right.el.classList.add("zoidium-right-sidebar");
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
    applyOrder(left, leftTitles);
    applyOrder(right, rightTitles);
    // Tabs that plugins add later land on the left; honor the remembered side
    // and order.
    new global.MutationObserver(function () {
      for (var j = left.panels.length - 1; j >= 0; j--) {
        var panel = left.panels[j];
        if (rightTitles.indexOf(panel.title) !== -1 && left.panels.length > 1) transfer(panel, left, right, false);
      }
      applyOrder(left, leftTitles);
      applyOrder(right, rightTitles);
    }).observe(left.tabcontainer, { childList: true });
    if (FULL_HEIGHT[settings.layout]) return new PZ.ui.splitPanel(CM, root, right, 0.8, 1);
    var center = new PZ.ui.splitPanel(CM, column.panels[1], right, 0.7, 1);
    return rebuild(root, column, new PZ.ui.splitPanel(CM, column.panels[0], center, Math.min(column.ratio, 0.24), 1));
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
