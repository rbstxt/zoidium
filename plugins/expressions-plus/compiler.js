"use strict";

const acorn = require("./vendor/acorn.txt");
const astring = require("./vendor/astring.txt");
const API_NAMES = new Set(("value thisProperty thisObject thisLayer thisClip thisSequence thisComp layer effect object prop controls control seedRandom wiggle easeIn easeOut degreesToRadians radiansToDegrees lookAt toWorld fromWorld worldPosition worldRotation toScreen fromScreen").split(" "));
const PURE_NAMES = new Set("Array Number String Boolean parseFloat parseInt isNaN isFinite Infinity NaN undefined JSON Math".split(" "));
const DENIED = new Set("this globalThis window document self top parent parentWindow frames Function eval Date Reflect Proxy WebAssembly Atomics SharedArrayBuffer".split(" "));
const FORBIDDEN = new Set("ThisExpression Super ClassDeclaration ClassExpression ImportDeclaration ExportNamedDeclaration ExportDefaultDeclaration ExportAllDeclaration ImportExpression AwaitExpression YieldExpression WithStatement DebuggerStatement MetaProperty".split(" "));
const id = name => ({ type: "Identifier", name });
const member = (object, name) => ({ type: "MemberExpression", object, property: id(name), computed: false, optional: false });
const helper = name => member(id("__z"), name);
const call = (callee, args) => ({ type: "CallExpression", callee, arguments: args, optional: false });
const tick = () => ({ type: "ExpressionStatement", expression: call(helper("tick"), []) });

function names(pattern, output = []) {
  if (!pattern) return output;
  if (pattern.type === "Identifier") output.push(pattern.name);
  else if (pattern.type === "RestElement") names(pattern.argument, output);
  else if (pattern.type === "AssignmentPattern") names(pattern.left, output);
  else if (pattern.type === "ArrayPattern") pattern.elements.forEach(p => names(p, output));
  else if (pattern.type === "ObjectPattern") pattern.properties.forEach(p => names(p.type === "RestElement" ? p.argument : p.value, output));
  return output;
}

function declare(scope, pattern) {
  for (const name of names(pattern)) {
    if (name.startsWith("__z") || DENIED.has(name) || name === "arguments") {
      throw new ReferenceError("Expression binding is not allowed: " + name);
    }
    scope.add(name);
  }
}

function hoist(node, scope) {
  if (!node || typeof node !== "object") return;
  if (/Function/.test(node.type)) return;
  if (node.type === "VariableDeclaration" && node.kind === "var") node.declarations.forEach(d => declare(scope, d.id));
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(n => hoist(n, scope));
    else if (value && typeof value.type === "string") hoist(value, scope);
  }
}

