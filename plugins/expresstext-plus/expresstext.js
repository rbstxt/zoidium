"use strict";

// ExpressText+ — tracked-letter text effector stack.
//
// One ExpressText+ container parents a 3D Text object and splits it into
// separately tracked letters (own namespace, so Text+ and the stock text
// pipeline are untouched). Effectors are stock Custom properties: the
// container's customs list is scoped so its + dialog offers only Shake,
// Plain, Random, Formula, Delay, Spline, Orbit, Repeater, Twist, Wrap
// and Voronoi, each a group of
// XYZ/strength/selection/field rows evaluated per letter per frame.
// Stock panel, stock undo, stock save/load — no custom DOM.
//
// Pure math (selection, strength, fields, stagger, effector envelopes) is
// DOM/THREE-free and covered by unit tests through the _test export.

const EXPRESS_TEXT_TYPE = "zoidium:expresstext-plus/expresstext";
const SCHEMA_VERSION = 1;
const EXPRESS_TEXT_NAME = "ExpressText+";
const DEGREES_TO_RADIANS = Math.PI / 180;
const MAX_ANCESTOR_DEPTH = 64;
const FIELD_LABELS = ["Infinite", "Linear", "Box", "Sphere"];
const DELAY_MODE_LABELS = ["Even", "Blend", "Spring"];
const RANDOM_MODE_LABELS = ["Random", "Gaussian", "Noise", "Turbulence", "Sorted"];
const RANDOM_SPACE_LABELS = ["Global", "UV"];
const SPLINE_MODE_LABELS = ["Step", "Falloff", "Relative"];
const SPLINE_PATH_LABELS = ["Line", "Circle", "Helix"];
const SPLINE_PLANE_LABELS = ["XY", "XZ", "YZ"];
const SPLINE_TRANSFORM_LABELS = ["Absolute", "Relative"];
const REPEATER_MODE_LABELS = ["Linear", "Random", "Echo"];
const REPEATER_MAX_COPIES = 64;
const TWIST_AXIS_LABELS = ["X", "Y", "Z"];
const WRAP_DIRECTION_LABELS = ["X", "Y", "Z"];
const DELAY_ORDER_LABELS = ["Forward", "Reverse", "Center out", "Random"];
const PIVOT_LABELS = ["Character", "Text"];
const PZ_EULER_ORDERS = new Set(["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"]);

const state = {
  PZ: null,
  THREE: null,
  editor: null,
  objectClasses: [],
  effectorClasses: {},
  customPropertyClass: null,
  unregisterObjectClasses: [],
  splitStates: new WeakMap(),
  splitTexts: new Set(),
  textPatched: false,
  originalTextUpdate: null,
  originalTextUpdateGeometry: null,
};

/* ------------------------------------------------------------------ numbers */

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function vector3(value, fallback) {
  const base = Array.isArray(fallback) ? fallback : [0, 0, 0];
  if (!Array.isArray(value)) return base.slice();
  return [0, 1, 2].map((index) => numberValue(value[index], base[index]));
}

/* ---------------------------------------------------------- letter selection */

// "1,4,5", "1+2", "1.4.5.", "2-6", "1, 3-5+8" (also full-width
// separators). "+" adds letters like "," does. Tokens like "plain-2" or
// "voronoi-1" take the letters of the 2nd Plain (1st Voronoi) section in
// stack order (one level only, so chains can never loop). 1-based,
// clamped to the letter count, de-duplicated, sorted. Blank means every
// letter (null).
function splitSelectionTokens(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  return text.split(/[,.\u3002\uFF0C\uFF0E\s;|+]+/);
}

function addTokenSelection(picked, token, total) {
  if (!token) return;
  const range = token.split(/[-~\uFF5E]+/);
  if (range.length === 2 && /^\d+$/.test(range[0]) && /^\d+$/.test(range[1])) {
    let from = Math.floor(Number(range[0]));
    let to = Math.floor(Number(range[1]));
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    for (let n = from; n <= to; n += 1) {
      if (n >= 1 && n <= total) picked.add(n - 1);
    }
    return;
  }
  if (/^\d+$/.test(token)) {
    const n = Math.floor(Number(token));
    if (n >= 1 && n <= total) picked.add(n - 1);
  }
}

function resolveSelection(value, count, plainLists) {
  const total = Math.max(0, Math.floor(numberValue(count, 0)));
  if (total <= 0) return new Set();
  const tokens = splitSelectionTokens(value);
  if (tokens === null) return null;
  const sections = plainLists && plainLists.sections;
  const picked = new Set();
  for (const token of tokens) {
    const ref = /^([a-z]+)-(\d+)$/i.exec(token);
    if (ref) {
      const kind = ref[1].toLowerCase();
      const n = Math.floor(Number(ref[2])) - 1;
      let src;
      if (sections && Array.isArray(sections[kind])) {
        src = sections[kind][n];
      } else if (kind === "plain") {
        const sources = Array.isArray(plainLists) ? plainLists : [];
        src = sources[n];
      }
      if (typeof src !== "string") continue; // missing section selects nothing
      const sub = resolveSelection(src, total, []);
      if (sub === null) {
        for (let i = 0; i < total; i += 1) picked.add(i);
      } else {
        for (const index of sub) picked.add(index);
      }
      continue;
    }
    addTokenSelection(picked, token, total);
  }
  return picked;
}

function parseLetterSelection(value, count) {
  return resolveSelection(value, count, []);
}

function isLetterSelected(selection, index) {
  return selection === null || selection.has(index);
}

function selectedList(selection, count) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    if (isLetterSelected(selection, index)) out.push(index);
  }
  return out;
}

// Strength counts 0 to 100 and scales the whole effector.
function strengthWeight(value) {
  return Math.min(100, Math.max(0, numberValue(value, 0))) / 100;
}

/* ------------------------------------------------------------------ fields */

// Smooth falloff edge shared by the finite fields (box/sphere), like a
// field volume in C4D: full strength through most of the volume, then a
// smooth ramp to zero at the boundary so sweeping letters glide in
// instead of popping. d is 0 at the center, 1 at the boundary.
function fieldEdge(d) {
  if (d <= 0.75) return 1;
  if (d >= 1) return 0;
  const u = (d - 0.75) / 0.25;
  return 1 - u * u * (3 - 2 * u);
}

