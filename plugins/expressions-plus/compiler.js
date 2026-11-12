"use strict";

const acorn = require("./vendor/acorn.txt");
const astring = require("./vendor/astring.txt");
const API_NAMES = new Set(("fps value thisProperty thisObject thisLayer thisClip thisSequence thisComp layer effect object prop controls control seedRandom wiggle easeIn easeOut degreesToRadians radiansToDegrees lookAt toWorld fromWorld worldPosition worldRotation toScreen fromScreen").split(" "));
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

// Preview-cache eligibility: `sharedMutation` is true when the expression
// might mutate state that outlives one evaluation (shared realm objects such
// as Math or Array.prototype, the host methods object, or reachable
// prototypes). Evaluation is unchanged; the preview cache only stays off for
// projects containing such an expression, because a retained frame could hide
// later evaluation state. The analysis is intentionally conservative: an
// unknown shape disables caching, while a missed mutation would serve stale
// frames.
//
// A local binding counts as provably fresh only when every value assigned to
// it (its declaration and every later write) is an array, object or function
// literal. `new`, calls and host values are not provable, and a local that is
// ever assigned a non-literal is not fresh. A member write, `delete` or known
// mutating-method call whose receiver is not a provably fresh local flags the
// expression, as does any computed dynamic call on such a receiver and any
// read or write of `__proto__`, `constructor` or `prototype`.
const SHARED_MUTATORS = new Set(("push pop shift unshift splice sort reverse fill copyWithin " +
  "set add delete clear assign defineProperty defineProperties setPrototypeOf freeze seal " +
  "preventExtensions __defineGetter__ __defineSetter__").split(" "));
const OBJECT_TARGET_MUTATORS = new Set("assign defineProperty defineProperties setPrototypeOf freeze seal preventExtensions".split(" "));
const REFLECT_TARGET_MUTATORS = new Set("set deleteProperty defineProperty setPrototypeOf preventExtensions".split(" "));
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const INVOKE_KEYS = new Set(["call", "apply", "bind"]);

function isFreshLiteral(node) {
  return !!node && (node.type === "ArrayExpression" || node.type === "ObjectExpression" ||
    node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration");
}

function unwrapChain(node) {
  while (node && node.type === "ChainExpression") node = node.expression;
  return node;
}

function memberRoot(node) {
  let current = unwrapChain(node);
  while (current && current.type === "MemberExpression") current = unwrapChain(current.object);
  return current;
}

// The statically known property name, or null for a computed dynamic key.
// Reads through a dynamic key (such as `a[i]`) stay eligible; writes and
// calls through one need a provably fresh receiver.
function staticKey(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "Literal" &&
    (typeof member.property.value === "string" || typeof member.property.value === "number")) {
    return String(member.property.value);
  }
  return null;
}

