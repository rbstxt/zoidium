// Geometry+ plugin entry: spline object class, registrations, and the
// test-only math handles. The implementation lives in the sibling files,
// loaded through the shared bundle loader in the shipped bundle and through
// local files in Node (tests).

function loadGeometryPlusParts(context) {
  if (
    context &&
    context.apis &&
    context.apis.modules &&
    typeof context.apis.modules.createRequire === "function" &&
    typeof context.getAsset === "function"
  ) {
    const bundleRequire = context.apis.modules.createRequire(
      context.getAsset,
      { root: "./plugins/geometry-plus/" }
    );
    return {
      helpers: bundleRequire("./geometry-helpers.js"),
      splineMath: bundleRequire("./spline-math.js"),
      tube: bundleRequire("./tube-geometry.js"),
      base: bundleRequire("./mesh-object-base.js"),
      primitives: bundleRequire("./primitive-shapes.js"),
    };
  }
  return {
    helpers: require("./geometry-helpers.js"),
    splineMath: require("./spline-math.js"),
    tube: require("./tube-geometry.js"),
    base: require("./mesh-object-base.js"),
    primitives: require("./primitive-shapes.js"),
  };
}

let parts = null;
try {
  if (typeof require === "function") parts = loadGeometryPlusParts(null);
} catch (error) {
  parts = null;
}

function ensureGeometryPlusParts(context) {
  if (!parts) parts = loadGeometryPlusParts(context);
  return parts;
}

"use strict";

// Test-only handles for the pure spline/tube math defined inside activate().
// activate() populates this object; characterization tests activate the plugin
// with stub hosts first and then pin numbers through plugin._test.
const geometryTestExports = {};

