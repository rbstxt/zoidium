module.exports = {
  activate(context) {
    const { PZ, window, object3d } = context;
    const THREE = window && window.THREE;
    if (!PZ || !THREE || !object3d) {
      throw new Error("Geometry+ requires the Zoidium 3D object registry.");
    }

    const unregister = [];
    const markGeometryDirty = function () {
      if (this.parentObject) this.parentObject.geometryNeedsUpdate = true;
    };

    function numberValue(value, fallback) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }

    function vectorValue(value, fallback) {
      if (!Array.isArray(value)) return fallback.slice();
      return [
        numberValue(value[0], fallback[0]),
        numberValue(value[1], fallback[1]),
        numberValue(value[2], fallback[2]),
      ];
    }

    function integerValue(value, fallback, minimum) {
      return Math.max(minimum, Math.round(numberValue(value, fallback)));
    }

    function createMeshObjectBase() {
      const shapeDefinitions = PZ.object3d.shape.propertyDefinitions;

      return class GeometryObject extends PZ.object3d {
        constructor() {
          super();
          this.threeObj = new THREE.Mesh(new THREE.Geometry(), new THREE.Material());
          this.threeObj.material.visible = false;
          this.threeObj.castShadow = true;
          this.threeObj.receiveShadow = true;
          this.geometryNeedsUpdate = true;
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
          if (this.geometryNeedsUpdate) {
            this.updateGeometry(this.generateGeometry());
            this.geometryNeedsUpdate = false;
          }
          const position = this.properties.position.get(frame);
          const rotation = this.properties.rotation.get(frame);
          const scale = this.properties.scale.get(frame);
          this.threeObj.position.set(position[0], position[1], position[2]);
          this.threeObj.rotation.set(rotation[0], rotation[1], rotation[2]);
          this.threeObj.scale.set(scale[0], scale[1], scale[2]);
          this.threeObj.rotation.order = this.properties.eulerOrder.get(frame);
          if (this.material) this.material.update(frame);
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

        generateGeometry() {
          return new THREE.Geometry();
        }
      };
    }

    const GeometryObject = createMeshObjectBase();

    class RoundedBoxObject extends GeometryObject {
      constructor() {
        super();
        this.properties.addAll({
          size: PZ.property.create({
            dynamic: !0,
            name: "Size",
            type: PZ.property.type.VECTOR3,
            subtitle1: "width",
            subtitle2: "height",
            subtitle3: "depth",
            value: [40, 24, 6],
            min: 0.1,
            step: 1,
            decimals: 1,
            changed: markGeometryDirty,
          }),
          cornerRadius: PZ.property.create({
            dynamic: !0,
            name: "Corner radius",
            type: PZ.property.type.NUMBER,
            value: 3,
            min: 0,
            step: 0.1,
            decimals: 2,
            changed: markGeometryDirty,
          }),
          cornerSegments: PZ.property.create({
            dynamic: !0,
            name: "Corner segments",
            type: PZ.property.type.NUMBER,
            value: 6,
            min: 1,
            max: 32,
            step: 1,
            decimals: 0,
            changed: markGeometryDirty,
          }),
          bevelSize: PZ.property.create({
            dynamic: !0,
            name: "Bevel size",
            type: PZ.property.type.NUMBER,
            value: 0.6,
            min: 0,
            step: 0.1,
            decimals: 2,
            changed: markGeometryDirty,
          }),
          bevelSegments: PZ.property.create({
            dynamic: !0,
            name: "Bevel segments",
            type: PZ.property.type.NUMBER,
            value: 2,
            min: 0,
            max: 8,
            step: 1,
            decimals: 0,
            changed: markGeometryDirty,
          }),
        });
        this.properties.name.set("Rounded Box");
      }

      generateGeometry() {
        const size = vectorValue(this.properties.size.get(), [40, 24, 6]);
        const width = Math.max(0.1, Math.abs(size[0]));
        const height = Math.max(0.1, Math.abs(size[1]));
        const depth = Math.max(0.1, Math.abs(size[2]));
        const radius = Math.min(
          Math.max(0, numberValue(this.properties.cornerRadius.get(), 3)),
          width / 2,
          height / 2
        );
        const cornerSegments = integerValue(
          this.properties.cornerSegments.get(),
          6,
          1
        );
        const bevelLimit = Math.min(width, height, depth) / 2;
        const bevel = Math.min(
          Math.max(0, numberValue(this.properties.bevelSize.get(), 0.6)),
          bevelLimit
        );
        const bevelSegments = integerValue(
          this.properties.bevelSegments.get(),
          2,
          0
        );
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const shape = new THREE.Shape();

        shape.moveTo(-halfWidth + radius, -halfHeight);
        shape.lineTo(halfWidth - radius, -halfHeight);
        shape.quadraticCurveTo(
          halfWidth,
          -halfHeight,
          halfWidth,
          -halfHeight + radius
        );
        shape.lineTo(halfWidth, halfHeight - radius);
        shape.quadraticCurveTo(
          halfWidth,
          halfHeight,
          halfWidth - radius,
          halfHeight
        );
        shape.lineTo(-halfWidth + radius, halfHeight);
        shape.quadraticCurveTo(
          -halfWidth,
          halfHeight,
          -halfWidth,
          halfHeight - radius
        );
        shape.lineTo(-halfWidth, -halfHeight + radius);
        shape.quadraticCurveTo(
          -halfWidth,
          -halfHeight,
          -halfWidth + radius,
          -halfHeight
        );

        const geometry = new THREE.ExtrudeGeometry(shape, {
          amount: depth,
          steps: 1,
          curveSegments: cornerSegments,
          bevelEnabled: bevel > 0 && bevelSegments > 0,
          bevelThickness: bevel,
          bevelSize: bevel,
          bevelSegments,
        });
        geometry.center();
        geometry.computeFaceNormals();
        geometry.computeVertexNormals();
        return geometry;
      }
    }

    class PolyhedronObject extends GeometryObject {
      constructor() {
        super();
        this.properties.addAll({
          shape: PZ.property.create({
            dynamic: !0,
            name: "Shape",
            type: PZ.property.type.OPTION,
            items: "tetrahedron;octahedron;icosahedron;dodecahedron",
            value: 0,
            changed: markGeometryDirty,
          }),
          radius: PZ.property.create({
            dynamic: !0,
            name: "Radius",
            type: PZ.property.type.NUMBER,
            value: 12,
            min: 0.1,
            step: 1,
            decimals: 1,
            changed: markGeometryDirty,
          }),
          detail: PZ.property.create({
            dynamic: !0,
            name: "Detail",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: 0,
            max: 5,
            step: 1,
            decimals: 0,
            changed: markGeometryDirty,
          }),
          shading: PZ.property.create({
            dynamic: !0,
            name: "Shading",
            type: PZ.property.type.OPTION,
            items: "flat;smooth",
            value: 0,
            changed: markGeometryDirty,
          }),
        });
        this.properties.name.set("Polyhedron");
      }

      generateGeometry() {
        const shape = integerValue(this.properties.shape.get(), 0, 0);
        const radius = Math.max(0.1, numberValue(this.properties.radius.get(), 12));
        const detail = Math.min(
          5,
          integerValue(this.properties.detail.get(), 0, 0)
        );
        const constructors = [
          THREE.TetrahedronGeometry,
          THREE.OctahedronGeometry,
          THREE.IcosahedronGeometry,
          THREE.DodecahedronGeometry,
        ];
        const GeometryConstructor = constructors[shape] || constructors[0];
        const geometry = new GeometryConstructor(radius, detail);
        if (integerValue(this.properties.shading.get(), 0, 0) === 0) {
          if (typeof geometry.computeFlatVertexNormals === "function") {
            geometry.computeFlatVertexNormals();
          } else {
            geometry.computeFaceNormals();
          }
        } else {
          geometry.computeVertexNormals();
        }
        geometry.center();
        return geometry;
      }
    }

    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/rounded-box",
        schemaVersion: 1,
        name: "Rounded Box",
        factory: () => new RoundedBoxObject(),
      })
    );
    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/polyhedron",
        schemaVersion: 1,
        name: "Polyhedron",
        factory: () => new PolyhedronObject(),
      })
    );

    this._zoidiumUnregister = unregister;
  },

  deactivate() {
    for (const unregister of this._zoidiumUnregister || []) {
      try {
        unregister();
      } catch (error) {
        console.error("Geometry+ could not unregister a 3D object class", error);
      }
    }
    this._zoidiumUnregister = [];
  },
};
