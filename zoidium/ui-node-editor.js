(function (global) {
  "use strict";

  // Node graph editor for Zoidium windows, installed as ZoidiumUI.nodeEditor
  // (this file queues its installer last, after the split parts in
  // ui-node-editor-graph.js, ui-node-editor-view.js,
  // ui-node-editor-fields.js and ui-node-editor-menu.js; see postInitScripts
  // in zoidium/runtime-config.js).
  //
  // The editor is UI only. It edits a plain JSON graph and reports finished
  // gestures through onChange; it never evaluates graphs.
  //
  //   Graph:  { nodes: [{ id, type, x, y, params }],
  //             links: [{ id, from: { node, port }, to: { node, port } }] }
  //
  // params holds explicit values. A missing key means the registry default
  // applies. An input port with a default and no incoming link is edited
  // inline, and its value is stored in params under the input's id.
  //
  // Shared editor state lives on the cx scope object so the split parts
  // (view, fields, menus) operate on the same graph, selection and maps.
  // Pure graph operations live in nodeEditor.graphTools (no DOM), so they can
  // be tested without a browser.

  var parts = global.ZoidiumNodeEditorParts = global.ZoidiumNodeEditorParts || {};
  function nodeEditor(options) {
    var opts = options || {};
    var doc = global.document;
    if (!doc) throw new Error("ZoidiumUI.nodeEditor needs a document");

    // Every part is required: a missing part cannot build a working editor.
    ["consts", "graphTools", "base", "createView", "createFields", "createMenu"].forEach(function (name) {
      if (!parts[name]) {
        throw new Error("ZoidiumUI.nodeEditor is missing its " + name + " part");
      }
    });
    var graphTools = parts.graphTools;
    var base = parts.base;
    var normalizeGraph = graphTools.normalizeGraph;
    var removeNodes = graphTools.removeNodes;
    var removeLinks = graphTools.removeLinks;
    var connectLinks = graphTools.connectLinks;
    var connectionError = graphTools.connectionError;
    var createIdMaker = graphTools.createIdMaker;
    var linkPathD = graphTools.linkPathD;
    var bezierPoints = graphTools.bezierPoints;
    var polylinesCross = graphTools.polylinesCross;
    var rectFromPoints = graphTools.rectFromPoints;
    var rectsIntersect = graphTools.rectsIntersect;
    var findNode = base.findNode;
    var typeSpec = base.typeSpec;
    var cloneValue = base.cloneValue;
    var sameValue = base.sameValue;
    var idsOf = base.idsOf;
    var anchorKey = base.anchorKey;
    var colorFor = base.colorFor;
    var C = parts.consts;
    var SNAP = C.SNAP;
    var SNAP_PX = C.SNAP_PX;
    var DRAG_PX = C.DRAG_PX;
    var CURVE_STEPS = C.CURVE_STEPS;
    var polylinePathD = base.polylinePathD;

    var types = graphTools.normalizeTypes(opts.nodeTypes);
    var canConnect = typeof opts.canConnect === "function" ? opts.canConnect : null;
    var readOnly = Boolean(opts.readOnly);
    var onChange = typeof opts.onChange === "function" ? opts.onChange : null;
    var onSelect = typeof opts.onSelect === "function" ? opts.onSelect : null;

    var cx = {
      doc: doc,
      types: types,
      canConnect: canConnect,
      readOnly: readOnly,
      onChange: onChange,
      onSelect: onSelect,
      idCounter: { n: 0 },
      graph: normalizeGraph(opts.graph, types),
      selected: new Set(),
      collapsed: new Set(),
      view: { panX: 0, panY: 0, zoom: 1 },
      anchors: new Map(),
      sizes: new Map(),
      nodeEls: new Map(),
      socketEls: new Map(),
      linkEls: new Map(),
      linkedInputs: new Set(),
      pickedLinkId: null,
      pointerScreen: null,
      pendingFrame: true,
      rendering: false,
      destroyed: false,
      linkFrame: 0,
      disposers: [],
    };
    parts.createView(cx);
    parts.createFields(cx);
    parts.createMenu(cx);
    cx.setSelection = setSelection;
    cx.commit = commit;
    cx.makerFor = makerFor;
    cx.setParam = setParam;
    cx.selectedIds = selectedIds;
    cx.plural = plural;

    var gesture = null;
    var spacePan = false;
    var resizeObserver = null;

    function listen(target, type, handler, listenOptions) {
      target.addEventListener(type, handler, listenOptions);
      cx.disposers.push(function () { target.removeEventListener(type, handler, listenOptions); });
    }

    // ---- selection and commits ----------------------------------------

    function selectedIds() {
      return Array.from(cx.selected);
    }

    function setSelection(ids, emit) {
      var known = new Set(cx.graph.nodes.map(function (node) { return node.id; }));
      var next = new Set();
      Array.from(ids).forEach(function (id) { if (known.has(id)) next.add(id); });
      var unchanged = next.size === cx.selected.size && Array.from(next).every(function (id) { return cx.selected.has(id); });
      cx.selected = next;
      cx.updateSelectionVisuals();
      if (emit && !unchanged && onSelect) {
        try {
          onSelect(selectedIds());
        } catch (error) {
          console.error("[Zoidium] node editor onSelect failed:", error);
        }
      }
    }

    function commit(kind, label) {
      cx.render();
      if (!onChange) return;
      try {
        onChange(copyGraph(cx.graph), { kind: kind, label: label });
      } catch (error) {
        console.error("[Zoidium] node editor onChange failed:", error);
      }
    }

    function copyGraph(source) {
      return { nodes: cloneValue(source.nodes) || [], links: cloneValue(source.links) || [] };
    }

    function makerFor(source) {
      return createIdMaker(idsOf(source), cx.idCounter);
    }

    function setParam(nodeId, key, value, label) {
      if (readOnly || cx.destroyed) return;
      var node = findNode(cx.graph, nodeId);
      if (!node) return;
      if (sameValue(cx.paramOr(node, key, cx.defaultFor(typeSpec(types, node.type) || { params: [], inputs: [] }, key)), value)) return;
      node.params = Object.assign({}, node.params);
      node.params[key] = cloneValue(value);
      commit("param", "Set " + label);
    }

    function plural(count) {
      return count === 1 ? "node" : "nodes";
    }

    function deleteSelected() {
      var doomed = new Set(selectedIds().filter(function (id) {
        var node = findNode(cx.graph, id);
        var spec = node ? typeSpec(types, node.type) : null;
        return !spec || spec.deletable !== false;
      }));
      if (!doomed.size) return;
      cx.graph = removeNodes(cx.graph, doomed);
      setSelection(selectedIds().filter(function (id) { return !doomed.has(id); }), true);
      commit("delete", "Delete " + doomed.size + " " + plural(doomed.size));
    }

    function selectAll() {
      setSelection(cx.graph.nodes.map(function (node) { return node.id; }), true);
    }

    function selectInRect(rect, mode) {
      var hit = new Set();
      cx.graph.nodes.forEach(function (node) {
        var size = cx.sizeOf(node.id);
        if (rectsIntersect(rect, { x: node.x, y: node.y, w: size.w, h: size.h })) hit.add(node.id);
      });
      var next;
      if (mode === "add") {
        next = new Set(cx.selected);
        hit.forEach(function (id) { next.add(id); });
      } else if (mode === "toggle") {
        next = new Set(cx.selected);
        hit.forEach(function (id) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        });
      } else {
        next = hit;
      }
      setSelection(Array.from(next), true);
    }

    // ---- connections ---------------------------------------------------

    function linkError(gesturePlan, target) {
      var fixed = gesturePlan.fixed;
      var from = fixed.dir === "out" ? fixed : target;
      var to = fixed.dir === "out" ? target : fixed;
      return connectionError(gesturePlan.baseGraph, types, { node: from.node, port: from.port }, { node: to.node, port: to.port }, canConnect);
    }

    function markSockets(plan) {
      var opposite = plan.fixed.dir === "out" ? "in" : "out";
      cx.socketEls.forEach(function (socket) {
        if (socket.dataset.dir !== opposite) return;
        var error = linkError(plan, { node: socket.dataset.nodeId, port: socket.dataset.port });
        socket.classList.add(error ? "invalid" : "valid");
      });
    }

    function clearSocketStates() {
      cx.socketEls.forEach(function (socket) {
        socket.classList.remove("valid", "invalid", "target");
      });
    }

    function findTarget(plan, point) {
      var radius = SNAP_PX / cx.view.zoom;
      var best = null;
      var bestDistance = radius * radius;
      var opposite = plan.fixed.dir === "out" ? "in" : "out";
      cx.graph.nodes.forEach(function (node) {
        var spec = typeSpec(types, node.type);
        if (!spec) return;
        (opposite === "in" ? spec.inputs : spec.outputs).forEach(function (port) {
          var anchor = cx.anchorAt(node, opposite, port.id);
          var dx = anchor.x - point.x;
          var dy = anchor.y - point.y;
          var distance = dx * dx + dy * dy;
          if (distance > bestDistance) return;
          var target = { node: node.id, port: port.id };
          if (linkError(plan, target)) return;
          bestDistance = distance;
          best = { target: target, key: anchorKey(node.id, opposite, port.id) };
        });
      });
      return best;
    }

    function startLinkGesture(socket, event) {
      if (readOnly) return;
      var node = findNode(cx.graph, socket.dataset.nodeId);
      if (!node) return;
      var dir = socket.dataset.dir;
      var plan = {
        kind: "link",
        pointerId: event.pointerId,
        fixed: { node: node.id, port: socket.dataset.port, dir: dir },
        picked: null,
        baseGraph: cx.graph,
        target: null,
        targetKey: null,
        type: cx.portTypeOf(node.id, dir, socket.dataset.port),
      };
      if (dir === "in") {
        var existing = cx.graph.links.find(function (link) {
          return link.to.node === node.id && link.to.port === socket.dataset.port;
        });
        if (existing) {
          plan.picked = existing;
          plan.fixed = { node: existing.from.node, port: existing.from.port, dir: "out" };
          plan.type = cx.portTypeOf(existing.from.node, "out", existing.from.port);
          plan.baseGraph = removeLinks(cx.graph, new Set([existing.id]));
          cx.pickedLinkId = existing.id;
        }
      }
      markSockets(plan);
      startGesture(plan, event);
      updateLinkGesture(plan, cx.worldAt(cx.screenOf(event)));
    }

    function updateLinkGesture(plan, point) {
      var fixed = cx.anchorFor(plan.fixed.node, plan.fixed.dir, plan.fixed.port);
      if (fixed) {
        var d = plan.fixed.dir === "out" ? linkPathD(fixed.x, fixed.y, point.x, point.y) : linkPathD(point.x, point.y, fixed.x, fixed.y);
        cx.previewPath.setAttribute("d", d);
        cx.previewPath.setAttribute("stroke", colorFor(plan.type));
      }
      var best = findTarget(plan, point);
      var key = best ? best.key : null;
      if (key !== plan.targetKey) {
        var previous = plan.targetKey ? cx.socketEls.get(plan.targetKey) : null;
        if (previous) previous.classList.remove("target");
        var next = key ? cx.socketEls.get(key) : null;
        if (next) next.classList.add("target");
        plan.targetKey = key;
      }
      plan.target = best ? best.target : null;
    }

    function finishLinkGesture(plan, point, event) {
      if (plan.target) {
        var target = plan.target;
        var from = plan.fixed.dir === "out" ? plan.fixed : target;
        var to = plan.fixed.dir === "out" ? target : plan.fixed;
        var picked = plan.picked;
        if (picked && from.node === picked.from.node && from.port === picked.from.port &&
            to.node === picked.to.node && to.port === picked.to.port) {
          return;
        }
        var result = connectLinks(plan.baseGraph, types,
          { node: from.node, port: from.port },
          { node: to.node, port: to.port },
          { id: picked ? picked.id : undefined, makeId: makerFor(plan.baseGraph), canConnect: canConnect });
        if (result.error) return;
        cx.graph = result.graph;
        commit("connect", picked ? "Reconnect link" : "Connect link");
        return;
      }
      if (cx.nodeAt(point)) return;
      if (plan.picked) {
        cx.graph = removeLinks(cx.graph, new Set([plan.picked.id]));
        commit("disconnect", "Disconnect link");
        return;
      }
      cx.openMenu(event.clientX, event.clientY, point, { fixed: plan.fixed, type: plan.type });
    }
    // ---- node movement -------------------------------------------------

    function startNodeGesture(nodeEl, event, point) {
      var id = nodeEl.dataset.nodeId;
      var additive = event.shiftKey || event.ctrlKey || event.metaKey;
      var inHeader = Boolean(event.target.closest && event.target.closest(".zoidium-node-editor-head"));
      var wasSelected = cx.selected.has(id);
      if (additive) {
        var toggled = new Set(cx.selected);
        if (toggled.has(id)) toggled.delete(id);
        else toggled.add(id);
        setSelection(Array.from(toggled), true);
        if (!cx.selected.has(id)) return;
      } else if (!wasSelected || !inHeader || readOnly) {
        setSelection([id], true);
      }
      if (!inHeader || readOnly) return;
      var items = cx.graph.nodes.filter(function (node) { return cx.selected.has(node.id); }).map(function (node) {
        return { id: node.id, x0: node.x, y0: node.y };
      });
      startGesture({
        kind: "move",
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        items: items,
        primaryId: id,
        clickSelectId: !additive && wasSelected ? id : null,
        moved: false,
        point: point,
      }, event);
    }

    function updateMove(plan, event) {
      var screenDx = event.clientX - plan.startClient.x;
      var screenDy = event.clientY - plan.startClient.y;
      if (!plan.moved) {
        if (Math.hypot(screenDx, screenDy) < DRAG_PX) return;
        plan.moved = true;
      }
      var dx = screenDx / cx.view.zoom;
      var dy = screenDy / cx.view.zoom;
      if (event.ctrlKey || event.metaKey) {
        var primary = plan.items.find(function (item) { return item.id === plan.primaryId; });
        if (primary) {
          dx = Math.round((primary.x0 + dx) / SNAP) * SNAP - primary.x0;
          dy = Math.round((primary.y0 + dy) / SNAP) * SNAP - primary.y0;
        }
      }
      plan.items.forEach(function (item) {
        var node = findNode(cx.graph, item.id);
        var element = cx.nodeEls.get(item.id);
        if (!node) return;
        node.x = Math.round(item.x0 + dx);
        node.y = Math.round(item.y0 + dy);
        if (element) {
          element.style.left = node.x + "px";
          element.style.top = node.y + "px";
        }
      });
      cx.scheduleLinks();
    }

    function restoreMove(plan) {
      plan.items.forEach(function (item) {
        var node = findNode(cx.graph, item.id);
        var element = cx.nodeEls.get(item.id);
        if (!node) return;
        node.x = item.x0;
        node.y = item.y0;
        if (element) {
          element.style.left = node.x + "px";
          element.style.top = node.y + "px";
        }
      });
    }
    // ---- gesture plumbing ----------------------------------------------

    function startGesture(plan, event) {
      gesture = plan;
      try { cx.viewport.setPointerCapture(event.pointerId); } catch (_error) { /* capture is optional */ }
    }

    function releaseCapture(pointerId) {
      try {
        if (cx.viewport.hasPointerCapture(pointerId)) cx.viewport.releasePointerCapture(pointerId);
      } catch (_error) { /* already released */ }
    }

    function clearGestureVisuals() {
      cx.previewPath.setAttribute("d", "");
      cx.knifePath.setAttribute("d", "");
      cx.marquee.classList.remove("visible");
      cx.viewport.classList.remove("panning", "knife");
      cx.pickedLinkId = null;
      clearSocketStates();
      cx.scheduleLinks();
    }

    function cancelGesture() {
      var plan = gesture;
      if (!plan) return;
      gesture = null;
      releaseCapture(plan.pointerId);
      clearGestureVisuals();
      if (plan.kind === "move") restoreMove(plan);
      cx.redrawLinks();
    }

    function finishGesture(event) {
      var plan = gesture;
      if (!plan) return;
      gesture = null;
      releaseCapture(plan.pointerId);
      clearGestureVisuals();
      var point = cx.worldAt(cx.screenOf(event));
      if (plan.kind === "move") {
        if (plan.moved) commit("move", "Move " + plan.items.length + " " + plural(plan.items.length));
        else if (plan.clickSelectId) setSelection([plan.clickSelectId], true);
      } else if (plan.kind === "link") {
        finishLinkGesture(plan, point, event);
      } else if (plan.kind === "marquee") {
        if (!plan.moved) {
          if (plan.mode === "replace") setSelection([], true);
        } else {
          selectInRect(rectFromPoints(plan.startWorld, cx.worldAt(plan.current)), plan.mode);
        }
      } else if (plan.kind === "knife") {
        finishKnife(plan);
      }
    }

    function finishKnife(plan) {
      var index = cx.indexNodes();
      var cut = [];
      if (plan.points.length > 1) {
        cx.graph.links.forEach(function (link) {
          var from = index.get(link.from.node);
          var to = index.get(link.to.node);
          if (!from || !to) return;
          var a = cx.anchorAt(from, "out", link.from.port);
          var b = cx.anchorAt(to, "in", link.to.port);
          if (polylinesCross(plan.points, bezierPoints(a.x, a.y, b.x, b.y, CURVE_STEPS))) cut.push(link.id);
        });
      }
      if (cut.length) {
        cx.graph = removeLinks(cx.graph, new Set(cut));
        commit("disconnect", "Cut " + cut.length + " " + (cut.length === 1 ? "link" : "links"));
        return;
      }
      // Ctrl-drag that cut nothing behaves as a toggle box selection.
      if (plan.moved) selectInRect(rectFromPoints(plan.startWorld, cx.worldAt(plan.current)), "toggle");
    }

    function startMarquee(screen, point, event, mode) {
      startGesture({
        kind: "marquee",
        pointerId: event.pointerId,
        start: screen,
        startWorld: point,
        current: screen,
        moved: false,
        mode: mode || (event.shiftKey ? "add" : "replace"),
      }, event);
    }

    function startKnife(screen, point, event) {
      if (readOnly) {
        startMarquee(screen, point, event, "toggle");
        return;
      }
      cx.viewport.classList.add("knife");
      startGesture({
        kind: "knife",
        pointerId: event.pointerId,
        start: screen,
        startWorld: point,
        current: screen,
        points: [point],
        moved: false,
      }, event);
    }

    function drawMarquee(a, b) {
      cx.marquee.style.left = Math.min(a.x, b.x) + "px";
      cx.marquee.style.top = Math.min(a.y, b.y) + "px";
      cx.marquee.style.width = Math.abs(b.x - a.x) + "px";
      cx.marquee.style.height = Math.abs(b.y - a.y) + "px";
      cx.marquee.classList.add("visible");
    }

    function startPan(screen, event) {
      cx.viewport.classList.add("panning");
      startGesture({ kind: "pan", pointerId: event.pointerId, last: screen }, event);
    }

    function onViewportPointerDown(event) {
      if (cx.destroyed || gesture) return;
      var target = event.target;
      if (closestOf(target, ".zoidium-node-editor-control, .zoidium-node-editor-toggle")) return;
      var screen = cx.screenOf(event);
      var point = cx.worldAt(screen);
      cx.pointerScreen = screen;
      cx.root.focus({ preventScroll: true });
      var socket = closestOf(target, ".zoidium-node-editor-socket");
      var nodeEl = closestOf(target, ".zoidium-node-editor-node");
      if (event.button === 1 || (event.button === 0 && (spacePan || (event.altKey && !nodeEl)))) {
        event.preventDefault();
        startPan(screen, event);
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      if (socket) {
        startLinkGesture(socket, event);
      } else if (nodeEl) {
        startNodeGesture(nodeEl, event, point);
      } else if ((event.ctrlKey || event.metaKey) && !readOnly) {
        startKnife(screen, point, event);
      } else {
        startMarquee(screen, point, event);
      }
    }

    function closestOf(target, selector) {
      return target && typeof target.closest === "function" ? target.closest(selector) : null;
    }

    function onViewportPointerMove(event) {
      if (cx.destroyed) return;
      var screen = cx.screenOf(event);
      cx.pointerScreen = screen;
      var plan = gesture;
      if (!plan || event.pointerId !== plan.pointerId) return;
      if (plan.kind === "pan") {
        cx.view.panX += screen.x - plan.last.x;
        cx.view.panY += screen.y - plan.last.y;
        plan.last = screen;
        cx.applyView();
      } else if (plan.kind === "move") {
        updateMove(plan, event);
      } else if (plan.kind === "link") {
        updateLinkGesture(plan, cx.worldAt(screen));
      } else if (plan.kind === "marquee") {
        plan.current = screen;
        if (!plan.moved && Math.hypot(screen.x - plan.start.x, screen.y - plan.start.y) >= DRAG_PX) plan.moved = true;
        if (plan.moved) drawMarquee(plan.start, screen);
      } else if (plan.kind === "knife") {
        var point = cx.worldAt(screen);
        var last = plan.points[plan.points.length - 1];
        plan.current = screen;
        if (!plan.moved && Math.hypot(screen.x - plan.start.x, screen.y - plan.start.y) >= DRAG_PX) plan.moved = true;
        if (Math.hypot(point.x - last.x, point.y - last.y) > 2) {
          plan.points.push(point);
          cx.knifePath.setAttribute("d", polylinePathD(plan.points));
        }
      }
    }

    function onViewportPointerUp(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      finishGesture(event);
    }

    function onViewportPointerCancel(event) {
      if (gesture && event.pointerId === gesture.pointerId) cancelGesture();
    }

    function onViewportLostCapture(event) {
      if (gesture && event.pointerId === gesture.pointerId) finishGesture(event);
    }

    function onViewportWheel(event) {
      if (cx.destroyed) return;
      event.preventDefault();
      var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1;
      var dx = event.deltaX * unit;
      var dy = event.deltaY * unit;
      if (!event.ctrlKey && dx !== 0) {
        // Two-finger trackpad scroll pans; a pinch arrives with ctrlKey and zooms.
        cx.view.panX -= dx;
        cx.view.panY -= dy;
        cx.applyView();
        return;
      }
      cx.zoomAt(cx.screenOf(event), Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.0015)));
    }
    // ---- keyboard ------------------------------------------------------

    function onRootKeyDown(event) {
      if (cx.destroyed) return;
      var key = event.key;
      var lower = key.length === 1 ? key.toLowerCase() : key;
      var target = event.target;
      var inField = target !== cx.root && typeof target.matches === "function" && target.matches("input, textarea, select");
      if (key === "Escape") {
        var consumed = true;
        if (cx.isMenuOpen()) cx.closeMenu(true);
        else if (gesture) cancelGesture();
        else if (inField) consumed = true;
        else if (cx.selected.size) setSelection([], true);
        else consumed = false;
        if (!consumed) return; // lets the host window close on Escape
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (inField) {
        event.stopPropagation();
        return;
      }
      if (key === " ") {
        if (!event.repeat) spacePan = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Undo, redo and save belong to the editor host: let them bubble to the
      // window, which passes them on to CM3 (graph edits are history steps).
      if (event.ctrlKey && !event.altKey && (lower === "z" || lower === "y" || lower === "s")) return;
      // Only keys the editor handles are prevented; Ctrl+R and the like keep
      // their browser behavior. Every other key stops at the editor.
      var handled = true;
      if (event.ctrlKey || event.metaKey) {
        if (lower === "a") selectAll();
        else if (lower === "d" && !readOnly) cx.duplicateSelected();
        else if (lower === "c") cx.copySelected();
        else if (lower === "v" && !readOnly) cx.pasteClipboard();
        else handled = false;
      } else if (key === "Delete" || key === "Backspace") {
        if (!readOnly) deleteSelected();
      } else if (key === "Home") {
        cx.frameNodes(null);
      } else if (lower === "f") {
        var ids = selectedIds();
        cx.frameNodes(ids.length ? new Set(ids) : null);
      } else if (key === "Tab") {
        if (!readOnly) cx.openMenuAtPointer();
      } else if (lower === "a") {
        if (event.shiftKey) cx.openMenuAtPointer();
        else selectAll();
      } else {
        handled = false;
      }
      if (handled) event.preventDefault();
      event.stopPropagation();
    }

    function onRootKeyUp(event) {
      if (event.key === " ") spacePan = false;
      event.stopPropagation();
    }

    function onRootKeyPress(event) {
      event.stopPropagation();
    }

    function onDocumentPointerDown(event) {
      cx.closeMenuIfOutside(event.target);
    }
    // ---- wiring --------------------------------------------------------

    listen(cx.viewport, "pointerdown", onViewportPointerDown);
    listen(cx.viewport, "pointermove", onViewportPointerMove);
    listen(cx.viewport, "pointerup", onViewportPointerUp);
    listen(cx.viewport, "pointercancel", onViewportPointerCancel);
    listen(cx.viewport, "lostpointercapture", onViewportLostCapture);
    listen(cx.viewport, "pointerleave", function () { cx.pointerScreen = null; });
    listen(cx.viewport, "mousedown", function (event) { if (event.button === 1) event.preventDefault(); });
    listen(cx.viewport, "wheel", onViewportWheel, { passive: false });
    listen(cx.viewport, "contextmenu", function (event) {
      event.preventDefault();
      if (readOnly || closestOf(event.target, ".zoidium-node-editor-node")) return;
      cx.openMenu(event.clientX, event.clientY, cx.worldAt(cx.screenOf(event)), null);
    });
    listen(cx.addButton, "click", function () {
      var buttonRect = cx.addButton.getBoundingClientRect();
      var viewRect = cx.viewport.getBoundingClientRect();
      cx.openMenu(buttonRect.left, buttonRect.bottom + 2, cx.worldAt({ x: viewRect.width / 2, y: viewRect.height / 2 }), null);
    });
    listen(cx.frameButton, "click", function () {
      cx.frameNodes(null);
      cx.root.focus({ preventScroll: true });
    });
    listen(cx.root, "keydown", onRootKeyDown);
    listen(cx.root, "keyup", onRootKeyUp);
    listen(cx.root, "keypress", onRootKeyPress);
    listen(cx.root, "blur", function () { spacePan = false; });
    listen(doc, "pointerdown", onDocumentPointerDown, true);

    if (typeof global.ResizeObserver === "function") {
      resizeObserver = new global.ResizeObserver(function () {
        if (cx.destroyed) return;
        cx.measure();
        if (cx.pendingFrame) cx.frameNodes(null);
        cx.redrawLinks();
      });
      resizeObserver.observe(cx.root);
    }

    // ---- public surface ------------------------------------------------

    function setGraph(next) {
      if (cx.destroyed) return;
      cancelGesture();
      cx.closeMenu(false);
      cx.graph = normalizeGraph(next, types);
      var known = new Set(cx.graph.nodes.map(function (node) { return node.id; }));
      cx.selected = new Set(selectedIds().filter(function (id) { return known.has(id); }));
      cx.collapsed = new Set(Array.from(cx.collapsed).filter(function (id) { return known.has(id); }));
      cx.render();
    }

    function destroy() {
      if (cx.destroyed) return;
      cancelGesture();
      cx.closeMenu(false);
      cx.destroyed = true;
      cx.disposers.splice(0).forEach(function (dispose) { dispose(); });
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (cx.linkFrame) {
        global.cancelAnimationFrame(cx.linkFrame);
        cx.linkFrame = 0;
      }
      cx.root.remove();
      cx.nodeEls.clear();
      cx.socketEls.clear();
      cx.linkEls.clear();
      cx.anchors.clear();
      cx.sizes.clear();
    }

    cx.render();

    return {
      element: cx.root,
      setGraph: setGraph,
      getGraph: function () { return copyGraph(cx.graph); },
      frameAll: function () { if (!cx.destroyed) cx.frameNodes(null); },
      destroy: destroy,
    };
  }
  nodeEditor.graphTools = parts.graphTools;

  var queue = global.ZoidiumUIModules = global.ZoidiumUIModules || [];

  queue.push({
    name: "node-editor",
    install: function () {
      return { nodeEditor: nodeEditor };
    },
  });
})(window);