module.exports = {
  _test: geometryTestExports,
  activate(context) {
    ensureGeometryPlusParts(context);
    const { PZ, window, object3d } = context;
    const THREE = window && window.THREE;
    if (!PZ || !THREE || !object3d) {
      throw new Error("Geometry+ requires the Zoidium 3D object registry.");
    }

    const unregister = [];
    const { markGeometryDirty, numberValue, vectorValue, integerValue } =
      parts.helpers;
    const numericProperty = (definition) =>
      parts.base.numericProperty(PZ, definition);
    const optionProperty = (definition) =>
      parts.base.optionProperty(PZ, definition);
    const shadingProperty = () => parts.base.shadingProperty(PZ);
    const { applyShading } = parts.base;
    const createMeshObjectBase = () =>
      parts.base.createMeshObjectBase(PZ, THREE);
    const {
      SPLINE_MAX_POINTS,
      SPLINE_DEFAULT_POINTS,
      SPLINE_DEFAULT_POINT_POSITIONS,
      cross3,
      normalize3,
      isZero3,
      parseRgbaColor,
      premultipliedRed,
      sampleThicknessGradient,
      sampleLinearSpline,
      sampleHermiteSpan,
      sampleCatmullRomSpline,
      sampleAkimaSpline,
      sampleBSplineSpline,
      sampleSplineCurve,
    } = parts.splineMath;
    const createLatheProfileGeometry = (...args) =>
      parts.tube.createLatheProfileGeometry(THREE, ...args);
    const createHollowCylinderGeometry = (...args) =>
      parts.tube.createHollowCylinderGeometry(THREE, ...args);
    const createHelixGeometry = (...args) =>
      parts.tube.createHelixGeometry(THREE, ...args);
    const createSplineTubeGeometry = (...args) =>
      parts.tube.createSplineTubeGeometry(THREE, ...args);
    Object.assign(geometryTestExports, {
      SPLINE_MAX_POINTS,
      SPLINE_DEFAULT_POINTS,
      SPLINE_DEFAULT_POINT_POSITIONS,
      numberValue,
      vectorValue,
      integerValue,
      cross3,
      normalize3,
      isZero3,
      parseRgbaColor,
      premultipliedRed,
      sampleThicknessGradient,
      sampleLinearSpline,
      sampleHermiteSpan,
      sampleCatmullRomSpline,
      sampleAkimaSpline,
      sampleBSplineSpline,
      sampleSplineCurve,
      createLatheProfileGeometry,
      createHollowCylinderGeometry,
      createHelixGeometry,
      createSplineTubeGeometry,
    });

    function splinePointDefinition(index) {
      const position = SPLINE_DEFAULT_POINT_POSITIONS[index - 1] || [0, 0, 0];
      return {
        name: "Point " + index,
        dynamic: true,
        group: true,
        type: PZ.property.type.VECTOR3,
        objects: [
          { dynamic: true, name: "X", type: PZ.property.type.NUMBER, value: position[0], step: 1 },
          { dynamic: true, name: "Y", type: PZ.property.type.NUMBER, value: position[1], step: 1 },
          { dynamic: true, name: "Z", type: PZ.property.type.NUMBER, value: position[2], step: 1 },
        ],
      };
    }

    const GeometryObject = createMeshObjectBase();
    const {
      RoundedBoxObject,
      PolyhedronObject,
      ConeObject,
      CapsuleObject,
      TubeObject,
      GearObject,
      HelixObject,
    } = parts.primitives.createPrimitiveClasses({
      PZ,
      THREE,
      GeometryObject,
      numberValue,
      vectorValue,
      integerValue,
      numericProperty,
      optionProperty,
      shadingProperty,
      applyShading,
      markGeometryDirty,
      createLatheProfileGeometry,
      createHollowCylinderGeometry,
      createHelixGeometry,
    });
    class SplineObject extends GeometryObject {
      constructor() {
        super();
        this.defaultName = "Spline";
        this.properties.addAll({
          points: PZ.property.create({
            name: "Points",
            type: PZ.property.type.NUMBER,
            value: SPLINE_DEFAULT_POINTS,
            min: 2,
            max: SPLINE_MAX_POINTS,
            step: 1,
            decimals: 0,
            changed: function () {
              const object = this.parentObject;
              if (object) {
                object.syncSplinePoints(integerValue(this.value, SPLINE_DEFAULT_POINTS, 2));
              }
            },
          }),
          interpolation: PZ.property.create({
            name: "Interpolation",
            type: PZ.property.type.LIST,
            value: "Cubic",
            items: [
              { name: "Linear", value: "Linear" },
              { name: "Cubic", value: "Cubic" },
              { name: "Akima", value: "Akima" },
              { name: "B-Spline", value: "B-Spline" },
            ],
            changed: markGeometryDirty,
          }),
          closed: numericProperty({
            name: "Closed",
            type: PZ.property.type.OPTION,
            items: "off;on",
            value: 0,
          }),
          start: numericProperty({
            name: "Start",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: 0,
            max: 1,
            step: 0.01,
            decimals: 2,
          }),
          end: numericProperty({
            name: "End",
            type: PZ.property.type.NUMBER,
            value: 1,
            min: 0,
            max: 1,
            step: 0.01,
            decimals: 2,
          }),
          thickness: numericProperty({
            name: "Thickness",
            type: PZ.property.type.NUMBER,
            value: 2,
            min: 0,
            step: 0.5,
            decimals: 2,
          }),
          thicknessMap: PZ.property.create({
            name: "Thickness map",
            type: PZ.property.type.GRADIENT,
            value: [{ position: 0, color: "rgba(255,255,255,1.0)" }],
            changed: markGeometryDirty,
          }),
          gradientSpace: PZ.property.create({
            name: "Gradient space",
            type: PZ.property.type.LIST,
            value: "Curve",
            items: [
              { name: "Curve", value: "Curve" },
              { name: "Trimmed", value: "Trimmed" },
            ],
            changed: markGeometryDirty,
          }),
          tension: numericProperty({
            name: "Tension",
            type: PZ.property.type.NUMBER,
            value: 1,
            min: 0,
            max: 2,
            step: 0.05,
            decimals: 2,
          }),
          pathSegments: numericProperty({
            name: "Path segments",
            type: PZ.property.type.NUMBER,
            value: 16,
            min: 1,
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
          caps: PZ.property.create({
            name: "Caps",
            type: PZ.property.type.LIST,
            value: "Both",
            items: [
              { name: "None", value: "None" },
              { name: "Both", value: "Both" },
              { name: "Start", value: "Start" },
              { name: "End", value: "End" },
            ],
            changed: markGeometryDirty,
          }),
          capStyle: PZ.property.create({
            name: "Cap style",
            type: PZ.property.type.LIST,
            value: "Flat",
            items: [
              { name: "Flat", value: "Flat" },
              { name: "Round", value: "Round" },
            ],
            changed: markGeometryDirty,
          }),
          shading: shadingProperty(),
        });
        this.syncSplinePoints(SPLINE_DEFAULT_POINTS);
        this.properties.name.set("Spline");
      }

      load(data) {
        const serialized = data && data.properties;
        const entry = serialized && serialized.points;
        let desired = SPLINE_DEFAULT_POINTS;
        if (typeof entry === "number" && Number.isFinite(entry)) {
          // Static properties serialize as bare values ("points": 5).
          desired = entry;
        } else if (entry && typeof entry === "object") {
          const raw = Object.prototype.hasOwnProperty.call(entry, "value")
            ? entry.value
            : entry.keyframes && entry.keyframes[0]
              ? entry.keyframes[0].value
              : undefined;
          if (Number.isFinite(Number(raw))) desired = Number(raw);
        }
        this.syncSplinePoints(Math.min(SPLINE_MAX_POINTS, Math.max(2, Math.round(desired))));
        this.resetSplinePointKeyframes();
        super.load(data);
      }

      resetSplinePointKeyframes() {
        for (let index = 1; index <= SPLINE_MAX_POINTS; index++) {
          const property = this.properties["point" + index];
          if (!property || !property.objects) continue;
          for (const component of property.objects) {
            if (component.keyframes && component.keyframes.length) {
              component.keyframes.splice(0, component.keyframes.length);
            }
          }
        }
      }

      syncSplinePoints(count) {
        const target = Math.min(
          SPLINE_MAX_POINTS,
          Math.max(2, integerValue(count, SPLINE_DEFAULT_POINTS, 2))
        );
        for (let index = 1; index <= SPLINE_MAX_POINTS; index++) {
          const key = "point" + index;
          const exists = Boolean(this.properties[key]);
          const wanted = index <= target;
          if (wanted && !exists) {
            const property = PZ.property.create(splinePointDefinition(index));
            property.load();
            this.properties.add(key, property);
          } else if (!wanted && exists) {
            this.properties.remove(key);
          }
        }
        this.geometryNeedsUpdate = true;
        this._geometrySignature = undefined;
      }

      activePointCount() {
        return Math.min(
          SPLINE_MAX_POINTS,
          Math.max(2, integerValue(this.properties.points.value, SPLINE_DEFAULT_POINTS, 2))
        );
      }

      getGeometrySignature(frame) {
        const count = this.activePointCount();
        const points = [];
        for (let index = 1; index <= count; index++) {
          points.push(this.properties["point" + index].get(frame));
        }
        return JSON.stringify([
          points,
          this.properties.interpolation.value,
          this.properties.closed.get(frame),
          this.properties.start.get(frame),
          this.properties.end.get(frame),
          this.properties.thickness.get(frame),
          this.properties.thicknessMap.value,
          this.properties.gradientSpace.value,
          this.properties.tension.get(frame),
          this.properties.pathSegments.get(frame),
          this.properties.radialSegments.get(frame),
          this.properties.caps.value,
          this.properties.capStyle.value,
          this.properties.shading.get(frame),
        ]);
      }

      generateGeometry(frame) {
        const count = this.activePointCount();
        const points = [];
        for (let index = 1; index <= count; index++) {
          const entry = this.properties["point" + index];
          if (!entry) break;
          const value = entry.get(frame);
          points.push([
            numberValue(value[0], 0),
            numberValue(value[1], 0),
            numberValue(value[2], 0),
          ]);
        }
        if (points.length < 2) return new THREE.Geometry();

        const interpolation = String(this.properties.interpolation.value || "Cubic");
        const closed = integerValue(this.properties.closed.get(frame), 0, 0) === 1;
        let start = Math.min(1, Math.max(0, numberValue(this.properties.start.get(frame), 0)));
        let end = Math.min(1, Math.max(0, numberValue(this.properties.end.get(frame), 1)));
        if (end < start) {
          const swap = start;
          start = end;
          end = swap;
        }
        if (end - start < 1e-4) return new THREE.Geometry();

        const pathSegments = integerValue(
          this.properties.pathSegments.get(frame),
          16,
          1
        );
        const radialSegments = integerValue(
          this.properties.radialSegments.get(frame),
          8,
          3
        );
        const thickness = Math.max(0, numberValue(this.properties.thickness.get(frame), 2));
        const tubeRadius = Math.max(thickness / 2, 1e-4);
        const caps = closed ? "None" : String(this.properties.caps.value || "Both");
        const capStyle = String(this.properties.capStyle.value || "Flat");
        const tension = Math.min(2, Math.max(0, numberValue(this.properties.tension.get(frame), 1)));
        const thicknessMap = this.properties.thicknessMap.value;
        const gradientSpace = String(this.properties.gradientSpace.value || "Curve");
        const spans = closed
          ? points.length
          : interpolation === "B-Spline" && points.length >= 4
            ? points.length - 3
            : points.length - 1;

        const totalSegments = Math.max(1, Math.round(spans * pathSegments));
        const centerline = [];
        const radii = [];
        for (let k = 0; k <= totalSegments; k++) {
          const amount = start + ((end - start) * k) / totalSegments;
          centerline.push(sampleSplineCurve(points, interpolation, amount, closed, tension));
          const gradientPosition =
            gradientSpace === "Trimmed"
              ? (amount - start) / Math.max(end - start, 1e-9)
              : amount;
          radii.push(
            tubeRadius * sampleThicknessGradient(thicknessMap, gradientPosition)
          );
        }
        const geometry = createSplineTubeGeometry(
          centerline,
          radii,
          radialSegments,
          caps,
          capStyle
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
    unregister.push(
      object3d.registerClass({
        type: "zoidium:geometry-plus/spline",
        schemaVersion: 1,
        name: "Spline",
        factory: () => new SplineObject(),
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
