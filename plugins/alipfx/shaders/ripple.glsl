precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

/*
Panzoid custom properties you should create with THESE names:

1. Radius             -> Number (dynamic)
2. Center of Ripple   -> 2D Vector
3. Type of Conversion -> Number (dynamic)  // 0 = Asymmetric, 1 = Symmetric
4. Wave Speed         -> Number (dynamic)
5. Wave Width         -> Number (dynamic)
6. Wave Height        -> Number (dynamic)
7. Ripple Phase       -> Number (dynamic)  // degrees
8. time               -> Number (dynamic)  // seconds

Panzoid converts spaces to underscores in GLSL:
"Center of Ripple"   => Center_of_Ripple
"Type of Conversion" => Type_of_Conversion
"Wave Speed"         => Wave_Speed
"Wave Width"         => Wave_Width
"Wave Height"        => Wave_Height
"Ripple Phase"       => Ripple_Phase
*/

uniform float Radius;
uniform vec2 Center_of_Ripple;
uniform float Type_of_Conversion;
uniform float Wave_Speed;
uniform float Wave_Width;
uniform float Wave_Height;
uniform float Ripple_Phase;
uniform float time;

const float PI  = 3.1415926535897932384626433832795;
const float TAU = 6.2831853071795864769252867665590;

/*
AE-like radius behavior:
- full strength inside Radius
- fades smoothly from Radius to 2*Radius
- no effect beyond 2*Radius
*/
float radiusEnvelope(float distPx, float radiusPx) {
    if (radiusPx <= 0.0) return 0.0;
    return 1.0 - smoothstep(radiusPx, radiusPx * 2.0, distPx);
}

/*
Symmetric mode height field:
Balanced and even.
This creates the broad, uniform pulse-like behavior seen in your symmetric screenshot.
*/
float symmetricHeight(float phase) {
    return sin(phase);
}

/*
Asymmetric mode height field:
Skewed / liquid-like and intentionally not a pure sine.
The positive crest is narrower and stronger, while the negative trough is broader and softer.
This is tuned for the kind of choppy, watery behavior visible in your asymmetric screenshots.
*/
float asymmetricHeight(float phase) {
    float p = phase
            + 0.52 * sin(phase)
            + 0.10 * sin(2.0 * phase - 0.30);

    float s = sin(p);

    float crest  = 1.02 * pow(max(s, 0.0), 1.55);
    float trough = -0.70 * pow(max(-s, 0.0), 0.78);

    float detail = 0.045 * sin(2.0 * phase - 1.05);

    return clamp(crest + trough + detail, -1.0, 1.0);
}

/*
Derivative / slope via finite difference.
This is the key difference from v1:
we distort by the wave slope instead of the raw wave height,
which makes the result look much more like refractive ripple rings.
*/
float symmetricSlope(float phase) {
    return cos(phase);
}

float asymmetricSlope(float phase) {
    float eps = 0.03;
    float a = asymmetricHeight(phase - eps);
    float b = asymmetricHeight(phase + eps);
    return (b - a) / (2.0 * eps);
}

void main() {
    // Current fragment in pixel space
    vec2 fragPx = vUv * resolution;

    // AE-style top-left center coordinates
    vec2 centerPx = vec2(
        Center_of_Ripple.x,
        resolution.y - Center_of_Ripple.y
    );

    vec2 delta = fragPx - centerPx;
    float distPx = length(delta);

    // Safe radial direction
    vec2 dir = delta / max(distPx, 1e-6);

    // Envelope from Radius
    float env = radiusEnvelope(distPx, Radius);

    // Wave width in pixels
    float widthPx = max(Wave_Width, 1e-4);

    // Ripple Phase is treated like AE degrees
    float phaseCycles = Ripple_Phase / 360.0;

    // Traveling radial phase
    float phase = TAU * ((distPx / widthPx) - (Wave_Speed * time) + phaseCycles);

    // Height fields
    float hSym  = symmetricHeight(phase);
    float hAsym = asymmetricHeight(phase);

    // Slopes (refraction-like behavior)
    float sSym  = symmetricSlope(phase);
    float sAsym = asymmetricSlope(phase);

    // 0 = Asymmetric, 1 = Symmetric
    float useSym = step(0.5, Type_of_Conversion);

    // Blend height and slope based on conversion type
    float heightField = mix(hAsym, hSym, useSym);
    float slopeField  = mix(sAsym, sSym, useSym);

    /*
    V2 displacement model:
    - main motion comes from slopeField (refraction-like)
    - small contribution from heightField keeps the ripple from looking too "flat"
    - symmetric mode is intentionally smoother / broader
    - asymmetric mode is intentionally choppier / denser
    */

    float slopeGain  = mix(0.95, 0.72, useSym);
    float heightGain = mix(0.18, 0.10, useSym);

    float displacementPx =
        Wave_Height * env * (slopeField * slopeGain + heightField * heightGain);

    // Radial displacement
    vec2 displacedPx = fragPx + dir * displacementPx;

    // Convert back to buffer UV space for Panzoid sampling
    vec2 sampleUv = (displacedPx / resolution) * uvScale;

    // Clamp to avoid sampling outside the source buffer
    sampleUv = clamp(sampleUv, vec2(0.0), uvScale);

    gl_FragColor = texture2D(tDiffuse, sampleUv);
}