function detectSharedMutation(tree) {
  const scopes = [{ bindings: new Map(), functionBoundary: true }];
  const current = () => scopes[scopes.length - 1];
  const functionScope = () => scopes.findLast(scope => scope.functionBoundary);
  const captureScope = () => scopes.slice();
  const lookupIn = (chain, name) => {
    for (let i = chain.length - 1; i >= 0; i--) {
      const record = chain[i].bindings.get(name);
      if (record) return record;
    }
    return null;
  };
  // A literal is deeply fresh when every value reachable through it is a
  // primitive, a nested literal or a provably fresh local: mutating any part
  // of it then dies with the evaluation. Host values, call results and
  // getters make it shared. Undeclared names are compile-time ReferenceErrors;
  // analysis results for them are discarded with the failed compilation.
  function bindingFresh(record, chain, seen) {
    if (!record || record.tainted || !record.inits.length) return false;
    if (seen.has(record)) return false;
    seen.add(record);
    try { return record.inits.every(init => literalFresh(init, chain, seen)); }
    finally { seen.delete(record); }
  }
  function literalFresh(node, chain, seen) {
    if (!node) return false;
    if (node.type === "ArrayExpression") {
      return (node.elements || []).every(element =>
        !!element && valueFresh(element.type === "SpreadElement" ? element.argument : element, chain, seen));
    }
    if (node.type === "ObjectExpression") {
      return (node.properties || []).every(property => {
        if (!property) return false;
        if (property.type === "SpreadElement") return valueFresh(property.argument, chain, seen);
        // A getter can hand out shared state on every read.
        if (property.kind !== "init") return false;
        return valueFresh(property.value, chain, seen);
      });
    }
    return node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionDeclaration";
  }
  function valueFresh(node, chain, seen) {
    if (!node) return false;
    switch (node.type) {
      case "Literal":
      case "TemplateLiteral":
      case "UnaryExpression":
      case "BinaryExpression":
        return true;
      case "ArrayExpression":
      case "ObjectExpression":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "FunctionDeclaration":
        return literalFresh(node, chain, seen);
      case "ConditionalExpression":
        return valueFresh(node.consequent, chain, seen) && valueFresh(node.alternate, chain, seen);
      case "SequenceExpression": {
        const expressions = node.expressions || [];
        return expressions.length > 0 && valueFresh(expressions[expressions.length - 1], chain, seen);
      }
      case "AssignmentExpression":
        return node.operator === "=" && valueFresh(node.right, chain, seen);
      case "Identifier": {
        const record = lookupIn(chain, node.name);
        if (!record || seen.has(record)) return false;
        return bindingFresh(record, chain, seen);
      }
      default:
        return false;
    }
  }
  const checks = [];
  let flagged = false;
  const flag = () => { flagged = true; };
  const lookupLive = name => lookupIn(scopes, name);
  // Receivers are captured with their scope chain while it is active; the
  // deferred checks below read final freshness after the whole tree is
  // scanned, so a later reassignment from shared state still revokes a use.
  const captureReceiver = node => {
    const root = memberRoot(node);
    if (!root) return { fresh: false };
    if (root.type === "Identifier" || isFreshLiteral(root)) return { root, chain: captureScope() };
    // A primitive root carries no shared mutable state: member writes on it
    // throw deterministically and `delete null?.x` short-circuits to true.
    if (root.type === "Literal" || root.type === "TemplateLiteral") return { fresh: true };
    return { fresh: false };
  };
  const capturedFresh = captured => {
    if (captured.fresh === true) return true;
    if (captured.fresh === false || !captured.root) return false;
    if (captured.root.type === "Identifier") {
      const record = lookupIn(captured.chain, captured.root.name);
      return bindingFresh(record, captured.chain, new Set());
    }
    return literalFresh(captured.root, captured.chain, new Set());
  };
  const captureArgument = captureReceiver;
  function recordAssignment(scope, pattern, init, tainted = false) {
    const chain = captureScope();
    for (const name of names(pattern)) {
      let entry = scope.bindings.get(name);
      if (!entry) { entry = { sawLiteral: false, tainted: false, inits: [] }; scope.bindings.set(name, entry); }
      if (init && isFreshLiteral(init)) { entry.sawLiteral = true; entry.inits.push(init); }
      else if (init || tainted) entry.tainted = true;
    }
    // A destructuring default applies when the source omits the value, so a
    // shared default taints every name bound beside it.
    if (init && pattern && typeof pattern.type === "string") {
      const defaults = [];
      const collect = node => {
        if (!node || typeof node.type !== "string") return;
        if (node.type === "AssignmentPattern") { defaults.push(node.right); collect(node.left); }
        else if (node.type === "RestElement") collect(node.argument);
        else if (node.type === "ArrayPattern") node.elements.forEach(collect);
        else if (node.type === "ObjectPattern") {
          node.properties.forEach(p => {
            if (p.type === "RestElement") collect(p.argument);
            else collect(p.value);
          });
        }
      };
      collect(pattern);
      if (defaults.some(right => !valueFresh(right, chain, new Set()))) {
        for (const name of names(pattern)) scope.bindings.get(name).tainted = true;
      }
    }
  }
  function checkMemberCall(member, firstArgument) {
    const key = staticKey(member);
    // A prototype read on the callee already reaches shared realm state
    // (`f.constructor()`), even before the call itself is classified.
    if (key !== null && PROTOTYPE_KEYS.has(key)) flag();
    if (key === null) {
      const receiver = captureReceiver(member.object);
      checks.push(() => { if (!capturedFresh(receiver)) flag(); });
      return;
    }
    if (SHARED_MUTATORS.has(key)) {
      const receiver = captureReceiver(member.object);
      checks.push(() => { if (!capturedFresh(receiver)) flag(); });
      return;
    }
    if (INVOKE_KEYS.has(key)) {
      // `push.call(list, item)` mutates through an alias. A mutating method
      // reached this way is checked against its own receiver; any other
      // `.call`/`.apply`/`.bind` target cannot be proven safe.
      const inner = unwrapChain(member.object);
      if (inner && inner.type === "MemberExpression") {
        const innerKey = staticKey(inner);
        if (innerKey !== null && SHARED_MUTATORS.has(innerKey)) {
          const innerReceiver = captureReceiver(inner.object);
          checks.push(() => { if (!capturedFresh(innerReceiver)) flag(); });
          return;
        }
      }
      const target = captureArgument(inner);
      checks.push(() => { if (!capturedFresh(target)) flag(); });
      return;
    }
    if ((member.object.type === "Identifier" && (member.object.name === "Object" || member.object.name === "Reflect") &&
      !lookupLive(member.object.name))) {
      // Bare `Object`/`Reflect` are compile-time ReferenceErrors today, so
      // this only guards a future pure binding or a native host of the same
      // shape: mutating statics flag unless their target is provably fresh.
      const targets = member.object.name === "Object" ? OBJECT_TARGET_MUTATORS : REFLECT_TARGET_MUTATORS;
      if (targets.has(key)) {
        const target = captureArgument(firstArgument);
        checks.push(() => { if (!capturedFresh(target)) flag(); });
      }
      // Any other known static only reads. An unknown computed static cannot
      // be proven read-only, but this branch is unreachable while bare
      // `Object`/`Reflect` are compile-time ReferenceErrors.
      else if (key === null) checks.push(flag);
    }
  }
  function scanPatternDefaults(pattern) {
    if (!pattern || typeof pattern.type !== "string") return;
    if (pattern.type === "AssignmentPattern") { scan(pattern.right); scanPatternDefaults(pattern.left); }
    else if (pattern.type === "RestElement") scanPatternDefaults(pattern.argument);
    else if (pattern.type === "ArrayPattern") pattern.elements.forEach(scanPatternDefaults);
    else if (pattern.type === "ObjectPattern") {
      pattern.properties.forEach(p => {
        if (p.type === "RestElement") scanPatternDefaults(p.argument);
        else { if (p.computed) scan(p.key); scanPatternDefaults(p.value); }
      });
    }
  }
  function scanChildren(node) {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(item => { if (item && typeof item.type === "string") scan(item); });
      else if (value && typeof value.type === "string") scan(value);
    }
  }
  function scan(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Identifier" || node.type === "Literal") return;
    if (node.type === "Program" || node.type === "BlockStatement" || node.type === "StaticBlock") {
      scopes.push({ bindings: new Map(), functionBoundary: node.type === "Program" });
      for (const statement of node.body || []) scan(statement);
      scopes.pop();
      return;
    }
    if (node.type === "SwitchStatement") {
      scan(node.discriminant);
      scopes.push({ bindings: new Map(), functionBoundary: false });
      for (const clause of node.cases || []) (clause.consequent || []).forEach(scan);
      scopes.pop();
      return;
    }
    if (/Function/.test(node.type)) {
      (node.params || []).forEach(scanPatternDefaults);
      scopes.push({ bindings: new Map(), functionBoundary: true });
      if (node.id) recordAssignment(current(), node.id, node);
      for (const param of node.params || []) recordAssignment(current(), param, null, true);
      if (node.body) scan(node.body);
      scopes.pop();
      return;
    }
    if (node.type === "VariableDeclaration") {
      const scope = node.kind === "var" ? functionScope() : current();
      for (const declarator of node.declarations || []) {
        scanPatternDefaults(declarator.id);
        recordAssignment(scope, declarator.id, declarator.init);
        scan(declarator.init);
      }
      return;
    }
    if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
      scopes.push({ bindings: new Map(), functionBoundary: false });
      if (node.init?.type === "VariableDeclaration") {
        const scope = node.init.kind === "var" ? functionScope() : current();
        for (const declarator of node.init.declarations || []) {
          scanPatternDefaults(declarator.id);
          recordAssignment(scope, declarator.id, declarator.init);
          scan(declarator.init);
        }
      } else {
        // `for (target of ...)` binds per-iteration values that cannot be
        // proven fresh; `for (init; ...)` may also write its target.
        if (node.left) {
          if (node.left.type === "Identifier") recordAssignment(current(), node.left, null, true);
          else { scanPatternDefaults(node.left); for (const name of names(node.left)) recordAssignment(current(), { type: "Identifier", name }, null, true); }
          scan(node.left);
        }
        scan(node.init);
      }
      scan(node.right);
      scan(node.test);
      scan(node.update);
      scan(node.body);
      scopes.pop();
      return;
    }
    if (node.type === "CatchClause") {
      scanPatternDefaults(node.param);
      scopes.push({ bindings: new Map(), functionBoundary: false });
      if (node.param) recordAssignment(current(), node.param, null, true);
      scan(node.body);
      scopes.pop();
      return;
    }
    if (node.type === "LabeledStatement") { scan(node.body); return; }
    if (node.type === "AssignmentExpression") {
      if (node.left.type === "Identifier") {
        const record = lookupLive(node.left.name);
        if (record) {
          if (isFreshLiteral(node.right)) { record.sawLiteral = true; record.inits.push(node.right); }
          else record.tainted = true;
        } else recordAssignment(current(), node.left, node.right);
      } else if (node.left.type === "MemberExpression" || node.left.type === "ChainExpression") {
        const target = unwrapChain(node.left);
        const receiver = target.type === "MemberExpression" ? captureReceiver(target.object) : { fresh: false };
        checks.push(() => { if (!capturedFresh(receiver)) flag(); });
      } else {
        scanPatternDefaults(node.left);
        for (const name of names(node.left)) recordAssignment(current(), { type: "Identifier", name }, node.right);
      }
      scan(node.left.type === "Identifier" ? null : node.left);
      scan(node.right);
      return;
    }
    if (node.type === "UpdateExpression") {
      const target = unwrapChain(node.argument);
      if (target.type === "MemberExpression") {
        const receiver = captureReceiver(target.object);
        checks.push(() => { if (!capturedFresh(receiver)) flag(); });
        scan(target.object);
        if (target.computed) scan(target.property);
      } else scan(node.argument);
      return;
    }
    if (node.type === "UnaryExpression" && node.operator === "delete") {
      const target = unwrapChain(node.argument);
      if (target.type === "MemberExpression") {
        const receiver = captureReceiver(target.object);
        checks.push(() => { if (!capturedFresh(receiver)) flag(); });
        scan(target.object);
        if (target.computed) scan(target.property);
      } else scan(node.argument);
      return;
    }
    if (node.type === "CallExpression" || node.type === "TaggedTemplateExpression") {
      const callee = node.type === "CallExpression" ? unwrapChain(node.callee) : unwrapChain(node.tag);
      if (callee && callee.type === "MemberExpression") {
        const firstArgument = node.type === "CallExpression" ? (node.arguments || [])[0] : null;
        checkMemberCall(callee, firstArgument);
        scan(callee.object);
        if (callee.computed) scan(callee.property);
      } else scan(node.type === "CallExpression" ? node.callee : node.tag);
      (node.arguments || []).forEach(scan);
      if (node.quasi) scan(node.quasi);
      return;
    }
    if (node.type === "MemberExpression") {
      const key = staticKey(node);
      if (key !== null && PROTOTYPE_KEYS.has(key)) flag();
      scan(node.object);
      if (node.computed) scan(node.property);
      return;
    }
    if (node.type === "ChainExpression") { scan(node.expression); return; }
    if (/Pattern$/.test(node.type)) { scanPatternDefaults(node); return; }
    if (node.type === "Property") {
      if (node.computed) scan(node.key);
      scan(node.value);
      return;
    }
    scanChildren(node);
  }
  scan(tree);
  for (const check of checks) check();
  return flagged;
}

