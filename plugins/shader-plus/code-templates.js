"use strict";
const { KINDS } = require("./kinds.js");
const templates = [
  { id: "passthrough", label: "Passthrough", properties: [], source: "precision highp float;\nuniform sampler2D tDiffuse;\nvarying vec2 vUvScaled;\nvoid main() {\n  gl_FragColor = texture2D(tDiffuse, vUvScaled);\n}" },
  { id: "color", label: "Color adjust", properties: [{ name: "Amount", kind: "slider" }], source: "precision highp float;\nuniform sampler2D tDiffuse;\nuniform float Amount;\nvarying vec2 vUvScaled;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  gl_FragColor = vec4(color.rgb * (0.5 + Amount), color.a);\n}" },
  { id: "gradient", label: "Gradient map", properties: [{ name: "Ramp", kind: "gradient" }], source: "precision highp float;\n// #include <zoidium/gradient>\nuniform sampler2D tDiffuse;\nuniform sampler2D Ramp;\nvarying vec2 vUvScaled;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));\n  gl_FragColor = vec4(zGradient(Ramp, luma).rgb, color.a);\n}" },
  { id: "curve", label: "Curve remap", properties: [{ name: "Remap", kind: "curve" }], source: "precision highp float;\n// #include <zoidium/curve>\nuniform sampler2D tDiffuse;\nuniform sampler2D Remap;\nvarying vec2 vUvScaled;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  gl_FragColor = vec4(zCurves(Remap, color.rgb), color.a);\n}" },
  { id: "noise", label: "Animated noise", provider: "expressions-plus", properties: [], source: "precision highp float;\n// #include <zoidium/noise>\nuniform float zTime;\nvarying vec2 vUv;\nvoid main() {\n  float n = zNoise(vec3(vUv * 6.0, zTime));\n  gl_FragColor = vec4(vec3(n), 1.0);\n}" },
  { id: "text", label: "Text overlay", properties: [{ name: "Title", kind: "text" }], source: "precision highp float;\n// #include <zoidium/text>\nuniform sampler2D tDiffuse;\nuniform sampler2D Title;\nvarying vec2 vUvScaled;\nvarying vec2 vUv;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  float coverage = zText(Title, vUv);\n  gl_FragColor = vec4(mix(color.rgb, vec3(1.0), coverage), max(color.a, coverage));\n}" },
];
function instantiate(template, effect) {
  const names = new Set((effect.customProperties || []).map(p => String(p.properties.name.get()).replace(/\s/g, "_")));
  let source = template.source;
  const properties = template.properties.map(p => {
    let name = p.name, n = 2;
    while (names.has(name)) name = p.name + n++;
    names.add(name);
    source = source.replace(new RegExp("\\b" + p.name + "\\b", "g"), name);
    return { ...p, name };
  });
  return { source, properties };
}
function installTemplates({ context, object, toolbar, node, aids, input, valid, presetFont, error }) {
  const menu = node("button", "proprow propbutton", "New from template", toolbar); menu.type = "button";
  const add = node("button", "proprow propbutton", "Add properties", toolbar); add.type = "button"; add.hidden = true;
  let pending = [], disposed = false;
  menu.onclick = () => context.ui.openMenu({ owner: toolbar, anchor: menu, title: "New from template", items: templates.map(t => ({ label: t.label, hint: t.provider && !context.window.ZoidiumExpressions ? "Requires Expressions+" : "", disabled: !!t.provider && !context.window.ZoidiumExpressions, async action() {
    const before = input.value;
    const approved = await context.ui.confirm({ title: "Replace shader source", message: "Replace the current editor text with " + t.label + "?", confirmLabel: "Replace" });
    if (!approved || disposed || !valid() || input.value !== before) return;
    const result = instantiate(t, object); pending = result.properties;
    aids.write({ text: result.source, start: 0, end: 0 });
    add.hidden = !pending.length; add.title = pending.map(p => p.name + " (" + KINDS[p.kind].label + ")").join(", ");
  } })) });
  add.onclick = () => {
    const { editor, PZ } = context;
    if (!valid() || !pending.length) return;
    if (editor.history.operation !== null) { error("Finish the current edit before adding properties."); return; }
    const names = new Set([...object.customProperties].map(p => object.fixPropertyName(p.properties.name.get())));
    if (pending.some(p => names.has(p.name))) { error("A template property name is already in use. Insert the template again to choose new names."); return; }
    // Build all records before opening history. Native createObject records
    // inverse deletion commands, so multiple properties are one native edit.
    const records = pending.map(spec => {
      const definition = KINDS[spec.kind].create(presetFont());
      const p = PZ.property.create(definition); p.load(); p.properties.name.set(spec.name);
      return { definition, data: JSON.parse(JSON.stringify(p)) };
    });
    editor.history.startOperation();
    try {
      for (const record of records) PZ.ui.edit.prototype.createObject.call({ editor }, { newParentAddress: object.customProperties.getAddress(), newIdx: object.customProperties.length, baseType: PZ.property, subType: record.definition, data: record.data });
      editor.history.finishOperation(); pending = []; add.hidden = true;
      aids.refresh();
    } catch (e) { editor.history.discardOperation(); error(e.message); }
  };
  return { dispose() { disposed = true; menu.remove(); add.remove(); } };
}
module.exports = { templates, instantiate, installTemplates };
