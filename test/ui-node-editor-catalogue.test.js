"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const { nodeEditorScripts, readScript } = require("./uikit-files");
const { makeDocument } = require("./fake-dom");
function setup() {
    const context = { console, document: makeDocument(), requestAnimationFrame: () => 0, cancelAnimationFrame() {} }; context.window = context;
    vm.createContext(context); for (const file of nodeEditorScripts()) vm.runInContext(readScript(file), context);
    const nodeEditor = context.ZoidiumUIModules[0].install({}).nodeEditor;
    const types = {
        float: { title: "Value (Float)", aliases: ["Number", "Scalar"], category: "Shader", outputs: [{ id: "out" }] },
        colorRamp: { title: "Color Ramp", aliases: ["ColorRamp"], category: "Converter", inputs: [{ id: "factor" }], outputs: [{ id: "out" }, { id: "alpha" }], params: [{ id: "stops", label: "Stops", control: "ramp", default: [[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]] }] },
        output: { title: "Output", inputs: [{ id: "color" }, { id: "opacity" }] },
    };
    const graph = { nodes: [{ id: "r", type: "colorRamp", x: 0, y: 0, params: {} }, { id: "v", type: "float", params: {} }, { id: "o", type: "output", params: {} }], links: [{ id: "l", from: { node: "r", port: "out" }, to: { node: "o", port: "color" } }] };
    const changes = [], editor = nodeEditor({ nodeTypes: types, graph, recipes: [{ label: "Starter", graph }], onChange(next, info) { changes.push({ next, info }); } });
    return { editor, changes, nodeEditor, types, graph };
}
function byLabel(root, label) { return root.querySelectorAll(".zoidium-node-editor-control").find(e => e.getAttribute("aria-label") === label); }
function event(target, name, detail = {}) { target.dispatch(name, { button: 0, pointerId: 1, clientX: 0, clientY: 0, ...detail }); }
test("search finds registry aliases in the actual add menu", () => {
    const { editor } = setup();
    for (const query of ["Value", "Number", "Scalar", "Float", "ColorRamp"]) {
        editor.element.dispatch("keydown", { key: "Tab" });
        const search = editor.element.querySelector(".zoidium-node-editor-search"); search.value = query; search.dispatch("input");
        const matches = editor.element.querySelectorAll(".zoidium-node-editor-menu-item"); assert.equal(matches.length, 1, query);
        assert.equal(matches[0].textContent, query === "ColorRamp" ? "Color Ramp" : "Value (Float)");
        search.dispatch("keydown", { key: "Escape" });
    }
    editor.destroy();
});
test("unconnected marking follows every output path and clears on reconnection", () => {
    const { editor, graph } = setup();
    const dimmed = editor.element.querySelectorAll(".unconnected"); assert.equal(dimmed.length, 1); assert.equal(dimmed[0].dataset.nodeId, "v"); assert.equal(dimmed[0].title, "Not connected to Output");
    graph.links.push({ id: "l2", from: { node: "v", port: "out" }, to: { node: "r", port: "factor" } }); editor.setGraph(graph);
    assert.equal(editor.element.querySelectorAll(".unconnected").length, 0); editor.destroy();
});
test("ramp drag commits once, cancellation is silent, and undo restores stops", () => {
    const { editor, changes } = setup(), before = editor.getGraph();
    let track = editor.element.querySelector(".zoidium-node-editor-ramp-track"); track.getBoundingClientRect = () => ({ left: 0, width: 100 });
    let handle = editor.element.querySelector(".zoidium-node-editor-ramp-stop");
    event(handle, "pointerdown"); for (const clientX of [10, 20, 30]) event(handle, "pointermove", { clientX });
    assert.equal(changes.length, 0); event(handle, "pointerup"); assert.equal(changes.length, 1); assert.equal(editor.getGraph().nodes[0].params.stops[0][0], .3);
    editor.setGraph(before); assert.equal(editor.getGraph().nodes[0].params.stops, undefined);
    track = editor.element.querySelector(".zoidium-node-editor-ramp-track"); track.getBoundingClientRect = () => ({ left: 0, width: 100 });
    handle = editor.element.querySelector(".zoidium-node-editor-ramp-stop"); event(handle, "pointerdown"); event(handle, "pointermove", { clientX: 50 }); event(handle, "pointercancel"); assert.equal(changes.length, 1);
    editor.destroy();
});
test("ramp add, remove, color, alpha and keyboard position each commit one edit", () => {
    const { editor, changes } = setup();
    byLabel(editor.element, "Add color stop").click(); assert.equal(changes.length, 1); assert.equal(editor.getGraph().nodes[0].params.stops.length, 3);
    const color = byLabel(editor.element, "Stop color"); color.value = "#ff0000"; color.dispatch("change"); assert.equal(changes.length, 2);
    const alpha = byLabel(editor.element, "Stop alpha"); alpha.value = ".25"; alpha.dispatch("input"); alpha.dispatch("blur"); assert.equal(changes.length, 3);
    assert.ok(editor.getGraph().nodes[0].params.stops.some(s => s[1] === 1 && s[2] === 0 && s[4] === .25));
    const handle = editor.element.querySelector(".zoidium-node-editor-ramp-stop"); let stopped = false;
    handle.dispatch("keydown", { key: "ArrowRight", stopPropagation() { stopped = true; } }); assert.ok(stopped); assert.equal(changes.length, 4);
    byLabel(editor.element, "Remove color stop").click(); assert.equal(changes.length, 5); assert.equal(editor.getGraph().nodes.length, 3); editor.destroy();
});
test("recipe replacement commits once and can be undone with the host snapshot", () => {
    const { editor, changes } = setup(), before = editor.getGraph();
    const menu = byLabel(editor.element, "Starter recipe"); menu.value = "0"; menu.dispatch("change");
    assert.equal(changes.length, 1); assert.equal(changes[0].info.kind, "recipe");
    editor.setGraph(before); assert.equal(changes.length, 1); assert.equal(JSON.stringify(editor.getGraph()), JSON.stringify(before)); editor.destroy();
});