// Extend the same ESTree/astring pipeline as CM3. Only identifier resolution,
// function/loop budgets and dynamic invocation differ from ordinary generation.
function compile(source, methodNames = [], mathNames = Object.getOwnPropertyNames(Math)) {
  const tree = acorn.parse(String(source), { ecmaVersion: "latest", allowReturnOutsideFunction: true });
  const methods = new Set(methodNames), math = new Set(mathNames);
  const root = new Set();
  hoist(tree, root);
  let extended = false;
  function reference(node, scopes) {
    const name = node.name;
    if (scopes.some(scope => scope.has(name))) return node;
    if (name.startsWith("__z") || DENIED.has(name) || name === "arguments") throw new ReferenceError(name + " is not defined");
    if (["frame", "time", "methods", "properties"].includes(name)) return node;
    // Keep existing CM3/Trapcode names and overloads ahead of the added API.
    if (methods.has(name)) return member(id("methods"), name);
    if (math.has(name)) return member(id("Math"), name);
    if (API_NAMES.has(name)) { extended = true; return member(member(id("__z"), "api"), name); }
    if (PURE_NAMES.has(name)) { extended = true; return member(member(id("__z"), "pure"), name); }
    throw new ReferenceError(name + " is not defined");
  }
  function pattern(node, scopes, assignment = false) {
    if (!node) return node;
    if (node.type === "Identifier") return assignment ? reference(node, scopes) : node;
    if (node.type === "AssignmentPattern") { node.left = pattern(node.left, scopes, assignment); node.right = visit(node.right, scopes); }
    else if (node.type === "RestElement") node.argument = pattern(node.argument, scopes, assignment);
    else if (node.type === "ArrayPattern") node.elements = node.elements.map(p => pattern(p, scopes, assignment));
    else if (node.type === "ObjectPattern") node.properties.forEach(p => {
      if (p.type === "RestElement") p.argument = pattern(p.argument, scopes, assignment);
      else { if (p.computed) p.key = visit(p.key, scopes); p.value = pattern(p.value, scopes, assignment); if (p.value.type !== "Identifier") p.shorthand = false; }
    });
    return node;
  }
  function visit(node, scopes) {
    if (!node || typeof node.type !== "string") return node;
    if (FORBIDDEN.has(node.type)) throw new SyntaxError(node.type + " is not allowed in expressions");
    if (node.type === "Identifier") return reference(node, scopes);
    if (node.type === "AssignmentExpression" && ["ObjectPattern", "ArrayPattern"].includes(node.left.type)) {
      node.left = pattern(node.left, scopes, true);node.right = visit(node.right, scopes);return node;
    }
    if (node.type === "UnaryExpression" && node.operator === "delete" && node.argument.type === "ChainExpression") {
      node.argument.zoidiumDelete = true;return visit(node.argument, scopes);
    }
    if (node.type === "ChainExpression") {
      extended = true;
      const steps = [];
      function flatten(n) {
        if (n.type === "MemberExpression") { const root = flatten(n.object); steps.push(n); return root; }
        if (n.type === "CallExpression") { const root = flatten(n.callee); steps.push(n); return root; }
        return n;
      }
      const initial = visit(flatten(node.expression), scopes);
      const value = id("__zc"), receiver = id("__zr");
      const body = [{ type: "VariableDeclaration", kind: "let", declarations: [{ type: "VariableDeclarator", id: receiver, init: null }] }];
      const assign = (left, right) => ({ type: "ExpressionStatement", expression: { type: "AssignmentExpression", operator: "=", left, right } });
      for (const step of steps) {
        if (step.optional) body.push({ type: "IfStatement", test: { type: "BinaryExpression", operator: "==", left: value, right: { type: "Literal", value: null } }, consequent: { type: "ReturnStatement", argument: node.zoidiumDelete ? { type: "Literal", value: true } : null }, alternate: null });
        if (step.type === "MemberExpression") {
          body.push(assign(receiver, value));
          const access = { ...step, object: value, property: step.computed ? visit(step.property, scopes) : step.property, optional: false };
          body.push(assign(value, node.zoidiumDelete && step === steps.at(-1) ? { type: "UnaryExpression", operator: "delete", prefix: true, argument: access } : access));
        } else {
          body.push(assign(value, call(helper("invoke"), [value, receiver, { type: "ArrayExpression", elements: step.arguments.map(a => visit(a, scopes)) }])));
          body.push(assign(receiver, { type: "UnaryExpression", operator: "void", prefix: true, argument: { type: "Literal", value: 0 } }));
        }
      }
      body.push({ type: "ReturnStatement", argument: node.zoidiumDelete && steps.at(-1)?.type !== "MemberExpression" ? { type: "Literal", value: true } : value });
      return call({ type: "ArrowFunctionExpression", params: [value], body: { type: "BlockStatement", body }, async: false, expression: false }, [initial]);
    }
    if (/Function/.test(node.type)) {
      if (node.async || node.generator) throw new SyntaxError("Async and generator functions are not allowed in expressions");
      extended = true;
      const scope = new Set();
      if (node.id) declare(scope, node.id);
      node.params.forEach(p => declare(scope, p));
      hoist(node.body, scope);
      const inner = [scope, ...scopes];
      node.params = node.params.map(p => pattern(p, inner));
      if (node.body.type !== "BlockStatement") {
        node.body = { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: node.body }] };
        node.expression = false;
      }
      node.body = visit(node.body, inner);
      node.body.body.unshift(tick());
      return node;
    }
    if (node.type === "Program" || node.type === "BlockStatement" || node.type === "SwitchStatement") {
      const scope = new Set();
      const statements = node.body || node.cases.flatMap(c => c.consequent);
      for (const s of statements) {
        if (s.type === "VariableDeclaration" && s.kind !== "var") s.declarations.forEach(d => declare(scope, d.id));
        if (s.type === "FunctionDeclaration") declare(scope, s.id);
      }
      const inner = [scope, ...scopes];
      if (node.type === "SwitchStatement") { node.discriminant = visit(node.discriminant, scopes); node.cases = node.cases.map(c => visit(c, inner)); }
      else node.body = node.body.map(n => visit(n, inner));
      return node;
    }
    if (/^(For|While|DoWhile)/.test(node.type)) {
      const scope = new Set(), decl = node.init || node.left;
      if (decl?.type === "VariableDeclaration") decl.declarations.forEach(d => declare(scope, d.id));
      const inner = [scope, ...scopes];
      for (const key of ["init", "left", "right", "test", "update", "body"]) if (node[key]) node[key] = visit(node[key], inner);
      if (node.body.type !== "BlockStatement") node.body = { type: "BlockStatement", body: [node.body] };
      node.body.body.unshift(tick());
      return node;
    }
    if (node.type === "CatchClause") {
      const scope = new Set(); declare(scope, node.param);
      node.param = pattern(node.param, [scope, ...scopes]); node.body = visit(node.body, [scope, ...scopes]); return node;
    }
    if (node.type === "VariableDeclaration") {
      if (node.kind !== "var") extended = true;
      for (const d of node.declarations) { d.id = pattern(d.id, scopes); d.init = visit(d.init, scopes); }
      return node;
    }
    if (node.type === "MemberExpression") {
      node.object = visit(node.object, scopes);
      if (node.computed) node.property = visit(node.property, scopes);
      return node;
    }
    if (node.type === "Property") {
      if (node.computed) node.key = visit(node.key, scopes);
      node.value = visit(node.value, scopes);
      if (node.shorthand && node.value.type !== "Identifier") node.shorthand = false;
      return node;
    }
    if (["CallExpression", "NewExpression", "TaggedTemplateExpression"].includes(node.type)) {
      const key = node.type === "TaggedTemplateExpression" ? "tag" : "callee";
      let target = visit(node[key], scopes);
      // A proxy at the receiver preserves getters, evaluation order, method
      // `this` and optional-chain short circuiting without reading a member twice.
      if (target.type === "MemberExpression") target.object = call(helper("receiver"), [target.object]);
      else target = call(helper("guard"), [target]);
      node[key] = target;
      if (node.arguments) node.arguments = node.arguments.map(n => visit(n, scopes));
      if (node.quasi) node.quasi = visit(node.quasi, scopes);
      return node;
    }
    if (["BreakStatement", "ContinueStatement"].includes(node.type)) return node;
    if (node.type === "LabeledStatement") { node.body = visit(node.body, scopes); return node; }
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) node[key] = value.map(n => n?.type ? visit(n, scopes) : n);
      else if (value?.type) node[key] = visit(value, scopes);
    }
    return node;
  }
  visit(tree, [root]);
  const last = tree.body.at(-1);
  if (last?.type === "ExpressionStatement") tree.body[tree.body.length - 1] = { type: "ReturnStatement", argument: last.expression };
  return { code: astring.generate(tree), extended };
}

function sandboxFunction(doc, code) {
  const iframe = doc.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  doc.body.appendChild(iframe);
  let Factory, globals;
  try { Factory = iframe.contentWindow.Function; globals = Object.keys(iframe.contentWindow); }
  finally { iframe.remove(); }
  const fn = Factory("frame", "time", "methods", "properties", "Math", "__z", ...globals.filter(n => !["frame", "time", "methods", "properties", "Math", "__z"].includes(n)), code);
  // Preserve intrinsic identity: sin.constructor and [].constructor.constructor
  // belong to the same detached realm, just as they do in CM3.
  fn.zoidiumPure = Factory("return {Array, Number, String, Boolean, parseFloat, parseInt, isNaN, isFinite, Infinity, NaN, undefined, JSON, Math}")();
  fn.zoidiumPure.Math.random = () => { throw new Error("Expression Math.random is unavailable; use seeded random()"); };
  return fn;
}

module.exports = { compile, sandboxFunction, API_NAMES, PURE_NAMES };
