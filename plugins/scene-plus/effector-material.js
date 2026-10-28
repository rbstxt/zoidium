"use strict";

const OWN_KEYS = new Set(["id", "uuid", "name", "type", "side", "vertexColors", "uniforms",
  "version", "needsUpdate", "userData", "_listeners"]);

function copyMaterialState(original, clone) {
  for (const key of Object.keys(original)) {
    if (OWN_KEYS.has(key)) continue;
    const value = original[key], target = clone[key];
    if (value && target && target !== value && !value.isTexture && typeof target.copy === "function" &&
      value.constructor === target.constructor) target.copy(value);
    else clone[key] = value;
  }
}

function programKey(original) {
  return JSON.stringify([original.defines, original.vertexShader, original.fragmentShader,
    Object.keys(original.uniforms || {}).sort(), original.flatShading, original.transparent,
    original.alphaTest, original.precision, original.skinning, original.morphTargets,
    ["map", "normalMap", "envMap", "bumpMap", "alphaMap", "emissiveMap", "roughnessMap", "metalnessMap",
      "lightMap", "aoMap", "specularMap", "displacementMap", "gradientMap"].map(key => {
      const texture = original[key];
      return texture ? [texture.mapping, texture.encoding, texture.format, texture.type] : null;
    })]);
}

function createFractureMaterials(THREE) {
  function releaseMaterial(mesh, state) {
    if (!state.material) return;
    if (mesh.material === state.material.shown) mesh.material = state.material.original;
    const order = state.material.renderOrder;
    if (order && mesh.renderOrder === order.shown) mesh.renderOrder = order.original;
    for (const clone of state.material.shown) clone.dispose();
    state.material = null;
  }

  function syncMaterial(mesh, state, wantFracture, vertexColors, renderOrderOffset = 0) {
    if (!wantFracture) { releaseMaterial(mesh, state); return; }
    const original = mesh.material === state.material?.shown ? state.material.original : mesh.material;
    if (!original) return;
    const sources = Array.isArray(original) ? original : [original];
    if (!sources.length) { releaseMaterial(mesh, state); return; }
    const capIndex = mesh.geometry.__zoidiumCapMaterialIndex ?? 1;
    if (!state.material || state.material.original !== original || state.material.sources.length !== sources.length ||
      sources.some((source, i) => source !== state.material.sources[i]) || state.material.capIndex !== capIndex) {
      releaseMaterial(mesh, state);
      // Outer groups retain their source material slots. Caps use slot zero's
      // material and yield to the outer surface at equal depth.
      const shown = sources.map(source => source.clone());
      shown[capIndex] = sources[0].clone();
      state.material = { original, sources: sources.slice(), shown, capIndex, signatures: [] };
    }
    const material = state.material;
    if (renderOrderOffset) {
      // Shader and material IDs reflect compilation history. Give opaque
      // fragments a hierarchy order so equal-depth overlaps stay deterministic.
      if (!material.renderOrder || mesh.renderOrder !== material.renderOrder.shown) {
        material.renderOrder = { original: mesh.renderOrder };
      }
      const base = material.renderOrder.original;
      const ordered = sources.every(source => !source.transparent) && Number.isFinite(base);
      mesh.renderOrder = ordered ? base + renderOrderOffset : base;
      material.renderOrder.shown = mesh.renderOrder;
    }
    const hasCaps = mesh.geometry.groups.some(group => group.materialIndex === capIndex && group.count > 0);
    material.shown.forEach((clone, index) => {
      const source = sources[index === capIndex ? 0 : index];
      const key = programKey(source), previous = material.signatures[index];
      const side = index === capIndex || !hasCaps ? THREE.DoubleSide : source.side;
      const colors = Boolean(vertexColors);
      const recompile = !previous || previous.key !== key || previous.version !== source.version ||
        previous.hook !== source.onBeforeCompile || previous.uniforms !== source.uniforms ||
        clone.side !== side || clone.vertexColors !== colors;
      copyMaterialState(source, clone);
      clone.onBeforeCompile = source.onBeforeCompile;
      clone.defines = source.defines;
      clone.side = side;
      clone.vertexColors = colors;
      // Sharing the whole table covers replaced uniforms and new graph inputs.
      // Three r91 caches the compiled uniform list, so schema changes recompile.
      if (source.uniforms) clone.uniforms = source.uniforms;
      if (index === capIndex) {
        clone.polygonOffset = true;
        clone.polygonOffsetFactor = 1;
        clone.polygonOffsetUnits = 1;
      }
      if (recompile) clone.needsUpdate = true;
      material.signatures[index] = { key, version: source.version, hook: source.onBeforeCompile, uniforms: source.uniforms };
    });
    mesh.material = material.shown;
  }
  return { releaseMaterial, syncMaterial };
}

module.exports = { createFractureMaterials };
