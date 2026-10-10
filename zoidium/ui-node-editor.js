(function (global) {
  "use strict";

  // Generic node graph editor for Zoidium windows, installed as
  // ZoidiumUI.nodeEditor by ui-kit.js (this file queues its installer first).
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
  // Pure graph operations live in nodeEditor.graphTools (no DOM), so they can
  // be tested without a browser.

  var GRID = 20;               // world units between background grid lines
  var SNAP = 10;               // node snapping step while Ctrl/Cmd is held
  var NODE_WIDTH = 180;        // world units
  var HEADER_HEIGHT = 22;
  var ZOOM_MIN = 0.25;
  var ZOOM_MAX = 2.5;
  var FRAME_ZOOM_MAX = 1.5;    // Home and F never zoom in past this
  var FRAME_MARGIN = 40;       // screen px around framed nodes
  var DRAG_PX = 3;             // screen px before a press becomes a drag
  var SNAP_PX = 14;            // screen px to snap a dragged link to a socket
  var PASTE_OFFSET = 40;
  var DUPLICATE_OFFSET = 20;
  var CURVE_STEPS = 16;
  var KEY_SEP = "\u0001";
  var MISSING_TINT = "#8a4a4a";
  var DEFAULT_SIZE = { w: NODE_WIDTH, h: 60, headH: HEADER_HEIGHT };
  var TYPE_COLORS = { float: "#a0a0a0", vector: "#8176dd", color: "#dcc44e" };
  var DEFAULT_SOCKET_COLOR = "#7d8ba3";
  var SVG_NS = "http://www.w3.org/2000/svg";

  // ---------------------------------------------------------------------
  // Pure helpers (no DOM)
  // ---------------------------------------------------------------------

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function finiteOr(value, fallback) {
    if (value === null || value === "" || value === undefined) return fallback;
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cloneValue(value) {
    if (value === undefined) return undefined;
    try {
      var text = JSON.stringify(value);
      return text === undefined ? null : JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function sameValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every(function (item, index) { return item === b[index]; });
    }
    return a === b;
  }

  function anchorKey(nodeId, dir, portId) {
    return nodeId + KEY_SEP + dir + KEY_SEP + portId;
  }

  function typeSpec(types, typeId) {
    return hasOwn(types, typeId) ? types[typeId] : null;
  }

  function findNode(graph, nodeId) {
    for (var i = 0; i < graph.nodes.length; i += 1) {
      if (graph.nodes[i].id === nodeId) return graph.nodes[i];
    }
    return null;
  }

  function findPort(types, typeId, dir, portId) {
    var spec = typeSpec(types, typeId);
    if (!spec) return null;
    var list = dir === "in" ? spec.inputs : spec.outputs;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === portId) return list[i];
    }
    return null;
  }

  function decimalsFor(step) {
    if (!(step > 0)) return 3;
    var text = String(step);
    var dot = text.indexOf(".");
    return dot < 0 ? 0 : Math.min(6, text.length - dot - 1);
  }

  function colorFor(type) {
    return hasOwn(TYPE_COLORS, type) ? TYPE_COLORS[type] : DEFAULT_SOCKET_COLOR;
  }

  function tintForCategory(category) {
    var text = String(category || "");
    var hash = 0;
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return "hsl(" + (hash % 360) + " 34% 34%)";
  }

  function normalizePorts(list) {
    var out = [];
    var seen = new Set();
    if (!Array.isArray(list)) return out;
    list.forEach(function (port) {
      if (!isObject(port) || port.id == null) return;
      var id = String(port.id);
      if (seen.has(id)) return;
      seen.add(id);
      out.push(Object.assign({}, port, {
        id: id,
        label: String(port.label != null ? port.label : id),
        type: String(port.type || "float"),
      }));
    });
    return out;
  }

  function normalizeParams(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (param) {
      return isObject(param) && param.id != null;
    }).map(function (param) {
      return Object.assign({}, param, {
        id: String(param.id),
        label: String(param.label != null ? param.label : param.id),
        control: String(param.control || "text"),
      });
    });
  }

  // Registry entries are copied and validated; a bad entry is skipped rather
  // than thrown, so one broken type never blanks the editor.
  function normalizeTypes(raw) {
    var out = Object.create(null);
    if (!isObject(raw)) return out;
    Object.keys(raw).forEach(function (typeId) {
      var spec = raw[typeId];
      if (!isObject(spec)) return;
      var max = finiteOr(spec.maxInstances, Infinity);
      out[typeId] = Object.assign({}, spec, {
        id: typeId,
        title: String(spec.title != null ? spec.title : typeId),
        category: String(spec.category != null ? spec.category : "Other"),
        color: typeof spec.color === "string" ? spec.color : null,
        inputs: normalizePorts(spec.inputs),
        outputs: normalizePorts(spec.outputs),
        params: normalizeParams(spec.params),
        maxInstances: max >= 1 ? Math.floor(max) : Infinity,
        deletable: spec.deletable !== false,
      });
    });
    return out;
  }

  function idsOf(graph) {
    var ids = [];
    ["nodes", "links"].forEach(function (key) {
      var list = graph && Array.isArray(graph[key]) ? graph[key] : [];
      list.forEach(function (item) {
        if (isObject(item) && typeof item.id === "string") ids.push(item.id);
      });
    });
    return ids;
  }

  // Returns makeId(prefix) -> "<prefix><counter>" that never collides with
  // existingIds or with ids it returned before. Pass a shared counter object
  // to keep ids monotonic across operations (ids of deleted nodes are not
  // reused by the same editor).
  function createIdMaker(existingIds, counter) {
    var used = new Set(existingIds || []);
    var state = counter || { n: 0 };
    return function makeId(prefix) {
      var id;
      do {
        state.n += 1;
        id = prefix + state.n;
      } while (used.has(id));
      used.add(id);
      return id;
    };
  }

  // Default compatibility: same type, anything from float, and color <-> vector.
  function defaultCanConnect(fromType, toType) {
    if (fromType === toType) return true;
    if (fromType === "float") return true;
    return (fromType === "color" && toType === "vector") || (fromType === "vector" && toType === "color");
  }

  function typesCompatible(canConnect, fromType, toType) {
    try {
      return canConnect ? Boolean(canConnect(fromType, toType)) : defaultCanConnect(fromType, toType);
    } catch (_error) {
      return false;
    }
  }

  // Adding fromId -> toId closes a cycle when toId already reaches fromId
  // through existing links.
  function wouldCreateCycle(links, fromId, toId) {
    if (fromId === toId) return true;
    var stack = [toId];
    var seen = new Set([toId]);
    while (stack.length) {
      var current = stack.pop();
      for (var i = 0; i < links.length; i += 1) {
        if (links[i].from.node !== current) continue;
        var next = links[i].to.node;
        if (next === fromId) return true;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  }

  // from is an output endpoint {node, port}; to is an input endpoint. Returns
  // null when the link is allowed, or a short reason. The link that the new
  // one would replace (the current link into `to`) is not counted for cycles.
  function connectionError(graph, types, from, to, canConnect) {
    if (!from || !to) return "Missing endpoint";
    var fromNode = findNode(graph, from.node);
    var toNode = findNode(graph, to.node);
    if (!fromNode || !toNode) return "Unknown node";
    var outPort = findPort(types, fromNode.type, "out", from.port);
    var inPort = findPort(types, toNode.type, "in", to.port);
    if (!outPort || !inPort) return "Unknown port";
    if (from.node === to.node) return "A node cannot connect to itself";
    if (!typesCompatible(canConnect, outPort.type, inPort.type)) return "Incompatible types";
    var remaining = graph.links.filter(function (link) {
      return !(link.to.node === to.node && link.to.port === to.port);
    });
    if (wouldCreateCycle(remaining, from.node, to.node)) return "Would create a cycle";
    return null;
  }

  function portAllowed(types, node, dir, portId) {
    if (!typeSpec(types, node.type)) return true; // unknown types keep their links
    return findPort(types, node.type, dir, portId) !== null;
  }

  // Makes any input safe to load: drops links to unknown nodes or ports,
  // keeps one link per input, drops links that would close a cycle, gives
  // missing ids to nodes and links, and keeps every other field as given.
  function normalizeGraph(raw, types, makeId) {
    var source = isObject(raw) ? raw : {};
    var nextId = makeId || createIdMaker(idsOf(source), { n: 0 });
    var nodes = [];
    var nodeById = new Map();
    var rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
    rawNodes.forEach(function (item) {
      if (!isObject(item)) return;
      var id = typeof item.id === "string" && item.id !== "" && !nodeById.has(item.id) ? item.id : nextId("n");
      var node = Object.assign(cloneValue(item) || {}, {
        id: id,
        type: item.type == null ? "" : String(item.type),
        x: finiteOr(item.x, 0),
        y: finiteOr(item.y, 0),
        params: isObject(item.params) ? cloneValue(item.params) || {} : {},
      });
      nodeById.set(id, node);
      nodes.push(node);
    });

    var links = [];
    var linkIds = new Set();
    var inputKeys = new Set();
    var rawLinks = Array.isArray(source.links) ? source.links : [];
    rawLinks.forEach(function (item) {
      if (!isObject(item) || !isObject(item.from) || !isObject(item.to)) return;
      var from = { node: String(item.from.node), port: String(item.from.port) };
      var to = { node: String(item.to.node), port: String(item.to.port) };
      var fromNode = nodeById.get(from.node);
      var toNode = nodeById.get(to.node);
      if (!fromNode || !toNode || from.node === to.node) return;
      if (!portAllowed(types, fromNode, "out", from.port) || !portAllowed(types, toNode, "in", to.port)) return;
      var inputKey = to.node + KEY_SEP + to.port;
      if (inputKeys.has(inputKey) || wouldCreateCycle(links, from.node, to.node)) return;
      var id = typeof item.id === "string" && item.id !== "" && !linkIds.has(item.id) ? item.id : nextId("l");
      inputKeys.add(inputKey);
      linkIds.add(id);
      links.push(Object.assign(cloneValue(item) || {}, { id: id, from: from, to: to }));
    });
    return { nodes: nodes, links: links };
  }

  function removeNodes(graph, nodeIds) {
    return {
      nodes: graph.nodes.filter(function (node) { return !nodeIds.has(node.id); }),
      links: graph.links.filter(function (link) {
        return !nodeIds.has(link.from.node) && !nodeIds.has(link.to.node);
      }),
    };
  }

  function removeLinks(graph, linkIds) {
    return {
      nodes: graph.nodes,
      links: graph.links.filter(function (link) { return !linkIds.has(link.id); }),
    };
  }

  function countType(graph, typeId) {
    var count = 0;
    graph.nodes.forEach(function (node) { if (node.type === typeId) count += 1; });
    return count;
  }

  // Inputs with a default are seeded into params so the inline value is part
  // of the graph data from the start.
  function addNode(graph, types, typeId, x, y, makeId) {
    var spec = typeSpec(types, typeId);
    if (!spec) return { error: "Unknown node type" };
    if (countType(graph, typeId) >= spec.maxInstances) {
      return { error: "Only " + spec.maxInstances + " allowed" };
    }
    var params = {};
    spec.params.forEach(function (param) {
      if (param.default !== undefined) params[param.id] = cloneValue(param.default);
    });
    spec.inputs.forEach(function (port) {
      if (port.default !== undefined) params[port.id] = cloneValue(port.default);
    });
    var node = { id: makeId("n"), type: typeId, x: Math.round(x), y: Math.round(y), params: params };
    return {
      graph: { nodes: graph.nodes.concat([node]), links: graph.links },
      node: node,
    };
  }

  // options: { id, makeId, canConnect }. A new link replaces the link that
  // currently feeds the same input (returned as `removed`).
  function connectLinks(graph, types, from, to, options) {
    var opts = options || {};
    var error = connectionError(graph, types, from, to, opts.canConnect);
    if (error) return { error: error };
    var removed = null;
    var links = [];
    graph.links.forEach(function (link) {
      if (link.to.node === to.node && link.to.port === to.port) removed = link;
      else links.push(link);
    });
    var makeId = opts.makeId || createIdMaker(idsOf(graph), { n: 0 });
    var link = {
      id: opts.id || makeId("l"),
      from: { node: from.node, port: from.port },
      to: { node: to.node, port: to.port },
    };
    links.push(link);
    return { graph: { nodes: graph.nodes, links: links }, link: link, removed: removed };
  }

  // Copies the selected nodes and the links between them. Copies are deep, so
  // a fragment never shares objects with the live graph.
  function copyFragment(graph, nodeIds) {
    return {
      nodes: graph.nodes.filter(function (node) { return nodeIds.has(node.id); }).map(cloneValue),
      links: graph.links.filter(function (link) {
        return nodeIds.has(link.from.node) && nodeIds.has(link.to.node);
      }).map(cloneValue),
    };
  }

  // Inserts a fragment with fresh ids, offset by (dx, dy). Nodes beyond a
  // type's maxInstances are skipped, and links with a skipped end are dropped.
  function insertFragment(graph, types, fragment, dx, dy, makeId) {
    var counts = Object.create(null);
    graph.nodes.forEach(function (node) { counts[node.type] = (counts[node.type] || 0) + 1; });
    var idMap = new Map();
    var nodes = [];
    var ids = [];
    fragment.nodes.forEach(function (source) {
      var spec = typeSpec(types, source.type);
      var count = counts[source.type] || 0;
      if (spec && count >= spec.maxInstances) return;
      counts[source.type] = count + 1;
      var node = cloneValue(source) || {};
      node.id = makeId("n");
      node.x = Math.round(finiteOr(source.x, 0) + dx);
      node.y = Math.round(finiteOr(source.y, 0) + dy);
      idMap.set(source.id, node.id);
      nodes.push(node);
      ids.push(node.id);
    });
    var links = [];
    fragment.links.forEach(function (source) {
      var from = idMap.get(source.from.node);
      var to = idMap.get(source.to.node);
      if (from === undefined || to === undefined) return;
      var link = cloneValue(source) || {};
      link.id = makeId("l");
      link.from = { node: from, port: source.from.port };
      link.to = { node: to, port: source.to.port };
      links.push(link);
    });
    return {
      graph: { nodes: graph.nodes.concat(nodes), links: graph.links.concat(links) },
      nodeIds: ids,
    };
  }

  // Link geometry, shared by rendering and knife cuts so the cut follows
  // exactly what is drawn.
  function curveOffset(x1, x2) {
    return Math.max(Math.abs(x2 - x1) * 0.5, 40);
  }

  function linkPathD(x1, y1, x2, y2) {
    var dx = curveOffset(x1, x2);
    return "M" + x1 + " " + y1 + " C" + (x1 + dx) + " " + y1 + " " + (x2 - dx) + " " + y2 + " " + x2 + " " + y2;
  }

  function bezierPoints(x1, y1, x2, y2, steps) {
    var dx = curveOffset(x1, x2);
    var c1x = x1 + dx;
    var c2x = x2 - dx;
    var points = [];
    for (var i = 0; i <= steps; i += 1) {
      var t = i / steps;
      var mt = 1 - t;
      var a = mt * mt * mt;
      var b = 3 * mt * mt * t;
      var c = 3 * mt * t * t;
      var d = t * t * t;
      points.push({
        x: a * x1 + b * c1x + c * c2x + d * x2,
        y: a * y1 + b * y1 + c * y2 + d * y2,
      });
    }
    return points;
  }

  function polylinePathD(points) {
    return points.map(function (point, index) {
      return (index ? "L" : "M") + point.x + " " + point.y;
    }).join(" ");
  }

  function segmentsIntersect(p1, p2, p3, p4) {
    function orient(a, b, c) {
      return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    }
    var d1 = orient(p3, p4, p1);
    var d2 = orient(p3, p4, p2);
    var d3 = orient(p1, p2, p3);
    var d4 = orient(p1, p2, p4);
    // Touching counts as a cut (a knife stroke through a sampled point). Only
    // exactly collinear, disjoint segments can report a false crossing.
    return d1 * d2 <= 0 && d3 * d4 <= 0;
  }

  function polylinesCross(points, curve) {
    for (var i = 0; i + 1 < points.length; i += 1) {
      for (var j = 0; j + 1 < curve.length; j += 1) {
        if (segmentsIntersect(points[i], points[i + 1], curve[j], curve[j + 1])) return true;
      }
    }
    return false;
  }

  function rectFromPoints(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  }

  function rectsIntersect(a, b) {
    return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  }

  var graphTools = Object.freeze({
    normalizeTypes: normalizeTypes,
    normalizeGraph: normalizeGraph,
    createIdMaker: createIdMaker,
    canConnect: defaultCanConnect,
    connectionError: connectionError,
    wouldCreateCycle: wouldCreateCycle,
    connectLinks: connectLinks,
    removeNodes: removeNodes,
    removeLinks: removeLinks,
    addNode: addNode,
    copyFragment: copyFragment,
    insertFragment: insertFragment,
    linkPathD: linkPathD,
    bezierPoints: bezierPoints,
    polylinesCross: polylinesCross,
    rectFromPoints: rectFromPoints,
    rectsIntersect: rectsIntersect,
    tintForCategory: tintForCategory,
    colorFor: colorFor,
  });

  // ---------------------------------------------------------------------
  // Editor component
  // ---------------------------------------------------------------------

  function nodeEditor(options) {
    var opts = options || {};
    var doc = global.document;
    if (!doc) throw new Error("ZoidiumUI.nodeEditor needs a document");

    var types = normalizeTypes(opts.nodeTypes);
    var canConnect = typeof opts.canConnect === "function" ? opts.canConnect : null;
    var readOnly = Boolean(opts.readOnly);
    var onChange = typeof opts.onChange === "function" ? opts.onChange : null;
    var onSelect = typeof opts.onSelect === "function" ? opts.onSelect : null;
    var idCounter = { n: 0 };

    var graph = normalizeGraph(opts.graph, types);
    var selected = new Set();
    var collapsed = new Set();
    var view = { panX: 0, panY: 0, zoom: 1 };
    var anchors = new Map();      // anchorKey -> { dx, dy } from the node's top-left
    var sizes = new Map();        // node id -> { w, h, headH } in world units
    var nodeEls = new Map();
    var socketEls = new Map();
    var linkEls = new Map();
    var linkedInputs = new Set();
    var gesture = null;
    var menu = null;
    var clipboard = null;
    var spacePan = false;
    var pickedLinkId = null;
    var pointerScreen = null;     // last pointer position inside the viewport
    var pendingFrame = true;
    var rendering = false;
    var destroyed = false;
    var linkFrame = 0;
    var disposers = [];
    var resizeObserver = null;

    // ---- DOM ----------------------------------------------------------

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function svgEl(tag, className) {
      var node = doc.createElementNS(SVG_NS, tag);
      if (className) node.setAttribute("class", className);
      return node;
    }

    function listen(target, type, handler, listenOptions) {
      target.addEventListener(type, handler, listenOptions);
      disposers.push(function () { target.removeEventListener(type, handler, listenOptions); });
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
    var header = el("div", "zoidium-node-editor-header");
    var addButton = el("button", "zoidium-node-editor-tool", "+ Add node");
    addButton.type = "button";
    addButton.title = "Add a node (also right-click the grid, Tab or Shift+A)";
    var frameButton = el("button", "zoidium-node-editor-tool", "Frame all");
    frameButton.type = "button";
    frameButton.title = "Fit every node in view (Home)";
    var hint = el("span", "zoidium-node-editor-hint", "Drag from a socket to connect. Right-click the grid to add nodes.");
    if (!readOnly) header.appendChild(addButton);
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
      return { x: (screen.x - view.panX) / view.zoom, y: (screen.y - view.panY) / view.zoom };
    }

    function applyView() {
      world.style.transform = "translate(" + view.panX + "px, " + view.panY + "px) scale(" + view.zoom + ")";
      var spacing = GRID * view.zoom;
      while (spacing < 8) spacing *= 2;
      viewport.style.backgroundSize = spacing + "px " + spacing + "px";
      viewport.style.backgroundPosition = view.panX + "px " + view.panY + "px";
    }

    function zoomAt(screen, factor) {
      var before = worldAt(screen);
      view.zoom = clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
      view.panX = screen.x - before.x * view.zoom;
      view.panY = screen.y - before.y * view.zoom;
      applyView();
    }

    function frameNodes(ids) {
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight;
      if (!vw || !vh) {
        pendingFrame = true;
        return;
      }
      pendingFrame = false;
      var list = graph.nodes.filter(function (node) { return !ids || ids.has(node.id); });
      if (!list.length) {
        view.zoom = 1;
        view.panX = vw / 2;
        view.panY = vh / 2;
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
      view.zoom = zoom;
      view.panX = vw / 2 - (minX + bw / 2) * zoom;
      view.panY = vh / 2 - (minY + bh / 2) * zoom;
      applyView();
    }

    // ---- measurement and anchors --------------------------------------

    function sizeOf(nodeId) {
      return sizes.get(nodeId) || DEFAULT_SIZE;
    }

    // Socket positions come from layout offsets, which ignore the zoom
    // transform. Sockets are measured relative to their node once per render.
    function measure() {
      anchors.clear();
      sizes.clear();
      nodeEls.forEach(function (nodeEl, nodeId) {
        var head = nodeEl.firstElementChild;
        sizes.set(nodeId, {
          w: nodeEl.offsetWidth,
          h: nodeEl.offsetHeight,
          headH: head ? head.offsetHeight : HEADER_HEIGHT,
        });
        nodeEl.querySelectorAll(".zoidium-node-editor-socket").forEach(function (socket) {
          anchors.set(anchorKey(nodeId, socket.dataset.dir, socket.dataset.port), {
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
      var rel = anchors.get(anchorKey(node.id, dir, portId));
      if (rel) return { x: node.x + rel.dx, y: node.y + rel.dy };
      return { x: dir === "in" ? node.x : node.x + size.w, y: node.y + size.headH / 2 };
    }

    function anchorFor(nodeId, dir, portId) {
      var node = findNode(graph, nodeId);
      return node ? anchorAt(node, dir, portId) : null;
    }

    function indexNodes() {
      var index = new Map();
      graph.nodes.forEach(function (node) { index.set(node.id, node); });
      return index;
    }

    function nodeAt(point) {
      var found = null;
      graph.nodes.forEach(function (node) {
        var size = sizeOf(node.id);
        if (point.x >= node.x && point.x <= node.x + size.w && point.y >= node.y && point.y <= node.y + size.h) {
          found = node;
        }
      });
      return found;
    }

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
      var node = findNode(graph, nodeId);
      var port = node ? findPort(types, node.type, dir, portId) : null;
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
      input.disabled = readOnly;
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
        if (readOnly || event.button !== 0) return;
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
        if (rendering || destroyed) return;
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
      input.disabled = readOnly;
      input.addEventListener("change", function () { commit(hexOf(input.value)); });
      return input;
    }

    function checkboxField(value, commit) {
      var input = el("input", "zoidium-node-editor-control zoidium-node-editor-check");
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.disabled = readOnly;
      input.addEventListener("change", function () { commit(input.checked); });
      return input;
    }

    function textField(value, commit) {
      var input = el("input", "zoidium-node-editor-control zoidium-node-editor-text");
      input.type = "text";
      input.spellcheck = false;
      input.value = value == null ? "" : String(value);
      input.disabled = readOnly;
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
      select.disabled = readOnly;
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

    function paramControl(node, param) {
      var value = paramOr(node, param.id, param.default);
      var commit = function (next) { setParam(node.id, param.id, next, param.label); };
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
      socketEls.set(anchorKey(node.id, dir, port.id), socket);
      return socket;
    }

    function inputRow(node, port) {
      var row = el("div", "zoidium-node-editor-row in");
      row.appendChild(socketFor(node, "in", port));
      row.appendChild(el("span", "zoidium-node-editor-label", port.label));
      if (!linkedInputs.has(node.id + KEY_SEP + port.id) && port.default !== undefined) {
        var field = inlineField(port, paramOr(node, port.id, port.default), function (next) {
          setParam(node.id, port.id, next, port.label);
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
        row.appendChild(el("span", "zoidium-node-editor-label", param.label));
        row.appendChild(paramControl(node, param));
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
      var spec = typeSpec(types, node.type);
      var element = el("div", "zoidium-node-editor-node");
      element.dataset.nodeId = node.id;
      element.style.left = node.x + "px";
      element.style.top = node.y + "px";
      if (selected.has(node.id)) element.classList.add("selected");
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
      toggle.title = collapsed.has(node.id) ? "Expand" : "Collapse";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.appendChild(el("span", "zoidium-node-editor-caret"));
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        if (collapsed.has(node.id)) collapsed.delete(node.id);
        else collapsed.add(node.id);
        render();
      });
      head.insertBefore(toggle, head.firstChild);
      if (collapsed.has(node.id)) {
        element.classList.add("collapsed");
        return element;
      }
      var ports = el("div", "zoidium-node-editor-ports");
      spec.inputs.forEach(function (port) { ports.appendChild(inputRow(node, port)); });
      spec.outputs.forEach(function (port) { ports.appendChild(outputRow(node, port)); });
      element.appendChild(ports);
      if (spec.params.length) element.appendChild(paramsBlock(node, spec));
      return element;
    }

    function render() {
      if (destroyed) return;
      rendering = true;
      try {
        nodeLayer.textContent = "";
        linkLayer.textContent = "";
        nodeEls.clear();
        socketEls.clear();
        linkEls.clear();
        linkedInputs = new Set();
        graph.links.forEach(function (link) {
          linkedInputs.add(link.to.node + KEY_SEP + link.to.port);
        });
        graph.nodes.forEach(function (node) {
          var element = buildNode(node);
          nodeLayer.appendChild(element);
          nodeEls.set(node.id, element);
        });
        graph.links.forEach(function (link) {
          var path = svgEl("path", "zoidium-node-editor-link");
          path.setAttribute("stroke", colorFor(portTypeOf(link.from.node, "out", link.from.port)));
          linkLayer.appendChild(path);
          linkEls.set(link.id, path);
        });
      } finally {
        rendering = false;
      }
      measure();
      if (pendingFrame) frameNodes(null);
      redrawLinks();
    }

    function redrawLinks() {
      if (destroyed) return;
      var index = indexNodes();
      graph.links.forEach(function (link) {
        var path = linkEls.get(link.id);
        if (!path) return;
        var from = index.get(link.from.node);
        var to = index.get(link.to.node);
        if (!from || !to) {
          path.setAttribute("d", "");
          return;
        }
        var a = anchorAt(from, "out", link.from.port);
        var b = anchorAt(to, "in", link.to.port);
        path.setAttribute("d", linkPathD(a.x, a.y, b.x, b.y));
        var className = "zoidium-node-editor-link";
        if (selected.has(to.id)) className += " lit";
        if (pickedLinkId === link.id) className += " picked";
        path.setAttribute("class", className);
      });
    }

    function scheduleLinks() {
      if (linkFrame || destroyed) return;
      linkFrame = global.requestAnimationFrame(function () {
        linkFrame = 0;
        redrawLinks();
      });
    }

    function updateSelectionVisuals() {
      nodeEls.forEach(function (element, nodeId) {
        element.classList.toggle("selected", selected.has(nodeId));
      });
      scheduleLinks();
    }

    // ---- selection and commits ----------------------------------------

    function selectedIds() {
      return Array.from(selected);
    }

    function setSelection(ids, emit) {
      var known = new Set(graph.nodes.map(function (node) { return node.id; }));
      var next = new Set();
      Array.from(ids).forEach(function (id) { if (known.has(id)) next.add(id); });
      var unchanged = next.size === selected.size && Array.from(next).every(function (id) { return selected.has(id); });
      selected = next;
      updateSelectionVisuals();
      if (emit && !unchanged && onSelect) {
        try {
          onSelect(selectedIds());
        } catch (error) {
          console.error("[Zoidium] node editor onSelect failed:", error);
        }
      }
    }

    function commit(kind, label) {
      render();
      if (!onChange) return;
      try {
        onChange(copyGraph(graph), { kind: kind, label: label });
      } catch (error) {
        console.error("[Zoidium] node editor onChange failed:", error);
      }
    }

    function copyGraph(source) {
      return { nodes: cloneValue(source.nodes) || [], links: cloneValue(source.links) || [] };
    }

    function makerFor(source) {
      return createIdMaker(idsOf(source), idCounter);
    }

    function setParam(nodeId, key, value, label) {
      if (readOnly || destroyed) return;
      var node = findNode(graph, nodeId);
      if (!node) return;
      if (sameValue(paramOr(node, key, defaultFor(typeSpec(types, node.type) || { params: [], inputs: [] }, key)), value)) return;
      node.params = Object.assign({}, node.params);
      node.params[key] = cloneValue(value);
      commit("param", "Set " + label);
    }

    function finishInsert(result, verb) {
      if (!result.nodeIds.length) return;
      graph = result.graph;
      setSelection(result.nodeIds, true);
      commit(verb.toLowerCase(), verb + " " + result.nodeIds.length + " " + plural(result.nodeIds.length));
    }

    function plural(count) {
      return count === 1 ? "node" : "nodes";
    }

    function duplicateSelected() {
      var ids = selectedIds();
      if (!ids.length) return;
      var fragment = copyFragment(graph, new Set(ids));
      finishInsert(insertFragment(graph, types, fragment, DUPLICATE_OFFSET, DUPLICATE_OFFSET, makerFor(graph)), "Duplicate");
    }

    function copySelected() {
      var ids = selectedIds();
      if (!ids.length) return;
      clipboard = copyFragment(graph, new Set(ids));
    }

    function pasteClipboard() {
      if (!clipboard || !clipboard.nodes.length) return;
      var minX = clipboard.nodes.reduce(function (min, node) { return Math.min(min, node.x); }, Infinity);
      var minY = clipboard.nodes.reduce(function (min, node) { return Math.min(min, node.y); }, Infinity);
      var target = pointerScreen ? worldAt(pointerScreen) : { x: minX + PASTE_OFFSET, y: minY + PASTE_OFFSET };
      var fragment = cloneValue(clipboard);
      finishInsert(insertFragment(graph, types, fragment, Math.round(target.x - minX), Math.round(target.y - minY), makerFor(graph)), "Paste");
    }

    function deleteSelected() {
      var doomed = new Set(selectedIds().filter(function (id) {
        var node = findNode(graph, id);
        var spec = node ? typeSpec(types, node.type) : null;
        return !spec || spec.deletable !== false;
      }));
      if (!doomed.size) return;
      graph = removeNodes(graph, doomed);
      setSelection(selectedIds().filter(function (id) { return !doomed.has(id); }), true);
      commit("delete", "Delete " + doomed.size + " " + plural(doomed.size));
    }

    function selectAll() {
      setSelection(graph.nodes.map(function (node) { return node.id; }), true);
    }

    function selectInRect(rect, mode) {
      var hit = new Set();
      graph.nodes.forEach(function (node) {
        var size = sizeOf(node.id);
        if (rectsIntersect(rect, { x: node.x, y: node.y, w: size.w, h: size.h })) hit.add(node.id);
      });
      var next;
      if (mode === "add") {
        next = new Set(selected);
        hit.forEach(function (id) { next.add(id); });
      } else if (mode === "toggle") {
        next = new Set(selected);
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
      socketEls.forEach(function (socket) {
        if (socket.dataset.dir !== opposite) return;
        var error = linkError(plan, { node: socket.dataset.nodeId, port: socket.dataset.port });
        socket.classList.add(error ? "invalid" : "valid");
      });
    }

    function clearSocketStates() {
      socketEls.forEach(function (socket) {
        socket.classList.remove("valid", "invalid", "target");
      });
    }

    function findTarget(plan, point) {
      var radius = SNAP_PX / view.zoom;
      var best = null;
      var bestDistance = radius * radius;
      var opposite = plan.fixed.dir === "out" ? "in" : "out";
      graph.nodes.forEach(function (node) {
        var spec = typeSpec(types, node.type);
        if (!spec) return;
        (opposite === "in" ? spec.inputs : spec.outputs).forEach(function (port) {
          var anchor = anchorAt(node, opposite, port.id);
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
      var node = findNode(graph, socket.dataset.nodeId);
      if (!node) return;
      var dir = socket.dataset.dir;
      var plan = {
        kind: "link",
        pointerId: event.pointerId,
        fixed: { node: node.id, port: socket.dataset.port, dir: dir },
        picked: null,
        baseGraph: graph,
        target: null,
        targetKey: null,
        type: portTypeOf(node.id, dir, socket.dataset.port),
      };
      if (dir === "in") {
        var existing = graph.links.find(function (link) {
          return link.to.node === node.id && link.to.port === socket.dataset.port;
        });
        if (existing) {
          plan.picked = existing;
          plan.fixed = { node: existing.from.node, port: existing.from.port, dir: "out" };
          plan.type = portTypeOf(existing.from.node, "out", existing.from.port);
          plan.baseGraph = removeLinks(graph, new Set([existing.id]));
          pickedLinkId = existing.id;
        }
      }
      markSockets(plan);
      startGesture(plan, event);
      updateLinkGesture(plan, worldAt(screenOf(event)));
    }

    function updateLinkGesture(plan, point) {
      var fixed = anchorFor(plan.fixed.node, plan.fixed.dir, plan.fixed.port);
      if (fixed) {
        var d = plan.fixed.dir === "out" ? linkPathD(fixed.x, fixed.y, point.x, point.y) : linkPathD(point.x, point.y, fixed.x, fixed.y);
        previewPath.setAttribute("d", d);
        previewPath.setAttribute("stroke", colorFor(plan.type));
      }
      var best = findTarget(plan, point);
      var key = best ? best.key : null;
      if (key !== plan.targetKey) {
        var previous = plan.targetKey ? socketEls.get(plan.targetKey) : null;
        if (previous) previous.classList.remove("target");
        var next = key ? socketEls.get(key) : null;
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
        graph = result.graph;
        commit("connect", picked ? "Reconnect link" : "Connect link");
        return;
      }
      if (nodeAt(point)) return;
      if (plan.picked) {
        graph = removeLinks(graph, new Set([plan.picked.id]));
        commit("disconnect", "Disconnect link");
        return;
      }
      openMenu(event.clientX, event.clientY, point, { fixed: plan.fixed, type: plan.type });
    }

    // ---- node movement -------------------------------------------------

    function startNodeGesture(nodeEl, event, point) {
      var id = nodeEl.dataset.nodeId;
      var additive = event.shiftKey || event.ctrlKey || event.metaKey;
      var inHeader = Boolean(event.target.closest && event.target.closest(".zoidium-node-editor-head"));
      var wasSelected = selected.has(id);
      if (additive) {
        var toggled = new Set(selected);
        if (toggled.has(id)) toggled.delete(id);
        else toggled.add(id);
        setSelection(Array.from(toggled), true);
        if (!selected.has(id)) return;
      } else if (!wasSelected || !inHeader || readOnly) {
        setSelection([id], true);
      }
      if (!inHeader || readOnly) return;
      var items = graph.nodes.filter(function (node) { return selected.has(node.id); }).map(function (node) {
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
      var dx = screenDx / view.zoom;
      var dy = screenDy / view.zoom;
      if (event.ctrlKey || event.metaKey) {
        var primary = plan.items.find(function (item) { return item.id === plan.primaryId; });
        if (primary) {
          dx = Math.round((primary.x0 + dx) / SNAP) * SNAP - primary.x0;
          dy = Math.round((primary.y0 + dy) / SNAP) * SNAP - primary.y0;
        }
      }
      plan.items.forEach(function (item) {
        var node = findNode(graph, item.id);
        var element = nodeEls.get(item.id);
        if (!node) return;
        node.x = Math.round(item.x0 + dx);
        node.y = Math.round(item.y0 + dy);
        if (element) {
          element.style.left = node.x + "px";
          element.style.top = node.y + "px";
        }
      });
      scheduleLinks();
    }

    function restoreMove(plan) {
      plan.items.forEach(function (item) {
        var node = findNode(graph, item.id);
        var element = nodeEls.get(item.id);
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
      try { viewport.setPointerCapture(event.pointerId); } catch (_error) { /* capture is optional */ }
    }

    function releaseCapture(pointerId) {
      try {
        if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      } catch (_error) { /* already released */ }
    }

    function clearGestureVisuals() {
      previewPath.setAttribute("d", "");
      knifePath.setAttribute("d", "");
      marquee.classList.remove("visible");
      viewport.classList.remove("panning", "knife");
      pickedLinkId = null;
      clearSocketStates();
      scheduleLinks();
    }

    function cancelGesture() {
      var plan = gesture;
      if (!plan) return;
      gesture = null;
      releaseCapture(plan.pointerId);
      clearGestureVisuals();
      if (plan.kind === "move") restoreMove(plan);
      redrawLinks();
    }

    function finishGesture(event) {
      var plan = gesture;
      if (!plan) return;
      gesture = null;
      releaseCapture(plan.pointerId);
      clearGestureVisuals();
      var point = worldAt(screenOf(event));
      if (plan.kind === "move") {
        if (plan.moved) commit("move", "Move " + plan.items.length + " " + plural(plan.items.length));
        else if (plan.clickSelectId) setSelection([plan.clickSelectId], true);
      } else if (plan.kind === "link") {
        finishLinkGesture(plan, point, event);
      } else if (plan.kind === "marquee") {
        if (!plan.moved) {
          if (plan.mode === "replace") setSelection([], true);
        } else {
          selectInRect(rectFromPoints(plan.startWorld, worldAt(plan.current)), plan.mode);
        }
      } else if (plan.kind === "knife") {
        finishKnife(plan);
      }
    }

    function finishKnife(plan) {
      var index = indexNodes();
      var cut = [];
      if (plan.points.length > 1) {
        graph.links.forEach(function (link) {
          var from = index.get(link.from.node);
          var to = index.get(link.to.node);
          if (!from || !to) return;
          var a = anchorAt(from, "out", link.from.port);
          var b = anchorAt(to, "in", link.to.port);
          if (polylinesCross(plan.points, bezierPoints(a.x, a.y, b.x, b.y, CURVE_STEPS))) cut.push(link.id);
        });
      }
      if (cut.length) {
        graph = removeLinks(graph, new Set(cut));
        commit("disconnect", "Cut " + cut.length + " " + (cut.length === 1 ? "link" : "links"));
        return;
      }
      // Ctrl-drag that cut nothing behaves as a toggle box selection.
      if (plan.moved) selectInRect(rectFromPoints(plan.startWorld, worldAt(plan.current)), "toggle");
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
      viewport.classList.add("knife");
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
      marquee.style.left = Math.min(a.x, b.x) + "px";
      marquee.style.top = Math.min(a.y, b.y) + "px";
      marquee.style.width = Math.abs(b.x - a.x) + "px";
      marquee.style.height = Math.abs(b.y - a.y) + "px";
      marquee.classList.add("visible");
    }

    function startPan(screen, event) {
      viewport.classList.add("panning");
      startGesture({ kind: "pan", pointerId: event.pointerId, last: screen }, event);
    }

    function onViewportPointerDown(event) {
      if (destroyed || gesture) return;
      var target = event.target;
      if (closestOf(target, ".zoidium-node-editor-control, .zoidium-node-editor-toggle")) return;
      var screen = screenOf(event);
      var point = worldAt(screen);
      pointerScreen = screen;
      root.focus({ preventScroll: true });
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
      if (destroyed) return;
      var screen = screenOf(event);
      pointerScreen = screen;
      var plan = gesture;
      if (!plan || event.pointerId !== plan.pointerId) return;
      if (plan.kind === "pan") {
        view.panX += screen.x - plan.last.x;
        view.panY += screen.y - plan.last.y;
        plan.last = screen;
        applyView();
      } else if (plan.kind === "move") {
        updateMove(plan, event);
      } else if (plan.kind === "link") {
        updateLinkGesture(plan, worldAt(screen));
      } else if (plan.kind === "marquee") {
        plan.current = screen;
        if (!plan.moved && Math.hypot(screen.x - plan.start.x, screen.y - plan.start.y) >= DRAG_PX) plan.moved = true;
        if (plan.moved) drawMarquee(plan.start, screen);
      } else if (plan.kind === "knife") {
        var point = worldAt(screen);
        var last = plan.points[plan.points.length - 1];
        plan.current = screen;
        if (!plan.moved && Math.hypot(screen.x - plan.start.x, screen.y - plan.start.y) >= DRAG_PX) plan.moved = true;
        if (Math.hypot(point.x - last.x, point.y - last.y) > 2) {
          plan.points.push(point);
          knifePath.setAttribute("d", polylinePathD(plan.points));
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
      if (destroyed) return;
      event.preventDefault();
      var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1;
      var dx = event.deltaX * unit;
      var dy = event.deltaY * unit;
      if (!event.ctrlKey && dx !== 0) {
        // Two-finger trackpad scroll pans; a pinch arrives with ctrlKey and zooms.
        view.panX -= dx;
        view.panY -= dy;
        applyView();
        return;
      }
      zoomAt(screenOf(event), Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.0015)));
    }

    // ---- add menu ------------------------------------------------------

    function menuAccepts(spec, ctx) {
      var ports = ctx.fixed.dir === "out" ? spec.inputs : spec.outputs;
      return ports.some(function (port) {
        return ctx.fixed.dir === "out"
          ? typesCompatible(canConnect, ctx.type, port.type)
          : typesCompatible(canConnect, port.type, ctx.type);
      });
    }

    function pickPort(spec, ctx) {
      var ports = ctx.fixed.dir === "out" ? spec.inputs : spec.outputs;
      var exact = ports.find(function (port) { return port.type === ctx.type; });
      if (exact) return exact;
      return ports.find(function (port) {
        return ctx.fixed.dir === "out"
          ? typesCompatible(canConnect, ctx.type, port.type)
          : typesCompatible(canConnect, port.type, ctx.type);
      }) || null;
    }

    function openMenu(clientX, clientY, point, ctx) {
      if (destroyed || readOnly) return;
      closeMenu(false);
      var rootRect = root.getBoundingClientRect();
      var element = el("div", "zoidium-node-editor-menu");
      var search = el("input", "zoidium-node-editor-search");
      search.type = "text";
      search.spellcheck = false;
      search.autocomplete = "off";
      search.placeholder = ctx ? "Connect a node..." : "Add a node...";
      var list = el("div", "zoidium-node-editor-menu-list");
      element.appendChild(search);
      element.appendChild(list);
      root.appendChild(element);
      menu = {
        element: element,
        search: search,
        list: list,
        point: point,
        ctx: ctx,
        items: [],
        index: -1,
        left: Math.max(0, clientX - rootRect.left),
        top: Math.max(0, clientY - rootRect.top),
      };
      search.addEventListener("input", function () { renderMenuItems(search.value); });
      search.addEventListener("keydown", onMenuKey);
      renderMenuItems("");
      search.focus();
    }

    function renderMenuItems(query) {
      if (!menu) return;
      var tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
      var list = menu.list;
      list.textContent = "";
      menu.items = [];
      var groups = new Map();
      Object.keys(types).forEach(function (typeId) {
        var spec = types[typeId];
        if (menu.ctx && !menuAccepts(spec, menu.ctx)) return;
        var haystack = (spec.title + " " + spec.category + " " + typeId).toLowerCase();
        if (!tokens.every(function (token) { return haystack.indexOf(token) >= 0; })) return;
        if (!groups.has(spec.category)) groups.set(spec.category, []);
        groups.get(spec.category).push(spec);
      });
      if (!groups.size) list.appendChild(el("div", "zoidium-node-editor-menu-empty", "No matching nodes."));
      groups.forEach(function (specs, category) {
        list.appendChild(el("div", "zoidium-node-editor-menu-group", category));
        specs.forEach(function (spec) {
          var full = countType(graph, spec.id) >= spec.maxInstances;
          var item = el("div", "zoidium-node-editor-menu-item" + (full ? " disabled" : ""), spec.title);
          if (full) item.title = "Only " + spec.maxInstances + " allowed in this graph";
          var index = menu.items.length;
          menu.items.push({ id: spec.id, element: item, disabled: full });
          item.addEventListener("pointerdown", function (event) { event.preventDefault(); });
          item.addEventListener("pointerenter", function () { setMenuIndex(index); });
          item.addEventListener("click", function () { activateMenuItem(index); });
          list.appendChild(item);
        });
      });
      setMenuIndex(menu.items.findIndex(function (item) { return !item.disabled; }));
      clampMenu();
    }

    function clampMenu() {
      var rootRect = root.getBoundingClientRect();
      var element = menu.element;
      var left = Math.min(menu.left, Math.max(0, rootRect.width - element.offsetWidth));
      var top = Math.min(menu.top, Math.max(0, rootRect.height - element.offsetHeight));
      element.style.left = left + "px";
      element.style.top = top + "px";
    }

    function setMenuIndex(index) {
      if (!menu) return;
      menu.index = index;
      menu.items.forEach(function (item, position) {
        item.element.classList.toggle("active", position === index);
      });
      var active = menu.items[index];
      if (active && typeof active.element.scrollIntoView === "function") {
        active.element.scrollIntoView({ block: "nearest" });
      }
    }

    function moveMenu(step) {
      if (!menu || !menu.items.length) return;
      var count = menu.items.length;
      var index = menu.index;
      for (var i = 0; i < count; i += 1) {
        index = (index + step + count) % count;
        if (!menu.items[index].disabled) {
          setMenuIndex(index);
          return;
        }
      }
    }

    function onMenuKey(event) {
      event.stopPropagation();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveMenu(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveMenu(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        activateMenuItem(menu ? menu.index : -1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    }

    function activateMenuItem(index) {
      if (!menu) return;
      var item = menu.items[index];
      if (!item || item.disabled) return;
      var opened = menu;
      closeMenu(true);
      addNodeOfType(item.id, opened.point, opened.ctx);
    }

    function addNodeOfType(typeId, point, ctx) {
      var spec = typeSpec(types, typeId);
      if (!spec) return;
      var maker = makerFor(graph);
      var added = addNode(graph, types, typeId, point.x, point.y, maker);
      if (added.error) return;
      var next = added.graph;
      var label = "Add " + spec.title;
      if (ctx) {
        var port = pickPort(spec, ctx);
        if (port) {
          var fixed = ctx.fixed;
          var from = fixed.dir === "out" ? { node: fixed.node, port: fixed.port } : { node: added.node.id, port: port.id };
          var to = fixed.dir === "out" ? { node: added.node.id, port: port.id } : { node: fixed.node, port: fixed.port };
          var connected = connectLinks(next, types, from, to, { makeId: maker, canConnect: canConnect });
          if (!connected.error) {
            next = connected.graph;
            label += " and connect";
          }
        }
      }
      graph = next;
      setSelection([added.node.id], true);
      commit("add", label);
    }

    function closeMenu(refocus) {
      if (!menu) return;
      var closing = menu;
      menu = null;
      closing.element.remove();
      if (refocus && !destroyed) root.focus({ preventScroll: true });
    }

    function openMenuAtPointer() {
      var rect = viewport.getBoundingClientRect();
      var screen = pointerScreen || { x: rect.width / 2, y: rect.height / 2 };
      openMenu(rect.left + screen.x, rect.top + screen.y, worldAt(screen), null);
    }

    // ---- keyboard ------------------------------------------------------

    function onRootKeyDown(event) {
      if (destroyed) return;
      var key = event.key;
      var lower = key.length === 1 ? key.toLowerCase() : key;
      var target = event.target;
      var inField = target !== root && typeof target.matches === "function" && target.matches("input, textarea, select");
      if (key === "Escape") {
        var consumed = true;
        if (menu) closeMenu(true);
        else if (gesture) cancelGesture();
        else if (inField) consumed = true;
        else if (selected.size) setSelection([], true);
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
        else if (lower === "d" && !readOnly) duplicateSelected();
        else if (lower === "c") copySelected();
        else if (lower === "v" && !readOnly) pasteClipboard();
        else handled = false;
      } else if (key === "Delete" || key === "Backspace") {
        if (!readOnly) deleteSelected();
      } else if (key === "Home") {
        frameNodes(null);
      } else if (lower === "f") {
        var ids = selectedIds();
        frameNodes(ids.length ? new Set(ids) : null);
      } else if (key === "Tab") {
        if (!readOnly) openMenuAtPointer();
      } else if (lower === "a") {
        if (event.shiftKey) openMenuAtPointer();
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
      if (menu && !menu.element.contains(event.target)) closeMenu(false);
    }

    // ---- wiring --------------------------------------------------------

    listen(viewport, "pointerdown", onViewportPointerDown);
    listen(viewport, "pointermove", onViewportPointerMove);
    listen(viewport, "pointerup", onViewportPointerUp);
    listen(viewport, "pointercancel", onViewportPointerCancel);
    listen(viewport, "lostpointercapture", onViewportLostCapture);
    listen(viewport, "pointerleave", function () { pointerScreen = null; });
    listen(viewport, "mousedown", function (event) { if (event.button === 1) event.preventDefault(); });
    listen(viewport, "wheel", onViewportWheel, { passive: false });
    listen(viewport, "contextmenu", function (event) {
      event.preventDefault();
      if (readOnly || closestOf(event.target, ".zoidium-node-editor-node")) return;
      openMenu(event.clientX, event.clientY, worldAt(screenOf(event)), null);
    });
    listen(addButton, "click", function () {
      var buttonRect = addButton.getBoundingClientRect();
      var viewRect = viewport.getBoundingClientRect();
      openMenu(buttonRect.left, buttonRect.bottom + 2, worldAt({ x: viewRect.width / 2, y: viewRect.height / 2 }), null);
    });
    listen(frameButton, "click", function () {
      frameNodes(null);
      root.focus({ preventScroll: true });
    });
    listen(root, "keydown", onRootKeyDown);
    listen(root, "keyup", onRootKeyUp);
    listen(root, "keypress", onRootKeyPress);
    listen(root, "blur", function () { spacePan = false; });
    listen(doc, "pointerdown", onDocumentPointerDown, true);

    if (typeof global.ResizeObserver === "function") {
      resizeObserver = new global.ResizeObserver(function () {
        if (destroyed) return;
        measure();
        if (pendingFrame) frameNodes(null);
        redrawLinks();
      });
      resizeObserver.observe(root);
    }

    // ---- public surface ------------------------------------------------

    function setGraph(next) {
      if (destroyed) return;
      cancelGesture();
      closeMenu(false);
      graph = normalizeGraph(next, types);
      var known = new Set(graph.nodes.map(function (node) { return node.id; }));
      selected = new Set(selectedIds().filter(function (id) { return known.has(id); }));
      collapsed = new Set(Array.from(collapsed).filter(function (id) { return known.has(id); }));
      render();
    }

    function destroy() {
      if (destroyed) return;
      cancelGesture();
      closeMenu(false);
      destroyed = true;
      disposers.splice(0).forEach(function (dispose) { dispose(); });
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (linkFrame) {
        global.cancelAnimationFrame(linkFrame);
        linkFrame = 0;
      }
      root.remove();
      nodeEls.clear();
      socketEls.clear();
      linkEls.clear();
      anchors.clear();
      sizes.clear();
    }

    render();

    return {
      element: root,
      setGraph: setGraph,
      getGraph: function () { return copyGraph(graph); },
      frameAll: function () { if (!destroyed) frameNodes(null); },
      destroy: destroy,
    };
  }

  nodeEditor.graphTools = graphTools;

  var queue = global.ZoidiumUIModules = global.ZoidiumUIModules || [];

  queue.push({
    name: "node-editor",
    install: function () {
      return { nodeEditor: nodeEditor };
    },
  });
})(window);
