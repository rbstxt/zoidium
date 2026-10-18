(function (global) {
  "use strict";

  // Canvas and view for the Zoidium node editor: the DOM shell, screen/world
  // coordinates, zoom and framing, and socket measurement. Installed on the
  // editor scope by nodeEditor() in zoidium/ui-node-editor.js (see
  // postInitScripts in zoidium/runtime-config.js); it owns no public surface
  // itself.

  var parts = global.ZoidiumNodeEditorParts = global.ZoidiumNodeEditorParts || {};

  // Builds the DOM shell and the view helpers on cx. Sizing maps and the
  // graph live on cx so the fields and gesture parts share them.
  parts.createView = function (cx) {
    var C = parts.consts;
    var GRID = C.GRID;
    var ZOOM_MIN = C.ZOOM_MIN;
    var ZOOM_MAX = C.ZOOM_MAX;
    var FRAME_ZOOM_MAX = C.FRAME_ZOOM_MAX;
    var FRAME_MARGIN = C.FRAME_MARGIN;
    var SVG_NS = C.SVG_NS;
    var HEADER_HEIGHT = C.HEADER_HEIGHT;
    var DEFAULT_SIZE = C.DEFAULT_SIZE;
    var base = parts.base;
    var clamp = base.clamp;
    var findNode = base.findNode;
    var anchorKey = base.anchorKey;

      // ---- DOM ----------------------------------------------------------

      function el(tag, className, text) {
        var node = cx.doc.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
      }

      function svgEl(tag, className) {
        var node = cx.doc.createElementNS(SVG_NS, tag);
        if (className) node.setAttribute("class", className);
        return node;
      }

      function listen(target, type, handler, listenOptions) {
        target.addEventListener(type, handler, listenOptions);
        cx.disposers.push(function () { target.removeEventListener(type, handler, listenOptions); });
      }

      var root = el("div", "zoidium-node-editor");
      root.tabIndex = 0;
      root.setAttribute("role", "application");
      root.setAttribute("aria-label", "Node graph editor");
      var viewport = el("div", "zoidium-node-editor-viewport");
      var world = el("div", "zoidium-node-editor-world");
      var svg = svgEl("svg", "zoidium-node-editor-links");
      svg.setAttribute("overflow", "visible");
      var linkLayer = svgEl("g");
      var previewPath = svgEl("path", "zoidium-node-editor-preview");
      var knifePath = svgEl("path", "zoidium-node-editor-knife");
      svg.appendChild(linkLayer);
      svg.appendChild(previewPath);
      svg.appendChild(knifePath);
      var nodeLayer = el("div", "zoidium-node-editor-nodes");
      var marquee = el("div", "zoidium-node-editor-marquee");
      world.appendChild(svg);
      world.appendChild(nodeLayer);
      viewport.appendChild(world);
      viewport.appendChild(marquee);
      // Header bar, like a Blender editor header: the visible way to add nodes.
      // The tools reuse the shared button builder; the tool class pins them
      // to the compact canvas-toolbar rendering (see ui-node-editor.css) the
      // shared full-width row button would otherwise break.
      var header = el("div", "zoidium-node-editor-header");
      function headerTool(label, hint) {
        var kit = global.ZoidiumUI;
        var node = null;
        if (kit && kit.controls && typeof kit.controls.button === "function") {
          try { node = kit.controls.button({ title: label, hint: hint }).element; }
          // A failing shared button builder falls back to a plain button below.
          catch (_error) { node = null; }
        }
        if (!node) {
          node = el("button", "", label);
          node.title = hint;
        }
        node.type = "button";
        node.classList.add("zoidium-node-editor-tool");
        return node;
      }
      var addButton = headerTool("+ Add node", "Add a node (also right-click the grid, Tab or Shift+A)");
      var frameButton = headerTool("Frame all", "Fit every node in view (Home)");
      var hint = el("span", "zoidium-node-editor-hint", "Drag from a socket to connect. Right-click the grid to add nodes.");
      if (!cx.readOnly) header.appendChild(addButton);
      if (!cx.readOnly && cx.recipes.length) {
        var recipes = el("select", "zoidium-node-editor-tool zoidium-node-editor-control");
        recipes.setAttribute("aria-label", "Starter recipe");
        recipes.title = "Replace this graph with a starter recipe in one undo step";
        var placeholder = el("option", "", "Recipes…"); placeholder.value = ""; recipes.appendChild(placeholder);
        cx.recipes.forEach(function (recipe, index) { var option = el("option", "", recipe.label); option.value = String(index); recipes.appendChild(option); });
        recipes.addEventListener("change", function () { if (recipes.value !== "") cx.loadRecipe(cx.recipes[Number(recipes.value)]); recipes.value = ""; });
        header.appendChild(recipes);
      }
      header.appendChild(frameButton);
      header.appendChild(hint);
      root.appendChild(header);
      root.appendChild(viewport);

      // ---- coordinates and view -----------------------------------------

      function screenOf(event) {
        var rect = viewport.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      }

      function worldAt(screen) {
        return { x: (screen.x - cx.view.panX) / cx.view.zoom, y: (screen.y - cx.view.panY) / cx.view.zoom };
      }

      function applyView() {
        world.style.transform = "translate(" + cx.view.panX + "px, " + cx.view.panY + "px) scale(" + cx.view.zoom + ")";
        var spacing = GRID * cx.view.zoom;
        while (spacing < 8) spacing *= 2;
        viewport.style.backgroundSize = spacing + "px " + spacing + "px";
        viewport.style.backgroundPosition = cx.view.panX + "px " + cx.view.panY + "px";
      }

      function zoomAt(screen, factor) {
        var before = worldAt(screen);
        cx.view.zoom = clamp(cx.view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        cx.view.panX = screen.x - before.x * cx.view.zoom;
        cx.view.panY = screen.y - before.y * cx.view.zoom;
        applyView();
      }

      function frameNodes(ids) {
        var vw = viewport.clientWidth;
        var vh = viewport.clientHeight;
        if (!vw || !vh) {
          cx.pendingFrame = true;
          return;
        }
        cx.pendingFrame = false;
        var list = cx.graph.nodes.filter(function (node) { return !ids || ids.has(node.id); });
        if (!list.length) {
          cx.view.zoom = 1;
          cx.view.panX = vw / 2;
          cx.view.panY = vh / 2;
          applyView();
          return;
        }
        var minX = Infinity;
        var minY = Infinity;
        var maxX = -Infinity;
        var maxY = -Infinity;
        list.forEach(function (node) {
          var size = sizeOf(node.id);
          minX = Math.min(minX, node.x);
          minY = Math.min(minY, node.y);
          maxX = Math.max(maxX, node.x + size.w);
          maxY = Math.max(maxY, node.y + size.h);
        });
        var bw = Math.max(1, maxX - minX);
        var bh = Math.max(1, maxY - minY);
        var zoom = clamp(Math.min((vw - 2 * FRAME_MARGIN) / bw, (vh - 2 * FRAME_MARGIN) / bh), ZOOM_MIN, FRAME_ZOOM_MAX);
        cx.view.zoom = zoom;
        cx.view.panX = vw / 2 - (minX + bw / 2) * zoom;
        cx.view.panY = vh / 2 - (minY + bh / 2) * zoom;
        applyView();
      }


      // ---- measurement and anchors --------------------------------------

      function sizeOf(nodeId) {
        return cx.sizes.get(nodeId) || DEFAULT_SIZE;
      }

      // Socket positions come from layout offsets, which ignore the zoom
      // transform. Sockets are measured relative to their node once per render.
      function measure() {
        cx.anchors.clear();
        cx.sizes.clear();
        cx.nodeEls.forEach(function (nodeEl, nodeId) {
          var head = nodeEl.firstElementChild;
          cx.sizes.set(nodeId, {
            w: nodeEl.offsetWidth,
            h: nodeEl.offsetHeight,
            headH: head ? head.offsetHeight : HEADER_HEIGHT,
          });
          nodeEl.querySelectorAll(".zoidium-node-editor-socket").forEach(function (socket) {
            cx.anchors.set(anchorKey(nodeId, socket.dataset.dir, socket.dataset.port), {
              dx: nodeEl.clientLeft + socket.offsetLeft + socket.offsetWidth / 2,
              dy: nodeEl.clientTop + socket.offsetTop + socket.offsetHeight / 2,
            });
          });
        });
      }

      // Collapsed and missing nodes have no socket elements; their links attach
      // to the left (inputs) or right (outputs) edge of the header.
      function anchorAt(node, dir, portId) {
        var size = sizeOf(node.id);
        var rel = cx.anchors.get(anchorKey(node.id, dir, portId));
        if (rel) return { x: node.x + rel.dx, y: node.y + rel.dy };
        return { x: dir === "in" ? node.x : node.x + size.w, y: node.y + size.headH / 2 };
      }

      function anchorFor(nodeId, dir, portId) {
        var node = findNode(cx.graph, nodeId);
        return node ? anchorAt(node, dir, portId) : null;
      }

      function indexNodes() {
        var index = new Map();
        cx.graph.nodes.forEach(function (node) { index.set(node.id, node); });
        return index;
      }

      function nodeAt(point) {
        var found = null;
        cx.graph.nodes.forEach(function (node) {
          var size = sizeOf(node.id);
          if (point.x >= node.x && point.x <= node.x + size.w && point.y >= node.y && point.y <= node.y + size.h) {
            found = node;
          }
        });
        return found;
      }
    cx.root = root;
    cx.viewport = viewport;
    cx.linkLayer = linkLayer;
    cx.nodeLayer = nodeLayer;
    cx.previewPath = previewPath;
    cx.knifePath = knifePath;
    cx.marquee = marquee;
    cx.addButton = addButton;
    cx.frameButton = frameButton;
    cx.screenOf = screenOf;
    cx.worldAt = worldAt;
    cx.applyView = applyView;
    cx.zoomAt = zoomAt;
    cx.frameNodes = frameNodes;
    cx.sizeOf = sizeOf;
    cx.measure = measure;
    cx.anchorAt = anchorAt;
    cx.anchorFor = anchorFor;
    cx.indexNodes = indexNodes;
    cx.nodeAt = nodeAt;
  };
})(window);
