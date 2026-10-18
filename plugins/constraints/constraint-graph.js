"use strict";

// Evaluation order for constraints in one scene.
//
// A constraint reads its target's world position and its own world position,
// and it writes the constrained object's local rotation. The rotation of an
// object never moves that object, but it moves all of its descendants. So a
// constraint on A depends on every constrained strict ancestor of A and on
// every constrained strict ancestor of A's target. An object tracking its own
// descendant depends on itself.
//
// orderConstraints() returns the constraints in a valid order and the set of
// constraints that take part in a cycle. Cyclic constraints are skipped; the
// rest are still evaluated (with the skipped ones left unconstrained).

// nodes: [{ key, deps: [key, ...] }] in authored (depth-first) order.
function orderConstraints(nodes) {
  const byKey = new Map();
  for (const node of nodes) byKey.set(node.key, node);
  const cyclic = findCyclicKeys(nodes, byKey);

  const order = [];
  const state = new Map(); // key -> 1 visiting, 2 done
  function visit(key) {
    if (state.get(key) === 2 || cyclic.has(key)) return;
    state.set(key, 1);
    const node = byKey.get(key);
    for (const dep of node.deps) {
      if (byKey.has(dep) && !cyclic.has(dep) && state.get(dep) !== 1) visit(dep);
    }
    state.set(key, 2);
    order.push(key);
  }
  for (const node of nodes) visit(node.key);
  return { order, cyclic };
}

// Tarjan's strongly connected components, iterative so deep hierarchies
// cannot overflow the stack. A component is cyclic when it has more than one
// member or its single member depends on itself.
function findCyclicKeys(nodes, byKey) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const cyclic = new Set();

  for (const root of nodes) {
    if (indices.has(root.key)) continue;
    const work = [{ key: root.key, next: 0 }];
    indices.set(root.key, index);
    lowlink.set(root.key, index);
    index += 1;
    stack.push(root.key);
    onStack.add(root.key);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const deps = byKey.get(frame.key).deps.filter((dep) => byKey.has(dep));
      if (frame.next < deps.length) {
        const dep = deps[frame.next];
        frame.next += 1;
        if (!indices.has(dep)) {
          indices.set(dep, index);
          lowlink.set(dep, index);
          index += 1;
          stack.push(dep);
          onStack.add(dep);
          work.push({ key: dep, next: 0 });
        } else if (onStack.has(dep)) {
          lowlink.set(frame.key, Math.min(lowlink.get(frame.key), indices.get(dep)));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].key;
        lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(frame.key)));
      }
      if (lowlink.get(frame.key) === indices.get(frame.key)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.key);
        const selfLoop = component.length === 1 && byKey.get(member).deps.includes(member);
        if (component.length > 1 || selfLoop) {
          for (const key of component) cyclic.add(key);
        }
      }
    }
  }
  return cyclic;
}

// Dependencies of one constraint, given parent lookups.
//   parentOf(object) -> parent object or null
//   isConstrained(object) -> boolean
function constraintDependencies(object, target, parentOf, isConstrained) {
  const deps = new Set();
  for (const start of [object, target]) {
    let current = start ? parentOf(start) : null;
    let guard = 0;
    while (current && guard < 10000) {
      if (isConstrained(current)) deps.add(current);
      current = parentOf(current);
      guard += 1;
    }
  }
  return Array.from(deps);
}

function isAncestor(candidate, object, parentOf) {
  let current = object ? parentOf(object) : null;
  let guard = 0;
  while (current && guard < 10000) {
    if (current === candidate) return true;
    current = parentOf(current);
    guard += 1;
  }
  return false;
}

module.exports = { orderConstraints, findCyclicKeys, constraintDependencies, isAncestor };
