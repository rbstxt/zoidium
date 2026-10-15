"use strict";

// The character transform from a9007ee^, before Text scale compensation.
// Keep S above the complete character hierarchy, including a singular S.
function keepNativeScale(textObject, splitState, textScale) {
  textObject.threeObj?.scale?.set(...textScale);
  splitState.textScale = [1, 1, 1];
  return splitState.textScale;
}

function applyCharacterTransform(node, controls, textPlus, textPivot, helpers) {
  const { getCharacterTransformReference, applyReferenceSpaceCharacterTransform, THREE, PZ_EULER_ORDERS } = helpers;
  const { pivotObject, referenceObject } = getCharacterTransformReference(
    textPlus,
    controls,
    textPivot
  );
  if (
    (textPlus?.zoidiumTextPlusMode === "random-scatter" || pivotObject) &&
    applyReferenceSpaceCharacterTransform(
      THREE,
      node,
      controls,
      referenceObject,
      pivotObject
    )
  ) {
    return;
  }

  node.matrixAutoUpdate = true;
  node.position.set(...controls.position);
  node.scale.set(...controls.scale);
  const order = PZ_EULER_ORDERS.has(controls.eulerOrder)
    ? controls.eulerOrder
    : "XYZ";
  node.rotation.set(
    controls.rotation[0],
    controls.rotation[1],
    controls.rotation[2],
    order
  );

  const axis = node.zoidiumTextPlusAxis;
  axis.set(...controls.shakeAxis);
  if (axis.lengthSq() > 1e-12 && controls.shake !== 0) {
    node.rotateOnAxis(axis.normalize(), controls.shake);
  }
}

module.exports = { applyCharacterTransform, keepNativeScale };
