"use strict";

module.exports = function createWorldPosition(THREE) {
    const local = THREE.Matrix4 ? new THREE.Matrix4() : null;

    // Three.js r91 has no updateWorldMatrix. Refresh only this ancestor chain.
    // During rendering, reuse the matrices established by WebGLRenderer. A
    // preceding callback can still edit an ancestor's TRS or dirty its matrix.
    function refresh(node, rendered) {
        if (!node) return false;
        const parentChanged = refresh(node.parent, rendered);
        const changedLocal = local && node.matrixAutoUpdate && node.matrix &&
            !local.compose(node.position, node.quaternion, node.scale).equals(node.matrix);
        if (rendered && !parentChanged && !changedLocal && !node.matrixWorldNeedsUpdate) return false;
        if (node.matrixAutoUpdate) node.updateMatrix();
        if (!node.matrix || !node.matrixWorld) return false;
        if (node.parent) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
        else node.matrixWorld.copy(node.matrix);
        node.matrixWorldNeedsUpdate = false;
        return true;
    }

    return function worldPosition(object, rendered) {
        const node = object?.threeObj;
        if (!node) return null;
        if (!rendered && typeof node.updateWorldMatrix === "function") node.updateWorldMatrix(true, false);
        else refresh(node, rendered);
        const e = node.matrixWorld.elements;
        return [e[12], e[13], e[14]];
    };
};
