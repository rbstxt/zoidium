"use strict";

// Geometry+ tube builders: lathe profiles, hollow cylinders, helical tubes,
// and spline-swept tubes with flat or round caps. Each takes the host THREE
// as its first argument; otherwise they depend only on the value helpers
// and the spline vector math.

const { numberValue } = require("./geometry-helpers.js");
const {
  cross3,
  isZero3,
  normalize3,
} = require("./spline-math.js");

function createLatheProfileGeometry(THREE, profile, radialSegments) {
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

function createHollowCylinderGeometry(THREE,
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

function createHelixGeometry(THREE,
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

function createSplineTubeGeometry(THREE, centerline, radii, radialSegments, caps, capStyle) {
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
module.exports = {
  createLatheProfileGeometry,
  createHollowCylinderGeometry,
  createHelixGeometry,
  createSplineTubeGeometry,
};
