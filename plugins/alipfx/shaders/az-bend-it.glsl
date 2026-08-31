// Panzoid CM3 – CC Bend It–style shader
precision highp float;
precision highp int;

// Panzoid built-ins
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;
varying vec2 vUvScaled;

// User properties (create these in Panzoid as dynamic properties)
uniform float Bend;              // degrees, positive bends "towards +v"
uniform vec2 Start;              // pixels
uniform vec2 End;                // pixels
uniform float Render_Prestart;   // enum as float: 0=None, 1=Static, 2=Bend, 3=Mirror
uniform float Distort;           // enum as float: 0=Legal, 1=Extended

// ---- Helpers ---------------------------------------------------------------

const float PI = 3.14159265358979323846;

int toMode(float v) { return int(floor(v + 0.5)); }

vec2 toScaledUV(vec2 pixel) {
    // Map a pixel-space coordinate to buffer UV, honoring Panzoid's uvScale.
    return (pixel / resolution) * uvScale;
}

bool inUnit(vec2 uv) {
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

// Distort sampling behavior:
//  - Legal (0): crop both X and Y; outside -> transparent
//  - Extended (1): crop X only; clamp Y; outside X -> transparent
vec4 sampleWithDistort(vec2 uv, int dMode) {
    if (dMode == 0) {
        // Legal
        if (!inUnit(uv)) return vec4(0.0);
        return texture2D(tDiffuse, uv);
    } else {
        // Extended
        if (uv.x < 0.0 || uv.x > 1.0) return vec4(0.0);
        float yClamped = clamp(uv.y, 0.0, 1.0);
        return texture2D(tDiffuse, vec2(uv.x, yClamped));
    }
}

// ---- Core bend math --------------------------------------------------------
//
// We bend a "sheet" along the line from Start to End.
// Axis unit: u. Perpendicular unit: v = rotate90(u).
// Param x = dot(p-Start, u)  : along the axis
//      y = dot(p-Start, v)  : perpendicular to axis
//
// For 0 <= x <= L, map to a circular arc with radius R = L / theta,
// where theta = radians(Bend). The base point follows the arc,
// and the sheet offset y moves along the local normal.
//
// For x > L, we continue straight along the end tangent (t̂ = [cosθ, sinθ])
// For x < 0, behavior depends on Render_Prestart mode:
//    0 None   : crop (transparent)
//    1 Static : sample original (no bend)
//    2 Bend   : continue arc backwards (φ negative)
//    3 Mirror : mirror about Start (use x' = |x|)

void main() {
    // Early exit when layer or handles degenerate
    vec2 p = vUv * resolution;

    vec2 axis = End - Start;
    float L = length(axis);
    if (L < 1e-6) {
        // No axis -> pass-through
        gl_FragColor = texture2D(tDiffuse, vUvScaled);
        return;
    }

    // Build local frame
    vec2 u = axis / L;
    vec2 v = vec2(-u.y, u.x);

    // Coordinates in local (u,v) frame
    vec2 q = p - Start;
    float x = dot(q, u);
    float y = dot(q, v);

    // Read modes
    int rMode = toMode(Render_Prestart);
    int dMode = toMode(Distort);

    // Bend angle in radians
    float theta = radians(Bend);
    // Near-zero bend -> straight
    bool noBend = abs(theta) < 1e-6;

    // Handle prestart "None" (crop) before we do any heavy math
    if (x < 0.0 && rMode == 0) {
        gl_FragColor = vec4(0.0);
        return;
    }

    // Handle prestart "Static" (no bending before Start)
    if (x < 0.0 && rMode == 1) {
        // Sample original pixel (unwarped)
        gl_FragColor = texture2D(tDiffuse, vUvScaled);
        return;
    }

    // Straight pass-through if no bend at all
    if (noBend) {
        // For Mirror mode (prestart), reflect x<0 to x>=0 in sampling? AE keeps straight.
        // We'll just pass-through for simplicity (closest to AE when Bend=0).
        gl_FragColor = texture2D(tDiffuse, vUvScaled);
        return;
    }

    // Arc radius. Sign of theta determines direction.
    float R = L / theta;

    // Local tangent and normal at a given φ
    // t̂(φ) = (cosφ)u + (sinφ)v
    // n̂(φ) = (-sinφ)u + (cosφ)v
    // Base arc point in global coords:
    // base(φ) = Start + u*(R*sinφ) + v*(R*(1 - cosφ))

    float phi; // effective bend angle at this x

    if (x <= L && x >= 0.0) {
        // Between Start and End: map to arc proportionally
        phi = theta * (x / L);
    } else if (x > L) {
        // Past End: use end tangent continuation (φ = θ)
        phi = theta;
    } else { // x < 0
        if (rMode == 2) {
            // Bend: continue arc backwards (φ negative)
            phi = theta * (x / L);
        } else if (rMode == 3) {
            // Mirror: reflect about Start
            phi = theta * (abs(x) / L);
            x = abs(x);
        } else {
            // Shouldn't reach here (None/Static handled above)
            phi = theta * (x / L);
        }
    }

    // Compute base point on arc at φ
    vec2 base = Start + u * (R * sin(phi)) + v * (R * (1.0 - cos(phi)));

    // Tangent and normal at φ
    vec2 tHat = u * cos(phi) + v * sin(phi);
    vec2 nHat = -u * sin(phi) + v * cos(phi);

    vec2 pWarp;

    if (x <= L && x >= 0.0) {
        // Within the handles: along the arc + local normal offset
        pWarp = base + y * nHat;
    } else if (x > L) {
        // Past End: straight continuation along end tangent, normal carries y
        pWarp = base + (x - L) * tHat + y * nHat;
    } else { // x < 0
        if (rMode == 2 || rMode == 3) {
            // Bent or Mirrored prestart: arc + normal (already set phi/x above)
            pWarp = base + y * nHat;
        } else {
            // Fallback (should not occur): transparent
            gl_FragColor = vec4(0.0);
            return;
        }
    }

    // Sample with Distort behavior
    vec2 uvSample = toScaledUV(pWarp);
    vec4 texel = sampleWithDistort(uvSample, dMode);

    gl_FragColor = texel;
}