// Bounded per-source cache for preview-cache eligibility. `getMethodNames`
// returns the current host method names; when they change, earlier results
// are dropped because name resolution may have changed with them. Sources
// that no longer compile fail closed.
function createSharedMutationCache(getMethodNames, compileFn = compile) {
  const cache = new Map();
  let stamp = "";
  return function isSharedMutation(source) {
    const methods = getMethodNames(), key = methods.join("\0");
    if (key !== stamp) { cache.clear(); stamp = key; }
    if (cache.has(source)) return cache.get(source);
    let flagged = true;
    try { flagged = !!compileFn(source, methods).needs.sharedMutation; }
    catch (_error) { flagged = true; }
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(source, flagged);
    return flagged;
  };
}

// Extend the same ESTree/astring pipeline as CM3. Only identifier resolution,
// function/loop budgets and dynamic invocation differ from ordinary generation.
function compile(source, methodNames = [], mathNames = Object.getOwnPropertyNames(Math)) {
  const tree = acorn.parse(String(source), { ecmaVersion: "latest", allowReturnOutsideFunction: true });
  const methods = new Set(methodNames), math = new Set(mathNames);
  const root = new Set();
  hoist(tree, root);
  let extended = false;
  const usedMethods = new Set();
  let allMethods = false;
  function reference(node, scopes) {
    const name = node.name;
    if (scopes.some(scope => scope.has(name))) return node;
    if (name.startsWith("__z") || DENIED.has(name) || name === "arguments") throw new ReferenceError(name + " is not defined");
    if (["frame", "time", "methods", "properties"].includes(name)) {
      // Custom properties can return original helper functions too.
      if (name === "methods" || name === "properties") allMethods = true;
      return node;
    }
    // Keep existing CM3/Trapcode names and overloads ahead of the added API.
    if (methods.has(name)) { usedMethods.add(name); return member(id("methods"), name); }
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
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement" || node.type === "LogicalExpression" && node.operator === "??" || node.type === "AssignmentExpression" && ["&&=", "||=", "??="].includes(node.operator) || node.type === "Literal" && (node.bigint !== undefined || /\d_\d/.test(node.raw || "") || /[dv]/.test(node.regex?.flags || ""))) extended = true;
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
      if (node.declarations.some(d => d.id.type !== "Identifier" && names(d.id).length > 0)) extended = true;
      return node;
    }
    if (node.type === "MemberExpression") {
      node.object = visit(node.object, scopes);
      if (node.computed) node.property = visit(node.property, scopes);
      else if (node.property.type === "Identifier" && !scopes.some(scope => scope.has(node.property.name)) && !methods.has(node.property.name) && !math.has(node.property.name) && !["frame", "time", "methods", "properties"].includes(node.property.name)) extended = true;
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
  // The eligibility walk reads the author's own names (`methods.counter`,
  // bare `sin`, `value`); the rewrite below replaces them with realm and
  // helper handles, so it must run on the unvisited tree.
  const sharedMutation = detectSharedMutation(tree);
  visit(tree, [root]);
  const last = tree.body.at(-1);
  if (last?.type === "ExpressionStatement") tree.body[tree.body.length - 1] = { type: "ReturnStatement", argument: last.expression };
  return { code: astring.generate(tree), extended, needs: { full: extended, methods: allMethods ? null : Array.from(usedMethods), sharedMutation } };
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

module.exports = { compile, createSharedMutationCache, sandboxFunction, API_NAMES, PURE_NAMES };
