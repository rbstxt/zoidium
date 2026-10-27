"use strict";

const { normalizeObjectData } = require("./text-plus-utils.js");
const { createPropertyCategory } = require("./text-plus-properties.js");
const { parseCharacterSelection, propertyValue } = require("./text-plus-controls.js");

const TYPE = "zoidium:text-plus/character-material";
const NAME = "Character Material";
let uvLayout = null;

function configure(context) {
  uvLayout = context.getAsset
    ? new Function(context.getAsset("text", "./plugins/material-plus/uv-layout.js"))()()
    : null;
}

function createClass(PZ) {
  class CharacterMaterial extends PZ.object3d.group {
    constructor() {
      super();
      this.type = TYPE;
      this.objects.name = "Text";
      this.characterProperties = createPropertyCategory(PZ, this, "Character", {
        characterNumbers: { name: "Characters", type: PZ.property.type.TEXT, value: "" },
      });
      this.frontMaterials = new PZ.objectSingleton(this, PZ.material);
      this.frontMaterials.name = "Front material";
      this.sideMaterials = new PZ.objectSingleton(this, PZ.material);
      this.sideMaterials.name = "Side material";
      // Append collections to keep native addresses stable across slot edits.
      this.children.push(this.frontMaterials, this.sideMaterials);
    }

    load(data) {
      const normalized = normalizeObjectData(data, TYPE, NAME, 1);
      super.load(normalized);
      this.characterProperties.load(normalized.characterProperties);
      for (const [key, slot] of [["frontMaterial", this.frontMaterials], ["sideMaterial", this.sideMaterials]]) {
        if (!normalized[key]) continue;
        const material = PZ.material.create(normalized[key].type);
        slot.push(material);
        material.loading = material.load(normalized[key]);
      }
    }

    toJSON() {
      return { ...super.toJSON(), type: TYPE, schemaVersion: 1,
        characterProperties: this.characterProperties,
        frontMaterial: this.frontMaterials[0] || null,
        sideMaterial: this.sideMaterials[0] || null };
    }

    async prepare(frame) {
      for (const material of [this.frontMaterials[0], this.sideMaterials[0]]) {
        if (!material) continue;
        await material.loading;
        await material.prepare(frame);
      }
      await super.prepare(frame);
    }

    update(frame) {
      // Materials update first so rebuilt glyphs see current material and UV flags.
      this.frontMaterials[0]?.update(frame);
      this.sideMaterials[0]?.update(frame);
      super.update(frame);
    }

    unload() {
      this.frontMaterials[0]?.unload();
      this.sideMaterials[0]?.unload();
      super.unload();
    }
  }
  CharacterMaterial.prototype.defaultName = NAME;
  CharacterMaterial.prototype.zoidiumTextPlusObject = true;
  CharacterMaterial.prototype.zoidiumTextPlusMode = "character-material";
  return CharacterMaterial;
}

function resolve(layers, frame, index, count) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.zoidiumTextPlusMode !== "character-material") continue;
    const selection = String(propertyValue(layer.characterProperties?.characterNumbers, frame, ""));
    if (selection.trim() && !parseCharacterSelection(selection, count).includes(index)) continue;
    return layer;
  }
  return null;
}

function syncUvs() {
  uvLayout?.syncCharacterMesh(this, this.__zoidiumSourceGeometry || this.geometry);
}

function apply(entry, source, owner) {
  const mesh = entry.mesh;
  if (!mesh) return;
  if (owner) {
    // Keep one array for the glyph's lifetime, including when a slot is replaced.
    const pair = entry.faceMaterials || (entry.faceMaterials = [source, source]);
    pair[0] = owner.frontMaterials[0]?.threeObj || source;
    pair[1] = owner.sideMaterials[0]?.threeObj || source;
    mesh.material = pair;
  }
  // Generated glyphs appear after the native material update. Apply their
  // current layout now, before an effector snapshots them or the first draw.
  // This also restores source UVs when a glyph leaves a material selection.
  mesh.__zoidiumSyncMaterialUvs = syncUvs;
  mesh.__zoidiumSyncMaterialUvs();
}

module.exports = { TYPE, NAME, configure, createClass, resolve, apply };
