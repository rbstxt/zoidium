"use strict";

// Geometry+ mesh object base: the shared dirty-flag helper, PZ-bound
// property factories, flat/smooth shading, and the GeometryObject class
// (transform properties, material ownership, geometry refresh) that every
// Geometry+ shape extends.

const { integerValue, markGeometryDirty } = require("./geometry-helpers.js");

function numericProperty(PZ, definition) {
  return PZ.property.create({
    ...definition,
    dynamic: true,
    changed: markGeometryDirty,
  });
}

function optionProperty(PZ, definition) {
  return PZ.property.create({
    ...definition,
    dynamic: true,
    changed: markGeometryDirty,
  });
}

function shadingProperty(PZ) {
  return optionProperty(PZ, {
    name: "Shading",
    type: PZ.property.type.OPTION,
    items: "flat;smooth",
    value: 0,
  });
}

function applyShading(geometry, shading) {
  if (!geometry) return geometry;
  if (integerValue(shading, 0, 0) === 0) {
    if (typeof geometry.computeFlatVertexNormals === "function") {
      geometry.computeFlatVertexNormals();
    } else {
      geometry.computeFaceNormals();
    }
  } else {
    geometry.computeVertexNormals();
  }
  return geometry;
}

function createMeshObjectBase(PZ, THREE) {
  const shapeDefinitions = PZ.object3d.shape.propertyDefinitions;

  return class GeometryObject extends PZ.object3d {
    constructor() {
      super();
      this.threeObj = new THREE.Mesh(new THREE.Geometry(), new THREE.Material());
      this.threeObj.material.visible = false;
      this.threeObj.castShadow = true;
      this.threeObj.receiveShadow = true;
      this.geometryNeedsUpdate = true;
      this._geometrySignature = undefined;
      this.materials = new PZ.objectSingleton(this, PZ.material);
      this.properties.addAll({
        position: PZ.property.create(shapeDefinitions.position),
        rotation: PZ.property.create(shapeDefinitions.rotation),
        scale: PZ.property.create(shapeDefinitions.scale),
        eulerOrder: PZ.property.create(shapeDefinitions.eulerOrder),
      });
      this.children.push(this.materials);
    }

    get material() {
      return this.materials[0];
    }

    load(data) {
      this.properties.load(data && data.properties);
      if (data && data.material) {
        const material = PZ.material.create(data.material.type);
        this.materials.push(material);
        material.loading = material.load(data.material);
      }
      if (!this.material) {
        const material = PZ.material.create("singlecolor");
        this.materials.push(material);
        material.loading = material.load();
      }
      this.geometryNeedsUpdate = true;
      this._geometrySignature = undefined;
      this.parentChanged();
    }

    toJSON() {
      return {
        type: this.type,
        schemaVersion: 1,
        properties: this.properties,
        material: this.material,
      };
    }

    unload() {
      if (this.threeObj && this.threeObj.geometry) {
        this.threeObj.geometry.dispose();
        this.threeObj.geometry = null;
      }
      if (this.material) this.material.unload();
    }

    update(frame) {
      const currentFrame = Number.isFinite(Number(frame)) ? Number(frame) : 0;
      const geometrySignature = this.getGeometrySignature(currentFrame);
      if (
        this.geometryNeedsUpdate ||
        geometrySignature !== this._geometrySignature
      ) {
        this.updateGeometry(this.generateGeometry(currentFrame));
        this._geometrySignature = geometrySignature;
        this.geometryNeedsUpdate = false;
      }
      const position = this.properties.position.get(currentFrame);
      const rotation = this.properties.rotation.get(currentFrame);
      const scale = this.properties.scale.get(currentFrame);
      this.threeObj.position.set(position[0], position[1], position[2]);
      this.threeObj.rotation.set(rotation[0], rotation[1], rotation[2]);
      this.threeObj.scale.set(scale[0], scale[1], scale[2]);
      this.threeObj.rotation.order = this.properties.eulerOrder.get(currentFrame);
      if (this.material) this.material.update(currentFrame);
    }

    async prepare(frame) {
      if (!this.material) return;
      await this.material.loading;
      await this.material.prepare(frame);
    }

    updateGeometry(geometry) {
      if (!this.threeObj) return;
      if (this.threeObj.geometry) this.threeObj.geometry.dispose();
      this.threeObj.geometry = geometry || new THREE.Geometry();
      this.threeObj.geometry.buffersNeedUpdate = true;
    }

    getGeometrySignature() {
      return null;
    }

    generateGeometry() {
      return new THREE.Geometry();
    }
  };
}
module.exports = {
  numericProperty,
  optionProperty,
  shadingProperty,
  applyShading,
  createMeshObjectBase,
};
