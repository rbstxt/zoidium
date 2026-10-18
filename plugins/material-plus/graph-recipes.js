"use strict";

// Only historical Output ports are used so recipes survive older surfaces.
module.exports = function (nodes) {
    function recipe(label, specs, wires) {
        const graph = { nodes: specs.map(([type, id, params], i) => ({ ...nodes.createNode(type, id), x: 30 + i * 240, y: 50, params: { ...nodes.createNode(type, id).params, ...params } })), links: wires.map(([from, fromPort, to, toPort]) => ({ from, fromPort, to, toPort })) };
        graph.nodes.push({ ...nodes.createNode("output", "output"), x: 30 + specs.length * 240, y: 50 });
        return { label, graph: nodes.parse(graph) };
    }
    return [
        recipe("Brushed metal", [["noise", "noise", { scale: 3, ratio: 32, octaves: 3 }], ["color", "tint", { color: [.55, .58, .62] }], ["float", "metal", { value: 1 }], ["float", "rough", { value: .28 }]], [["noise", "out", "output", "bump"], ["tint", "out", "output", "color"], ["metal", "out", "output", "metalness"], ["rough", "out", "output", "roughness"]]),
        recipe("Rough plastic", [["noise", "noise", { scale: 28, octaves: 2 }], ["color", "tint", { color: [.16, .32, .55] }], ["float", "rough", { value: .65 }]], [["noise", "out", "output", "bump"], ["tint", "out", "output", "color"], ["rough", "out", "output", "roughness"]]),
        recipe("Bumpy stone", [["noise", "noise", { scale: 6, octaves: 5 }], ["colorRamp", "ramp", { stops: [[0, .08, .07, .06, 1], [1, .58, .53, .44, 1]] }], ["float", "rough", { value: .85 }]], [["noise", "out", "ramp", "factor"], ["ramp", "out", "output", "color"], ["noise", "out", "output", "bump"], ["rough", "out", "output", "roughness"]]),
        recipe("Noise minus Voronoi cells", [["noise", "noise", { scale: 8 }], ["voronoi", "cells", { scale: 8 }], ["math", "subtract", { op: 1, a: 0, b: 0 }]], [["noise", "out", "subtract", "a"], ["cells", "out", "subtract", "b"], ["subtract", "out", "output", "color"], ["subtract", "out", "output", "bump"]]),
    ];
};
