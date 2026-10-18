(function (global) {
  "use strict";

  // Pure node graph tools for the Zoidium node editor: registry validation,
  // normalization, connection rules, cycle prevention, id generation,
  // copy/paste remapping and link geometry. No DOM: these run in node tests
  // without a browser and are shared by every split part of the editor
  // through global.ZoidiumNodeEditorParts (see postInitScripts in
  // zoidium/runtime-config.js). The editor itself never evaluates graphs; it
  // edits plain JSON and reports finished gestures through onChange.
  //
  //   Graph:  { nodes: [{ id, type, x, y, params }],
  //             links: [{ id, from: { node, port }, to: { node, port } }] }
  //
  // params holds explicit values. A missing key means the registry default
  // applies. An input port with a default and no incoming link is edited
  // inline, and its value is stored in params under the input's id.

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
  var MISSING_TINT = "var(--zui-danger)";
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
      // Unserializable values (functions, cycles) clone to null.
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
  function matchesSearch(spec, typeId, query) {
    var haystack = [spec.title, spec.category, typeId].concat(Array.isArray(spec.aliases) ? spec.aliases : []).join(" ").toLowerCase();
    return String(query || "").toLowerCase().split(/\s+/).filter(Boolean).every(function (token) { return haystack.indexOf(token) >= 0; });
  }

  function connectedToOutput(graph) {
    var reached = new Set(graph.nodes.filter(function (n) { return n.type === "output"; }).map(function (n) { return n.id; }));
    if (!reached.size) return new Set(graph.nodes.map(function (n) { return n.id; }));
    var changed = true;
    while (changed) {
      changed = false;
      graph.links.forEach(function (link) {
        if (reached.has(link.to.node) && !reached.has(link.from.node)) { reached.add(link.from.node); changed = true; }
      });
    }
    return reached;
  }

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
      // A throwing plugin type check rejects the connection.
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
    matchesSearch: matchesSearch,
    connectedToOutput: connectedToOutput,
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

  var parts = global.ZoidiumNodeEditorParts = global.ZoidiumNodeEditorParts || {};
  parts.consts = {
    GRID: GRID,
    SNAP: SNAP,
    NODE_WIDTH: NODE_WIDTH,
    HEADER_HEIGHT: HEADER_HEIGHT,
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    FRAME_ZOOM_MAX: FRAME_ZOOM_MAX,
    FRAME_MARGIN: FRAME_MARGIN,
    DRAG_PX: DRAG_PX,
    SNAP_PX: SNAP_PX,
    PASTE_OFFSET: PASTE_OFFSET,
    DUPLICATE_OFFSET: DUPLICATE_OFFSET,
    CURVE_STEPS: CURVE_STEPS,
    KEY_SEP: KEY_SEP,
    MISSING_TINT: MISSING_TINT,
    DEFAULT_SIZE: DEFAULT_SIZE,
    TYPE_COLORS: TYPE_COLORS,
    DEFAULT_SOCKET_COLOR: DEFAULT_SOCKET_COLOR,
    SVG_NS: SVG_NS,
  };
  parts.graphTools = graphTools;
  // Every pure helper, so split editor parts share one implementation.
  parts.base = {
    hasOwn: hasOwn,
    isObject: isObject,
    finiteOr: finiteOr,
    clamp: clamp,
    cloneValue: cloneValue,
    sameValue: sameValue,
    anchorKey: anchorKey,
    typeSpec: typeSpec,
    findNode: findNode,
    findPort: findPort,
    decimalsFor: decimalsFor,
    colorFor: colorFor,
    tintForCategory: tintForCategory,
    typesCompatible: typesCompatible,
    countType: countType,
    idsOf: idsOf,
    polylinePathD: polylinePathD,
  };
})(window);
