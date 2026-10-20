"use strict";

// Instance IDs belong to the effect and never depend on position or tool type.
// All animated values stay in native property channels, outside this schema.
const MAX_INSTANCES = 64;
const SPATIAL = new Set([
  "lens-distortion", "haze-flare", "pop", "diffusion", "star-filter",
  "anamorphic-flare", "shutter-streak", "edge-softness", "chromatic-aberration",
  "vignette", "telecine-net",
]);
const clone = value => JSON.parse(JSON.stringify(value));
const key = (id, property) => "ml_" + id + "_" + property;

function validate(value, tools) {
  if (!value || value.version !== 1 || !Array.isArray(value.order) || value.order.length > MAX_INSTANCES) {
    throw new Error("Unsupported Magic Looks instance chain.");
  }
  const seen = new Set();
  const order = value.order.map(instance => {
    if (!instance || !/^i[1-9][0-9]{0,8}$/.test(instance.id) ||
        seen.has(instance.id) || !tools.byId(instance.tool)) {
      throw new Error("Invalid Magic Looks tool instance.");
    }
    seen.add(instance.id);
    return { id: instance.id, tool: instance.tool };
  });
  const floor = Math.max(0, ...order.map(item => Number(item.id.slice(1)))) + 1;
  return { version: 1, nextId: Math.max(floor, Number.isSafeInteger(value.nextId) ? value.nextId : floor), order };
}

function empty() { return { version: 1, nextId: 1, order: [] }; }
function append(model, tool, tools, after) {
  const next = validate(model, tools);
  if (next.order.length >= MAX_INSTANCES || next.nextId > 999999999) throw new Error("The tool chain is full.");
  if (!tools.byId(tool)) throw new Error("Unknown Magic Looks tool.");
  const instance = { id: "i" + next.nextId++, tool };
  const index = after ? next.order.findIndex(item => item.id === after) + 1 : next.order.length;
  next.order.splice(index, 0, instance);
  return next;
}
function move(model, id, index, tools) {
  const next = validate(model, tools), old = next.order.findIndex(item => item.id === id);
  if (old < 0) return next;
  const [instance] = next.order.splice(old, 1);
  next.order.splice(Math.max(0, Math.min(next.order.length, index)), 0, instance);
  return next;
}
function remove(model, id, tools) {
  const next = validate(model, tools);
  next.order = next.order.filter(item => item.id !== id);
  return next;
}
function toolKeys(tool, tools) {
  const collect = value => typeof value === "string" ? [value] :
    Object.values(value || {}).flatMap(collect);
  return collect(tools.propMap()[tool]);
}
// Native panels have a narrow name column. Keep the instance identity first,
// then the parameter. Each tool's enable row names the tool, while numeric
// lanes keep the distinguishing parameter first. Storage keys never change.
const SHORT_NAMES = {
  "color-contrast": "Color", "hsl-colors": "HSL", "color-ranges": "Ranges",
  "color-reversal": "Reversal", "three-strip": "3-Strip", "lift-gamma-gain": "LGG",
  "ranged-saturation": "Sat", "warm-cool": "Warm", "four-way": "4-Way",
  "auto-shoulder": "Shoulder", "haze-flare": "Haze", "star-filter": "Star",
  "anamorphic-flare": "Flare", "lens-distortion": "Lens", "shutter-streak": "Streak",
  "edge-softness": "Edge", "chromatic-aberration": "CA", "telecine-net": "Net",
};
function parameterName(name) {
  return name.replace(/^Enable$/, "On").replace(/Exposure Compensation/, "Exposure")
    .replace(/^Strength$/, "Mix").replace(/Distortion/, "Distort").replace(/Saturation/g, "Sat")
    .replace(/Highlight/g, "High").replace(/Midtone/g, "Mid").replace(/Shadow/g, "Low")
    .replace(/Component Balance/, "Balance");
}
function selection(schema, preferred, previous = []) {
  if (schema.order.some(item => item.id === preferred)) return preferred;
  const old = previous.findIndex(item => item.id === preferred);
  return schema.order[Math.max(0, Math.min(old, schema.order.length - 1))]?.id;
}
function definitions(instance, tools, PZ) {
  const base = tools.buildPropertyDefinitions(PZ), result = {};
  for (const property of toolKeys(instance.tool, tools)) {
    const name = tools.byId(instance.tool).name;
    const label = base[property].name.slice(name.length).trim();
    let shortLabel = label === "Enable" ? (SHORT_NAMES[instance.tool] || name) +
      (["contrast", "pop"].includes(instance.tool) ? ":On" : "") : parameterName(label);
    if (instance.tool === "ranged-saturation") {
      const map = tools.propMap()[instance.tool].params;
      for (const [zone, title] of [["Highlight", "High"], ["Midtone", "Mid"], ["Shadow", "Low"]]) {
        if (property === map["sat" + zone]) shortLabel = "Sat " + title;
        if (property === map["threshold" + zone]) shortLabel = title + " limit";
      }
    }
    result[key(instance.id, property)] = { ...base[property], name: instance.id.slice(1) + " " + shortLabel };
    // Text and asset channels are storage for visual editors, never raw rows.
    if ([PZ.property.type.TEXT, PZ.property.type.ASSET].includes(base[property].type)) {
      result[key(instance.id, property)].visible = false;
    }
    // The old setup scaled fractions to percent before rounding. Native rows
    // display the stored fraction, which needs the extra decimal places.
    if (base[property].type === PZ.property.type.NUMBER) {
      result[key(instance.id, property)].decimals = Math.max(3, base[property].decimals || 0);
    }
  }
  return result;
}
// Every spatial stage has its own input image. Pointwise stages can share a
// draw even when the same tool occurs repeatedly, with independent uniforms.
function plan(order, active = () => true) {
  const passes = [];
  let colors = null;
  for (const instance of order) {
    if (!active(instance)) continue;
    if (SPATIAL.has(instance.tool)) {
      colors = null;
      passes.push({ spatial: true, instances: [instance] });
    } else {
      const samplers = instance.tool === "lut" ? 3 : ["curves", "s-curve"].includes(instance.tool) ? 1 : 0;
      if (!colors || colors.instances.length >= 8 || colors.samplers + samplers > 6) {
        colors = { spatial: false, instances: [], samplers: 0 }; passes.push(colors);
      }
      colors.instances.push(instance);
      colors.samplers += samplers;
    }
  }
  return passes;
}
// A saved effect never opts into the new renderer based on plugin versions.
function mode(data) { return data?.looksInstances ? "instances" : data ? "legacy" : "instances"; }

module.exports = { MAX_INSTANCES, SPATIAL, clone, key, empty, validate, append, move, remove,
  toolKeys, definitions, selection, plan, mode };
