"use strict";
// A vector expression overrides its component expressions and keys.
function expressionOwner(property) {
  let owner = property.expression ? property : null;
  for (let parent = property.parent; parent; parent = parent.parent) {
    if (parent.objects?.includes(property) && parent.expression) owner = parent;
  }
  return owner;
}
function expressionOf(property) { return expressionOwner(property)?.expression || null; }
function evaluatedValue(property, frame) {
  const owner = expressionOwner(property);
  if (!owner || owner === property) return property.get(frame);
  return owner.get(frame)?.[owner.objects.indexOf(property)];
}
module.exports = { expressionOf, evaluatedValue };
