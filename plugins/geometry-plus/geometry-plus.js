module.exports = {
  activate(context) {
    const { PZ, window, object3d } = context;
    const THREE = window && window.THREE;
    if (!PZ || !THREE || !object3d) {
      throw new Error("Geometry+ requires the Zoidium 3D object registry.");
    }

    const unregister = [];
    const markGeometryDirty = function () {
      if (this.parentObject) {
        this.parentObject.geometryNeedsUpdate = true;
        this.parentObject._geometrySignature = undefined;
      }
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

    function numericProperty(definition) {
      return PZ.property.create({
        ...definition,
        dynamic: true,
        changed: markGeometryDirty,
      });
    }

    function optionProperty(definition) {
      return PZ.property.create({
        ...definition,
        dynamic: true,
        changed: markGeometryDirty,
      });
    }

    function shadingProperty() {
      return optionProperty({
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

    function createLatheProfileGeometry(profile, radialSegments) {
      const geometry = new THREE.Geometry();
      const rings = [];
      const segmentCount = Math.max(3, radialSegments);

      for (const entry of profile) {
        const radius = Math.max(0, numberValue(entry.radius, 0));
        const y = numberValue(entry.y, 0);
        if (radius <= 1e-6) {
          rings.push({ pole: geometry.vertices.length });
          geometry.vertices.push(new THREE.Vector3(0, y, 0));
          continue;
        }

        const ring = [];
        for (let index = 0; index <= segmentCount; index += 1) {
          const angle = (Math.PI * 2 * index) / segmentCount;
          ring.push(geometry.vertices.length);
          geometry.vertices.push(
            new THREE.Vector3(
              radius * Math.cos(angle),
              y,
              radius * Math.sin(angle)
            )
          );
        }
        rings.push({ ring });
      }

      for (let profileIndex = 0; profileIndex < rings.length - 1; profileIndex += 1) {
        const lower = rings[profileIndex];
        const upper = rings[profileIndex + 1];
        if (lower.pole != null && upper.ring) {
          for (let index = 0; index < segmentCount; index += 1) {
            geometry.faces.push(
              new THREE.Face3(
                lower.pole,
                upper.ring[index],
                upper.ring[index + 1]
              )
            );
          }
        } else if (lower.ring && upper.pole != null) {
          for (let index = 0; index < segmentCount; index += 1) {
            geometry.faces.push(
              new THREE.Face3(
                upper.pole,
                lower.ring[index + 1],
                lower.ring[index]
              )
            );
          }
        } else if (lower.ring && upper.ring) {
          for (let index = 0; index < segmentCount; index += 1) {
            geometry.faces.push(
              new THREE.Face3(
                lower.ring[index],
                upper.ring[index],
                upper.ring[index + 1]
              ),
              new THREE.Face3(
                lower.ring[index],
                upper.ring[index + 1],
                lower.ring[index + 1]
              )
            );
          }
        }
      }

      geometry.computeFaceNormals();
      geometry.computeVertexNormals();
      return geometry;
    }

    function createHollowCylinderGeometry(
      outerRadius,
      innerRadius,
      height,
      radialSegments,
      capped
    ) {
      const geometry = new THREE.Geometry();
      const segmentCount = Math.max(3, radialSegments);
      const halfHeight = height / 2;
      const rings = [];

      function addRing(radius, y) {
        const ring = [];
        for (let index = 0; index <= segmentCount; index += 1) {
          const angle = (Math.PI * 2 * index) / segmentCount;
          ring.push(geometry.vertices.length);
          geometry.vertices.push(
            new THREE.Vector3(
              radius * Math.cos(angle),
              y,
              radius * Math.sin(angle)
            )
          );
        }
        return ring;
      }

      rings.push(
        addRing(outerRadius, -halfHeight),
        addRing(outerRadius, halfHeight),
        addRing(innerRadius, -halfHeight),
        addRing(innerRadius, halfHeight)
      );
      const [outerBottom, outerTop, innerBottom, innerTop] = rings;

      for (let index = 0; index < segmentCount; index += 1) {
        const next = index + 1;
        geometry.faces.push(
          new THREE.Face3(outerBottom[index], outerTop[index], outerTop[next]),
          new THREE.Face3(outerBottom[index], outerTop[next], outerBottom[next]),
          new THREE.Face3(innerBottom[index], innerBottom[next], innerTop[next]),
          new THREE.Face3(innerBottom[index], innerTop[next], innerTop[index])
        );
        if (capped) {
          geometry.faces.push(
            new THREE.Face3(outerBottom[index], outerBottom[next], innerBottom[next]),
            new THREE.Face3(outerBottom[index], innerBottom[next], innerBottom[index]),
            new THREE.Face3(outerTop[index], innerTop[next], outerTop[next]),
            new THREE.Face3(outerTop[index], innerTop[index], innerTop[next])
          );
        }
      }

      geometry.computeFaceNormals();
      geometry.computeVertexNormals();
      return geometry;
    }

    function createHelixGeometry(
      pathRadius,
      height,
      turns,
      tubeRadius,
      pathSegments,
      radialSegments
    ) {
      const curve = new THREE.Curve();
      curve.getPoint = (amount) => {
        const angle = Math.PI * 2 * turns * amount;
        return new THREE.Vector3(
          pathRadius * Math.cos(angle),
          height * (amount - 0.5),
          pathRadius * Math.sin(angle)
        );
      };
      return new THREE.TubeGeometry(
        curve,
        pathSegments,
        tubeRadius,
        radialSegments,
        false
      );
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

    const GeometryObject = createMeshObjectBase();

    class RoundedBoxObject extends GeometryObject {
      constructor() {
        super();
        this.defaultName = "Rounded Box";
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

      getGeometrySignature(frame) {
        return JSON.stringify([
          this.properties.size.get(frame),
          this.properties.cornerRadius.get(frame),
          this.properties.cornerSegments.get(frame),
          this.properties.bevelSize.get(frame),
          this.properties.bevelSegments.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const size = vectorValue(this.properties.size.get(frame), [40, 24, 6]);
        const width = Math.max(0.1, Math.abs(size[0]));
        const height = Math.max(0.1, Math.abs(size[1]));
        const depth = Math.max(0.1, Math.abs(size[2]));
        const radius = Math.min(
          Math.max(0, numberValue(this.properties.cornerRadius.get(frame), 3)),
          width / 2,
          height / 2
        );
        const cornerSegments = integerValue(
          this.properties.cornerSegments.get(frame),
          6,
          1
        );
        const bevelLimit = Math.min(width, height, depth) / 2;
        const bevel = Math.min(
          Math.max(0, numberValue(this.properties.bevelSize.get(frame), 0.6)),
          bevelLimit
        );
        const bevelSegments = integerValue(
          this.properties.bevelSegments.get(frame),
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
        this.defaultName = "Polyhedron";
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

      getGeometrySignature(frame) {
        return JSON.stringify([
          this.properties.shape.get(frame),
          this.properties.radius.get(frame),
          this.properties.detail.get(frame),
          this.properties.shading.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const shape = integerValue(this.properties.shape.get(frame), 0, 0);
        const radius = Math.max(0.1, numberValue(this.properties.radius.get(frame), 12));
        const detail = Math.min(
          5,
          integerValue(this.properties.detail.get(frame), 0, 0)
        );
        const constructors = [
          THREE.TetrahedronGeometry,
          THREE.OctahedronGeometry,
          THREE.IcosahedronGeometry,
          THREE.DodecahedronGeometry,
        ];
        const GeometryConstructor = constructors[shape] || constructors[0];
        const geometry = new GeometryConstructor(radius, detail);
        geometry.center();
        return applyShading(geometry, this.properties.shading.get(frame));
      }
    }

    class ConeObject extends GeometryObject {
      constructor() {
        super();
        this.defaultName = "Cone";
        this.properties.addAll({
          topRadius: numericProperty({
            name: "Top radius",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: 0,
            step: 1,
            decimals: 1,
          }),
          bottomRadius: numericProperty({
            name: "Bottom radius",
            type: PZ.property.type.NUMBER,
            value: 16,
            min: 0,
            step: 1,
            decimals: 1,
          }),
          height: numericProperty({
            name: "Height",
            type: PZ.property.type.NUMBER,
            value: 32,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          segments: numericProperty({
            name: "Segments",
            type: PZ.property.type.NUMBER,
            value: 24,
            min: 3,
            max: 64,
            step: 1,
            decimals: 0,
          }),
          endCaps: optionProperty({
            name: "End caps",
            type: PZ.property.type.OPTION,
            items: "closed;open",
            value: 0,
          }),
          shading: shadingProperty(),
        });
        this.properties.name.set("Cone");
      }

      getGeometrySignature(frame) {
        return JSON.stringify([
          this.properties.topRadius.get(frame),
          this.properties.bottomRadius.get(frame),
          this.properties.height.get(frame),
          this.properties.segments.get(frame),
          this.properties.endCaps.get(frame),
          this.properties.shading.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const topRadius = Math.max(
          0,
          numberValue(this.properties.topRadius.get(frame), 0)
        );
        const bottomRadius = Math.max(
          0,
          numberValue(this.properties.bottomRadius.get(frame), 16)
        );
        const height = Math.max(0.1, numberValue(this.properties.height.get(frame), 32));
        const segments = integerValue(this.properties.segments.get(frame), 24, 3);
        const openEnded = integerValue(this.properties.endCaps.get(frame), 0, 0) !== 0;
        const geometry = new THREE.CylinderGeometry(
          topRadius,
          bottomRadius,
          height,
          segments,
          1,
          openEnded
        );
        return applyShading(geometry, this.properties.shading.get(frame));
      }
    }

    class CapsuleObject extends GeometryObject {
      constructor() {
        super();
        this.defaultName = "Capsule";
        this.properties.addAll({
          radius: numericProperty({
            name: "Radius",
            type: PZ.property.type.NUMBER,
            value: 8,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          height: numericProperty({
            name: "Height",
            type: PZ.property.type.NUMBER,
            value: 32,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          segments: numericProperty({
            name: "Segments",
            type: PZ.property.type.NUMBER,
            value: 8,
            min: 2,
            max: 32,
            step: 1,
            decimals: 0,
          }),
          radialSegments: numericProperty({
            name: "Radial segments",
            type: PZ.property.type.NUMBER,
            value: 16,
            min: 3,
            max: 64,
            step: 1,
            decimals: 0,
          }),
          shading: shadingProperty(),
        });
        this.properties.name.set("Capsule");
      }

      getGeometrySignature(frame) {
        return JSON.stringify([
          this.properties.radius.get(frame),
          this.properties.height.get(frame),
          this.properties.segments.get(frame),
          this.properties.radialSegments.get(frame),
          this.properties.shading.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const radius = Math.max(0.1, numberValue(this.properties.radius.get(frame), 8));
        const height = Math.max(0.1, numberValue(this.properties.height.get(frame), 32));
        const capSegments = integerValue(this.properties.segments.get(frame), 8, 2);
        const radialSegments = integerValue(
          this.properties.radialSegments.get(frame),
          16,
          3
        );
        const halfStraight = Math.max(0, height / 2 - radius);
        const profile = [{ radius: 0, y: -halfStraight - radius }];

        for (let index = 1; index <= capSegments; index += 1) {
          const angle = (-Math.PI / 2) + (Math.PI / 2) * (index / capSegments);
          profile.push({
            radius: radius * Math.cos(angle),
            y: -halfStraight + radius * Math.sin(angle),
          });
        }
        if (halfStraight > 1e-6) {
          profile.push({ radius, y: halfStraight });
        }
        for (let index = 1; index <= capSegments; index += 1) {
          const angle = (Math.PI / 2) * (index / capSegments);
          profile.push({
            radius: radius * Math.cos(angle),
            y: halfStraight + radius * Math.sin(angle),
          });
        }

        const geometry = createLatheProfileGeometry(profile, radialSegments);
        return applyShading(geometry, this.properties.shading.get(frame));
      }
    }

    class TubeObject extends GeometryObject {
      constructor() {
        super();
        this.defaultName = "Tube";
        this.properties.addAll({
          outerRadius: numericProperty({
            name: "Outer radius",
            type: PZ.property.type.NUMBER,
            value: 12,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          innerRadius: numericProperty({
            name: "Inner radius",
            type: PZ.property.type.NUMBER,
            value: 8,
            min: 0.01,
            step: 1,
            decimals: 1,
          }),
          height: numericProperty({
            name: "Height",
            type: PZ.property.type.NUMBER,
            value: 24,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          radialSegments: numericProperty({
            name: "Radial segments",
            type: PZ.property.type.NUMBER,
            value: 24,
            min: 3,
            max: 64,
            step: 1,
            decimals: 0,
          }),
          endCaps: optionProperty({
            name: "End caps",
            type: PZ.property.type.OPTION,
            items: "closed;open",
            value: 0,
          }),
          shading: shadingProperty(),
        });
        this.properties.name.set("Tube");
      }

      getGeometrySignature(frame) {
        return JSON.stringify([
          this.properties.outerRadius.get(frame),
          this.properties.innerRadius.get(frame),
          this.properties.height.get(frame),
          this.properties.radialSegments.get(frame),
          this.properties.endCaps.get(frame),
          this.properties.shading.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const outerRadius = Math.max(
          0.1,
          numberValue(this.properties.outerRadius.get(frame), 12)
        );
        const innerRadius = Math.min(
          Math.max(0.01, numberValue(this.properties.innerRadius.get(frame), 8)),
          Math.max(0.01, outerRadius - 0.01)
        );
        const height = Math.max(0.1, numberValue(this.properties.height.get(frame), 24));
        const radialSegments = integerValue(
          this.properties.radialSegments.get(frame),
          24,
          3
        );
        const capped = integerValue(this.properties.endCaps.get(frame), 0, 0) === 0;
        const geometry = createHollowCylinderGeometry(
          outerRadius,
          innerRadius,
          height,
          radialSegments,
          capped
        );
        return applyShading(geometry, this.properties.shading.get(frame));
      }
    }

    class GearObject extends GeometryObject {
      constructor() {
        super();
        this.defaultName = "Gear";
        this.properties.addAll({
          teeth: numericProperty({
            name: "Teeth",
            type: PZ.property.type.NUMBER,
            value: 12,
            min: 3,
            max: 64,
            step: 1,
            decimals: 0,
          }),
          innerRadius: numericProperty({
            name: "Inner radius",
            type: PZ.property.type.NUMBER,
            value: 10,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          outerRadius: numericProperty({
            name: "Outer radius",
            type: PZ.property.type.NUMBER,
            value: 16,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          thickness: numericProperty({
            name: "Thickness",
            type: PZ.property.type.NUMBER,
            value: 6,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          toothWidth: numericProperty({
            name: "Tooth width",
            type: PZ.property.type.NUMBER,
            value: 0.55,
            min: 0.1,
            max: 0.9,
            step: 0.05,
            decimals: 2,
          }),
          bevelSize: numericProperty({
            name: "Bevel size",
            type: PZ.property.type.NUMBER,
            value: 0.3,
            min: 0,
            step: 0.1,
            decimals: 2,
          }),
          bevelSegments: numericProperty({
            name: "Bevel segments",
            type: PZ.property.type.NUMBER,
            value: 2,
            min: 0,
            max: 8,
            step: 1,
            decimals: 0,
          }),
          shading: shadingProperty(),
        });
        this.properties.name.set("Gear");
      }

      getGeometrySignature(frame) {
        return JSON.stringify([
          this.properties.teeth.get(frame),
          this.properties.innerRadius.get(frame),
          this.properties.outerRadius.get(frame),
          this.properties.thickness.get(frame),
          this.properties.toothWidth.get(frame),
          this.properties.bevelSize.get(frame),
          this.properties.bevelSegments.get(frame),
          this.properties.shading.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const teeth = integerValue(this.properties.teeth.get(frame), 12, 3);
        const outerRadius = Math.max(
          0.1,
          numberValue(this.properties.outerRadius.get(frame), 16)
        );
        const innerRadius = Math.min(
          Math.max(0.1, numberValue(this.properties.innerRadius.get(frame), 10)),
          Math.max(0.1, outerRadius - 0.1)
        );
        const thickness = Math.max(
          0.1,
          numberValue(this.properties.thickness.get(frame), 6)
        );
        const toothWidth = Math.min(
          0.95,
          Math.max(0.05, numberValue(this.properties.toothWidth.get(frame), 0.55))
        );
        const step = (Math.PI * 2) / teeth;
        const toothHalfAngle = (step * toothWidth) / 2;
        const shape = new THREE.Shape();
        const pointAt = (angle, radius) => [
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        ];
        const points = [];

        for (let index = 0; index < teeth; index += 1) {
          const center = index * step;
          points.push(
            pointAt(center - step / 2, innerRadius),
            pointAt(center - toothHalfAngle, outerRadius),
            pointAt(center + toothHalfAngle, outerRadius),
            pointAt(center + step / 2, innerRadius)
          );
        }
        shape.moveTo(points[0][0], points[0][1]);
        for (let index = 1; index < points.length; index += 1) {
          shape.lineTo(points[index][0], points[index][1]);
        }
        shape.closePath();

        const bevelSegments = integerValue(
          this.properties.bevelSegments.get(frame),
          2,
          0
        );
        const bevel = Math.min(
          Math.max(0, numberValue(this.properties.bevelSize.get(frame), 0.3)),
          thickness / 2,
          (outerRadius - innerRadius) / 2
        );
        const geometry = new THREE.ExtrudeGeometry(shape, {
          amount: thickness,
          steps: 1,
          curveSegments: 1,
          bevelEnabled: bevel > 0 && bevelSegments > 0,
          bevelThickness: bevel,
          bevelSize: bevel,
          bevelSegments,
        });
        geometry.center();
        return applyShading(geometry, this.properties.shading.get(frame));
      }
    }

    class HelixObject extends GeometryObject {
      constructor() {
        super();
        this.defaultName = "Helix";
        this.properties.addAll({
          radius: numericProperty({
            name: "Radius",
            type: PZ.property.type.NUMBER,
            value: 14,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          height: numericProperty({
            name: "Height",
            type: PZ.property.type.NUMBER,
            value: 32,
            min: 0.1,
            step: 1,
            decimals: 1,
          }),
          turns: numericProperty({
            name: "Turns",
            type: PZ.property.type.NUMBER,
            value: 3,
            min: 0.25,
            max: 32,
            step: 0.25,
            decimals: 2,
          }),
          tubeRadius: numericProperty({
            name: "Tube radius",
            type: PZ.property.type.NUMBER,
            value: 2,
            min: 0.05,
            step: 0.25,
            decimals: 2,
          }),
          pathSegments: numericProperty({
            name: "Path segments",
            type: PZ.property.type.NUMBER,
            value: 64,
            min: 8,
            max: 256,
            step: 1,
            decimals: 0,
          }),
          radialSegments: numericProperty({
            name: "Radial segments",
            type: PZ.property.type.NUMBER,
            value: 8,
            min: 3,
            max: 32,
            step: 1,
            decimals: 0,
          }),
          shading: shadingProperty(),
        });
        this.properties.name.set("Helix");
      }

      getGeometrySignature(frame) {
        return JSON.stringify([
          this.properties.radius.get(frame),
          this.properties.height.get(frame),
          this.properties.turns.get(frame),
          this.properties.tubeRadius.get(frame),
          this.properties.pathSegments.get(frame),
          this.properties.radialSegments.get(frame),
          this.properties.shading.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const radius = Math.max(0.1, numberValue(this.properties.radius.get(frame), 14));
        const height = Math.max(0.1, numberValue(this.properties.height.get(frame), 32));
        const turns = Math.max(0.25, numberValue(this.properties.turns.get(frame), 3));
        const tubeRadius = Math.max(
          0.05,
          numberValue(this.properties.tubeRadius.get(frame), 2)
        );
        const pathSegments = integerValue(
          this.properties.pathSegments.get(frame),
          64,
          8
        );
        const radialSegments = integerValue(
          this.properties.radialSegments.get(frame),
          8,
          3
        );
        const geometry = createHelixGeometry(
          radius,
          height,
          turns,
          tubeRadius,
          pathSegments,
          radialSegments
        );
        return applyShading(geometry, this.properties.shading.get(frame));
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
    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/cone",
        schemaVersion: 1,
        name: "Cone",
        factory: () => new ConeObject(),
      })
    );
    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/capsule",
        schemaVersion: 1,
        name: "Capsule",
        factory: () => new CapsuleObject(),
      })
    );
    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/tube",
        schemaVersion: 1,
        name: "Tube",
        factory: () => new TubeObject(),
      })
    );
    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/gear",
        schemaVersion: 1,
        name: "Gear",
        factory: () => new GearObject(),
      })
    );
    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/helix",
        schemaVersion: 1,
        name: "Helix",
        factory: () => new HelixObject(),
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
