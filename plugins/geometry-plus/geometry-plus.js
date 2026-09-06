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

    const SPLINE_MAX_POINTS = 32;
    const SPLINE_DEFAULT_POINTS = 2;

    function cross3(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    }

    function normalize3(value, fallback) {
      const length = Math.hypot(value[0], value[1], value[2]);
      if (!(length > 1e-9)) return fallback.slice();
      return [value[0] / length, value[1] / length, value[2] / length];
    }

    function isZero3(value) {
      return Math.hypot(value[0], value[1], value[2]) <= 1e-9;
    }

    // Gradient sampling mirrors the CM3 gradient rasterizer used by native
    // particle size: colors are parsed from "rgba(...)", interpolated linearly
    // between stops, and the scalar comes from the premultiplied red channel.
    function parseRgbaColor(text) {
      const parts = String(text || "")
        .split("(")[1]
        .split(")")[0]
        .split(",");
      const number = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      return {
        r: number(parseInt(parts[0], 10), 0),
        g: number(parseInt(parts[1], 10), 0),
        b: number(parseInt(parts[2], 10), 0),
        a: parts.length > 3 ? number(parseFloat(parts[3]), 1) : 1,
      };
    }

    function premultipliedRed(color) {
      return Math.min(1, Math.max(0, (color.r * color.a) / 255));
    }

    function sampleThicknessGradient(stops, position) {
      if (!Array.isArray(stops) || stops.length === 0) return 1;
      const parsed = stops
        .map((stop) => ({
          position: Math.min(1, Math.max(0, numberValue(stop.position, 0))),
          color: parseRgbaColor(stop.color),
        }))
        .sort((a, b) => a.position - b.position);
      const amount = Math.min(1, Math.max(0, numberValue(position, 0)));
      const first = parsed[0];
      const last = parsed[parsed.length - 1];
      if (amount <= first.position) return premultipliedRed(first.color);
      if (amount >= last.position) return premultipliedRed(last.color);
      for (let index = 0; index < parsed.length - 1; index++) {
        const lower = parsed[index];
        const upper = parsed[index + 1];
        if (amount >= lower.position && amount <= upper.position) {
          const span = upper.position - lower.position;
          const frac = span > 1e-9 ? (amount - lower.position) / span : 0;
          return premultipliedRed({
            r: lower.color.r + (upper.color.r - lower.color.r) * frac,
            a: lower.color.a + (upper.color.a - lower.color.a) * frac,
          });
        }
      }
      return premultipliedRed(last.color);
    }

    function sampleLinearSpline(points, amount, closed) {
      const count = points.length;
      const spans = closed ? count : count - 1;
      const scaled = Math.min(Math.max(amount, 0), 1) * spans;
      const index = Math.min(Math.floor(scaled), spans - 1);
      const t = scaled - index;
      const a = points[index % count];
      const b = points[(index + 1) % count];
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
    }

    function sampleHermiteSpan(p0, p1, p2, p3, t, tension) {
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const axis = (a, b, c, d) => {
        const m1 = (tension * (c - a)) / 2;
        const m2 = (tension * (d - b)) / 2;
        return h00 * b + h10 * m1 + h01 * c + h11 * m2;
      };
      return [
        axis(p0[0], p1[0], p2[0], p3[0]),
        axis(p0[1], p1[1], p2[1], p3[1]),
        axis(p0[2], p1[2], p2[2], p3[2]),
      ];
    }

    function sampleCatmullRomSpline(points, amount, closed, tension) {
      const count = points.length;
      const spans = closed ? count : count - 1;
      const scaled = Math.min(Math.max(amount, 0), 1) * spans;
      const index = Math.min(Math.floor(scaled), spans - 1);
      const t = scaled - index;
      const p1 = points[index % count];
      const p2 = points[(index + 1) % count];
      const p0 = closed
        ? points[(index - 1 + count) % count]
        : points[Math.max(index - 1, 0)];
      const p3 = closed
        ? points[(index + 2) % count]
        : points[Math.min(index + 2, count - 1)];
      return sampleHermiteSpan(p0, p1, p2, p3, t, tension);
    }

    function sampleAkimaSpline(points, amount, closed) {
      const count = points.length;
      const spans = closed ? count : count - 1;
      const scaled = Math.min(Math.max(amount, 0), 1) * spans;
      const index = Math.min(Math.floor(scaled), spans - 1);
      const t = scaled - index;
      const t2 = t * t;
      const t3 = t2 * t;
      const tangents = [];
      for (let axis = 0; axis < 3; axis++) {
        const values = points.map((point) => point[axis]);
        const pointTangents = [];
        if (closed) {
          // Cyclic slopes and tangents: neighbors wrap around the loop.
          const slopes = [];
          for (let k = 0; k < count; k++) {
            slopes.push(values[(k + 1) % count] - values[k]);
          }
          for (let k = 0; k < count; k++) {
            const s0 = slopes[(k - 2 + count) % count];
            const s1 = slopes[(k - 1 + count) % count];
            const s2 = slopes[k];
            const s3 = slopes[(k + 1) % count];
            const w1 = Math.abs(s3 - s2);
            const w2 = Math.abs(s1 - s0);
            pointTangents.push(
              w1 + w2 < 1e-12 ? (s1 + s2) / 2 : (w1 * s1 + w2 * s2) / (w1 + w2)
            );
          }
        } else {
          // Slopes s[k] = values[k + 1] - values[k], extended as s[-2], s[-1],
          // s[n - 1], s[n] following the classic Akima boundary handling.
          const slopes = new Array(count + 4).fill(0);
          for (let k = 0; k <= count - 2; k++) slopes[k + 2] = values[k + 1] - values[k];
          slopes[1] = 2 * slopes[2] - slopes[3];
          slopes[0] = 2 * slopes[1] - slopes[2];
          slopes[count + 1] = 2 * slopes[count] - slopes[count - 1];
          slopes[count + 2] = 2 * slopes[count + 1] - slopes[count];
          for (let k = 0; k < count; k++) {
            const w1 = Math.abs(slopes[k + 3] - slopes[k + 2]);
            const w2 = Math.abs(slopes[k + 1] - slopes[k]);
            pointTangents.push(
              w1 + w2 < 1e-12
                ? (slopes[k + 1] + slopes[k + 2]) / 2
                : (w1 * slopes[k + 1] + w2 * slopes[k + 2]) / (w1 + w2)
            );
          }
        }
        const y0 = values[index];
        const y1 = values[(index + 1) % count];
        const m0 = pointTangents[index];
        const m1 = pointTangents[(index + 1) % count];
        tangents.push(
          (2 * t3 - 3 * t2 + 1) * y0 +
            (t3 - 2 * t2 + t) * m0 +
            (-2 * t3 + 3 * t2) * y1 +
            (t3 - t2) * m1
        );
      }
      return tangents;
    }

    function sampleBSplineSpline(points, amount, closed) {
      const count = points.length;
      const degree = 3;
      if (closed) {
        // Cyclic uniform B-spline: control point access wraps around the loop
        // so the curve closes smoothly on itself.
        const spans = count;
        const scaled = Math.min(Math.max(amount, 0), 1) * spans;
        const index = Math.min(Math.floor(scaled), spans - 1);
        const t = scaled - index;
        const t2 = t * t;
        const t3 = t2 * t;
        const at = (offset) => points[(index + offset) % count];
        const axis = (a, b, c, d) =>
          ((1 - t) * (1 - t) * (1 - t) * a +
            (3 * t3 - 6 * t2 + 4) * b +
            (-3 * t3 + 3 * t2 + 3 * t + 1) * c +
            t3 * d) /
          6;
        return [
          axis(at(0)[0], at(1)[0], at(2)[0], at(3)[0]),
          axis(at(0)[1], at(1)[1], at(2)[1], at(3)[1]),
          axis(at(0)[2], at(1)[2], at(2)[2], at(3)[2]),
        ];
      }
      // Open-uniform knot vector: u_j = 0 for j <= degree, j - degree for
      // degree < j < count, spans for j >= count. The ends are clamped, so
      // the curve starts at the first point and ends at the last point.
      const knot = (j) => (j <= degree ? 0 : j >= count ? spans : j - degree);
      const spans = count - degree;
      let t = Math.min(Math.max(amount, 0), 1) * spans;
      if (t >= spans) t = spans - 1e-9;
      let span = degree;
      while (span < count - 1 && t >= knot(span + 1)) span += 1;
      const d = [];
      for (let j = 0; j <= degree; j++) d.push(points[j + span - degree].slice());
      for (let r = 1; r <= degree; r++) {
        for (let j = degree; j >= r; j--) {
          const i = j + span - degree;
          const denom = knot(j + 1 + span - r) - knot(i);
          const alpha = denom > 1e-12 ? (t - knot(i)) / denom : 0;
          for (let axis = 0; axis < 3; axis++) {
            d[j][axis] = (1 - alpha) * d[j - 1][axis] + alpha * d[j][axis];
          }
        }
      }
      return d[degree];
    }

    function sampleSplineCurve(points, interpolation, amount, closed, tension) {
      if (!closed && points.length === 2) {
        return sampleLinearSpline(points, amount, false);
      }
      if (interpolation === "Linear") return sampleLinearSpline(points, amount, closed);
      if (interpolation === "Akima") return sampleAkimaSpline(points, amount, closed);
      if (interpolation === "B-Spline") return sampleBSplineSpline(points, amount, closed);
      return sampleCatmullRomSpline(points, amount, closed, tension);
    }

    function createSplineTubeGeometry(centerline, radii, radialSegments, caps, capStyle) {
      const geometry = new THREE.Geometry();
      const ringCount = centerline.length;
      if (ringCount < 2) return geometry;
      const segmentCount = Math.max(3, radialSegments);

      const diffs = [];
      for (let i = 0; i < ringCount - 1; i++) {
        diffs.push(
          normalize3(
            [
              centerline[i + 1][0] - centerline[i][0],
              centerline[i + 1][1] - centerline[i][1],
              centerline[i + 1][2] - centerline[i][2],
            ],
            [0, 0, 0]
          )
        );
      }
      const tangents = [];
      for (let i = 0; i < ringCount; i++) {
        let tangent = i < ringCount - 1 && !isZero3(diffs[i]) ? diffs[i] : null;
        if (!tangent) tangent = i > 0 && !isZero3(diffs[i - 1]) ? diffs[i - 1] : null;
        tangents.push(tangent || [1, 0, 0]);
      }

      const normals = [];
      let normal = null;
      for (let i = 0; i < ringCount; i++) {
        const tangent = tangents[i];
        if (!normal) {
          const reference = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
          normal = normalize3(cross3(tangent, reference), [1, 0, 0]);
        } else {
          const dot =
            normal[0] * tangent[0] +
            normal[1] * tangent[1] +
            normal[2] * tangent[2];
          normal = normalize3(
            [
              normal[0] - tangent[0] * dot,
              normal[1] - tangent[1] * dot,
              normal[2] - tangent[2] * dot,
            ],
            normal
          );
        }
        normals.push(normal);
      }

      const rings = [];
      for (let i = 0; i < ringCount; i++) {
        const center = centerline[i];
        const tangent = tangents[i];
        const up = normals[i];
        const binormal = cross3(up, tangent);
        const radius = Math.max(radii[i], 1e-4);
        const ring = [];
        for (let j = 0; j < segmentCount; j++) {
          const angle = (Math.PI * 2 * j) / segmentCount;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          ring.push(geometry.vertices.length);
          geometry.vertices.push(
            new THREE.Vector3(
              center[0] + radius * (cos * up[0] + sin * binormal[0]),
              center[1] + radius * (cos * up[1] + sin * binormal[1]),
              center[2] + radius * (cos * up[2] + sin * binormal[2])
            )
          );
        }
        rings.push(ring);
      }

      for (let i = 0; i < ringCount - 1; i++) {
        for (let j = 0; j < segmentCount; j++) {
          const next = (j + 1) % segmentCount;
          geometry.faces.push(
            new THREE.Face3(rings[i][j], rings[i + 1][j], rings[i + 1][next]),
            new THREE.Face3(rings[i][j], rings[i + 1][next], rings[i][next])
          );
        }
      }

      const addFlatCap = (ring, center, flip) => {
        const capCenter = geometry.vertices.length;
        geometry.vertices.push(new THREE.Vector3(center[0], center[1], center[2]));
        for (let j = 0; j < segmentCount; j++) {
          const next = (j + 1) % segmentCount;
          geometry.faces.push(
            flip
              ? new THREE.Face3(capCenter, ring[next], ring[j])
              : new THREE.Face3(capCenter, ring[j], ring[next])
          );
        }
      };

      const addRoundCap = (ringIndex, direction) => {
        const baseRing = rings[ringIndex];
        const baseCenter = centerline[ringIndex];
        const tangent = tangents[ringIndex];
        const up = normals[ringIndex];
        const binormal = cross3(up, tangent);
        const capRadius = Math.max(radii[ringIndex], 1e-4);
        const steps = 6;
        let previousRing = baseRing;
        for (let step = 1; step <= steps; step++) {
          const angle = (Math.PI / 2) * (step / steps);
          const radius = capRadius * Math.cos(angle);
          const offset = capRadius * Math.sin(angle) * direction;
          const capCenter = [
            baseCenter[0] + tangent[0] * offset,
            baseCenter[1] + tangent[1] * offset,
            baseCenter[2] + tangent[2] * offset,
          ];
          if (radius <= 1e-4) {
            const poleIndex = geometry.vertices.length;
            geometry.vertices.push(new THREE.Vector3(capCenter[0], capCenter[1], capCenter[2]));
            for (let j = 0; j < segmentCount; j++) {
              const next = (j + 1) % segmentCount;
              geometry.faces.push(
                new THREE.Face3(poleIndex, previousRing[next], previousRing[j])
              );
            }
            return;
          }
          const ring = [];
          for (let j = 0; j < segmentCount; j++) {
            const theta = (Math.PI * 2 * j) / segmentCount;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta) * direction;
            ring.push(geometry.vertices.length);
            geometry.vertices.push(
              new THREE.Vector3(
                capCenter[0] + radius * (cos * up[0] + sin * binormal[0]),
                capCenter[1] + radius * (cos * up[1] + sin * binormal[1]),
                capCenter[2] + radius * (cos * up[2] + sin * binormal[2])
              )
            );
          }
          for (let j = 0; j < segmentCount; j++) {
            const next = (j + 1) % segmentCount;
            geometry.faces.push(
              new THREE.Face3(previousRing[j], ring[j], ring[next]),
              new THREE.Face3(previousRing[j], ring[next], previousRing[next])
            );
          }
          previousRing = ring;
        }
      };

      if (caps === "Both" || caps === "Start") {
        if (capStyle === "Round") addRoundCap(0, -1);
        else addFlatCap(rings[0], centerline[0], false);
      }
      if (caps === "Both" || caps === "End") {
        if (capStyle === "Round") addRoundCap(ringCount - 1, 1);
        else addFlatCap(rings[ringCount - 1], centerline[ringCount - 1], true);
      }

      geometry.computeFaceNormals();
      return geometry;
    }

    function splinePointDefinition(index) {
      return {
        name: "Point " + index,
        dynamic: true,
        group: true,
        type: PZ.property.type.VECTOR3,
        objects: [
          { dynamic: true, name: "X", type: PZ.property.type.NUMBER, value: 0, step: 1 },
          { dynamic: true, name: "Y", type: PZ.property.type.NUMBER, value: 0, step: 1 },
          { dynamic: true, name: "Z", type: PZ.property.type.NUMBER, value: 0, step: 1 },
        ],
      };
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
        super.load(data);
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
