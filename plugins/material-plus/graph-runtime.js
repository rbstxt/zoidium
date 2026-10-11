"use strict";

// Node graph runtime entry: parses node graphs and evaluates them to pixel
// buffers. Pixel math lives in graph-buffers.js, project image support in
// graph-images.js, and the 32 node definitions in graph-types.js. Loaded
// through plain require under Node and through the shared bundle module
// loader (`context.apis.modules.createRequire`) in the Zoidium runtime.

const createPixelBuffers = require("./graph-buffers.js");
const attachGraphImages = require("./graph-images.js");
const defineGraphTypes = require("./graph-types.js");

function createGraphRuntime(PZ, document) {
    const nodes = {};
    const buffers = createPixelBuffers(document);
    const { bufferToCanvas, clamp, luminanceAt } = buffers;
    const imageBuffer = attachGraphImages(nodes, { PZ, document, newBuffer: buffers.newBuffer });
    const { TYPES, pixelParameter, reduceValue, asTexture, numericMath } = defineGraphTypes({ ...buffers, imageBuffer });

    nodes.types = TYPES;

    nodes.defaultGraph = function () {
        return {
            nodes: [
                {
                    id: "noise",
                    type: "noise",
                    x: 40,
                    y: 120,
                    params: { scale: 3, ratio: 14, octaves: 4, seed: 7, brightness: 1, contrast: 1.4, speedX: 0, speedY: 0 },
                },
                {
                    id: "gradient",
                    type: "gradient",
                    x: 330,
                    y: 90,
                    params: { value: 0.5, midpoint: 0.45, color1: [0.08, 0.08, 0.09], color2: [0.85, 0.87, 0.9] },
                },
                { id: "output", type: "output", x: 640, y: 80, params: {} },
            ],
            links: [
                { from: "noise", fromPort: "out", to: "gradient", toPort: "t" },
                { from: "gradient", fromPort: "out", to: "output", toPort: "color" },
                { from: "noise", fromPort: "out", to: "output", toPort: "bump" },
            ],
        };
    };

    nodes.createNode = function (type, id) {
        var definition = TYPES[type];
        var params = {};
        for (var i = 0; i < definition.params.length; i++) {
            var param = definition.params[i];
            params[param.key] = Array.isArray(param.value) ? param.value.slice() : param.value;
        }
        return { id: id, type: type, x: 40, y: 40, params: params };
    };

    const parseCache = new Map();
    const MAX_PARSE_CACHE = 50;

    function parseGraph(json) {
        let graph;
        try { graph = typeof json === "string" ? JSON.parse(json.slice(0, 1000000)) : json; } catch (_) {}
        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) graph = nodes.defaultGraph();
        const result = { schemaVersion: 1, nodes: [], links: [] };
        const ids = new Set();
        for (const raw of graph.nodes.slice(0, 200)) {
            if (!raw || typeof raw.id !== "string" || raw.id.length > 128 || ids.has(raw.id) || !Object.hasOwn(TYPES, raw.type)) continue;
            ids.add(raw.id);
            const type = raw.type === "math" && raw.params?.a === undefined && raw.params?.b === undefined ? "legacyMath" : raw.type;
            const node = nodes.createNode(type, raw.id);
            node.x = Number.isFinite(raw.x) ? raw.x : 40;
            node.y = Number.isFinite(raw.y) ? raw.y : 40;
            for (const p of TYPES[type].params) {
                let v = raw.params?.[p.key];
                if (p.type === "number" && Number.isFinite(Number(v))) v = clamp(Number(v), p.min ?? -Number.MAX_VALUE, p.max ?? Number.MAX_VALUE);
                else if (p.type === "option" && Number.isFinite(Number(v))) v = clamp(Math.round(Number(v)), 0, p.items.length - 1);
                else if (p.type === "color" && Array.isArray(v) && v.length >= 3) v = v.slice(0, 3).map(c => clamp(Number(c) || 0, 0, 1));
                else if (p.type === "asset" && typeof v === "string" && !/^(?:https?:|data:|blob:)/i.test(v)) v = v.slice(0, 1024);
                else continue;
                node.params[p.key] = v;
            }
            result.nodes.push(node);
        }
        const map = new Map(result.nodes.map(n => [n.id, n]));
        const occupied = new Set();
        for (const raw of graph.links.slice(0, 400)) {
            if (!raw) continue;
            const link = typeof raw.from === "object" ? { from: raw.from?.node, fromPort: raw.from?.port, to: raw.to?.node, toPort: raw.to?.port } : raw;
            const from = map.get(link.from), to = map.get(link.to);
            const key = link.to + ":" + link.toPort;
            if (!from || !to || occupied.has(key) || !TYPES[from.type].outputs.some(p => p.key === link.fromPort) || !TYPES[to.type].inputs.some(p => p.key === link.toPort)) continue;
            const reaches = (id, seen = new Set()) => {
                if (id === link.from) return true;
                if (seen.has(id)) return false;
                seen.add(id);
                return result.links.some(l => l.from === id && reaches(l.to, seen));
            };
            if (reaches(link.to)) continue;
            occupied.add(key);
            result.links.push({ from: link.from, fromPort: link.fromPort, to: link.to, toPort: link.toPort });
        }
        return result;
    };

    // Update paths re-parse the same graph JSON every frame. Cache by the
    // source string so identical input is parsed once. Parsed graphs are
    // read-only for every caller (evaluate, cacheKey, and the fresnel/image
    // helpers only read them); object inputs are still parsed fresh because
    // callers may mutate the result.
    nodes.parse = function (json) {
        if (typeof json !== "string") return parseGraph(json);
        const hit = parseCache.get(json);
        if (hit) return hit;
        const parsed = parseGraph(json);
        if (parseCache.size >= MAX_PARSE_CACHE) parseCache.delete(parseCache.keys().next().value);
        parseCache.set(json, parsed);
        return parsed;
    };

    nodes.findLink = function (graph, nodeId, port) {
        for (var i = 0; i < graph.links.length; i++) {
            var link = graph.links[i];
            if (link.to === nodeId && link.toPort === port) {
                return link;
            }
        }
        return null;
    };

    nodes.fresnelSettings = function (graph, time = 0, context = {}) {
        for (var i = 0; i < graph.nodes.length; i++) {
            if (graph.nodes[i].type !== "output") continue;
            var link = nodes.findLink(graph, graph.nodes[i].id, "fresnel");
            if (!link) return null;
            for (var n = 0; n < graph.nodes.length; n++) {
                var node = graph.nodes[n];
                if (node.id === link.from && node.type === "fresnel") {
                    const setting = key => {
                        const source = nodes.findLink(graph, node.id, key);
                        if (!source) return node.params[key];
                        const value = nodes.evaluate(graph, context.size || 32, time, context, source.from);
                        return value ? reduceValue(value, key === "color") : node.params[key];
                    };
                    return {
                        color: setting("color"),
                        power: setting("power"),
                        mix: setting("mix"),
                    };
                }
            }
        }
        return null;
    };

    nodes.isAnimated = function (graph, material) {
        const cache = nodes.getImageCache(material);
        return graph.nodes.some(n => (["noise", "ridgedFractal", "turbulence", "marble", "dirt"].includes(n.type) && (n.params.speedX || n.params.speedY || graph.links.some(l => l.to === n.id && ["speedX", "speedY"].includes(l.toPort)))) || cache[n.params.asset]?.loaded?.data?.gif?.frames?.length > 1);
    };
    nodes.cacheKey = function (graph, resolution, frame, assets) {
        return JSON.stringify([nodes.parse(graph), resolution, frame, assets]);
    };
    nodes.evaluate = function (graph, size, time, context, target) {
        size = Math.max(1, Math.min(2048, Math.round(size) || 128));
        graph = nodes.parse(graph);
        var outputs = {};
        var cache = Object.create(null);
        var nodeMap = Object.create(null);
        for (var i = 0; i < graph.nodes.length; i++) {
            nodeMap[graph.nodes[i].id] = graph.nodes[i];
        }

        function inputBuffer(nodeId, port, stack) {
            var link = nodes.findLink(graph, nodeId, port);
            if (link) {
                return evaluateNode(link.from, stack);
            }
            return null;
        }

        function evaluateNode(id, stack) {
            if (cache[id] !== undefined) return cache[id];
            if (stack.indexOf(id) >= 0) return null;
            var node = nodeMap[id];
            if (!node) return null;
            var definition = TYPES[node.type];
            if (!definition) return null;
            stack.push(id);
            var inputs = {};
            for (var i = 0; i < definition.inputs.length; i++) {
                var input = definition.inputs[i];
                inputs[input.key] = inputBuffer(id, input.key, stack);
            }
            const params = { ...node.params, _pixel: 0, _fields: {} };
            for (const p of definition.params) if (inputs[p.key]) {
                const value = inputs[p.key];
                if (value.scalar === undefined && pixelParameter(node.type, p.key)) {
                    params._fields[p.key] = true;
                    const rgb = [0, 0, 0];
                    Object.defineProperty(params, p.key, { get() {
                        if (p.type !== "color") return value[params._pixel] === value[params._pixel + 1] && value[params._pixel + 1] === value[params._pixel + 2] ? value[params._pixel] / 255 : luminanceAt(value, params._pixel);
                        for (let c = 0; c < 3; c++) rgb[c] = value[params._pixel + c] / 255;
                        return rgb;
                    } });
                } else params[p.key] = reduceValue(value, p.type === "color");
            }
            let result;
            if (node.type === "float") result = inputs.value || { scalar: params.value };
            else if (node.type === "color" && inputs.color) result = asTexture(inputs.color, size);
            else if (node.type === "math") result = numericMath(size, inputs, params);
            else {
                for (const key of Object.keys(inputs)) if (!definition.params.some(p => p.key === key)) inputs[key] = asTexture(inputs[key], size);
                result = definition.evaluate ? definition.evaluate(size, inputs, params, time, context) : null;
            }
            stack.pop();
            cache[id] = result;
            return result;
        }

        if (target !== undefined) return evaluateNode(target, []);
        for (var n = 0; n < graph.nodes.length; n++) {
            var node = graph.nodes[n];
            if (node.type !== "output") continue;
            var definition = TYPES.output;
            for (var j = 0; j < definition.inputs.length; j++) {
                var key = definition.inputs[j].key;
                var buffer = inputBuffer(node.id, key, []);
                if (buffer) {
                    outputs[key] = bufferToCanvas(size, asTexture(buffer, size));
                }
            }
        }
        const fresnel = nodes.fresnelSettings(graph, time, { ...context, size });
        if (fresnel) outputs.__fresnel = fresnel;
        return outputs;
    };

    return nodes;
}

module.exports = createGraphRuntime;
