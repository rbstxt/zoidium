"use strict";
const { T } = require("./kinds.js");
const copy = value => JSON.parse(JSON.stringify(value));
function resetProperty(ops, property, value) {
  const d = property.definition;
  value = d.zoidiumShader?.default ?? value ?? d.value;
  if (property.expression) ops.setExpression({ property: property.getAddress(), expression: null });
  if (property.objects) {
    property.objects.forEach((child, index) => resetProperty(ops, child, Array.isArray(value) ? value[index] : undefined));
    return;
  }
  ops.reset(property);
  if (value !== undefined) ops.setValue({ property: property.getAddress(), frame: 0, value: d.type === T.OPTION ? String(value) : copy(value) });
}
function installReset({ context, patch }) {
  const { PZ, editor: CM } = context;
  const shaderProperties = list => list instanceof PZ.propertyList && list.parent instanceof PZ.effect.shader && list.parent.properties === list;
  patch(PZ.ui.properties.prototype, "resetAll", original => function (list) {
    if (!shaderProperties(list)) return original.apply(this, arguments);
    for (const property of list) if (property !== list.fragShader) this.reset(property);
  });
  function resetCustom(effect, ops = new PZ.ui.properties(CM)) {
    if (CM.history.operation !== null) return false;
    CM.history.startOperation();
    try {
      for (const property of effect.customProperties) resetProperty(ops, property);
      CM.history.finishOperation();
    } catch (error) {
      for (const command of CM.history.operation.slice().reverse()) command.execute();
      CM.history.discardOperation(); throw error;
    }
    CM.project.ui?.onChanged?.update(); CM.mainViewport?.requestRender?.();
    return true;
  }
  patch(PZ.ui.edit.prototype, "generateItemCommands", original => function (row, list) {
    const result = original.apply(this, arguments);
    if (list instanceof PZ.objectList && list.parent instanceof PZ.effect.shader && list.parent.customProperties === list && !this.options.hideAllListItemButtons) {
      const button = this.generateButton("reset");
      button.title = "Reset custom properties to defaults"; button.setAttribute("aria-label", button.title);
      button.onclick = event => { event.stopPropagation(); resetCustom(list.parent, this.propertyOps); };
      row.children[1].prepend(button);
    }
    return result;
  });
  return { resetCustom };
}
module.exports = { installReset, resetProperty };
