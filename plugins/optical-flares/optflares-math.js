"use strict";

// OpenZoid Optical Flares - projection and layout math.
//
// Pure functions only: no globals, clocks, randomness or retained state. The
// flare object calls them from its render hook with the camera that is drawing
// the layer, so a flare's screen position depends only on the scene state of
// that frame.
//
// Layout units: the screen height spans 2 units with the origin at the screen
// centre, and x is scaled by the view aspect (width / height). Element sizes
// and offsets are expressed in these units, so they are resolution independent.

const flareMath = (function () {
    const math = {};

    // Three.js Matrix4.elements are column-major: element[column * 4 + row].
    function transform(m, x, y, z) {
        return [
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
            m[3] * x + m[7] * y + m[11] * z + m[15],
        ];
    }

    function clamp(value, min, max) {
        return value < min ? min : value > max ? max : value;
    }

    // Projects a world point through a camera. `view` is the camera's
    // matrixWorldInverse and `proj` its projectionMatrix (both elements arrays).
    // Returns null when the point is on or behind the camera plane. The camera
    // looks down -Z in view space, so a point in front has negative view z.
    math.projectPoint = function (world, view, proj) {
        const v = transform(view, world[0], world[1], world[2]);
        if (!(v[2] < 0)) return null;
        const c = transform(proj, v[0], v[1], v[2]);
        if (!c[3]) return null;
        return {
            x: c[0] / c[3],
            y: c[1] / c[3],
            z: c[2] / c[3],
            distance: -v[2],
        };
    };

    // Visibility of a projected source: 1 inside the screen, fading linearly to
    // 0 across `margin` (in NDC units beyond the edge), 0 beyond it or outside
    // the depth range.
    math.sourceFade = function (ndc, margin) {
        if (!ndc || ndc.z < -1 || ndc.z > 1) return 0;
        const edge = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
        if (edge <= 1) return 1;
        const limit = 1 + Math.max(0, margin || 0);
        if (edge >= limit) return 0;
        return (limit - edge) / (limit - 1);
    };

    // NDC point to layout units for a view with the given aspect (width/height).
    math.toLayout = function (ndcX, ndcY, aspect) {
        return [ndcX * aspect, ndcY];
    };

    // Pixel offset from the screen centre, as stored by Optical Flares
    // (Center Position and the 2D source), to layout units. Y is stored with
    // the opposite sign of the screen Y axis.
    math.offsetToLayout = function (offset, resolutionY) {
        const scale = 2 / Math.max(resolutionY, 1);
        return [offset[0] * scale, 0 - offset[1] * scale];
    };

    // Size multiplier from the source distance. falloff 0 disables the effect.
    math.distanceScale = function (distance, reference, falloff) {
        if (!falloff) return 1;
        const d = Math.max(distance, 0.0001);
        const ref = Math.max(reference, 0.0001);
        return clamp(Math.pow(ref / d, falloff), 0.05, 20);
    };

    // Complete screen state of a 3D source for one camera, or null when the
    // flare must not be drawn. `world` is the source's world position.
    math.screenState = function (options) {
        const ndc = math.projectPoint(options.world, options.view, options.proj);
        const fade = math.sourceFade(ndc, options.margin);
        if (fade <= 0) return null;
        return {
            source: math.toLayout(ndc.x, ndc.y, options.aspect),
            depth: ndc.z,
            fade: fade,
            scale: math.distanceScale(ndc.distance, options.reference, options.falloff),
        };
    };

    // Intensity of the non-glow elements for a source-to-centre distance in
    // layout units. Mirrors `axisFade` in the fragment shader: 0 when the two
    // coincide, 1 from 0.02 units (about 1% of the frame height) outwards.
    math.axisFade = function (length) {
        const t = clamp(length / 0.02, 0, 1);
        return t * t * (3 - 2 * t);
    };

    // Anchor of one element along the layout axis. This mirrors the fragment
    // shader: elements sit on the line from the source through the centre,
    // rotated by the Rotation Offset, at `distance` (1 = the centre).
    math.elementAnchor = function (source, center, distance, rotationOffset) {
        const dx = center[0] - source[0];
        const dy = center[1] - source[1];
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(length < 0.000001 ? -0.7071 : dy, length < 0.000001 ? 0.7071 : dx) + rotationOffset;
        const reach = length < 0.000001 ? 0 : length * distance;
        return [source[0] + Math.cos(angle) * reach, source[1] + Math.sin(angle) * reach];
    };

    return math;
})();

if (typeof PZ !== "undefined" && PZ) {
    PZ.opticalflares = PZ.opticalflares || {};
    PZ.opticalflares.math = flareMath;
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = flareMath;
}
