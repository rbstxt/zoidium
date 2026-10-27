"use strict";

// ExpressText+ Formula micro-language: tokenizer, parser and compiler.

const { numberValue } = require("./expresstext-select.js");

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

module.exports = { FORMULA_ARITY, FORMULA_CONSTANTS, FORMULA_DEG, FORMULA_FUNCTIONS, FORMULA_VARIABLES, compileFormula, evalFormulaNode, formulaCache, parseFormula, tokenizeFormula, validateFormulaAst };