// Field falloff sampled at a letter base position, mirroring the
// deform-framework semantics: 0 infinite (everywhere), 1 linear ramp across
// the field X extent, 2 box (inside only, feathered edge), 3 sphere
// (inside the X radius, feathered edge).
function fieldWeight(kind, point, position, scale) {
  const type = Math.round(numberValue(kind, 0));
  if (type <= 0) return 1;
  const p = vector3(point, [0, 0, 0]);
  const c = vector3(position, [0, 0, 0]);
  const s = vector3(scale, [100, 100, 100]).map((v) =>
    Math.max(0.01, Math.abs(v))
  );
  if (type === 2) {
    return fieldEdge(
      Math.max(
        Math.abs(p[0] - c[0]) / (s[0] / 2),
        Math.abs(p[1] - c[1]) / (s[1] / 2),
        Math.abs(p[2] - c[2]) / (s[2] / 2)
      )
    );
  }
  if (type === 3) {
    const dx = (p[0] - c[0]) / (s[0] / 2);
    const dy = (p[1] - c[1]) / (s[1] / 2);
    const dz = (p[2] - c[2]) / (s[2] / 2);
    return fieldEdge(Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const lo = c[0] - s[0] / 2;
  const t = (p[0] - lo) / s[0];
  return Math.min(1, Math.max(0, t));
}

/* ------------------------------------------------- formula expressions */

// Formula micro-language (C4D Formula effector): one scalar per letter
// from a typed expression. Variables: px,py,pz (letter base position),
// rx,ry,rz (incoming rotation, degrees), sx,sy,sz (incoming scale),
// u,v,w (letter UV across the line: first 0, last 1), id (0-based
// letter index), count, falloff (field weight), t (project time in
// seconds times the Time row), f (Frequency row, free constant).
// Functions: sin,cos,tan (degrees, C4D convention), asin,acos,atan,atan2
// (return degrees), abs,sqrt,cbrt,exp,ln,log,min,max,floor,ceil,round,
// trunc,sign,pow,mod; constants pi,e. Operators: + - * / % ^ (power,
// right-associative), comparisons, && || !, ternary, parentheses.
// Recursive-descent over validated tokens only: anything else (property
// access, assignments, strings, keywords) fails closed to a scalar 0,
// so a typo can never run code or poison a frame.
const FORMULA_DEG = Math.PI / 180;

const FORMULA_FUNCTIONS = {
  sin: (d) => Math.sin(d * FORMULA_DEG),
  cos: (d) => Math.cos(d * FORMULA_DEG),
  tan: (d) => Math.tan(d * FORMULA_DEG),
  asin: (x) => (Math.asin(Math.min(1, Math.max(-1, x))) / FORMULA_DEG),
  acos: (x) => (Math.acos(Math.min(1, Math.max(-1, x))) / FORMULA_DEG),
  atan: (x) => (Math.atan(x) / FORMULA_DEG),
  atan2: (y, x) => (Math.atan2(y, x) / FORMULA_DEG),
  abs: (x) => Math.abs(x),
  sqrt: (x) => Math.sqrt(Math.max(0, x)),
  cbrt: (x) => Math.cbrt(x),
  exp: (x) => Math.exp(x),
  ln: (x) => Math.log(x <= 0 ? NaN : x),
  log: (x) => Math.log10(x <= 0 ? NaN : x),
  pow: (x, y) => Math.pow(x, y),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  round: (x) => Math.round(x),
  trunc: (x) => Math.trunc(x),
  sign: (x) => Math.sign(x),
  mod: (a, b) => ((a % b) + b) % b,
};

const FORMULA_ARITY = {
  sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, atan2: 2,
  abs: 1, sqrt: 1, cbrt: 1, exp: 1, ln: 1, log: 1, pow: 2,
  floor: 1, ceil: 1, round: 1, trunc: 1, sign: 1, mod: 2,
};

const FORMULA_CONSTANTS = { pi: Math.PI, e: Math.E };

const FORMULA_VARIABLES = [
  "px", "py", "pz", "rx", "ry", "rz", "sx", "sy", "sz",
  "u", "v", "w", "id", "count", "falloff", "t", "f",
];

function tokenizeFormula(src) {
  const text = String(src == null ? "" : src);
  const tokens = [];
  const re = /(?:([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[+\-*/%^(),?:<>!]))/g;
  let pos = 0;
  while (pos < text.length) {
    if (/\s/.test(text[pos])) {
      pos += 1;
      continue;
    }
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m || m.index !== pos || (!m[1] && !m[2] && !m[3])) {
      throw new Error(`bad character at ${pos}`);
    }
    tokens.push(m[1] !== undefined ? { num: parseFloat(m[1]) } : m[2] !== undefined ? { id: m[2] } : { op: m[3] });
    pos = re.lastIndex;
  }
  if (!tokens.length) throw new Error("empty formula");
  return tokens;
}

function parseFormula(src) {
  const tokens = tokenizeFormula(src);
  let at = 0;
  const peek = () => tokens[at];
  const eat = (op) => {
    const t = tokens[at];
    if (t && t.op === op) {
      at += 1;
      return true;
    }
    return false;
  };
  function parseTernary() {
    const cond = parseOr();
    if (eat("?")) {
      const a = parseTernary();
      if (!eat(":")) throw new Error("expected :");
      return { tern: [cond, a, parseTernary()] };
    }
    return cond;
  }
  function parseOr() {
    let node = parseAnd();
    while (eat("||")) node = { bin: ["||", node, parseAnd()] };
    return node;
  }
  function parseAnd() {
    let node = parseCmp();
    while (eat("&&")) node = { bin: ["&&", node, parseCmp()] };
    return node;
  }
  function parseCmp() {
    let node = parseAdd();
    for (;;) {
      const t = peek();
      if (t && t.op && ["<", ">", "<=", ">=", "==", "!="].includes(t.op)) {
        at += 1;
        node = { bin: [t.op, node, parseAdd()] };
      } else return node;
    }
  }
  function parseAdd() {
    let node = parseMul();
    for (;;) {
      if (eat("+")) node = { bin: ["+", node, parseMul()] };
      else if (eat("-")) node = { bin: ["-", node, parseMul()] };
      else return node;
    }
  }
  function parseMul() {
    let node = parseUnary();
    for (;;) {
      if (eat("*")) node = { bin: ["*", node, parseUnary()] };
      else if (eat("/")) node = { bin: ["/", node, parseUnary()] };
      else if (eat("%")) node = { bin: ["%", node, parseUnary()] };
      else return node;
    }
  }
  function parsePower() {
    const base = parsePrimary();
    if (eat("^")) return { bin: ["^", base, parseUnary()] };
    return base;
  }
  function parseUnary() {
    if (eat("-")) return { un: ["-", parsePower()] };
    if (eat("+")) return parsePower();
    if (eat("!")) return { un: ["!", parsePower()] };
    return parsePower();
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("unexpected end");
    if (t.num !== undefined) {
      at += 1;
      return { num: t.num };
    }
    if (t.id !== undefined) {
      const name = t.id;
      at += 1;
      if (eat("(")) {
        const args = [];
        if (!eat(")")) {
          do {
            args.push(parseTernary());
          } while (eat(","));
          if (!eat(")")) throw new Error("expected )");
        }
        return { call: [name, args] };
      }
      return { name };
    }
    if (eat("(")) {
      const node = parseTernary();
      if (!eat(")")) throw new Error("expected )");
      return node;
    }
    throw new Error("unexpected token");
  }
  const root = parseTernary();
  if (at !== tokens.length) throw new Error("trailing tokens");
  return root;
}

function validateFormulaAst(node) {
  if (node.num !== undefined) {
    if (!isFinite(node.num)) throw new Error("bad number");
    return;
  }
  if (node.name !== undefined) {
    if (FORMULA_VARIABLES.includes(node.name)) return;
    if (Object.hasOwn(FORMULA_CONSTANTS, node.name)) return;
    throw new Error(`unknown name ${node.name}`);
  }
  if (node.call !== undefined) {
    const [name, args] = node.call;
    if (!Object.hasOwn(FORMULA_FUNCTIONS, name)) throw new Error(`unknown function ${name}`);
    const arity = FORMULA_ARITY[name];
    if (arity === undefined) {
      if (name !== "min" && name !== "max") throw new Error(`bad arity ${name}`);
      if (!args.length) throw new Error(`bad arity ${name}`);
    } else if (args.length !== arity) throw new Error(`bad arity ${name}`);
    args.forEach(validateFormulaAst);
    return;
  }
  if (node.un !== undefined) {
    validateFormulaAst(node.un[1]);
    return;
  }
  if (node.bin !== undefined) {
    validateFormulaAst(node.bin[1]);
    validateFormulaAst(node.bin[2]);
    return;
  }
  if (node.tern !== undefined) {
    node.tern.forEach(validateFormulaAst);
    return;
  }
  throw new Error("bad node");
}

function evalFormulaNode(node, scope) {
  if (node.num !== undefined) return node.num;
  if (node.name !== undefined) {
    if (Object.hasOwn(FORMULA_CONSTANTS, node.name)) return FORMULA_CONSTANTS[node.name];
    return numberValue(scope[node.name], 0);
  }
  if (node.call !== undefined) {
    const fn = FORMULA_FUNCTIONS[node.call[0]];
    return fn(...node.call[1].map((arg) => evalFormulaNode(arg, scope)));
  }
  if (node.un !== undefined) {
    const value = evalFormulaNode(node.un[1], scope);
    return node.un[0] === "-" ? -value : !value ? 1 : 0;
  }
  if (node.bin !== undefined) {
    const [op, left, right] = node.bin;
    const a = evalFormulaNode(left, scope);
    const b = evalFormulaNode(right, scope);
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return a / b;
      case "%": return a % b;
      case "^": return Math.pow(a, b);
      case "<": return a < b ? 1 : 0;
      case ">": return a > b ? 1 : 0;
      case "<=": return a <= b ? 1 : 0;
      case ">=": return a >= b ? 1 : 0;
      case "==": return a === b ? 1 : 0;
      case "!=": return a !== b ? 1 : 0;
      case "&&": return (a ? 1 : 0) && (b ? 1 : 0) ? 1 : 0;
      case "||": return (a ? 1 : 0) || (b ? 1 : 0) ? 1 : 0;
      default: return NaN;
    }
  }
  if (node.tern !== undefined) {
    return evalFormulaNode(node.tern[0], scope) ? evalFormulaNode(node.tern[1], scope) : evalFormulaNode(node.tern[2], scope);
  }
  return NaN;
}

const formulaCache = new Map();

function compileFormula(src) {
  const key = String(src == null ? "" : src);
  const hit = formulaCache.get(key);
  if (hit) return hit;
  let out;
  try {
    const ast = parseFormula(key);
    validateFormulaAst(ast);
    out = { fn: (scope) => evalFormulaNode(ast, scope) };
  } catch (error) {
    out = { error: String((error && error.message) || error) };
    try {
      console.warn(`[ExpressText+] bad formula ignored: ${key.slice(0, 80)} (${out.error})`);
    } catch (_warn) {}
  }
  if (formulaCache.size > 128) formulaCache.clear();
  formulaCache.set(key, out);
  return out;
}

/* ------------------------------------------------- stagger, random, curves */

function hashSeed(seed, salt) {
  let h = (Math.floor(numberValue(seed, 1)) * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function seededRandom(seed, index, channel) {
  return hashSeed(numberValue(seed, 1) * 1000 + index * 131 + channel * 17, 7);
}

// Integer-lattice hash in [0,1): the dice behind Random/Gaussian and the
// lattice behind Noise/Turbulence. 32-bit wrapped, so any integer seed
// (including free-entered decimals scaled up) stays deterministic.
function hashLattice(ix, iy, iz, seedInt) {
  let h =
    (seedInt | 0) ^
    Math.imul(ix | 0, 374761393) ^
    Math.imul(iy | 0, 668265263) ^
    Math.imul(iz | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothNoiseUnit(t) {
  return t * t * (3 - 2 * t);
}

// Trilinear value noise in [0,1].
function valueNoise3(x, y, z, seedInt) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smoothNoiseUnit(x - ix);
  const fy = smoothNoiseUnit(y - iy);
  const fz = smoothNoiseUnit(z - iz);
  const c000 = hashLattice(ix, iy, iz, seedInt);
  const c100 = hashLattice(ix + 1, iy, iz, seedInt);
  const c010 = hashLattice(ix, iy + 1, iz, seedInt);
  const c110 = hashLattice(ix + 1, iy + 1, iz, seedInt);
  const c001 = hashLattice(ix, iy, iz + 1, seedInt);
  const c101 = hashLattice(ix + 1, iy, iz + 1, seedInt);
  const c011 = hashLattice(ix, iy + 1, iz + 1, seedInt);
  const c111 = hashLattice(ix + 1, iy + 1, iz + 1, seedInt);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

// Fractal noise in [0,1]: plain octaves for Noise, absolute octaves
// (ridged, less uniform) for Turbulence.
function fractalNoise3(x, y, z, seedInt, octaves, turbulence) {
  let sum = 0;
  let norm = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let o = 0; o < octaves; o += 1) {
    const n = valueNoise3(fx, fy, fz, seedInt + o * 101);
    sum += (turbulence ? Math.abs(n * 2 - 1) : n) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
    fz *= 2.03;
  }
  return norm > 0 ? sum / norm : 0.5;
}

// Fisher-Yates shuffle of [0..count), deterministic per salt. Sorted mode
// hands each letter a distinct stratum so values spread evenly.
function shuffledStrata(count, salt) {
  const order = [];
  for (let i = 0; i < count; i += 1) order.push(i);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(hashSeed(salt, i) * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order;
}

// Rank of a letter inside an ordered list for stagger math.
function delayRank(order, position, count, seed) {
  const kind = Math.round(numberValue(order, 0));
  if (count <= 1) return 0;
  if (kind === 1) return count - 1 - position;
  if (kind === 2) {
    const middle = (count - 1) / 2;
    return Math.abs(position - middle);
  }
  if (kind === 3) {
    // Deterministic shuffle:_latest_ rank of this position.
    const slots = [];
    for (let i = 0; i < count; i += 1) slots.push(i);
    for (let i = count - 1; i > 0; i -= 1) {
      const j = Math.floor(seededRandom(seed, i, 101) * (i + 1));
      const swap = slots[i];
      slots[i] = slots[j];
      slots[j] = swap;
    }
    return slots.indexOf(position);
  }
  return position;
}

// Shake oscillator: frequency in cycles per second at a 30fps base, offset
// and per-letter delay in cycles. Returns [-1, 1].
function shakeValue(frame, frequency, offset, stagger) {
  const t =
    numberValue(frame, 0) * (numberValue(frequency, 1) / 30) +
    numberValue(offset, 0) +
    numberValue(stagger, 0);
  return Math.sin(t * Math.PI * 2);
}

/* ------------------------------------------------------- per-letter evaluation */

function readProp(props, key, frame, fallback) {
  if (!props) return fallback;
  const property = typeof props.get === "function" ? props.get(key) : props[key];
  if (property && typeof property.get === "function") {
    // Fresh rows can carry empty keyframe tracks until the host edit flow
    // initializes them; fall back to the definition value, then the
    // default. Live rows report value: null while unseeded, which must
    // fall through too — returning null would zero every default.
    try {
      const value = property.get(frame);
      if (value !== undefined && value !== null) return value;
    } catch (_get) {}
    try {
      if (property.value !== undefined && property.value !== null) {
        return property.value;
      }
    } catch (_value) {}
    try {
      if (property.definition && property.definition.value !== undefined) {
        return property.definition.value;
      }
    } catch (_def) {}
    return fallback;
  }
  const value = property;
  return value === undefined || value === null ? fallback : value;
}

function readVector(props, key, frame, fallback) {
  return vector3(readProp(props, key, frame, fallback), fallback);
}

function staticProps(values) {
  const store = {};
  for (const key of Object.keys(values || {})) {
    store[key] = { get: () => values[key] };
  }
  return {
    get(key) {
      return store[key];
    },
  };
}

// Effector envelope shared inputs for one letter. plainLists carries the
// literal Letters strings of the stack's Plain layers (in order) so
// "plain-N" tokens resolve; slots counts the selected letters for
// normalized (0..1) stagger shapes.
function letterContext(props, prefix, frame, index, list, plainLists) {
  const selected = resolveSelection(
    readProp(props, `${prefix}Letters`, frame, ""),
    list.total,
    plainLists || []
  );
  const order = selected === null ? list.order : selectedListOrder(selected, list);
  const slots = Math.max(1, order.length);
  const rank = delayRank(
    readProp(props, `${prefix}DelayOrder`, frame, 0),
    order.indexOf(index),
    slots,
    readProp(props, `${prefix}Seed`, frame, 1)
  );
  const delay = rank * numberValue(readProp(props, `${prefix}Delay`, frame, 0), 0);
  const strength = strengthWeight(readProp(props, `${prefix}Strength`, frame, 100));
  return { selected, rank, slots, delay, strength };
}

function selectedListOrder(selected, list) {
  if (selected === null) return list.order;
  return list.order.filter((index) => selected.has(index));
}

function applyFieldWeight(weight, props, prefix, frame, base) {
  if (weight <= 0) return 0;
  const kind = Math.round(numberValue(readProp(props, `${prefix}Field`, frame, 0), 0));
  if (kind === 0) return weight;
  return (
    weight *
    fieldWeight(
      kind,
      base,
      readVector(props, `${prefix}FieldPosition`, frame, [0, 0, 0]),
      readVector(props, `${prefix}FieldScale`, frame, [100, 100, 100])
    )
  );
}

function blankControls() {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

function addScaled(target, vector, amount) {
  target[0] += vector[0] * amount;
  target[1] += vector[1] * amount;
  target[2] += vector[2] * amount;
}

function mulScale(target, vector, amount) {
  target[0] *= 1 + (vector[0] - 1) * amount;
  target[1] *= 1 + (vector[1] - 1) * amount;
  target[2] *= 1 + (vector[2] - 1) * amount;
}

function evaluateShake(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "shakeEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "shake", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  let weight = applyFieldWeight(ctx.strength, props, "shake", frame, base);
  if (weight <= 0) return;
  // True time placement: negative local frames are meaningful (sinusoids
  // read naturally; keyframed rows clamp inside the host reader), so no
  // Math.max(0, ...) here — that would freeze every shifted state at 0.
  const localFrame = frame - ctx.delay;
  const value = shakeValue(
    localFrame,
    readProp(props, "shakeFrequency", frame, 1),
    readProp(props, "shakeOffset", frame, 0),
    0
  );
  const amount = value * weight;
  addScaled(out.position, readVector(props, "shakePosition", frame, [0, 0, 0]), amount);
  addScaled(out.rotation, readVector(props, "shakeRotation", frame, [0, 0, 0]), amount);
  mulScale(out.scale, readVector(props, "shakeScale", frame, [1, 1, 1]), amount);
}

function evaluatePlain(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "plainEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "plain", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "plain", frame, base);
  if (weight <= 0) return;
  const localFrame = frame - ctx.delay;
  // Invert odd: odd-numbered letters (1st, 3rd, 5th…) mirror the position
  // and rotation.
  let position = readVector(props, "plainPosition", localFrame, [0, 0, 0]);
  let rotation = readVector(props, "plainRotation", localFrame, [0, 0, 0]);
  const invertOdd =
    Math.round(numberValue(readProp(props, "plainInvertOdd", frame, 0), 0)) === 1;
  if (invertOdd && (index + 1) % 2 === 1) {
    position = [-position[0], -position[1], -position[2]];
    rotation = [-rotation[0], -rotation[1], -rotation[2]];
  }
  addScaled(out.position, position, weight);
  addScaled(out.rotation, rotation, weight);
  mulScale(out.scale, readVector(props, "plainScale", localFrame, [1, 1, 1]), weight);
}

// Normalized random value [0,1] for one letter/channel/axis under the C4D
// Random modes. opts carries { seedInt, sync, indexed, space, anim,
// noise, rank, count }. Random is uniform per axis; Gaussian averages
// three (bell around the middle); Noise/Turbulence sample a value-noise
// field that Global pins to the letter's base position and UV to its
// index, evolving with Animation Speed (Indexed samples each axis
// separately, otherwise all axes share one sample and drift diagonally);
// Sorted deals each selected letter a distinct shuffled stratum so values
// spread evenly. Pure function of its inputs: scrub-safe.
function randomUnit(mode, index, group, axis, base, frame, opts) {
  const m = mode === 1 ? 1 : mode === 2 ? 2 : mode === 3 ? 3 : mode === 4 ? 4 : 0;
  const seedInt = opts.seedInt | 0;
  const groupSalt = opts.sync ? 0 : (group + 1) * 100003;
  if (m === 4) {
    const salt = seedInt + groupSalt + axis * 104729;
    const strata = shuffledStrata(Math.max(1, opts.count), salt);
    const rank = Math.min(opts.count - 1, Math.max(0, opts.rank));
    return (strata[rank] + 0.5) / Math.max(1, opts.count);
  }
  if (m === 2 || m === 3) {
    const scale = Math.max(0, numberValue(opts.noise, 100)) / 100;
    const p = vector3(base, [0, 0, 0]);
    const at =
      opts.space === 1
        ? [index * 3.71, index * 9.13 + 4.7, index * 5.37 + 9.1]
        : [p[0], p[1], p[2]];
    const t = (numberValue(frame, 0) * Math.max(0, numberValue(opts.anim, 0))) / 100 / 30;
    const freq = scale / 15;
    const gx = opts.sync ? 0 : group * 13.13;
    const ax = opts.indexed ? axis * 19.19 : 0;
    const x = at[0] * freq + 0.63 * t + ax;
    const y = at[1] * freq + 1.17 * t + gx;
    const z = at[2] * freq + 0.81 * t;
    return m === 3
      ? fractalNoise3(x, y, z, seedInt, 4, true)
      : fractalNoise3(x, y, z, seedInt, 2, false);
  }
  if (m === 1) {
    const u =
      hashLattice(index, groupSalt, axis * 3, seedInt) +
      hashLattice(index + 1009, groupSalt, axis * 3 + 1, seedInt) +
      hashLattice(index + 2017, groupSalt, axis * 3 + 2, seedInt);
    return u / 3;
  }
  return hashLattice(index, groupSalt, axis, seedInt);
}

function evaluateRandom(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "randomEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "random", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  // Strength is unbounded (the manual allows below 0% and above 100%):
  // negative strengths mirror the scatter.
  const rawStrength = numberValue(readProp(props, "randomStrength", frame, 100), 100) / 100;
  const field = applyFieldWeight(1, props, "random", frame, base);
  const weight = rawStrength * field;
  if (!(weight > 0 || weight < 0)) return;
  const seed = readProp(props, "randomSeed", frame, 1);
  const mode = Math.round(numberValue(readProp(props, "randomMode", frame, 0), 0));
  // Minimum/Maximum rescale the internal [0,1] range (defaults identity).
  const minimum = numberValue(readProp(props, "randomMinimum", frame, 0), 0) / 100;
  const maximum = numberValue(readProp(props, "randomMaximum", frame, 100), 100) / 100;
  const all = Array.isArray(list.order) && list.order.length
    ? list.order.slice()
    : Array.from({ length: Math.max(0, list.total || 0) }, (_, i) => i);
  const selArray = ctx.selected === null ? all : all.filter((i) => ctx.selected.has(i));
  const opts = {
    seedInt: Math.round(numberValue(seed, 1) * 1000),
    sync: !!numberValue(readProp(props, "randomSynchronized", frame, 0), 0),
    indexed: !!numberValue(readProp(props, "randomIndexed", frame, 1), 1),
    space: Math.round(numberValue(readProp(props, "randomSpace", frame, 0), 0)),
    anim: Math.max(0, numberValue(readProp(props, "randomAnimationSpeed", frame, 0), 0)),
    noise: Math.max(0, numberValue(readProp(props, "randomNoiseScale", frame, 100), 100)),
    rank: selArray.indexOf(index),
    count: selArray.length,
  };
  const localFrame = frame - ctx.delay;
  const posMin = readVector(props, "randomPositionMin", localFrame, [-10, -10, -10]);
  const posMax = readVector(props, "randomPositionMax", localFrame, [10, 10, 10]);
  const rotMin = readVector(props, "randomRotationMin", localFrame, [0, 0, 0]);
  const rotMax = readVector(props, "randomRotationMax", localFrame, [0, 0, 0]);
  const sclMin = readVector(props, "randomScaleMin", localFrame, [1, 1, 1]);
  const sclMax = readVector(props, "randomScaleMax", localFrame, [1, 1, 1]);
  const remap = (u) => minimum + u * (maximum - minimum);
  for (let axis = 0; axis < 3; axis += 1) {
    const up = remap(randomUnit(mode, index, 0, axis, base, localFrame, opts));
    const ur = remap(randomUnit(mode, index, 1, axis, base, localFrame, opts));
    const us = remap(randomUnit(mode, index, 2, axis, base, localFrame, opts));
    out.position[axis] += (posMin[axis] + (posMax[axis] - posMin[axis]) * up) * weight;
    out.rotation[axis] += (rotMin[axis] + (rotMax[axis] - rotMin[axis]) * ur) * weight;
    const target = sclMin[axis] + (sclMax[axis] - sclMin[axis]) * us;
    out.scale[axis] *= 1 + (target - 1) * weight;
  }
}

function evaluateFormula(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "formulaEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "formula", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  // Strength is unbounded (the manual allows below 0% and above 100%):
  // negative strengths mirror the result.
  const rawStrength = numberValue(readProp(props, "formulaStrength", frame, 100), 100) / 100;
  const field = applyFieldWeight(1, props, "formula", frame, base);
  const weight = rawStrength * field;
  if (!(weight > 0 || weight < 0)) return;
  const localFrame = frame - ctx.delay;
  const compiled = compileFormula(readProp(props, "formulaExpression", frame, "sin(u*360*f+t*90)"));
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const at = order.indexOf(index);
  const rank = at === -1 ? 0 : at;
  const slots = Math.max(1, order.length);
  const bp = vector3(base, [0, 0, 0]);
  const scope = {
    px: bp[0],
    py: bp[1],
    pz: bp[2],
    rx: (out.rotation[0] * 180) / Math.PI,
    ry: (out.rotation[1] * 180) / Math.PI,
    rz: (out.rotation[2] * 180) / Math.PI,
    sx: out.scale[0],
    sy: out.scale[1],
    sz: out.scale[2],
    u: slots > 1 ? rank / (slots - 1) : 0,
    v: 0,
    w: 0,
    id: index,
    count: Math.max(0, numberValue(list.total, 0)),
    falloff: field,
    t: (numberValue(localFrame, 0) / 30) * numberValue(readProp(props, "formulaTime", frame, 1), 1),
    f: numberValue(readProp(props, "formulaFrequency", frame, 1), 1),
  };
  let scalar = 0;
  if (!compiled.error) {
    try {
      scalar = numberValue(compiled.fn(scope), 0);
    } catch (_eval) {
      scalar = 0;
    }
  }
  if (!isFinite(scalar)) scalar = 0;
  // Minimum/Maximum rescale the formula output (defaults identity), so a
  // wild expression (t*px) stays tame with Maximum at 1%.
  const minimum = numberValue(readProp(props, "formulaMinimum", frame, 0), 0) / 100;
  const maximum = numberValue(readProp(props, "formulaMaximum", frame, 100), 100) / 100;
  const remapped = minimum + scalar * (maximum - minimum);
  const posAmp = readVector(props, "formulaPosition", localFrame, [0, 10, 0]);
  const rotAmp = readVector(props, "formulaRotation", localFrame, [0, 0, 0]);
  const sclAmp = readVector(props, "formulaScale", localFrame, [1, 1, 1]);
  addScaled(out.position, posAmp, remapped * weight);
  addScaled(out.rotation, rotAmp, remapped * weight);
  mulScale(
    out.scale,
    sclAmp.map((v) => 1 + (v - 1) * remapped),
    weight
  );
}

/* ------------------------------------------------- spline paths */

// XYZ-euler rotation of a vector (R = Rx·Ry·Rz, matching THREE).
function rotateEulerXYZ(v, e) {
  const cx = Math.cos(e[0]);
  const sx = Math.sin(e[0]);
  const cy = Math.cos(e[1]);
  const sy = Math.sin(e[1]);
  const cz = Math.cos(e[2]);
  const sz = Math.sin(e[2]);
  const x1 = cz * v[0] - sz * v[1];
  const y1 = sz * v[0] + cz * v[1];
  const z1 = v[2];
  const x2 = cy * x1 + sy * z1;
  const y2 = y1;
  const z2 = -sy * x1 + cy * z1;
  return [x2, cx * y2 - sx * z2, sx * y2 + cx * z2];
}

// Euler XYZ angles (three.js convention) for a right-handed basis given
// as column vectors. Reduces to the in-plane tangent angle for untilted
// paths, so existing arrangements never shift.
function eulerFromBasis(xAxis, yAxis, zAxis) {
  const clamped = Math.min(1, Math.max(-1, zAxis[0]));
  if (Math.abs(clamped) < 0.9999999) {
    return [
      Math.atan2(-zAxis[1], zAxis[2]),
      Math.asin(clamped),
      Math.atan2(-yAxis[0], xAxis[0]),
    ];
  }
  return [Math.atan2(yAxis[2], yAxis[1]), Math.asin(clamped), 0];
}

// Built-in spline paths (C4D Circle/Helix primitives, Y-up world).
// sampleSplinePath(path, P, u) with u over the full shape returns
// { position, euler }: the point on the path plus the letter orientation
// built from tangent and plane normal, so tilted paths turn letters
// correctly in 3D. P.tilt (radians XYZ) orients the whole path about its
// center. Circle starts at +X like the primitives; helix rises +Y with
// Turns full convolutions; Reverse mirrors u (point order flip).
function sampleSplinePath(path, P, u) {
  const uu = numberValue(u, 0);
  let point;
  let tangent;
  let normal;
  if (path === 2) {
    const turns = numberValue(P.turns, 1);
    const r0 = Math.max(0, numberValue(P.radius, 50));
    const r1 = Math.max(0, numberValue(P.radiusEnd, r0));
    const height = Math.max(0, numberValue(P.height, 100));
    const theta = 2 * Math.PI * turns * uu;
    const r = r0 + (r1 - r0) * uu;
    const dtheta = 2 * Math.PI * turns;
    const dr = r1 - r0;
    point = [r * Math.cos(theta), uu * height, r * Math.sin(theta)];
    tangent = [
      dr * Math.cos(theta) - r * Math.sin(theta) * dtheta,
      height,
      dr * Math.sin(theta) + r * Math.cos(theta) * dtheta,
    ];
    normal = [0, 0, 1];
  } else if (path === 1) {
    const radius = Math.max(0, numberValue(P.radius, 50));
    const theta = 2 * Math.PI * uu;
    const plane = Math.round(numberValue(P.plane, 0));
    if (plane === 1) {
      point = [radius * Math.cos(theta), 0, radius * Math.sin(theta)];
      tangent = [-Math.sin(theta), 0, Math.cos(theta)];
      normal = [0, 1, 0];
    } else if (plane === 2) {
      point = [0, radius * Math.cos(theta), radius * Math.sin(theta)];
      tangent = [0, -Math.sin(theta), Math.cos(theta)];
      normal = [1, 0, 0];
    } else {
      point = [radius * Math.cos(theta), radius * Math.sin(theta), 0];
      tangent = [-Math.sin(theta), Math.cos(theta), 0];
      normal = [0, 0, 1];
    }
  } else {
    const length = Math.max(0, numberValue(P.length, 100));
    point = [(uu - 0.5) * length, 0, 0];
    tangent = [1, 0, 0];
    normal = [0, 0, 1];
  }
  const tiltRaw = vector3(P.tilt, [0, 0, 0]);
  const tilt = [numberValue(tiltRaw[0], 0), numberValue(tiltRaw[1], 0), numberValue(tiltRaw[2], 0)];
  const height = Math.max(0, numberValue(P.height, 100));
  const pivot = path === 2 ? [0, height / 2, 0] : [0, 0, 0];
  const rel = [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]];
  const spun = rotateEulerXYZ(rel, tilt);
  const position = [pivot[0] + spun[0], pivot[1] + spun[1], pivot[2] + spun[2]];
  const t = rotateEulerXYZ(tangent, tilt);
  const n = rotateEulerXYZ(normal, tilt);
  const tl = Math.hypot(t[0], t[1], t[2]) || 1;
  const tn = [t[0] / tl, t[1] / tl, t[2] / tl];
  const yv = [
    n[1] * tn[2] - n[2] * tn[1],
    n[2] * tn[0] - n[0] * tn[2],
    n[0] * tn[1] - n[1] * tn[0],
  ];
  const yl = Math.hypot(yv[0], yv[1], yv[2]);
  const euler =
    yl > 1e-9
      ? eulerFromBasis(tn, [yv[0] / yl, yv[1] / yl, yv[2] / yl], n)
      : [0, 0, Math.atan2(tn[1], tn[0])];
  return { position, euler };
}

function evaluateSpline(props, frame, index, list, base, out, plainLists, aux) {
  if (!numberValue(readProp(props, "splineEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "spline", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  // Strength is unbounded (the manual allows below 0% and above 100%):
  // it blends the distance to the path, mirroring past it when negative.
  const rawStrength = numberValue(readProp(props, "splineStrength", frame, 100), 100) / 100;
  const field = applyFieldWeight(1, props, "spline", frame, base);
  const weight = rawStrength * field;
  if (!(weight > 0 || weight < 0)) return;
  const mode = Math.round(numberValue(readProp(props, "splineMode", frame, 0), 0));
  const transform = Math.round(numberValue(readProp(props, "splineTransform", frame, 0), 0));
  const localFrame = frame - ctx.delay;
  const P = {
    path: Math.round(numberValue(readProp(props, "splinePath", frame, 0), 0)),
    length: Math.max(0, numberValue(readProp(props, "splineLength", localFrame, 100), 100)),
    radius: Math.max(0, numberValue(readProp(props, "splineRadius", localFrame, 50), 50)),
    radiusEnd: Math.max(0, numberValue(readProp(props, "splineRadiusEnd", localFrame, 50), 50)),
    height: Math.max(0, numberValue(readProp(props, "splineHeight", localFrame, 100), 100)),
    turns: numberValue(readProp(props, "splineTurns", localFrame, 1), 1),
    plane: Math.round(numberValue(readProp(props, "splinePlane", localFrame, 0), 0)),
    reverse: !!numberValue(readProp(props, "splineReverse", localFrame, 0), 0),
    offset: numberValue(readProp(props, "splineOffset", localFrame, 0), 0) / 100,
    start: numberValue(readProp(props, "splineStart", localFrame, 0), 0) / 100,
    end: numberValue(readProp(props, "splineEnd", localFrame, 100), 100) / 100,
    clamp: !!numberValue(readProp(props, "splineClamp", localFrame, 1), 1),
    tilt: readVector(props, "splineTilt", localFrame, [0, 0, 0]),
  };
  const path = P.path === 1 ? 1 : P.path === 2 ? 2 : 0;
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const slots = Math.max(1, order.length);
  const rank = order.indexOf(index);
  // Base coordinate: Step counts evenly, Falloff flows with the field
  // (great with a Linear Field, per the manual), Relative keeps the
  // letters' proportional X spacing (single-line text, per the manual).
  let baseT;
  if (mode === 1) {
    baseT = field;
  } else if (mode === 2) {
    const extent = aux && aux.extent;
    if (extent && extent.hi > extent.lo) {
      const bx = vector3(base, [0, 0, 0])[0];
      baseT = Math.min(1, Math.max(0, (bx - extent.lo) / (extent.hi - extent.lo)));
    } else {
      baseT = slots > 1 ? (rank === -1 ? 0 : rank) / (slots - 1) : 0;
    }
  } else {
    baseT = slots > 1 ? (rank === -1 ? 0 : rank) / (slots - 1) : 0;
  }
  if (P.reverse) baseT = 1 - baseT;
  const place = (x) => {
    const t = P.start + x * (P.end - P.start) + P.offset;
    if (P.clamp) {
      const lo = Math.min(P.start, P.end);
      const hi = Math.max(P.start, P.end);
      return Math.min(hi, Math.max(lo, t));
    }
    return t - Math.floor(t);
  };
  const posToggle = !!numberValue(readProp(props, "splinePosition", frame, 1), 1);
  const rotToggle = !!numberValue(readProp(props, "splineRotation", frame, 1), 1);
  if (transform === 1) {
    // Relative: the text keeps its layout and slides by the path shift
    // between Start and Start + Offset.
    const pin = (x) => {
      if (P.clamp) {
        const lo = Math.min(P.start, P.end);
        const hi = Math.max(P.start, P.end);
        return Math.min(hi, Math.max(lo, x));
      }
      return x - Math.floor(x);
    };
    const a = sampleSplinePath(path, P, pin(P.start + P.offset));
    const b = sampleSplinePath(path, P, pin(P.start));
    if (posToggle) {
      out.position[0] += (a.position[0] - b.position[0]) * weight;
      out.position[1] += (a.position[1] - b.position[1]) * weight;
      out.position[2] += (a.position[2] - b.position[2]) * weight;
    }
  } else if (posToggle) {
    // Absolute: the anchor lands on the path (controls carry path minus
    // base, since the renderer adds the base back), blended by Strength.
    const smp = sampleSplinePath(path, P, place(baseT));
    const bp = vector3(base, [0, 0, 0]);
    out.position[0] += (smp.position[0] - bp[0] - out.position[0]) * weight;
    out.position[1] += (smp.position[1] - bp[1] - out.position[1]) * weight;
    out.position[2] += (smp.position[2] - bp[2] - out.position[2]) * weight;
  }
  if (rotToggle) {
    const smp = sampleSplinePath(path, P, place(baseT));
    const heading = numberValue(readProp(props, "splineHeading", localFrame, 0), 0);
    const pitch = numberValue(readProp(props, "splinePitch", localFrame, 0), 0);
    const bank = numberValue(readProp(props, "splineBank", localFrame, 0), 0);
    out.rotation[0] += (pitch + smp.euler[0]) * weight;
    out.rotation[1] += (heading + smp.euler[1]) * weight;
    out.rotation[2] += (bank + smp.euler[2]) * weight;
  }
}

// Orbit: the selected letters revolve rigidly about their own center in
// the screen plane (glyphs turn with the orbit), so a pair swaps places
// at 180 degrees. Angle animates full revolutions; Radius scales the
// orbit size (0% collapses to the center, single letters spin in place).
// Still in, still out: Angle 0 is the identity.
function evaluateOrbit(props, frame, index, list, base, out, plainLists, aux) {
  if (!numberValue(readProp(props, "orbitEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "orbit", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "orbit", frame, base);
  if (!(weight > 0)) return;
  const localFrame = frame - ctx.delay;
  // XYZ orbit angles (radians on the wire): the pair tumbles rigidly in
  // 3D — Z swaps side by side, X flips in place along the line, Y swaps
  // with a yaw. Glyphs turn with the orbit on every axis.
  const angle = readVector(props, "orbitAngle", localFrame, [0, 0, 0]);
  const radius = numberValue(readProp(props, "orbitRadius", localFrame, 100), 100) / 100;
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const own = vector3(base, [0, 0, 0]);
  // Selection center: shared world bases when the run provides them
  // (converted back into this letter's layout space), otherwise the
  // letter's own base (safe: position holds, glyph still spins). Missing
  // entries (unbuilt texts) never drag the center.
  let center = own;
  const shared = aux && Array.isArray(aux.bases) ? aux.bases : null;
  if (shared) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (let p = 0; p < order.length; p += 1) {
      const gi = order[p];
      if (!isLetterSelected(ctx.selected, gi)) continue;
      const raw = shared[gi];
      if (!Array.isArray(raw)) continue;
      cx += raw[0];
      cy += raw[1];
      cz += raw[2];
      n += 1;
    }
    if (n > 0) {
      const worldCenter = [cx / n, cy / n, cz / n];
      center = aux && aux.selfWorld ? localBaseOf(worldCenter, aux.selfWorld) : worldCenter;
    }
  }
  const dx = (own[0] - center[0]) * radius;
  const dy = (own[1] - center[1]) * radius;
  const dz = (own[2] - center[2]) * radius;
  const spun = rotateEulerXYZ([dx, dy, dz], angle);
  const target = [center[0] + spun[0], center[1] + spun[1], center[2] + spun[2]];
  out.position[0] += (target[0] - own[0] - out.position[0]) * weight;
  out.position[1] += (target[1] - own[1] - out.position[1]) * weight;
  out.position[2] += (target[2] - own[2] - out.position[2]) * weight;
  out.rotation[0] += angle[0] * weight;
  out.rotation[1] += angle[1] * weight;
  out.rotation[2] += angle[2] * weight;
}

// Twist: ribbon twirl in the letter run — each letter turns about the
// chosen axis proportionally to its rank, centered so the middle holds
// and the ends counter-rotate. Angle is the total end-to-end twirl;
// a lone letter holds (no line to twist across).
function evaluateTwist(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "twistEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "twist", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "twist", frame, base);
  if (!(weight > 0)) return;
  const localFrame = frame - ctx.delay;
  const angle = numberValue(readProp(props, "twistAngle", localFrame, 0), 0);
  const axis = Math.round(numberValue(readProp(props, "twistAxis", localFrame, 2), 2));
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const slots = Math.max(1, order.length);
  const at = order.indexOf(index);
  const twirl = slots > 1 && at !== -1 ? angle * (at / (slots - 1) - 0.5) : 0;
  const ax = axis === 0 ? 0 : axis === 1 ? 1 : 2;
  out.rotation[ax] += twirl * weight;
}

// Wrap: flag wave in the letter run — sine displacement along Direction
// with Frequency cycles across the run and animatable Phase. Upright
// letters (no tilt math); amplitude 0 is the identity.
function evaluateWrap(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "wrapEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "wrap", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "wrap", frame, base);
  if (!(weight > 0)) return;
  const localFrame = frame - ctx.delay;
  const amplitude = numberValue(readProp(props, "wrapAmplitude", localFrame, 0), 0);
  const frequency = Math.max(0, numberValue(readProp(props, "wrapFrequency", localFrame, 1), 1));
  const phase = numberValue(readProp(props, "wrapPhase", localFrame, 0), 0);
  const dir = Math.round(numberValue(readProp(props, "wrapDirection", localFrame, 1), 1));
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const slots = Math.max(1, order.length);
  const at = order.indexOf(index);
  const u = slots > 1 && at !== -1 ? at / (slots - 1) : 0;
  const wave = amplitude * Math.sin(2 * Math.PI * frequency * u + phase);
  const ax = dir === 0 ? 0 : dir === 2 ? 2 : 1;
  out.position[ax] += wave * weight;
}

/* ------------------------------------------------- voronoi chunks */

// Halton low-discrepancy value in [0,1) for spreading shatter sites.
function haltonSequence(index, base) {
  let f = 1;
  let r = 0;
  let i = Math.max(1, Math.floor(numberValue(index, 1)));
  const b = Math.max(2, Math.floor(numberValue(base, 2)));
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

// Partition letter triangles into voronoi cells: seeded sites spread
// over the glyph bounds, each triangle assigned to its nearest site.
// Pure array math (no THREE): positions/normals/uvs are flat per-triangle
// arrays; returns per nonempty cell { position, normal, uv, center }.
function splitVoronoiCells(positions, normals, uvs, count, seed) {
  // Live geometry hands typed arrays (Float32Array), tests hand plain
  // arrays: accept any indexable array-like.
  const pos = positions && typeof positions.length === "number" ? positions : [];
  const triCount = Math.floor(pos.length / 9);
  const want = Math.max(1, Math.min(64, Math.floor(numberValue(count, 8))));
  if (triCount <= 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < minX) minX = pos[i];
    if (pos[i] > maxX) maxX = pos[i];
    if (pos[i + 1] < minY) minY = pos[i + 1];
    if (pos[i + 1] > maxY) maxY = pos[i + 1];
    if (pos[i + 2] < minZ) minZ = pos[i + 2];
    if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
  }
  const seedNum = numberValue(seed, 1);
  const seedFrac = seedNum - Math.floor(seedNum) + (seedNum < 0 ? 1 : 0);
  const spanX = maxX > minX ? maxX - minX : 1;
  const spanY = maxY > minY ? maxY - minY : 1;
  const spanZ = maxZ > minZ ? maxZ - minZ : 1;
  const sites = [];
  const siteCount = Math.min(want, triCount);
  for (let s = 0; s < siteCount; s += 1) {
    const jx = (haltonSequence(s + 1, 2) + seedFrac * 0.6180339887) % 1;
    const jy = (haltonSequence(s + 1, 3) + seedFrac * 0.3819660113) % 1;
    const jz = (haltonSequence(s + 1, 5) + seedFrac * 0.5) % 1;
    sites.push([minX + spanX * jx, minY + spanY * jy, minZ + spanZ * jz]);
  }
  const cells = sites.map(() => ({ tris: [], center: [0, 0, 0] }));
  for (let t = 0; t < triCount; t += 1) {
    const cx = (pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3;
    const cy = (pos[t * 9 + 1] + pos[t * 9 + 4] + pos[t * 9 + 7]) / 3;
    const cz = (pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3;
    let best = 0;
    let bestD = Infinity;
    for (let s = 0; s < sites.length; s += 1) {
      const dx = cx - sites[s][0];
      const dy = cy - sites[s][1];
      const dz = cz - sites[s][2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    cells[best].tris.push(t);
  }
  const nor = normals && typeof normals.length === "number" ? normals : [];
  const uv = uvs && typeof uvs.length === "number" ? uvs : [];
  const out = [];
  for (const cell of cells) {
    if (!cell.tris.length) continue;
    const position = [];
    const normal = [];
    const uvOut = [];
    let ccx = 0;
    let ccy = 0;
    let ccz = 0;
    for (const t of cell.tris) {
      for (let k = 0; k < 9; k += 1) position.push(pos[t * 9 + k]);
      for (let k = 0; k < 9; k += 1) {
        if (nor.length > t * 9 + k) normal.push(nor[t * 9 + k]);
      }
      for (let k = 0; k < 6; k += 1) {
        if (uv.length > t * 6 + k) uvOut.push(uv[t * 6 + k]);
      }
      ccx += (pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3;
      ccy += (pos[t * 9 + 1] + pos[t * 9 + 4] + pos[t * 9 + 7]) / 3;
      ccz += (pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3;
    }
    const n = cell.tris.length;
    out.push({ position, normal, uv: uvOut, center: [ccx / n, ccy / n, ccz / n] });
  }
  return out;
}

// Chunk pose from summed totals: offset along the letter-center
// direction, tumble by signed spin. Pure (no THREE).
function voronoiChunkPose(chunkCenter, letterCenter, explode, spin, signs) {
  const cc = vector3(chunkCenter, [0, 0, 0]);
  const lc = vector3(letterCenter, [0, 0, 0]);
  const dx = cc[0] - lc[0];
  const dy = cc[1] - lc[1];
  const dz = cc[2] - lc[2];
  const len = Math.hypot(dx, dy, dz);
  const dir = len > 1e-9 ? [dx / len, dy / len, dz / len] : [0, 1, 0];
  const ex = numberValue(explode, 0);
  const sp = Array.isArray(spin) ? spin : [0, 0, 0];
  const sg = Array.isArray(signs) ? signs : [1, 1, 1];
  return {
    offset: [dir[0] * ex, dir[1] * ex, dir[2] * ex],
    rotation: [sp[0] * sg[0], sp[1] * sg[1], sp[2] * sg[2]],
  };
}

// Delay chase calibration (see the Delay section below). Each letter
// chases its own target, so forward and reversed sweeps time identically:
// the cascade comes from the field sweep itself, the Delay only trails.
// Even closes in at uniform speed covering the letter's whole travel in
// DELAY_EVEN_SPAN frames at full strength (Strength adjusts the speed,
// per the manual). Blend catches up DELAY_BLEND_CATCH of the gap per
// frame; Spring rides DELAY_SPRING_STIFF stiffness retaining
// DELAY_SPRING_DAMP of its velocity (higher Strength softens toward these
// through a square-root ramp, so mid strengths already wobble). Long
// timelines warm-start the last DELAY_SIM_WINDOW frames; older history
// cannot move a trail.
const DELAY_EVEN_SPAN = 2.5;
const DELAY_BLEND_CATCH = 0.25;
const DELAY_SPRING_STIFF = 0.08;
const DELAY_SPRING_DAMP = 0.9;
const DELAY_SPRING_DAMP_MIN = 0.5;
const DELAY_SIM_WINDOW = 7200;

// Per-letter Delay parameters for one simulation step. null means the
// letter bypasses the chase and follows its own target (disabled layer,
// unselected letter, or zero field weight — like unselected clones in C4D).
function delayLinkParams(props, frame, index, list, base, plainLists) {
  if (!numberValue(readProp(props, "delayEnable", frame, 1), 1)) return null;
  const selected = resolveSelection(
    readProp(props, "delayLetters", frame, ""),
    list.total,
    plainLists || []
  );
  if (!isLetterSelected(selected, index)) return null;
  const gated = applyFieldWeight(
    strengthWeight(readProp(props, "delayStrength", frame, 100)),
    props,
    "delay",
    frame,
    base
  );
  if (!(gated > 0)) return null;
  return {
    strength: Math.min(1, Math.max(0, gated)),
    mode: Math.round(numberValue(readProp(props, "delayMode", frame, 0), 0)),
    position: !!numberValue(readProp(props, "delayPosition", frame, 1), 1),
    scale: !!numberValue(readProp(props, "delayScale", frame, 1), 1),
    rotation: !!numberValue(readProp(props, "delayRotation", frame, 1), 1),
  };
}

// One chase step for a single letter: move state toward pred (the
// letter's own target). snap is the same target: bypassed letters (null
// chase, strength 0, toggled-off channel) snap to it, so unaffected
// clones follow the raw effector result exactly and stale spring velocity
// is always cleared on bypass. mode 0 closes at uniform speed paced by
// travel (the letter's whole motion over the window), mode 1 closes
// fast-then-slow, mode 2 rides a damper.
function chaseToward(state, velocity, pred, snap, chase, travel, dt) {
  const step = Math.max(0, numberValue(dt, 1));
  const groups = [
    ["position", "positionVelocity", chase ? chase.position : false],
    ["rotation", "rotationVelocity", chase ? chase.rotation : false],
    ["scale", "scaleVelocity", chase ? chase.scale : false],
  ];
  for (const [key, velKey, enabled] of groups) {
    const cur = state[key];
    const vel = velocity[velKey];
    if (!chase || !enabled || !(chase.strength > 0)) {
      for (let axis = 0; axis < 3; axis += 1) {
        cur[axis] = snap[key][axis];
        vel[axis] = 0;
      }
      continue;
    }
    const s = chase.strength;
    const want = pred[key];
    for (let axis = 0; axis < 3; axis += 1) {
      const from = numberValue(cur[axis], 0);
      const to = numberValue(want[axis], 0);
      if (chase.mode === 2) {
        // Softens with strength (the manual: higher values, softer
        // springs, more residual oscillation); the output blend carries
        // the off-ramp to exact at 0%.
        const soft = Math.sqrt(Math.min(1, Math.max(0, s)));
        const stiff = 1 + (DELAY_SPRING_STIFF - 1) * soft;
        const damp = DELAY_SPRING_DAMP_MIN + (DELAY_SPRING_DAMP - DELAY_SPRING_DAMP_MIN) * s;
        vel[axis] += (to - from) * stiff * step;
        vel[axis] *= Math.pow(damp, step);
        cur[axis] = from + vel[axis] * step;
      } else if (chase.mode === 1) {
        // Fast-then-slow close-in; the catch-up reaches instant at 0%.
        const k = 1 + (DELAY_BLEND_CATCH - 1) * s;
        cur[axis] = from + (to - from) * Math.min(1, k * step);
      } else {
        // Uniform close-in: cover the whole travel in SPAN frames at full
        // strength, so steps cascade a few frames late while gentle motion
        // tracks nearly exactly. Static letters hold (travel 0 → frozen).
        const pace = numberValue(travel && travel[key] ? travel[key][axis] : 0, 0);
        const rate = pace > 0 ? (pace / Math.max(s * DELAY_EVEN_SPAN, 1e-9)) * step : 0;
        const diff = to - from;
        cur[axis] = from + Math.max(-rate, Math.min(rate, diff));
      }
    }
  }
}

function blankDelayVelocity() {
  return {
    positionVelocity: [0, 0, 0],
    rotationVelocity: [0, 0, 0],
    scaleVelocity: [0, 0, 0],
  };
}

// Every non-delay effector at one frame, merged into fresh controls.
function evaluateEffectors(layers, frame, index, list, base, plainLists, aux) {
  const out = blankControls();
  for (const layer of layers) {
    if (!layer || layer.kind === "delay") continue;
    if (layer.kind === "shake") evaluateShake(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "plain") evaluatePlain(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "random") evaluateRandom(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "formula") evaluateFormula(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "twist") evaluateTwist(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "wrap") evaluateWrap(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "orbit") evaluateOrbit(layer.props, frame, index, list, base, out, plainLists, aux);
    else if (layer.kind === "spline") evaluateSpline(layer.props, frame, index, list, base, out, plainLists, aux);
  }
  return out;
}

// Full stack for one letter across ancestor layers (outermost first).
// Delay layers drag a trail behind the motion: each letter chases its own
// target, and static stacks simply hold their pose (like C4D: still in,
// still out). aux carries shared line data both paths can use (notably
// the Spline Relative extent); without it those fall back gracefully.
// Unknown kinds are ignored so future effectors compose without changes.
function evaluateStack(stack, containerProps, frame, index, list, base, aux) {
  const out = blankControls();
  const order = readProp(containerProps, "rotationOrder", frame, "XYZ");
  out.eulerOrder = PZ_EULER_ORDERS.has(order) ? order : "XYZ";
  const layers = stack || [];
  const delays = [];
  for (const layer of layers) {
    if (layer && layer.kind === "delay") delays.push(layer);
  }
  if (!delays.length) {
    const pose = evaluateEffectors(layers, frame, index, list, base, plainListsAt(layers, frame), aux);
    out.position = pose.position;
    out.rotation = pose.rotation;
    out.scale = pose.scale;
    return out;
  }
  const controls = simulateDelayLetter(layers, delays, frame, index, list, base, aux);
  out.position = controls.position;
  out.rotation = controls.rotation;
  out.scale = controls.scale;
  return out;
}

function plainListsAt(layers, frame) {
  const plainLists = [];
  // Section selections by kind for kind-N tokens ("plain-2",
  // "voronoi-1", ...): rides the array so every existing caller and
  // test passing plain lists keeps working unchanged.
  const sections = {};
  for (const layer of layers) {
    if (!layer || !layer.kind) continue;
    const letters = readProp(layer.props, `${layer.kind}Letters`, frame, "");
    if (layer.kind === "plain") plainLists.push(letters);
    (sections[layer.kind] = sections[layer.kind] || []).push(letters);
  }
  plainLists.sections = sections;
  return plainLists;
}

function copyDelayState(state) {
  return {
    position: state.position.slice(),
    rotation: state.rotation.slice(),
    scale: state.scale.slice(),
  };
}

// Standard effector Strength: the trail blends between the undelayed
// target (0%, off) and the fully chased state (100%). Bypassed letters
// read strength 0 and follow their target exactly.
function blendDelayOutput(target, chased, s) {
  if (!(s > 0)) {
    return {
      position: target.position.slice(),
      rotation: target.rotation.slice(),
      scale: target.scale.slice(),
    };
  }
  if (s >= 1) return chased;
  const out = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  for (const key of ["position", "rotation", "scale"]) {
    for (let axis = 0; axis < 3; axis += 1) {
      out[key][axis] = target[key][axis] + (chased[key][axis] - target[key][axis]) * s;
    }
  }
  return out;
}

function copyDelayVelocity(velocity) {
  return {
    positionVelocity: velocity.positionVelocity.slice(),
    rotationVelocity: velocity.rotationVelocity.slice(),
    scaleVelocity: velocity.scaleVelocity.slice(),
  };
}

function sampleStageTarget(layers, stepFrame, letterIndex, list, base, aux) {
  const pose = evaluateEffectors(
    layers,
    stepFrame,
    letterIndex,
    list,
    base,
    plainListsAt(layers, stepFrame),
    aux
  );
  return {
    position: pose.position.slice(),
    rotation: pose.rotation.slice(),
    scale: pose.scale.slice(),
  };
}

// One Delay layer for one letter: the letter chases its own stage input,
// so forward and reversed sweeps time identically and static targets hold
// exactly. Even closes in at uniform speed, Blend fast-then-slow, Spring
// on a damper. Stacked Delays chain the same way C4D stacks them. Returns
// a sampler for the next layer: integer steps read the output table
// (linearly interpolated for fractional queries), the exact end frame
// reads the fractional tail.
function runDelayLetterStage(layers, delayProps, sampleInput, endFrame, lastStep, index, list, base) {
  const firstStep = Math.max(0, lastStep - DELAY_SIM_WINDOW);
  const listsAt = (f) => plainListsAt(layers, f);
  const paramsAt = (f) => delayLinkParams(delayProps, f, index, list, base, listsAt(f));
  // Stage targets over the window; Even paces itself on their travel.
  const targets = [];
  for (let f = firstStep; f <= lastStep; f += 1) targets.push(sampleInput(f));
  const travel = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  for (const key of ["position", "rotation", "scale"]) {
    for (let axis = 0; axis < 3; axis += 1) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < targets.length; k += 1) {
        const v = targets[k][key][axis];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      travel[key][axis] = hi > lo ? hi - lo : 0;
    }
  }
  // Chase the letter's own target; static targets hold exactly.
  let state = copyDelayState(targets[0]);
  let velocity = blankDelayVelocity();
  const table = [];
  for (let k = 0; k < targets.length; k += 1) {
    const f = firstStep + k;
    const params = paramsAt(f);
    const own = targets[k];
    const mode = params ? params.mode : 0;
    const chase = params
      ? {
          mode: mode === 1 || mode === 2 ? mode : 0,
          strength: params.strength,
          position: params.position,
          scale: params.scale,
          rotation: params.rotation,
        }
      : null;
    const chased = copyDelayState(state);
    const nextVel = copyDelayVelocity(velocity);
    chaseToward(chased, nextVel, own, own, chase, travel, 1);
    velocity = nextVel;
    state = chased;
    // Spring blends (its deadbeat point is singular, so the trail would
    // never fully switch off otherwise); Even and Blend carry their
    // off-ramp in the pacing and catch-up.
    table.push(mode === 2 ? blendDelayOutput(own, chased, params ? params.strength : 0) : chased);
  }
  // Fractional tail at the exact end frame.
  const frac = endFrame - lastStep;
  let tail = null;
  if (frac > 1e-9) {
    const params = paramsAt(endFrame);
    const own = sampleInput(endFrame);
    const mode = params ? params.mode : 0;
    const chase = params
      ? {
          mode: mode === 1 || mode === 2 ? mode : 0,
          strength: params.strength,
          position: params.position,
          scale: params.scale,
          rotation: params.rotation,
        }
      : null;
    const chased = copyDelayState(state);
    const nextVel = copyDelayVelocity(velocity);
    chaseToward(chased, nextVel, own, own, chase, travel, frac);
    tail = mode === 2 ? blendDelayOutput(own, chased, params ? params.strength : 0) : chased;
  } else {
    tail = table[table.length - 1];
  }
  const lerpState = (a, b, t) => {
    const out = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
    for (const key of ["position", "rotation", "scale"]) {
      for (let axis = 0; axis < 3; axis += 1) {
        out[key][axis] = a[key][axis] + (b[key][axis] - a[key][axis]) * t;
      }
    }
    return out;
  };
  return {
    sample(stepFrame) {
      if (stepFrame >= endFrame - 1e-9) return tail;
      if (stepFrame <= firstStep) return table[0];
      const k0 = Math.floor(stepFrame) - firstStep;
      const t = stepFrame - Math.floor(stepFrame);
      const a = table[Math.min(table.length - 1, Math.max(0, k0))];
      if (!(t > 1e-9)) return a;
      return lerpState(a, table[Math.min(table.length - 1, k0 + 1)], t);
    },
  };
}

function simulateDelayLetter(layers, delays, frame, index, list, base, aux) {
  const endFrame = numberValue(frame, 0);
  if (!(endFrame > 0)) {
    // Pre-roll: the letter starts exactly on the target.
    return sampleStageTarget(layers, endFrame, index, list, base, aux);
  }
  const lastStep = Math.floor(endFrame);
  let sample = (stepFrame) => sampleStageTarget(layers, stepFrame, index, list, base, aux);
  let out = null;
  for (const delay of delays) {
    const staged = runDelayLetterStage(
      layers,
      delay.props,
      sample,
      endFrame,
      lastStep,
      index,
      list,
      base
    );
    sample = staged.sample;
    out = sample(endFrame);
  }
  return out;
}

// Custom-properties readers: sections are stock dynamic groups found by
// display name; rows inside them by stamped effectorKey. Both survive
// creation (verified live) because definitions round-trip through save.
function customsChildren(container) {
  const list = container && container.customProperties;
  const out = [];
  if (!list) return out;
  try {
    const count = list.length || 0;
    for (let i = 0; i < count; i += 1) {
      if (list[i] !== undefined) out.push(list[i]);
    }
  } catch (_error) {}
  return out;
}

function sectionGroupOf(container, displayName) {
  for (const child of customsChildren(container)) {
    try {
      if (child && child.definition && child.definition.name === displayName) {
        return child;
      }
    } catch (_error) {}
  }
  return null;
}

function groupReader(group) {
  return {
    get(key) {
      if (!group) return undefined;
      try {
        const kids = group.objects || [];
        for (let i = 0; i < kids.length; i += 1) {
          const child = kids[i];
          if (child && child.definition && child.definition.effectorKey === key) {
            return child;
          }
        }
      } catch (_error) {}
      return undefined;
    },
  };
}

// Full stack for one letter: inline customs sections first (fixed panel
// order), then legacy object effectors (container children, then stacked
// ancestors) so older scenes keep rendering while they transition.
// Saved lists serialize as objects with numeric keys ({"0":…, length: N}),
// not arrays: normalize before iterating, or stock revive output is
// silently skipped.
function rawArray(rawList) {
  if (!rawList || typeof rawList !== "object") return [];
  if (Array.isArray(rawList)) return rawList;
  const out = [];
  const count = rawList.length || 0;
  for (let i = 0; i < count; i += 1) out.push(rawList[i]);
  return out;
}

// Stock revive rebuilds customs children without their definitions
// (observed live: definition.name comes back null while the raw saved
// data still carries the full defs). Reattach identity from raw so
// sections and rows stay readable after reload. Never throws.
function reattachCustomDefinitions(liveList, rawList) {
  try {
    const raw = rawArray(rawList);
    const count = (liveList && liveList.length) || 0;
    for (let i = 0; i < count && i < raw.length; i += 1) {
      const liveChild = liveList[i];
      const rawChild = raw[i] || {};
      if (liveChild && (!liveChild.definition || !liveChild.definition.name) && rawChild.type) {
        liveChild.definition = rawChild.type;
      }
      const liveRows = (liveChild && liveChild.objects) || [];
      const defRows = (rawChild.type && rawChild.type.objects) || [];
      for (let j = 0; j < liveRows.length && j < defRows.length; j += 1) {
        if (
          liveRows[j] &&
          (!liveRows[j].definition || !liveRows[j].definition.effectorKey) &&
          defRows[j]
        ) {
          liveRows[j].definition = defRows[j];
        }
      }
    }
  } catch (_error) {}
}

// Kind from a stamped row key ("shakeEnable" -> "shake"). Display names
// change on duplicate ("Shake 2") but stamped keys never do, so copies
// keep working and stack.
function kindOfKey(key) {
  if (typeof key !== "string" || !key) return null;
  for (const kind of EFFECTOR_ORDER) {
    if (key === kind) return kind;
    if (key.indexOf(kind) === 0 && key.length > kind.length) {
      const next = key[kind.length];
      if (next >= "A" && next <= "Z") return kind;
    }
  }
  return null;
}

function kindOfGroup(group) {
  try {
    const kids = (group && group.objects) || [];
    for (let i = 0; i < kids.length; i += 1) {
      const child = kids[i];
      const kind =
        child && child.definition ? kindOfKey(child.definition.effectorKey) : null;
      if (kind) return kind;
    }
  } catch (_error) {}
  return null;
}

// Every customs section in panel order, duplicates included: each copy
// evaluates with its own values.
function customSections(container) {
  const out = [];
  for (const child of customsChildren(container)) {
    try {
      const kind = kindOfGroup(child);
      if (kind) out.push({ kind, props: groupReader(child), source: child });
    } catch (_error) {}
  }
  return out;
}

function stackLayersFor(container, layers) {
  const out = customSections(container);
  for (const layer of expressStackOf(layers)) out.push(layer);
  return out;
}

const EFFECTOR_PIVOT_KEYS = {
  shake: "shakePivot",
  plain: "plainPivot",
  random: "randomPivot",
};

/* ------------------------------------------------------- property schema */

function vectorDefinition(PZ, definition) {
  const axisNames = ["X", "Y", "Z"];
  return {
    dynamic: true,
    interpolated: true,
    group: true,
    name: definition.name,
    type: PZ.property.type.VECTOR3,
    value: definition.value.slice(),
    ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
    ...(definition.linkRatio ? { linkRatio: true } : {}),
    objects: definition.value.map((value, index) => ({
      dynamic: true,
      interpolated: true,
      name: `${definition.name}.${axisNames[index]}`,
      type: PZ.property.type.NUMBER,
      value,
      ...(definition.min == null ? {} : { min: definition.min }),
      ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
      step: definition.step == null ? 1 : definition.step,
      decimals: definition.decimals == null ? 2 : definition.decimals,
    })),
  };
}

function dynamicNumberDefinition(PZ, name, value, options) {
  return {
    dynamic: true,
    interpolated: true,
    name,
    type: PZ.property.type.NUMBER,
    value,
    ...(options || {}),
  };
}

function enableDefinition(PZ, name) {
  return {
    dynamic: true,
    name,
    type: PZ.property.type.OPTION,
    items: "off;on",
    value: 1,
  };
}

function lettersDefinition(PZ) {
  return {
    dynamic: true,
    name: "Letters",
    type: PZ.property.type.TEXT,
    value: "",
  };
}

function strengthDefinition(PZ) {
  return dynamicNumberDefinition(PZ, "Strength", 100, {
    min: 0,
    max: 100,
    step: 1,
    decimals: 1,
  });
}

function fieldDefinitions(PZ) {
  return {
    field: {
      dynamic: true,
      name: "Field",
      type: PZ.property.type.OPTION,
      items: FIELD_LABELS.join(";"),
      value: 0,
    },
    fieldPosition: vectorDefinition(PZ, {
      name: "Field position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    fieldScale: vectorDefinition(PZ, {
      name: "Field scale",
      value: [100, 100, 100],
      min: 0.01,
      step: 1,
      decimals: 2,
    }),
  };
}

function delayDefinitions(PZ) {
  return {
    delay: dynamicNumberDefinition(PZ, "Delay", 0, {
      min: 0,
      step: 1,
      decimals: 2,
    }),
    delayOrder: {
      dynamic: true,
      name: "Delay order",
      type: PZ.property.type.OPTION,
      items: DELAY_ORDER_LABELS.join(";"),
      value: 0,
    },
  };
}

function seedDefinition(PZ) {
  return dynamicNumberDefinition(PZ, "Seed", 1, {
    step: 0.01,
    decimals: 2,
  });
}

function pivotDefinition(PZ) {
  return {
    dynamic: true,
    name: "Pivot",
    type: PZ.property.type.OPTION,
    items: PIVOT_LABELS.join(";"),
    value: 0,
  };
}

function xyzDefinitions(PZ, prefix, positionValue, rotationValue, scaleValue) {
  return {
    [`${prefix}Position`]: vectorDefinition(PZ, {
      name: "Position",
      value: positionValue,
      step: 1,
      decimals: 2,
    }),
    [`${prefix}Rotation`]: vectorDefinition(PZ, {
      name: "Rotation",
      value: rotationValue,
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    [`${prefix}Scale`]: vectorDefinition(PZ, {
      name: "Scale",
      value: scaleValue,
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
  };
}

function withPrefix(defs, prefix, label) {
  const out = {};
  for (const key of Object.keys(defs)) {
    const name = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
    const def = defs[key];
    // effectorKey survives property creation (verified live) and links a
    // rendered row back to its stable key no matter the display label.
    out[name] =
      key === "enable"
        ? { ...def, effectorKey: name }
        : { ...def, name: `${label} ${def.name}`, effectorKey: name };
  }
  return out;
}

const EFFECTOR_ORDER = ["shake", "plain", "random", "formula", "delay", "spline", "orbit", "repeater", "twist", "wrap", "voronoi"];
const EFFECTOR_NAMES = {
  shake: "Shake",
  plain: "Plain",
  random: "Random",
  formula: "Formula",
  delay: "Delay",
  spline: "Spline",
  orbit: "Orbit",
  repeater: "Repeater",
  twist: "Twist",
  wrap: "Wrap",
  voronoi: "Voronoi",
};
const EFFECTOR_TYPES = {
  shake: "zoidium:expresstext-plus/shake",
  plain: "zoidium:expresstext-plus/plain",
  random: "zoidium:expresstext-plus/random",
  formula: "zoidium:expresstext-plus/formula",
  delay: "zoidium:expresstext-plus/delay",
  spline: "zoidium:expresstext-plus/spline",
  orbit: "zoidium:expresstext-plus/orbit",
  repeater: "zoidium:expresstext-plus/repeater",
  twist: "zoidium:expresstext-plus/twist",
  wrap: "zoidium:expresstext-plus/wrap",
  voronoi: "zoidium:expresstext-plus/voronoi",
};
const EFFECTOR_KINDS = {};
for (const kind of Object.keys(EFFECTOR_TYPES)) {
  EFFECTOR_KINDS[EFFECTOR_TYPES[kind]] = kind;
}

const EFFECTOR_BUILDERS = {
  shake: createShakePropertyDefinitions,
  plain: createPlainPropertyDefinitions,
  random: createRandomPropertyDefinitions,
  formula: createFormulaPropertyDefinitions,
  delay: createDelayPropertyDefinitions,
  spline: createSplinePropertyDefinitions,
  orbit: createOrbitPropertyDefinitions,
  repeater: createRepeaterPropertyDefinitions,
  twist: createTwistPropertyDefinitions,
  wrap: createWrapPropertyDefinitions,
  voronoi: createVoronoiPropertyDefinitions,
};

// Effector classes live ONLY inside the one single ExpressText+ group:
// they are constructed from this factory map (never globally registered,
// never offered by the picker). The container revives them on load and the
// + menu instantiates them here.
function newEffectorInstance(type) {
  try {
    const factory = state.effectorClasses && state.effectorClasses[type];
    if (typeof factory === "function") return new factory();
  } catch (_error) {}
  return null;
}

function createContainerPropertyDefinitions(PZ) {
  return {
    rotationOrder: {
      name: "Rotation order",
      type: PZ.property.type.LIST,
      value: "XYZ",
      items: PZ.object3d.eulerOrders,
    },
  };
}

// Scoped custom-property class: the stock + dialog reads its entries from
// PZ.ui.objectTypes keyed by the customs list item class, so registering
// the eleven effectors under our own subclass scopes them to ExpressText+
// containers only. Everywhere else keeps the stock five.
function customPropertyClass(PZ) {
  if (state.customPropertyClass) return state.customPropertyClass;
  if (!PZ || !PZ.property || typeof PZ.property.dynamic !== "function") {
    return null;
  }
  class ExpressCustomProperty extends PZ.property.dynamic {}
  state.customPropertyClass = ExpressCustomProperty;
  return ExpressCustomProperty;
}

function effectorEntryDefs(PZ) {
  const builders = {
    Shake: createShakePropertyDefinitions,
    Plain: createPlainPropertyDefinitions,
    Random: createRandomPropertyDefinitions,
    Formula: createFormulaPropertyDefinitions,
    Delay: createDelayPropertyDefinitions,
    Spline: createSplinePropertyDefinitions,
    Orbit: createOrbitPropertyDefinitions,
    Repeater: createRepeaterPropertyDefinitions,
    Twist: createTwistPropertyDefinitions,
    Wrap: createWrapPropertyDefinitions,
    Voronoi: createVoronoiPropertyDefinitions,
  };
  const out = [];
  for (const name of Object.keys(builders)) {
    let objects = null;
    try {
      objects = Object.values(builders[name](PZ));
    } catch (_build) {
      continue;
    }
    if (!objects || !objects.length) continue;
    out.push({
      name,
      desc: `${name} letters with selection, strength and fields`,
      type: {
        custom: true,
        group: true,
        dynamic: true,
        // The display name must live INSIDE the type object: registry
        // entry names never reach the project file, so groups built from
        // this def would come back nameless after save/load.
        name,
        objects,
        // VECTOR3 routes the group row through the same editor stock
        // vector groups use. NUMBER would route through generateInput,
        // which reads keyframes the fresh group does not have yet.
        type: PZ.property.type.VECTOR3,
      },
    });
  }
  return out;
}

function registerEffectorEntries(PZ) {
  try {
    const itemClass = customPropertyClass(PZ);
    if (!itemClass) return false;
    const ui = PZ.ui;
    if (!ui || !ui.objectTypes || typeof ui.objectTypes.set !== "function") {
      return false;
    }
    ui.objectTypes.set(itemClass, effectorEntryDefs(PZ));
    return true;
  } catch (_error) {
    return false;
  }
}

function unregisterEffectorEntries() {
  try {
    const PZ = state.PZ;
    const itemClass = state.customPropertyClass;
    if (PZ && PZ.ui && PZ.ui.objectTypes && typeof PZ.ui.objectTypes.delete === "function" && itemClass) {
      PZ.ui.objectTypes.delete(itemClass);
    }
  } catch (_error) {}
  state.customPropertyClass = null;
}

function createShakePropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Shake"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      ...xyzDefinitions(PZ, "", [0, 0, 0], [0, 0, 0], [1, 1, 1]),
      frequency: dynamicNumberDefinition(PZ, "Frequency", 1, {
        min: 0,
        step: 0.1,
        decimals: 2,
      }),
      offset: dynamicNumberDefinition(PZ, "Offset", 0, {
        step: 0.05,
        decimals: 2,
      }),
      ...delayDefinitions(PZ),
      seed: seedDefinition(PZ),
      pivot: pivotDefinition(PZ),
      ...fieldDefinitions(PZ),
    },
    "shake",
    "Shake"
  );
}

function createPlainPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Plain"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      ...xyzDefinitions(PZ, "", [0, 0, 0], [0, 0, 0], [1, 1, 1]),
      invertOdd: {
        dynamic: true,
        name: "Invert odd",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 0,
      },
      ...delayDefinitions(PZ),
      pivot: pivotDefinition(PZ),
      ...fieldDefinitions(PZ),
    },
    "plain",
    "Plain"
  );
}

function createFormulaPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Formula"),
      letters: lettersDefinition(PZ),
      // Free entry (the manual allows below 0% and above 100%):
      // negative strengths mirror the result.
      strength: dynamicNumberDefinition(PZ, "Strength", 100, {
        step: 1,
        decimals: 1,
      }),
      minimum: dynamicNumberDefinition(PZ, "Minimum", 0, {
        step: 1,
        decimals: 1,
      }),
      maximum: dynamicNumberDefinition(PZ, "Maximum", 100, {
        step: 1,
        decimals: 1,
      }),
      expression: {
        dynamic: true,
        name: "Expression",
        type: PZ.property.type.TEXT,
        value: "sin(u*360*f+t*90)",
      },
      time: dynamicNumberDefinition(PZ, "Time", 1, {
        step: 0.1,
        decimals: 2,
      }),
      frequency: dynamicNumberDefinition(PZ, "Frequency", 1, {
        step: 0.1,
        decimals: 2,
      }),
      ...xyzDefinitions(PZ, "", [0, 10, 0], [0, 0, 0], [1, 1, 1]),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "formula",
    "Formula"
  );
}

function createOrbitPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Orbit"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      angle: vectorDefinition(PZ, {
        name: "Angle",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      radius: dynamicNumberDefinition(PZ, "Radius", 100, {
        step: 1,
        decimals: 1,
      }),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "orbit",
    "Orbit"
  );
}

function createSplinePropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Spline"),
      letters: lettersDefinition(PZ),
      // Free entry (Strength blends the distance to the path and may
      // exceed 100% or mirror below 0%, like the manual).
      strength: dynamicNumberDefinition(PZ, "Strength", 100, {
        step: 1,
        decimals: 1,
      }),
      mode: {
        dynamic: true,
        name: "Mode",
        type: PZ.property.type.OPTION,
        items: SPLINE_MODE_LABELS.join(";"),
        value: 0,
      },
      transform: {
        dynamic: true,
        name: "Transform",
        type: PZ.property.type.OPTION,
        items: SPLINE_TRANSFORM_LABELS.join(";"),
        value: 0,
      },
      path: {
        dynamic: true,
        name: "Path",
        type: PZ.property.type.OPTION,
        items: SPLINE_PATH_LABELS.join(";"),
        value: 0,
      },
      length: dynamicNumberDefinition(PZ, "Length", 100, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      radius: dynamicNumberDefinition(PZ, "Radius", 50, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      radiusEnd: dynamicNumberDefinition(PZ, "End radius", 50, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      height: dynamicNumberDefinition(PZ, "Height", 100, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      turns: dynamicNumberDefinition(PZ, "Turns", 1, {
        step: 0.1,
        decimals: 2,
      }),
      plane: {
        dynamic: true,
        name: "Plane",
        type: PZ.property.type.OPTION,
        items: SPLINE_PLANE_LABELS.join(";"),
        value: 0,
      },
      tilt: vectorDefinition(PZ, {
        name: "Tilt",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      reverse: {
        dynamic: true,
        name: "Reverse",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 0,
      },
      offset: dynamicNumberDefinition(PZ, "Offset", 0, {
        step: 1,
        decimals: 1,
      }),
      start: dynamicNumberDefinition(PZ, "Start", 0, {
        step: 1,
        decimals: 1,
      }),
      end: dynamicNumberDefinition(PZ, "End", 100, {
        step: 1,
        decimals: 1,
      }),
      clamp: {
        dynamic: true,
        name: "Clamp",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      position: {
        dynamic: true,
        name: "Position",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      rotation: {
        dynamic: true,
        name: "Rotation",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      heading: dynamicNumberDefinition(PZ, "Heading", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      pitch: dynamicNumberDefinition(PZ, "Pitch", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      bank: dynamicNumberDefinition(PZ, "Bank", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "spline",
    "Spline"
  );
}

function createRepeaterPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Repeater"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      mode: {
        dynamic: true,
        name: "Mode",
        type: PZ.property.type.OPTION,
        items: REPEATER_MODE_LABELS.join(";"),
        value: 0,
      },
      copies: dynamicNumberDefinition(PZ, "Copies", 3, {
        min: 0,
        max: REPEATER_MAX_COPIES,
        step: 1,
        decimals: 0,
      }),
      offset: vectorDefinition(PZ, {
        name: "Offset",
        value: [10, 0, 0],
        step: 1,
        decimals: 2,
      }),
      rangeMin: vectorDefinition(PZ, {
        name: "Min range",
        value: [-10, -10, -10],
        step: 1,
        decimals: 2,
      }),
      rangeMax: vectorDefinition(PZ, {
        name: "Max range",
        value: [10, 10, 10],
        step: 1,
        decimals: 2,
      }),
      seed: seedDefinition(PZ),
      lag: dynamicNumberDefinition(PZ, "Lag", 2, {
        min: 0,
        step: 0.5,
        decimals: 1,
      }),
      fade: dynamicNumberDefinition(PZ, "Fade", 50, {
        min: 0,
        max: 100,
        step: 1,
        decimals: 1,
      }),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "repeater",
    "Repeater"
  );
}

function createTwistPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Twist"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      angle: dynamicNumberDefinition(PZ, "Angle", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      axis: {
        dynamic: true,
        name: "Axis",
        type: PZ.property.type.OPTION,
        items: TWIST_AXIS_LABELS.join(";"),
        value: 2,
      },
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "twist",
    "Twist"
  );
}

function createWrapPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Wrap"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      amplitude: dynamicNumberDefinition(PZ, "Amplitude", 0, {
        step: 1,
        decimals: 2,
      }),
      frequency: dynamicNumberDefinition(PZ, "Frequency", 1, {
        min: 0,
        step: 0.1,
        decimals: 2,
      }),
      phase: dynamicNumberDefinition(PZ, "Phase", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      direction: {
        dynamic: true,
        name: "Direction",
        type: PZ.property.type.OPTION,
        items: WRAP_DIRECTION_LABELS.join(";"),
        value: 1,
      },
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "wrap",
    "Wrap"
  );
}

function createVoronoiPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Voronoi"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      chunks: dynamicNumberDefinition(PZ, "Chunks", 8, {
        min: 1,
        max: 64,
        step: 1,
        decimals: 0,
      }),
      explode: dynamicNumberDefinition(PZ, "Explode", 0, {
        step: 1,
        decimals: 2,
      }),
      spin: vectorDefinition(PZ, {
        name: "Spin",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      seed: seedDefinition(PZ),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "voronoi",
    "Voronoi"
  );
}

function createDelayPropertyDefinitions(PZ) {
  // Hand-built keys (no withPrefix): the kind prefix doubles as the key
  // prefix, so withPrefix would stutter ("delayDelayOrder"). Display names
  // follow the "<Effector> <thing>" convention; every def carries its
  // effectorKey stamp for the group reader.
  return {
    delayEnable: {
      ...enableDefinition(PZ, "Delay"),
      effectorKey: "delayEnable",
    },
    delayLetters: {
      ...lettersDefinition(PZ),
      name: "Delay Letters",
      effectorKey: "delayLetters",
    },
    delayStrength: {
      ...strengthDefinition(PZ),
      name: "Delay Strength",
      effectorKey: "delayStrength",
    },
    delayMode: {
      dynamic: true,
      name: "Delay Mode",
      type: PZ.property.type.OPTION,
      items: DELAY_MODE_LABELS.join(";"),
      value: 0,
      effectorKey: "delayMode",
    },
    delayPosition: {
      ...enableDefinition(PZ, "Delay Position"),
      effectorKey: "delayPosition",
    },
    delayScale: {
      ...enableDefinition(PZ, "Delay Scale"),
      effectorKey: "delayScale",
    },
    delayRotation: {
      ...enableDefinition(PZ, "Delay Rotation"),
      effectorKey: "delayRotation",
    },
    delayField: {
      dynamic: true,
      name: "Delay Field",
      type: PZ.property.type.OPTION,
      items: FIELD_LABELS.join(";"),
      value: 0,
      effectorKey: "delayField",
    },
    delayFieldPosition: {
      ...vectorDefinition(PZ, {
        name: "Delay Field position",
        value: [0, 0, 0],
        step: 1,
        decimals: 2,
      }),
      effectorKey: "delayFieldPosition",
    },
    delayFieldScale: {
      ...vectorDefinition(PZ, {
        name: "Delay Field scale",
        value: [100, 100, 100],
        min: 0.01,
        step: 1,
        decimals: 2,
      }),
      effectorKey: "delayFieldScale",
    },
  };
}

function createRandomPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Random"),
      letters: lettersDefinition(PZ),
      // Free entry (the manual allows below 0% and above 100%):
      // negative strengths mirror the scatter.
      strength: dynamicNumberDefinition(PZ, "Strength", 100, {
        step: 1,
        decimals: 1,
      }),
      mode: {
        dynamic: true,
        name: "Mode",
        type: PZ.property.type.OPTION,
        items: RANDOM_MODE_LABELS.join(";"),
        value: 0,
      },
      minimum: dynamicNumberDefinition(PZ, "Minimum", 0, {
        step: 1,
        decimals: 1,
      }),
      maximum: dynamicNumberDefinition(PZ, "Maximum", 100, {
        step: 1,
        decimals: 1,
      }),
      synchronized: {
        dynamic: true,
        name: "Synchronized",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 0,
      },
      indexed: {
        dynamic: true,
        name: "Indexed",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      seed: seedDefinition(PZ),
      space: {
        dynamic: true,
        name: "Space",
        type: PZ.property.type.OPTION,
        items: RANDOM_SPACE_LABELS.join(";"),
        value: 0,
      },
      animationSpeed: dynamicNumberDefinition(PZ, "Animation speed", 0, {
        min: 0,
        step: 1,
        decimals: 1,
      }),
      noiseScale: dynamicNumberDefinition(PZ, "Noise scale", 100, {
        min: 0,
        step: 1,
        decimals: 1,
      }),
      positionMin: vectorDefinition(PZ, {
        name: "Min position",
        value: [-10, -10, -10],
        step: 1,
        decimals: 2,
      }),
      positionMax: vectorDefinition(PZ, {
        name: "Max position",
        value: [10, 10, 10],
        step: 1,
        decimals: 2,
      }),
      rotationMin: vectorDefinition(PZ, {
        name: "Min rotation",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      rotationMax: vectorDefinition(PZ, {
        name: "Max rotation",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      scaleMin: vectorDefinition(PZ, {
        name: "Min scale",
        value: [1, 1, 1],
        min: 0.001,
        step: 0.01,
        decimals: 3,
        linkRatio: true,
      }),
      scaleMax: vectorDefinition(PZ, {
        name: "Max scale",
        value: [1, 1, 1],
        min: 0.001,
        step: 0.01,
        decimals: 3,
        linkRatio: true,
      }),
      ...delayDefinitions(PZ),
      pivot: pivotDefinition(PZ),
      ...fieldDefinitions(PZ),
    },
    "random",
    "Random"
  );
}

/* ------------------------------------------------------------- tracking */

// Same UTF-16 unit walk as the native TextGeometry layout so split letters
// sit exactly where the untouched text would.
function getExpressLayout(text, fontData, size, spacing) {
  const data = fontData && typeof fontData === "object" ? fontData : {};
  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
  const characterSpacing = numberValue(spacing, 0);
  const bounds = data.boundingBox || {};
  const lineHeight =
    (numberValue(bounds.yMax, 0) -
      numberValue(bounds.yMin, 0) +
      numberValue(data.underlineThickness, 0)) *
    scale;
  const glyphs = data.glyphs || {};
  const characters = String(text == null ? "" : text).split("");
  const units = [];
  let cursorX = 0;
  let cursorY = 0;
  for (let sourceIndex = 0; sourceIndex < characters.length; sourceIndex += 1) {
    const character = characters[sourceIndex];
    if (character === "\n") {
      cursorX = 0;
      cursorY -= lineHeight;
      continue;
    }
    const glyph = glyphs[character] || glyphs["?"] || null;
    const advance = glyph ? numberValue(glyph.ha, 0) * scale : 0;
    units.push({
      character,
      sourceIndex,
      index: units.length,
      x: cursorX,
      y: cursorY,
      advance,
    });
    cursorX += advance + characterSpacing;
  }
  return { units, count: units.length, lineHeight };
}

function getExpressCenterOffset(bounds, positionMode) {
  if (!bounds || !bounds.min || !bounds.max) return [0, 0, 0];
  const minimum = vector3(bounds.min, [0, 0, 0]);
  const maximum = vector3(bounds.max, [0, 0, 0]);
  const offset = [
    -(minimum[0] + maximum[0]) / 2,
    -(minimum[1] + maximum[1]) / 2,
    -(minimum[2] + maximum[2]) / 2,
  ];
  // Same anchor modes as the native 3D Text: 0 centered, 1/4/6 keep one
  // axis unshifted, 2/3/5 double the shift on one axis.
  switch (Math.round(numberValue(positionMode, 0))) {
    case 1:
      offset[0] = 0;
      break;
    case 2:
      offset[0] *= 2;
      break;
    case 3:
      offset[1] *= 2;
      break;
    case 4:
      offset[1] = 0;
      break;
    case 5:
      offset[2] *= 2;
      break;
    case 6:
      offset[2] = 0;
      break;
    default:
      break;
  }
  return offset;
}

function getExpressTextCenter(bounds, centerOffset) {
  if (!bounds || !bounds.min || !bounds.max) return [0, 0, 0];
  const minimum = vector3(bounds.min, [0, 0, 0]);
  const maximum = vector3(bounds.max, [0, 0, 0]);
  const offset = vector3(centerOffset, [0, 0, 0]);
  return minimum.map(
    (value, index) => (value + maximum[index]) / 2 + offset[index]
  );
}

function propertyValue(property, frame, fallback) {
  if (!property || typeof property.get !== "function") return fallback;
  const value = property.get(frame);
  return value === undefined ? fallback : value;
}

function getAncestorObject(object) {
  if (!object) return null;
  try {
    return object.parentObject || null;
  } catch (_error) {
    return null;
  }
}

// Ancestor layers above a Text, outermost first: the tracking container
// plus every ExpressText+ effector stacked over it. Bails out (returns [])
// when a Text+ container owns the text, so the two trackers never fight.
function collectExpressObjects(textObject) {
  const layers = [];
  const visited = new Set();
  let current = getAncestorObject(textObject);
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    if (current.zoidiumTextPlusObject === true) return [];
    if (current.zoidiumExpressTextObject === true || current.zoidiumExpressEffector) {
      layers.push(current);
    }
    current = getAncestorObject(current);
  }
  layers.reverse();
  return layers;
}

function expressContainerOf(layers) {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    if (layers[i].zoidiumExpressTextObject === true) return layers[i];
  }
  return null;
}

function expressStackOf(layers) {
  const stack = [];
  const seen = new Set();
  const pushLayer = (kind, props, source) => {
    if (!kind || seen.has(props)) return;
    seen.add(props);
    stack.push({ kind, props, source });
  };
  // Ancestor effectors first (outer to inner), then the container's own
  // children in list order: the whole stack lives in the one group, with
  // picker-stacked ancestors still honored.
  for (const layer of layers) {
    if (layer.zoidiumExpressEffector) {
      pushLayer(layer.zoidiumExpressEffector, getExpressProperties(layer), layer);
    }
  }
  const container = expressContainerOf(layers);
  try {
    const children = container && container.objects;
    const count = (children && children.length) || 0;
    for (let i = 0; i < count; i += 1) {
      const child = children[i];
      if (child && child.zoidiumExpressEffector) {
        pushLayer(child.zoidiumExpressEffector, getExpressProperties(child), child);
      }
    }
  } catch (_children) {}
  return stack;
}

function getExpressProperties(container) {
  return container.expressProperties || container.properties || {};
}

function finiteBox(geometry) {
  if (!geometry || typeof geometry.computeBoundingBox !== "function") return null;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (
    !box ||
    !box.min ||
    !box.max ||
    !Number.isFinite(box.min.x) ||
    !Number.isFinite(box.min.y) ||
    !Number.isFinite(box.min.z) ||
    !Number.isFinite(box.max.x) ||
    !Number.isFinite(box.max.y) ||
    !Number.isFinite(box.max.z)
  ) {
    return null;
  }
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

/* ------------------------------------------------- repeater copies */

// Per repeater layer: allocation counts + live row values for this frame.
// The section contributes nothing to letter controls (it multiplies
// geometry instead); the renderer reads these specs to place ghosts.
function repeaterSpecsFor(stack, frame) {
  const out = [];
  for (const layer of stack || []) {
    if (!layer || layer.kind !== "repeater") continue;
    const props = layer.props;
    const enabled = !!numberValue(readProp(props, "repeaterEnable", frame, 1), 1);
    const copies = enabled
      ? Math.max(
          0,
          Math.min(
            REPEATER_MAX_COPIES,
            Math.floor(numberValue(readProp(props, "repeaterCopies", frame, 3), 3))
          )
        )
      : 0;
    out.push({
      layer,
      source: layer.source,
      copies,
      mode: Math.round(numberValue(readProp(props, "repeaterMode", frame, 0), 0)),
      offset: readVector(props, "repeaterOffset", frame, [10, 0, 0]),
      rangeMin: readVector(props, "repeaterRangeMin", frame, [-10, -10, -10]),
      rangeMax: readVector(props, "repeaterRangeMax", frame, [10, 10, 10]),
      seed: readProp(props, "repeaterSeed", frame, 1),
      lag: Math.max(0, numberValue(readProp(props, "repeaterLag", frame, 2), 2)),
      fade: Math.min(
        1,
        Math.max(0, numberValue(readProp(props, "repeaterFade", frame, 50), 50) / 100)
      ),
    });
  }
  return out;
}

// Raw copy offset (unweighted; the caller scales by letter weight):
// Linear steps the Offset per slot, Random scatters deterministically in
// the range volume, Echo smears along the letter's velocity (still
// letters show no spread). slot is 1-based.
function repeaterCopyOffset(spec, letterIndex, slot, velocity) {
  if (spec.mode === 2) {
    const v = velocity || [0, 0, 0];
    return [-v[0] * spec.lag * slot, -v[1] * spec.lag * slot, -v[2] * spec.lag * slot];
  }
  if (spec.mode === 1) {
    const seedInt = Math.round(numberValue(spec.seed, 1) * 1000);
    const out = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      const u = hashLattice(letterIndex, slot * 57 + 11, axis * 131 + 7, seedInt);
      out[axis] = spec.rangeMin[axis] + (spec.rangeMax[axis] - spec.rangeMin[axis]) * u;
    }
    return out;
  }
  return [spec.offset[0] * slot, spec.offset[1] * slot, spec.offset[2] * slot];
}

function repeaterCopyOpacity(spec, slot) {
  if (!(spec.copies > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - spec.fade * (slot / spec.copies)));
}

function copyMeshState(source, target) {
  if (!source || !target) return;
  target.material = source.material;
  target.castShadow = source.castShadow;
  target.receiveShadow = source.receiveShadow;
  target.visible = source.visible;
  target.frustumCulled = source.frustumCulled;
  target.renderOrder = source.renderOrder;
  target.renderDepth = source.renderDepth;
  target.customDepthMaterial = source.customDepthMaterial;
  target.customDistanceMaterial = source.customDistanceMaterial;
  if (source.layers && target.layers) target.layers.mask = source.layers.mask;
}

function createLetterShapes(THREE, font, character, size) {
  const data = font && font.data;
  if (!data) {
    return typeof font?.generateShapes === "function"
      ? font.generateShapes(character, size, 8)
      : [];
  }
  if (!THREE?.ShapePath) return [];
  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
  const glyphs = data.glyphs || {};
  const glyph = glyphs[character] || glyphs["?"];
  if (!glyph || !glyph.o) return [];
  const path = new THREE.ShapePath();
  const outline = glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(" "));
  for (let index = 0; index < outline.length; ) {
    const action = outline[index++];
    const next = (count) => {
      const out = [];
      for (let k = 0; k < count; k += 1) out.push(numberValue(outline[index++], 0) * scale);
      return out;
    };
    if (action === "m") {
      const [x, y] = next(2);
      path.moveTo(x, y);
    } else if (action === "l") {
      const [x, y] = next(2);
      path.lineTo(x, y);
    } else if (action === "q") {
      const [cpx, cpy, cpx1, cpy1] = next(4);
      path.quadraticCurveTo(cpx1, cpy1, cpx, cpy);
    } else if (action === "b") {
      const [cpx, cpy, cpx1, cpy1, cpx2, cpy2] = next(6);
      path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy);
    }
  }
  return path.toShapes();
}

function getSplitState(textObject) {
  let splitState = state.splitStates.get(textObject);
  if (splitState) return splitState;
  splitState = {
    signature: null,
    fullGeometry: null,
    emptyGeometry: null,
    lastExtrudeOptions: null,
    renderRoot: null,
    entries: [],
  };
  state.splitStates.set(textObject, splitState);
  state.splitTexts.add(textObject);
  return splitState;
}

function disposeExpressRendering(splitState) {
  if (!splitState) return;
  if (splitState.renderRoot?.parent) {
    splitState.renderRoot.parent.remove(splitState.renderRoot);
  }
  for (const entry of splitState.entries || []) {
    entry.geometry?.dispose?.();
    for (const copy of entry.copies || []) {
      try {
        if (copy.ownMaterial) copy.mesh.material?.dispose?.();
      } catch (_material) {}
    }
    for (const chunk of entry.chunks || []) {
      try {
        chunk.geometry?.dispose?.();
      } catch (_chunk) {}
    }
  }
  splitState.emptyGeometry?.dispose?.();
  splitState.renderRoot = null;
  splitState.entries = [];
  splitState.signature = null;
  splitState.repeatLayers = null;
  // lastExtrudeOptions survives on purpose: the next build reads it as
  // the fallback when the live mesh holds the empty swap (restore drops
  // the whole state instead).
}

function restoreExpressRendering(textObject) {
  const splitState = state.splitStates.get(textObject);
  if (!splitState) return;
  try {
    if (splitState.fullGeometry && textObject.threeObj) {
      splitState.emptyGeometry?.dispose?.();
      textObject.threeObj.geometry = splitState.fullGeometry;
    }
  } catch (_error) {}
  disposeExpressRendering(splitState);
  state.splitStates.delete(textObject);
  state.splitTexts.delete(textObject);
}

function expressSignature(textObject) {
  try {
    const text = propertyValue(textObject.properties?.text, 0, "");
    const size = propertyValue(textObject.properties?.size, 0, [20, 3]);
    const spacing = propertyValue(textObject.properties?.spacing, 0, 0);
    const font = textObject.font?.font3d;
    // Extrusion and centering ride the signature too: flipping bevel,
    // caps, detail or the center point rebuilds the letters with the
    // source geometry's current options instead of holding stale ones.
    // The preserved last build fills the gaps the empty swap leaves.
    const positionMode = propertyValue(textObject.properties?.positionMode, 0, 0);
    let splitState = null;
    try {
      splitState = state.splitStates.get(textObject) || null;
    } catch (_split) {}
    const extrude = sourceExtrudeOptions(textObject, splitState);
    return JSON.stringify([
      text,
      size,
      spacing,
      !!(font && font.data),
      positionMode,
      extrude,
    ]);
  } catch (_error) {
    return null;
  }
}

// BufferGeometry attribute with three.js version tolerance (r91 uses
// addAttribute, newer uses setAttribute); arrays ride Float32Array.
function setChunkAttribute(THREE, geometry, name, array, itemSize) {
  if (!array || !array.length || !geometry) return;
  try {
    const attribute = new THREE.BufferAttribute(new Float32Array(array), itemSize);
    if (typeof geometry.setAttribute === "function") geometry.setAttribute(name, attribute);
    else if (typeof geometry.addAttribute === "function") geometry.addAttribute(name, attribute);
  } catch (_attr) {}
}

// Flat triangle arrays for the splitter from either geometry flavor:
// live r91 letters are legacy Geometry (vertices/faces/faceVertexUvs),
// newer three (and the tests) hand BufferGeometry attributes. Returns
// { positions, normals, uvs } as plain arrays, or null.
function geometryTriangleArrays(geometry) {
  try {
    const attrs = geometry && geometry.attributes;
    if (attrs && attrs.position && attrs.position.array && attrs.position.array.length) {
      return {
        positions: attrs.position.array,
        normals: attrs.normal && attrs.normal.array ? attrs.normal.array : [],
        uvs: attrs.uv && attrs.uv.array ? attrs.uv.array : [],
      };
    }
    const vertices = geometry && geometry.vertices;
    const faces = geometry && geometry.faces;
    const hasFaces =
      vertices && faces && typeof vertices.length === "number" && typeof faces.length === "number";
    if (!hasFaces || !faces.length) return null;
    const uvLayer = geometry.faceVertexUvs && geometry.faceVertexUvs[0];
    const positions = [];
    const normals = [];
    const uvs = [];
    for (let f = 0; f < faces.length; f += 1) {
      const face = faces[f];
      const index = [face.a, face.b, face.c];
      for (const vi of index) {
        const v = vertices[vi];
        positions.push(v ? v.x : 0, v ? v.y : 0, v ? v.z : 0);
      }
      const vertexNormals =
        face.vertexNormals && face.vertexNormals.length === 3 ? face.vertexNormals : null;
      for (let k = 0; k < 3; k += 1) {
        const n = vertexNormals ? vertexNormals[k] : face.normal;
        normals.push(n ? n.x : 0, n ? n.y : 0, n ? n.z : 0);
      }
      const faceUvs = uvLayer && uvLayer[f];
      for (let k = 0; k < 3; k += 1) {
        const t = faceUvs && faceUvs[k];
        uvs.push(t ? t.x : 0, t ? t.y : 0);
      }
    }
    return { positions, normals, uvs };
  } catch (_geometry) {
    return null;
  }
}

// Euler angles from either a live THREE.Euler (.x/.y/.z/.order) or the
// test fake (.args); [x, y, z, order].
function eulerParts(euler) {
  if (!euler) return [0, 0, 0, "XYZ"];
  if (Array.isArray(euler.args) && euler.args.length >= 3) {
    return [euler.args[0], euler.args[1], euler.args[2], euler.args[3] || "XYZ"];
  }
  return [euler.x || 0, euler.y || 0, euler.z || 0, euler.order || "XYZ"];
}

// Extrude option keys we carry from the source geometry. Scalar-only:
// shapes/fonts stay out so the rebuild signature stays tiny.
const EXTRUDE_OPTION_KEYS = [
  "size",
  "height",
  "amount",
  "depth",
  "curveSegments",
  "detail",
  "steps",
  "bevelEnabled",
  "bevelThickness",
  "bevelSize",
  "bevelSizeInner",
  "bevelShift",
  "bevelSegments",
  "bevelDetail",
  "bevelRound",
  "bevelProfile",
  "bevelTension",
  "bevelOffset",
  "bevelSide",
];

// The source mesh's own extrusion settings for letter geometry, read from
// every shape the live geometry takes: Text+ builds ExtrudeGeometry
// (parameters.options with the full bevel/cap suite), stock TextGeometry
// keeps its construction options under parameters.parameters. The newest
// successful build stays as the final pool: after a build the live mesh
// holds our empty swap, and the signature must keep reading the options
// the letters were built from — never a change.
function sourceExtrudeOptions(textObject, splitState) {
  const out = {};
  try {
    const live =
      textObject && textObject.threeObj && textObject.threeObj.geometry;
    const last =
      splitState && splitState.lastExtrudeOptions;
    const pools = [];
    const params = live && live.parameters;
    if (params && typeof params === "object") {
      pools.push(params.options, params.parameters, params);
    }
    if (last && typeof last === "object") pools.push(last);
    for (const pool of pools) {
      if (!pool || typeof pool !== "object") continue;
      for (const key of EXTRUDE_OPTION_KEYS) {
        if (out[key] === undefined && pool[key] !== undefined) {
          out[key] = pool[key];
        }
      }
    }
    // r91 extrudes by `amount` (from TextGeometry `height`); map it when
    // the pools only carried the other name.
    if (out.amount === undefined && out.height !== undefined) out.amount = out.height;
    if (out.depth === undefined && out.amount !== undefined) out.depth = out.amount;
    // Fixed key order: the signature must read back byte-identical no
    // matter which pool carried each value.
    const normalized = {};
    for (const key of EXTRUDE_OPTION_KEYS) {
      if (out[key] !== undefined) normalized[key] = out[key];
    }
    return normalized;
  } catch (_options) {
    return {};
  }
}

function buildExpressRendering(textObject, splitState, repeatCounts, voronoiSpec) {
  const THREE = state.THREE;
  const sourceMesh = textObject.threeObj;
  const font = textObject.font?.font3d;
  if (!THREE || !sourceMesh || !font) return false;
  disposeExpressRendering(splitState);
  const rawText = propertyValue(textObject.properties?.text, 0, "");
  const rawSize = propertyValue(textObject.properties?.size, 0, [20, 3]);
  const size = Array.isArray(rawSize) ? numberValue(rawSize[0], 20) : 20;
  const depth = Array.isArray(rawSize) ? numberValue(rawSize[1], 3) : 3;
  const spacing = propertyValue(textObject.properties?.spacing, 0, 0);
  const layout = getExpressLayout(rawText, font.data, size, spacing);
  // Extrusion must match the native text exactly: reuse the source
  // geometry's own extrude options (amount/depth, bevel, caps, curve
  // segments) and only fall back to plain defaults when they are
  // unreadable. The picked (pre-default) options snapshot drives the
  // rebuild signature, so post-build frames read back exactly what the
  // build consumed — no key-set drift, no rebuild churn.
  const sourceOptions = sourceExtrudeOptions(textObject, splitState);
  const extrudeOptions = {
    amount: depth,
    depth,
    bevelEnabled: false,
    curveSegments: 6,
  };
  for (const key of Object.keys(sourceOptions)) {
    extrudeOptions[key] = sourceOptions[key];
  }
  const renderRoot = new THREE.Object3D();
  renderRoot.name = "ExpressText letters";
  const pending = [];
  try {
    for (const unit of layout.units) {
      const shapes = createLetterShapes(THREE, font, unit.character, size);
      if (!shapes.length) continue;
      const geometry = new THREE.ExtrudeGeometry(shapes, extrudeOptions);
      const box = finiteBox(geometry);
      if (!box) {
        geometry.dispose?.();
        continue;
      }
      pending.push({ unit, geometry, box });
    }
    if (!pending.length) {
      disposeExpressRendering(splitState);
      return false;
    }
    // Whole-text bounds first, so every anchor carries the native
    // positionMode centering and letters land where the untouched text is.
    const bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    for (const item of pending) {
      const box = item.box;
      bounds.min[0] = Math.min(bounds.min[0], box.min[0] + item.unit.x);
      bounds.min[1] = Math.min(bounds.min[1], box.min[1] + item.unit.y);
      bounds.min[2] = Math.min(bounds.min[2], box.min[2]);
      bounds.max[0] = Math.max(bounds.max[0], box.max[0] + item.unit.x);
      bounds.max[1] = Math.max(bounds.max[1], box.max[1] + item.unit.y);
      bounds.max[2] = Math.max(bounds.max[2], box.max[2]);
      bounds.empty = false;
    }
    const positionMode = propertyValue(textObject.properties?.positionMode, 0, 0);
    const centerOffset = getExpressCenterOffset(bounds, positionMode);
    const entries = [];
    for (const item of pending) {
      const box = item.box;
      const unit = item.unit;
      const cx = (box.min[0] + box.max[0]) / 2;
      const cy = (box.min[1] + box.max[1]) / 2;
      const anchor = new THREE.Object3D();
      anchor.name = `Letter ${unit.index + 1}`;
      anchor.position.set(
        unit.x + cx + centerOffset[0],
        unit.y + cy + centerOffset[1],
        (box.min[2] + box.max[2]) / 2 + centerOffset[2]
      );
      const mesh = new THREE.Mesh(item.geometry, sourceMesh.material);
      mesh.name = unit.character;
      mesh.position.set(-cx, -cy, -(box.min[2] + box.max[2]) / 2);
      copyMeshState(sourceMesh, mesh);
      anchor.add(mesh);
      renderRoot.add(anchor);
      entries.push({
        index: unit.index,
        count: layout.count,
        character: unit.character,
        geometry: item.geometry,
        anchor,
        mesh,
        base: [anchor.position.x, anchor.position.y, anchor.position.z],
        copies: [],
        chunks: [],
        chunkCenter: [cx, cy, (box.min[2] + box.max[2]) / 2],
      });
      // Repeater ghosts: extra meshes sharing the letter geometry, placed
      // per frame by updateExpressRendering. Materials clone once here so
      // per-copy fade never touches the shared source material.
      const copyCounts = Array.isArray(repeatCounts) ? repeatCounts : [];
      const entry = entries[entries.length - 1];
      for (let ri = 0; ri < copyCounts.length; ri += 1) {
        const total = Math.max(
          0,
          Math.min(REPEATER_MAX_COPIES, Math.floor(numberValue(copyCounts[ri], 0)))
        );
        for (let slot = 1; slot <= total; slot += 1) {
          const node = new THREE.Object3D();
          node.name = `Letter ${unit.index + 1} copy ${slot}`;
          const mesh = new THREE.Mesh(item.geometry, sourceMesh.material);
          mesh.name = `${unit.character}#${slot}`;
          mesh.position.set(-cx, -cy, -(box.min[2] + box.max[2]) / 2);
          copyMeshState(sourceMesh, mesh);
          let ownMaterial = false;
          try {
            if (sourceMesh.material && typeof sourceMesh.material.clone === "function") {
              mesh.material = sourceMesh.material.clone();
              mesh.material.transparent = true;
              ownMaterial = true;
            }
          } catch (_clone) {}
          node.add(mesh);
          renderRoot.add(node);
          entry.copies.push({ node, mesh, ownMaterial, ri, slot });
        }
      }
      // Voronoi chunks from the first layer asking for them: partition
      // the letter geometry once here; motion sums per frame below.
      // Chunk meshes share no geometry (each owns its triangles).
      const triangleArrays = voronoiSpec ? geometryTriangleArrays(item.geometry) : null;
      if (triangleArrays && triangleArrays.positions.length >= 9) {
        const cells = splitVoronoiCells(
          triangleArrays.positions,
          triangleArrays.normals,
          triangleArrays.uvs,
          voronoiSpec.chunks,
          voronoiSpec.seed
        );
        const seedInt = Math.round(numberValue(voronoiSpec.seed, 1) * 1000);
        for (let ci = 0; ci < cells.length; ci += 1) {
          const cell = cells[ci];
          const geometry = new THREE.BufferGeometry();
          setChunkAttribute(THREE, geometry, "position", cell.position, 3);
          setChunkAttribute(THREE, geometry, "normal", cell.normal, 3);
          setChunkAttribute(THREE, geometry, "uv", cell.uv, 2);
          const mesh = new THREE.Mesh(geometry, sourceMesh.material);
          mesh.name = `${unit.character}+${ci}`;
          mesh.position.set(-cx, -cy, -(box.min[2] + box.max[2]) / 2);
          copyMeshState(sourceMesh, mesh);
          const node = new THREE.Object3D();
          node.name = `Letter ${unit.index + 1} chunk ${ci}`;
          node.add(mesh);
          renderRoot.add(node);
          entry.chunks.push({
            node,
            mesh,
            geometry,
            center: cell.center,
            sign: [0, 1, 2].map((ax) =>
              hashLattice(ci, unit.index * 131 + ax * 17, seedInt) > 0.5 ? 1 : -1
            ),
          });
        }
      }
    }
    if (sourceMesh.parent) sourceMesh.parent.add(renderRoot);
    else if (sourceMesh.add) sourceMesh.add(renderRoot);
    splitState.fullGeometry = splitState.fullGeometry || sourceMesh.geometry;
    if (!splitState.emptyGeometry && typeof THREE.BufferGeometry === "function") {
      splitState.emptyGeometry = new THREE.BufferGeometry();
    }
    if (splitState.emptyGeometry) sourceMesh.geometry = splitState.emptyGeometry;
    splitState.lastExtrudeOptions = { ...sourceOptions };
    splitState.renderRoot = renderRoot;
    splitState.entries = entries;
    splitState.textCenter = getExpressTextCenter(bounds, centerOffset);
    splitState.signature = expressSignature(textObject);
    return true;
  } catch (_error) {
    disposeExpressRendering(splitState);
    return false;
  }
}

function applyLetterTransform(THREE, node, base, controls, pivotPoint, eulerOrder) {
  const order = PZ_EULER_ORDERS.has(eulerOrder) ? eulerOrder : "XYZ";
  const euler = new THREE.Euler(controls.rotation[0], controls.rotation[1], controls.rotation[2], order);
  const pivot = pivotPoint || base;
  const centered =
    pivot[0] === base[0] && pivot[1] === base[1] && pivot[2] === base[2];
  let v;
  if (centered) {
    // Character pivot: the rotation spins the letter inside its position
    // offset (in place), so scattered letters turn without swinging out
    // of the text. Scale still rides the offset, as before.
    v = new THREE.Vector3(
      pivot[0] + controls.position[0] * controls.scale[0],
      pivot[1] + controls.position[1] * controls.scale[1],
      pivot[2] + controls.position[2] * controls.scale[2]
    );
  } else {
    // Text pivot: orbit about the string center, as before.
    const rot = new THREE.Matrix4().makeRotationFromEuler(euler);
    v = new THREE.Vector3(
      base[0] + controls.position[0] - pivot[0],
      base[1] + controls.position[1] - pivot[1],
      base[2] + controls.position[2] - pivot[2]
    );
    v.applyMatrix4(rot);
    v.set(
      pivot[0] + v.x * controls.scale[0],
      pivot[1] + v.y * controls.scale[1],
      pivot[2] + v.z * controls.scale[2]
    );
  }
  node.matrixAutoUpdate = true;
  node.position.copy(v);
  node.rotation.set(controls.rotation[0], controls.rotation[1], controls.rotation[2], order);
  node.scale.set(
    Math.max(1e-6, controls.scale[0]),
    Math.max(1e-6, controls.scale[1]),
    Math.max(1e-6, controls.scale[2])
  );
}

/* ------------------------------------------------- connected letter run */

// Ordered Text objects under a container (outliner order, descending
// through plain Group wrappers): the connected letter run. Texts count
// wherever they sit — directly under the container or nested in groups.
// Effector instances (flagged), nested ExpressText+ containers and Text+
// owners never count as texts, and their subtrees are skipped entirely.
// Saved/array-like lists normalize via rawArray.
function containerTexts(container) {
  const out = [];
  const visited = new Set();
  const walk = (node, depth) => {
    if (!node || depth > MAX_ANCESTOR_DEPTH || visited.has(node)) return;
    visited.add(node);
    let kids = [];
    try {
      kids = rawArray(node.objects);
    } catch (_kids) {
      return;
    }
    for (const child of kids) {
      if (!child || visited.has(child)) continue;
      if (child.zoidiumExpressTextObject || child.zoidiumExpressEffector) continue;
      if (child.zoidiumTextPlusObject === true) continue;
      if (child.font && child.font.font3d && child.properties && "text" in Object(child.properties)) {
        out.push(child);
        continue;
      }
      walk(child, depth + 1);
    }
  };
  try {
    walk(container, 0);
  } catch (_texts) {}
  return out;
}

// A Text object's own placement for its render root (and for measuring
// its letters in world space). Reads at the given frame so keyframed
// text motion carries.
function ownTransformOf(object, frame) {
  const props = (object && object.properties) || {};
  const order = propertyValue(props.rotationOrder, frame, "XYZ");
  return {
    position: vector3(propertyValue(props.position, frame, [0, 0, 0]), [0, 0, 0]),
    rotation: vector3(propertyValue(props.rotation, frame, [0, 0, 0]), [0, 0, 0]),
    eulerOrder: PZ_EULER_ORDERS.has(order) ? order : "XYZ",
    scale: vector3(propertyValue(props.scale, frame, [1, 1, 1]), [1, 1, 1]),
  };
}

// Compose a child transform through its parent wrapper (XYZ convention,
// like the rest): scale the offset, spin it, then translate.
function throughParent(parent, child) {
  const scaled = [
    child.position[0] * parent.scale[0],
    child.position[1] * parent.scale[1],
    child.position[2] * parent.scale[2],
  ];
  const spun = rotateEulerXYZ(scaled, parent.rotation);
  return {
    position: [
      parent.position[0] + spun[0],
      parent.position[1] + spun[1],
      parent.position[2] + spun[2],
    ],
    rotation: [
      parent.rotation[0] + child.rotation[0],
      parent.rotation[1] + child.rotation[1],
      parent.rotation[2] + child.rotation[2],
    ],
    eulerOrder: child.eulerOrder,
    scale: [
      parent.scale[0] * child.scale[0],
      parent.scale[1] * child.scale[1],
      parent.scale[2] * child.scale[2],
    ],
  };
}

// A text's world placement for its render root: its own transform
// composed through any Group wrappers up to (excluding) the ExpressText
// container. Reads at the given frame so keyframed motion carries.
function textWorldOf(textObject, frame) {
  let world = ownTransformOf(textObject, frame);
  try {
    let current = getAncestorObject(textObject);
    for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      if (current.zoidiumExpressTextObject === true) break;
      if (current.zoidiumTextPlusObject === true) break;
      world = throughParent(ownTransformOf(current, frame), world);
      current = getAncestorObject(current);
    }
  } catch (_ancestors) {}
  return world;
}

function rotateAxisX(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

function rotateAxisY(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

function rotateAxisZ(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

// Layout-space base into world space through a text transform (matches
// the render root application; XYZ convention like the rest).
function worldBaseOf(localBase, world) {
  const l = vector3(localBase, [0, 0, 0]);
  const scaled = [l[0] * world.scale[0], l[1] * world.scale[1], l[2] * world.scale[2]];
  const spun = rotateEulerXYZ(scaled, world.rotation);
  return [world.position[0] + spun[0], world.position[1] + spun[1], world.position[2] + spun[2]];
}

// World-space point back into a text's layout space (inverse transform);
// degenerate zero scales collapse onto the center plane.
function localBaseOf(worldPoint, world) {
  const p = vector3(worldPoint, [0, 0, 0]);
  const dx = p[0] - world.position[0];
  const dy = p[1] - world.position[1];
  const dz = p[2] - world.position[2];
  const unx = rotateAxisX([dx, dy, dz], -world.rotation[0]);
  const uny = rotateAxisY(unx, -world.rotation[1]);
  const unz = rotateAxisZ(uny, -world.rotation[2]);
  return [
    world.scale[0] === 0 ? 0 : unz[0] / world.scale[0],
    world.scale[1] === 0 ? 0 : unz[1] / world.scale[1],
    world.scale[2] === 0 ? 0 : unz[2] / world.scale[2],
  ];
}

// Letter count of a text from layout alone (exact from frame 0, no built
// state needed): missing glyphs still consume an index downstream.
function layoutLetterCount(textObject, frame) {
  try {
    const font = textObject && textObject.font && textObject.font.font3d;
    const data = font && font.data;
    if (!data) return 0;
    const props = (textObject && textObject.properties) || {};
    const rawText = propertyValue(props.text, frame, "");
    const rawSize = propertyValue(props.size, frame, [20, 3]);
    const size = Array.isArray(rawSize) ? numberValue(rawSize[0], 20) : 20;
    const spacing = propertyValue(props.spacing, frame, 0);
    const layout = getExpressLayout(String(rawText == null ? "" : rawText), data, size, spacing);
    const units = layout && layout.units;
    return Array.isArray(units) ? units.length : 0;
  } catch (_layout) {
    return 0;
  }
}

// Connected letter run for a container: continuous numbering across all
// its texts in outliner order, so selections, id/u/count, ranks and
// centers span texts. Counts come from layout (exact from frame 0);
// world bases come from built entries when available (exact in steady
// state; brand-new texts join within a frame).
function containerLetterRun(container, selfText, selfEntries, frame) {
  const fallbackWorld = textWorldOf(selfText, frame);
  if (!selfText) {
    return {
      total: 0,
      order: [],
      starts: [],
      counts: [],
      bases: [],
      extent: null,
      selfStart: 0,
      selfWorld: fallbackWorld,
    };
  }
  const texts = containerTexts(container);
  if (!texts.includes(selfText)) texts.push(selfText);
  const selfWorld = textWorldOf(selfText, frame);
  const starts = [];
  const counts = [];
  let total = 0;
  for (const text of texts) {
    starts.push(total);
    let count = layoutLetterCount(text, frame);
    if (!(count > 0)) {
      try {
        const built = state.splitStates.get(text);
        count = built && built.entries ? built.entries.length : 0;
      } catch (_built) {
        count = 0;
      }
    }
    counts.push(count);
    total += count;
  }
  const order = [];
  for (let i = 0; i < total; i += 1) order.push(i);
  const bases = new Array(total).fill(null);
  const placeEntries = (text, entries, start, world) => {
    for (const entry of entries || []) {
      if (!entry || !entry.base) continue;
      const g = start + entry.index;
      if (g < 0 || g >= total) continue;
      bases[g] = worldBaseOf(entry.base, world);
    }
  };
  const selfAt = texts.indexOf(selfText);
  placeEntries(selfText, selfEntries, starts[selfAt], selfWorld);
  for (let ti = 0; ti < texts.length; ti += 1) {
    if (texts[ti] === selfText) continue;
    let entries = null;
    try {
      const split = state.splitStates.get(texts[ti]);
      entries = split && split.entries;
    } catch (_split) {}
    placeEntries(texts[ti], entries, starts[ti], textWorldOf(texts[ti], frame));
  }
  let extent = null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bases) {
    if (!Array.isArray(b) || !isFinite(b[0])) continue;
    if (b[0] < lo) lo = b[0];
    if (b[0] > hi) hi = b[0];
  }
  if (hi > lo) extent = { lo, hi };
  return { total, order, starts, counts, bases, extent, selfStart: starts[selfAt], selfWorld };
}

function updateExpressRendering(textObject, splitState, layers, frame) {
  const THREE = state.THREE;
  const sourceMesh = textObject.threeObj;
  if (!THREE || !sourceMesh) return;
  const signature = expressSignature(textObject);
  const container = expressContainerOf(layers);
  if (!container) return;
  const containerProps = getExpressProperties(container);
  const stack = stackLayersFor(container, layers);
  const repeaters = repeaterSpecsFor(stack, frame);
  const repeatKey = repeaters.map((r) => r.copies).join(",");
  // Voronoi partition from the first layer asking for chunks; motion
  // sums every layer per frame below. Seed rides the signature so a
  // re-roll rebuilds the cells.
  let voronoiSpec = null;
  for (const layer of stack) {
    if (layer && layer.kind === "voronoi") {
      const chunks = Math.max(
        0,
        Math.min(64, Math.floor(numberValue(readProp(layer.props, "voronoiChunks", frame, 8), 8)))
      );
      if (chunks > 0) {
        voronoiSpec = { chunks, seed: readProp(layer.props, "voronoiSeed", frame, 1) };
        break;
      }
    }
  }
  const voronoiKey = voronoiSpec ? `${voronoiSpec.chunks}:${voronoiSpec.seed}` : "";
  const fullSig = signature == null ? null : `${signature}|repeat:${repeatKey}|voronoi:${voronoiKey}`;
  // Stable section identities (reorder-safe): wrapper layers churn every
  // frame, their source objects do not.
  const refs = repeaters.map((r) => r.source);
  const refsChanged =
    !splitState.repeatLayers ||
    refs.length !== splitState.repeatLayers.length ||
    refs.some((l, i) => l !== splitState.repeatLayers[i]);
  if (!splitState.renderRoot || splitState.signature !== fullSig || refsChanged) {
    if (!buildExpressRendering(textObject, splitState, repeaters.map((r) => r.copies), voronoiSpec)) return;
    splitState.signature = fullSig;
    splitState.repeatLayers = refs;
  }
  // Connected letter run: continuous numbering across every text under
  // this container, so selections, id/u/count, ranks and centers span
  // texts. Single texts resolve to their own local numbering exactly.
  const run = containerLetterRun(container, textObject, splitState.entries, frame);
  const selfWorld = run.selfWorld;
  // The text keeps its own placement: carry the Text object's transform
  // onto its render root so multiple texts compose by position instead
  // of piling on the origin. Reads at the current frame, so keyframed
  // text motion carries its letters.
  try {
    splitState.renderRoot.position.set(
      selfWorld.position[0],
      selfWorld.position[1],
      selfWorld.position[2]
    );
    splitState.renderRoot.rotation.set(
      selfWorld.rotation[0],
      selfWorld.rotation[1],
      selfWorld.rotation[2],
      selfWorld.eulerOrder
    );
    splitState.renderRoot.scale.set(selfWorld.scale[0], selfWorld.scale[1], selfWorld.scale[2]);
  } catch (_rootTransform) {}
  const entries = splitState.entries;
  const globalList = { order: run.order, total: run.total };
  // One shared pivot per frame: when any stacked effector asks for the
  // Text pivot the whole stack rotates/scales about the string center,
  // otherwise each letter turns about its own center.
  let textPivot = false;
  for (const layer of stack) {
    const pivotKey = EFFECTOR_PIVOT_KEYS[layer.kind];
    if (
      pivotKey &&
      Math.round(numberValue(readProp(layer.props, pivotKey, frame, 0), 0)) === 1
    ) {
      textPivot = true;
      break;
    }
  }
  const sharedPivot = textPivot ? splitState.textCenter || [0, 0, 0] : null;
  const aux = {
    extent: run.extent,
    bases: run.bases,
    selfWorld: run.selfWorld,
  };
  for (const entry of entries) {
    copyMeshState(sourceMesh, entry.mesh);
    const globalIndex = run.selfStart + entry.index;
    const controls = evaluateStack(stack, containerProps, frame, globalIndex, globalList, entry.base, aux);
    const order = controls.eulerOrder || "XYZ";
    applyLetterTransform(THREE, entry.anchor, entry.base, controls, sharedPivot || entry.base, order);
    const plainLists = plainListsAt(stack, frame);
    // Echo ghosts trail the letter's motion: sample the previous frame.
    let velocity = null;
    if (entry.copies && entry.copies.length && repeaters.some((r) => r.mode === 2 && r.copies > 0)) {
      const prev = evaluateStack(stack, containerProps, frame - 1, globalIndex, globalList, entry.base, aux);
      velocity = [
        controls.position[0] - prev.position[0],
        controls.position[1] - prev.position[1],
        controls.position[2] - prev.position[2],
      ];
    }
    for (const copy of entry.copies || []) {
      const spec = repeaters[copy.ri];
      const node = copy.node;
      if (!spec) {
        node.visible = false;
        continue;
      }
      const ctx = letterContext(spec.layer.props, "repeater", frame, globalIndex, globalList, plainLists);
      const w = isLetterSelected(ctx.selected, globalIndex)
        ? applyFieldWeight(ctx.strength, spec.layer.props, "repeater", frame, entry.base)
        : 0;
      if (!(w > 0)) {
        node.visible = false;
        continue;
      }
      node.visible = true;
      const raw = repeaterCopyOffset(spec, globalIndex, copy.slot, velocity);
      node.position.set(
        entry.anchor.position.x + raw[0] * w,
        entry.anchor.position.y + raw[1] * w,
        entry.anchor.position.z + raw[2] * w
      );
      node.rotation.copy(entry.anchor.rotation);
      node.scale.copy(entry.anchor.scale);
      if (copy.ownMaterial && copy.mesh.material) {
        const op = repeaterCopyOpacity(spec, copy.slot);
        try {
          if (Math.abs(numberValue(copy.mesh.material.opacity, 1) - op) > 1e-6) {
            copy.mesh.material.opacity = op;
          }
          const wantTransparent = op < 0.999;
          if (!!copy.mesh.material.transparent !== wantTransparent) {
            copy.mesh.material.transparent = wantTransparent;
          }
        } catch (_fade) {}
      }
    }
    if (entry.chunks && entry.chunks.length) {
      // Shatter sums every voronoi layer (shared partition, richer motion).
      let explode = 0;
      const spin = [0, 0, 0];
      let chunkWeight = 0;
      for (const layer of stack) {
        if (!layer || layer.kind !== "voronoi") continue;
        const ctx = letterContext(layer.props, "voronoi", frame, globalIndex, globalList, plainLists);
        if (!isLetterSelected(ctx.selected, globalIndex)) continue;
        const w = applyFieldWeight(ctx.strength, layer.props, "voronoi", frame, entry.base);
        if (!(w > 0)) continue;
        const local = frame - ctx.delay;
        explode += numberValue(readProp(layer.props, "voronoiExplode", local, 0), 0) * w;
        const sv = readVector(layer.props, "voronoiSpin", local, [0, 0, 0]);
        spin[0] += sv[0] * w;
        spin[1] += sv[1] * w;
        spin[2] += sv[2] * w;
        chunkWeight += w;
      }
      const shattered = chunkWeight > 0;
      try {
        entry.mesh.visible = !shattered;
      } catch (_vis) {}
      for (const chunk of entry.chunks) {
        const node = chunk.node;
        if (!shattered) {
          node.visible = false;
          continue;
        }
        node.visible = true;
        const pose = voronoiChunkPose(chunk.center, entry.chunkCenter, explode, spin, chunk.sign);
        node.position.set(
          entry.anchor.position.x + pose.offset[0],
          entry.anchor.position.y + pose.offset[1],
          entry.anchor.position.z + pose.offset[2]
        );
        const baseArgs = eulerParts(entry.anchor.rotation);
        node.rotation.set(
          baseArgs[0] + pose.rotation[0],
          baseArgs[1] + pose.rotation[1],
          baseArgs[2] + pose.rotation[2],
          baseArgs[3]
        );
        node.scale.copy(entry.anchor.scale);
      }
    }
  }
}

function syncExpressRendering(textObject, frame) {
  try {
    const layers = collectExpressObjects(textObject);
    if (!layers.length) {
      if (state.splitStates.get(textObject)) restoreExpressRendering(textObject);
      return;
    }
    updateExpressRendering(textObject, getSplitState(textObject), layers, frame);
  } catch (error) {
    try {
      restoreExpressRendering(textObject);
    } catch (_inner) {}
    console.error("ExpressText+ could not update 3D text", error);
  }
}

/* ------------------------------------------------- container + patching */

function createPropertyCategory(PZ, owner, name, definitions) {
  const properties = new PZ.propertyList(definitions, owner);
  Object.defineProperty(properties, "_zoidiumCategoryName", {
    value: name,
    configurable: true,
  });
  const propertyIndex = owner.children.indexOf(owner.properties);
  owner.children.splice(propertyIndex + 1, 0, properties);
  return properties;
}

function defaultExpressData(data, fallbackName) {
  const input = data && typeof data === "object" ? data : {};
  return {
    properties: { ...(input.properties || {}), name: input.properties?.name ?? fallbackName ?? EXPRESS_TEXT_NAME },
    characterProperties: input.characterProperties || {},
    customProperties: input.customProperties || [],
    objects: input.objects || [],
    expressProperties: input.expressProperties || {},
  };
}

const EXPRESS_SHAKE_TYPE = "zoidium:expresstext-plus/shake";
const EXPRESS_PLAIN_TYPE = "zoidium:expresstext-plus/plain";
const EXPRESS_RANDOM_TYPE = "zoidium:expresstext-plus/random";
const EXPRESS_FORMULA_TYPE = "zoidium:expresstext-plus/formula";
const EXPRESS_SPLINE_TYPE = "zoidium:expresstext-plus/spline";
const EXPRESS_ORBIT_TYPE = "zoidium:expresstext-plus/orbit";
const EXPRESS_REPEATER_TYPE = "zoidium:expresstext-plus/repeater";
const EXPRESS_TWIST_TYPE = "zoidium:expresstext-plus/twist";
const EXPRESS_WRAP_TYPE = "zoidium:expresstext-plus/wrap";
const EXPRESS_VORONOI_TYPE = "zoidium:expresstext-plus/voronoi";
const EXPRESS_DELAY_TYPE = "zoidium:expresstext-plus/delay";

function getExpressDefinitions() {
  return [
    {
      type: EXPRESS_TEXT_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: EXPRESS_TEXT_NAME,
      kind: null,
      objectsName: "Text",
      createProperties: (PZ) => createContainerPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_SHAKE_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Shake",
      kind: "shake",
      objectsName: "Modifiers",
      createProperties: (PZ) => createShakePropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_PLAIN_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Plain",
      kind: "plain",
      objectsName: "Modifiers",
      createProperties: (PZ) => createPlainPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_RANDOM_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Random",
      kind: "random",
      objectsName: "Modifiers",
      createProperties: (PZ) => createRandomPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_FORMULA_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Formula",
      kind: "formula",
      objectsName: "Modifiers",
      createProperties: (PZ) => createFormulaPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_DELAY_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Delay",
      kind: "delay",
      objectsName: "Modifiers",
      createProperties: (PZ) => createDelayPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_SPLINE_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Spline",
      kind: "spline",
      objectsName: "Modifiers",
      createProperties: (PZ) => createSplinePropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_ORBIT_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Orbit",
      kind: "orbit",
      objectsName: "Modifiers",
      createProperties: (PZ) => createOrbitPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_REPEATER_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Repeater",
      kind: "repeater",
      objectsName: "Modifiers",
      createProperties: (PZ) => createRepeaterPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_TWIST_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Twist",
      kind: "twist",
      objectsName: "Modifiers",
      createProperties: (PZ) => createTwistPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_WRAP_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Wrap",
      kind: "wrap",
      objectsName: "Modifiers",
      createProperties: (PZ) => createWrapPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_VORONOI_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Voronoi",
      kind: "voronoi",
      objectsName: "Modifiers",
      createProperties: (PZ) => createVoronoiPropertyDefinitions(PZ),
    },
  ];
}

function createExpressObjectClass(PZ, definition) {
  const propertyDefinitions = definition.createProperties(PZ);

  class ExpressObject extends PZ.object3d.group {
    constructor() {
      super();
      this.objects.name = definition.objectsName;
      // The customs list carries our scoped item class, so the stock +
      // dialog on ExpressText+ containers offers only effectors. The row
      // keeps its stock "Custom properties" label.
      try {
        const itemClass =
          (definition.kind ? null : customPropertyClass(PZ)) ||
          (PZ.property && PZ.property.dynamic);
        if (itemClass && PZ.objectList && this.customProperties) {
          const scoped = new PZ.objectList(this, itemClass);
          scoped.name = "Custom properties";
          const at = this.children.indexOf(this.customProperties);
          try {
            if (at >= 0) this.children.splice(at, 1, scoped);
            else this.children.push(scoped);
          } catch (_splice) {
            this.children.push(scoped);
          }
          this.customProperties = scoped;
        }
      } catch (_scope) {}
      this.expressProperties = createPropertyCategory(
        PZ,
        this,
        "ExpressText",
        propertyDefinitions
      );
      this.type = definition.type;
      // The base group constructor installs its own bound load (with
      // migration handling) which shadows prototype overrides, so hook the
      // post-load work here: orphan effector revive, customs reattach and
      // the ExpressText values load. Untouched data passes through exactly
      // as received.
      try {
        const stockLoad = this.load;
        const self = this;
        this.load = function (data) {
          let loadData = data;
          let stashed = null;
          try {
            const children = rawArray(data && data.objects);
            const rest = [];
            stashed = [];
            for (const child of children) {
              const type = child && child.type;
              if (typeof type === "string" && EFFECTOR_KINDS[type] && newEffectorInstance(type)) {
                stashed.push(child);
              } else {
                rest.push(child);
              }
            }
            if (stashed.length && data && typeof data === "object") {
              loadData = { ...data, objects: rest };
            }
          } catch (_split) {
            stashed = null;
          }
          let out = null;
          try {
            out = typeof stockLoad === "function"
              ? stockLoad.call(self, loadData)
              : PZ.object3d.group.prototype.load.call(self, loadData);
          } catch (_load) {}
          try {
            for (const childData of stashed || []) {
              const instance = newEffectorInstance(childData && childData.type);
              if (instance) {
                const loaded = instance.load(childData);
                if (loaded && typeof loaded.then === "function" && "loading" in instance) {
                  instance.loading = loaded;
                }
                self.objects.push(instance);
              }
            }
          } catch (_revive) {}
          try {
            reattachCustomDefinitions(
              self.customProperties,
              data && data.customProperties
            );
          } catch (_reattach) {}
          try {
            if (self.expressProperties && data && data.expressProperties) {
              self.expressProperties.load(data.expressProperties);
            }
          } catch (_props) {}
          return out;
        };
      } catch (_hook) {}
    }

    toJSON() {
      const data = super.toJSON();
      data.type = definition.type;
      data.schemaVersion = definition.schemaVersion;
      data.expressProperties = this.expressProperties;
      return data;
    }
  }

  ExpressObject.prototype.defaultName = definition.name;
  if (definition.kind) {
    ExpressObject.prototype.zoidiumExpressEffector = definition.kind;
  } else {
    ExpressObject.prototype.zoidiumExpressTextObject = true;
  }
  return ExpressObject;
}

function installTextPatches(PZ) {
  try {
    const text = PZ.object3d && PZ.object3d.text;
    if (!text || !text.prototype || typeof text.prototype.update !== "function") return false;
    if (text.prototype.update.__expressTextPlus) {
      text.prototype.update.__expressTextPlusAlive = true;
      return true;
    }
    const originalUpdate = text.prototype.update;
    const patchedUpdate = function (frame) {
      const out = originalUpdate.call(this, frame);
      try {
        if (!patchedUpdate.__expressTextPlusAlive) return out;
        syncExpressRendering(this, frame);
      } catch (_error) {}
      return out;
    };
    patchedUpdate.__expressTextPlus = true;
    patchedUpdate.__expressTextPlusAlive = true;
    patchedUpdate.__expressTextPlusOriginal = originalUpdate;
    text.prototype.update = patchedUpdate;
    state.textPatched = true;
    state.originalTextUpdate = originalUpdate;

    if (typeof text.prototype.updateGeometry === "function" && !text.prototype.updateGeometry.__expressTextPlus) {
      const originalGeometry = text.prototype.updateGeometry;
      const patchedGeometry = function (...args) {
        const out = originalGeometry.call(this, ...args);
        try {
          // Fresh native geometry just landed (a size/bevel/font row
          // changed): drop our letters so the next sync rebuilds from it.
          // Never swap the stale snapshot back in here — that froze the
          // text at its first-built state.
          const splitState = state.splitStates.get(this);
          if (splitState) disposeExpressRendering(splitState);
        } catch (_error) {}
        return out;
      };
      patchedGeometry.__expressTextPlus = true;
      patchedGeometry.__expressTextPlusOriginal = originalGeometry;
      text.prototype.updateGeometry = patchedGeometry;
      state.originalTextUpdateGeometry = originalGeometry;
    }

    const originalUnload = text.prototype.unload;
    if (typeof originalUnload === "function" && !originalUnload.__expressTextPlus) {
      const patchedUnload = function (...args) {
        try {
          restoreExpressRendering(this);
        } catch (_error) {}
        return originalUnload.call(this, ...args);
      };
      patchedUnload.__expressTextPlus = true;
      text.prototype.unload = patchedUnload;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function restoreTextPatches() {
  try {
    const text = state.PZ?.object3d?.text;
    if (text?.prototype?.update?.__expressTextPlus) {
      if (text.prototype.update.__expressTextPlusOriginal) {
        text.prototype.update = text.prototype.update.__expressTextPlusOriginal;
      }
    }
    if (text?.prototype?.updateGeometry?.__expressTextPlusOriginal) {
      text.prototype.updateGeometry = text.prototype.updateGeometry.__expressTextPlusOriginal;
    }
  } catch (_error) {}
  state.textPatched = false;
  state.originalTextUpdate = null;
  state.originalTextUpdateGeometry = null;
}

/* ------------------------------------------------------------- activation */

function activate(context) {
  if (state.PZ) return;
  const { PZ, window, object3d } = context || {};
  const THREE = window?.THREE;
  if (
    !PZ?.object3d?.group ||
    !PZ.object3d.text ||
    !PZ.property ||
    !THREE?.TextGeometry ||
    !object3d ||
    typeof object3d.registerClass !== "function"
  ) {
    throw new Error("ExpressText+ needs the CM3 3D Text API and Zoidium object registry.");
  }
  state.PZ = PZ;
  state.THREE = THREE || null;
  state.editor = (context && context.editor) || null;
  if (!installTextPatches(PZ)) {
    deactivate();
    throw new Error("ExpressText+ could not install its 3D Text bindings.");
  }
  try {
    for (const definition of getExpressDefinitions()) {
      const ObjectClass = createExpressObjectClass(PZ, definition);
      state.objectClasses.push(ObjectClass);
      if (definition.kind) {
        // Effectors stay private to the single group: constructible
        // through the factory map, invisible to the picker and the
        // global type registry.
        state.effectorClasses[definition.type] = ObjectClass;
        continue;
      }
      state.unregisterObjectClasses.push(
        object3d.registerClass({
          type: definition.type,
          schemaVersion: definition.schemaVersion,
          name: definition.name,
          factory: () => new ObjectClass(),
        })
      );
    }
  } catch (error) {
    deactivate();
    throw error;
  }
  // Effector entries for the stock Custom properties + dialog, scoped to
  // ExpressText+ containers only. Best-effort: without the host registry
  // the customs row keeps the stock five and everything else works.
  registerEffectorEntries(PZ);
  try {
    console.log(
      "[ExpressText+] effector engine v11 (geometry rebuilds follow, never freeze; bundle v10)"
    );
  } catch (_log) {}
}

function deactivate() {
  unregisterEffectorEntries();
  restoreTextPatches();
  for (const textObject of Array.from(state.splitTexts)) {
    try {
      restoreExpressRendering(textObject);
    } catch (_error) {}
  }
  for (const unregister of state.unregisterObjectClasses) {
    try {
      unregister();
    } catch (error) {
      console.error("ExpressText+ could not unregister its container", error);
    }
  }
  state.PZ = null;
  state.THREE = null;
  state.editor = null;
  state.objectClasses = [];
  state.effectorClasses = {};
  state.unregisterObjectClasses = [];
  state.splitStates = new WeakMap();
  state.splitTexts = new Set();
}

module.exports = {
  activate,
  deactivate,
  _test: {
    EXPRESS_TEXT_TYPE,
    EXPRESS_SHAKE_TYPE,
    EXPRESS_PLAIN_TYPE,
    EXPRESS_RANDOM_TYPE,
    EXPRESS_FORMULA_TYPE,
    EXPRESS_SPLINE_TYPE,
    EXPRESS_ORBIT_TYPE,
    EXPRESS_REPEATER_TYPE,
    EXPRESS_TWIST_TYPE,
    EXPRESS_WRAP_TYPE,
    EXPRESS_VORONOI_TYPE,
    EXPRESS_DELAY_TYPE,
    SCHEMA_VERSION,
    FIELD_LABELS,
    DELAY_MODE_LABELS,
    RANDOM_MODE_LABELS,
    RANDOM_SPACE_LABELS,
    SPLINE_MODE_LABELS,
    SPLINE_PATH_LABELS,
    SPLINE_PLANE_LABELS,
    SPLINE_TRANSFORM_LABELS,
    REPEATER_MODE_LABELS,
    REPEATER_MAX_COPIES,
    TWIST_AXIS_LABELS,
    WRAP_DIRECTION_LABELS,
    repeaterSpecsFor,
    repeaterCopyOffset,
    repeaterCopyOpacity,
    rotateEulerXYZ,
    eulerFromBasis,
    rotateAxisX,
    rotateAxisY,
    rotateAxisZ,
    containerTexts,
    textWorldOf,
    ownTransformOf,
    throughParent,
    worldBaseOf,
    localBaseOf,
    layoutLetterCount,
    containerLetterRun,
    DELAY_ORDER_LABELS,
    numberValue,
    vector3,
    parseLetterSelection,
    splitSelectionTokens,
    resolveSelection,
    isLetterSelected,
    selectedList,
    strengthWeight,
    fieldWeight,
    hashSeed,
    seededRandom,
    hashLattice,
    valueNoise3,
    fractalNoise3,
    shuffledStrata,
    randomUnit,
    delayRank,
    shakeValue,
    plainListsAt,
    delayLinkParams,
    chaseToward,
    blankDelayVelocity,
    runDelayLetterStage,
    simulateDelayLetter,
    DELAY_EVEN_SPAN,
    DELAY_BLEND_CATCH,
    DELAY_SPRING_STIFF,
    DELAY_SPRING_DAMP,
    DELAY_SPRING_DAMP_MIN,
    DELAY_SIM_WINDOW,
    blendDelayOutput,
    readProp,
    readVector,
    staticProps,
    blankControls,
    evaluateShake,
    evaluatePlain,
    evaluateRandom,
    evaluateFormula,
    evaluateSpline,
    evaluateOrbit,
    evaluateTwist,
    evaluateWrap,
    sampleSplinePath,
    haltonSequence,
    splitVoronoiCells,
    voronoiChunkPose,
    geometryTriangleArrays,
    eulerParts,
    sourceExtrudeOptions,
    tokenizeFormula,
    parseFormula,
    compileFormula,
    evaluateStack,
    letterContext,
    getExpressLayout,
    getExpressCenterOffset,
    getExpressTextCenter,
    customsChildren,
    sectionGroupOf,
    groupReader,
    kindOfKey,
    kindOfGroup,
    customSections,
    rawArray,
    reattachCustomDefinitions,
    stackLayersFor,
    getSplitState,
    buildExpressRendering,
    disposeExpressRendering,
    restoreExpressRendering,
    applyLetterTransform,
    updateExpressRendering,
    collectExpressObjects,
    expressContainerOf,
    expressStackOf,
    customPropertyClass,
    effectorEntryDefs,
    registerEffectorEntries,
    unregisterEffectorEntries,
    EFFECTOR_ORDER,
    EFFECTOR_NAMES,
    EFFECTOR_TYPES,
    EFFECTOR_KINDS,
    newEffectorInstance,
    getExpressDefinitions,
    createExpressObjectClass,
    evaluateStack,
    EFFECTOR_PIVOT_KEYS,
    getAncestorObject,
    createContainerPropertyDefinitions,
    createShakePropertyDefinitions,
    createPlainPropertyDefinitions,
    createRandomPropertyDefinitions,
    createFormulaPropertyDefinitions,
    createSplinePropertyDefinitions,
    createOrbitPropertyDefinitions,
    createRepeaterPropertyDefinitions,
    createTwistPropertyDefinitions,
    createWrapPropertyDefinitions,
    createVoronoiPropertyDefinitions,
    createDelayPropertyDefinitions,
    defaultExpressData,
    withPrefix,
  },
};
