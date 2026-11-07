"use strict";
const { KINDS, MAX_TIME_SAMPLES, kindOf } = require("./kinds.js");
const templates = [
  { id: "passthrough", label: "Passthrough", properties: [], source: "precision highp float;\nuniform sampler2D tDiffuse;\nvarying vec2 vUvScaled;\nvoid main() {\n  gl_FragColor = texture2D(tDiffuse, vUvScaled);\n}" },
  { id: "color", label: "Color adjust", properties: [{ name: "Amount", kind: "slider" }], source: "precision highp float;\nuniform sampler2D tDiffuse;\nuniform float Amount;\nvarying vec2 vUvScaled;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  gl_FragColor = vec4(color.rgb * (0.5 + Amount), color.a);\n}" },
  { id: "gradient", label: "Gradient map", properties: [{ name: "Ramp", kind: "gradient" }], source: "precision highp float;\n// #include <zoidium/gradient>\nuniform sampler2D tDiffuse;\nuniform sampler2D Ramp;\nvarying vec2 vUvScaled;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));\n  gl_FragColor = vec4(zGradient(Ramp, luma).rgb, color.a);\n}" },
  { id: "curve", label: "Curve remap", properties: [{ name: "Remap", kind: "curve" }], source: "precision highp float;\n// #include <zoidium/curve>\nuniform sampler2D tDiffuse;\nuniform sampler2D Remap;\nvarying vec2 vUvScaled;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  gl_FragColor = vec4(zCurves(Remap, color.rgb), color.a);\n}" },
  { id: "noise", label: "Animated noise", provider: "expressions-plus", properties: [], source: "precision highp float;\n// #include <zoidium/noise>\nuniform float zTime;\nvarying vec2 vUv;\nvoid main() {\n  float n = zNoise(vec3(vUv * 6.0, zTime));\n  gl_FragColor = vec4(vec3(n), 1.0);\n}" },
  { id: "text", label: "Text overlay", properties: [{ name: "Title", kind: "text" }], source: "precision highp float;\n// #include <zoidium/text>\nuniform sampler2D tDiffuse;\nuniform sampler2D Title;\nvarying vec2 vUvScaled;\nvarying vec2 vUv;\nvoid main() {\n  vec4 color = texture2D(tDiffuse, vUvScaled);\n  float coverage = zText(Title, vUv);\n  gl_FragColor = vec4(mix(color.rgb, vec3(1.0), coverage), max(color.a, coverage));\n}" },
  { id: "velocity", label: "Velocity from a property", provider: "expressions-plus", properties: [{ name: "Velocity", kind: "point" }], source: "precision highp float;\nuniform sampler2D tDiffuse;\nuniform vec2 Velocity;\nvarying vec2 vUvScaled;\n// Link the Velocity Point control to an expression such as\n// thisComp.layer(\"Ball\").property(\"Position\").velocity\n// for per-second motion of another layer, or use .speed on a Slider\n// for the magnitude. Sample the past with\n// valueAtTime(time - thisComp.frameDuration).\nvoid main() {\n  gl_FragColor = texture2D(tDiffuse, vUvScaled + Velocity * 0.01);\n}" },
  {"id": "time-motion", "label": "Motion from two time samples", "properties": [{"name": "Before", "kind": "timeSample", "value": -1}, {"name": "After", "kind": "timeSample", "value": 1}], "source": "precision highp float;\n// #include <zoidium/temporal>\nuniform sampler2D Before;\nuniform sampler2D After;\nuniform vec2 resolution;\nuniform vec2 uvScale;\nvarying vec2 vUvScaled;\n// Brightness-based estimate between two images, in texture UV units.\n// This is not geometry velocity. Flat areas and large motion are ambiguous.\nvoid main() {\n  vec2 motion = zTimeMotion(Before, After, vUvScaled, uvScale / resolution);\n  gl_FragColor = vec4(vec2(0.5) + motion * 20.0, 0.5, 1.0);\n}"},
  {"id": "time-jitter", "label": "Time jitter", "provider": "expressions-plus", "properties": [{"name": "Jitter", "kind": "timeSample", "value": -1, "expression": "Math.floor(Math.sin(time * 12) * 3)"}], "source": "precision highp float;\nuniform sampler2D Jitter;\nvarying vec2 vUvScaled;\n// Jitter's offset expression is evaluated at this frame, in frames.\n// Change the expression to control the rate and reach of the time jumps.\nvoid main() {\n  gl_FragColor = texture2D(Jitter, vUvScaled);\n}"},
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
    if (pending.filter(p => p.kind === "timeSample").length + object.customProperties.filter(p => kindOf(p) === "timeSample").length > MAX_TIME_SAMPLES) {
      error("Shader+ supports at most four Time sample properties per effect"); return;
    }
    // Build all records before opening history. Native createObject records
    // inverse deletion commands, so multiple properties are one native edit.
    const records = pending.map(spec => {
      const definition = KINDS[spec.kind].create(presetFont());
      const p = PZ.property.create(definition); p.load(); p.properties.name.set(spec.name);
      if (spec.value !== undefined) p.set(spec.value);
      if (spec.expression) p.expression = new PZ.expression(spec.expression);
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
