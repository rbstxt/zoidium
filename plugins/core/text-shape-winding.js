(function installTextShapeWindingPatch() {
  "use strict";

  if (
    typeof THREE === "undefined" ||
    !THREE.ShapePath ||
    !THREE.ShapePath.prototype ||
    typeof THREE.ShapePath.prototype.toShapes !== "function" ||
    THREE.ShapePath.prototype.__zoidiumTextShapeWindingPatch
  ) {
    return;
  }

  const shapePathPrototype = THREE.ShapePath.prototype;
  const originalToShapes = shapePathPrototype.toShapes;

  function pointInPolygon(point, polygon) {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];

      if (
        (a.y > point.y) !== (b.y > point.y) &&
        point.x <
          ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }

    return inside;
  }

  function getBounds(points) {
    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };

    for (const point of points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }

    return bounds;
  }

  function boundsContain(outer, inner) {
    return (
      outer.minX <= inner.minX &&
      outer.minY <= inner.minY &&
      outer.maxX >= inner.maxX &&
      outer.maxY >= inner.maxY
    );
  }

  // The bounding-box center is usually inside a glyph contour. For concave
  // contours, use the midpoint of the first two horizontal intersections as
  // a fallback. This gives nesting tests a point that is inside the contour
  // instead of merely somewhere inside its bounding box.
  function getInteriorPoint(points, bounds) {
    const point = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };

    if (pointInPolygon(point, points)) return point;

    const intercepts = [];
    const y = point.y;

    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];

      if ((a.y > y) !== (b.y > y)) {
        intercepts.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }

    if (intercepts.length > 1) {
      intercepts.sort((a, b) => a - b);
      point.x = (intercepts[0] + intercepts[1]) / 2;
    }

    return point;
  }

  function createShapesFromContours(shapePath) {
    const entries = [];

    for (const subPath of shapePath.subPaths || []) {
      const points = subPath.getPoints();
      if (!points || points.length < 3) continue;

      const area = THREE.ShapeUtils.area(points);
      if (area === 0) continue;

      const bounds = getBounds(points);
      entries.push({
        subPath,
        points,
        bounds,
        interiorPoint: getInteriorPoint(points, bounds),
        absArea: Math.abs(area),
        // ShapeUtils uses positive area for counter-clockwise contours.
        winding: area < 0 ? -1 : 1,
        container: null,
        excluded: false,
        role: null,
      });
    }

    // A containing contour must have a larger absolute area, so processing
    // large contours first lets us find the nearest container deterministically.
    entries.sort((a, b) => b.absArea - a.absArea);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let containerWinding = 0;

      for (let j = i - 1; j >= 0; j--) {
        const candidate = entries[j];
        if (!boundsContain(candidate.bounds, entry.bounds)) continue;
        if (!pointInPolygon(entry.interiorPoint, candidate.points)) continue;

        entry.container = candidate.excluded
          ? candidate.container
          : candidate;
        containerWinding = candidate.winding;
        entry.winding += containerWinding;
        break;
      }

      // Non-zero winding is the rule used by the old Three.js font path
      // conversion. Exclude contours which do not change filled/unfilled
      // state; retaining them would create redundant overlapping shapes.
      if ((entry.winding !== 0) === (containerWinding !== 0)) {
        entry.excluded = true;
      }
    }

    for (const entry of entries) {
      if (entry.excluded) continue;
      entry.role =
        entry.container === null || entry.container.role === "hole"
          ? "outer"
          : "hole";
    }

    const shapes = [];
    const shapeByEntry = new Map();

    for (const entry of entries) {
      if (entry.excluded || entry.role !== "outer") continue;

      const shape = new THREE.Shape();
      shape.curves = entry.subPath.curves;
      shapes.push(shape);
      shapeByEntry.set(entry, shape);
    }

    for (const entry of entries) {
      if (entry.excluded || entry.role !== "hole") continue;

      const shape = shapeByEntry.get(entry.container);
      if (!shape) continue;

      const hole = new THREE.Path();
      hole.curves = entry.subPath.curves;
      shape.holes.push(hole);
    }

    return shapes;
  }

  shapePathPrototype.toShapes = function toShapesWithCorrectWinding(
    isCCW,
    noHoles,
  ) {
    // Keep Three.js r91's legacy options intact for non-font callers. The
    // bundled Font implementation calls toShapes() without arguments.
    if (arguments.length > 0) {
      return originalToShapes.apply(this, arguments);
    }

    return createShapesFromContours(this);
  };

  shapePathPrototype.__zoidiumTextShapeWindingPatch = true;
})();
