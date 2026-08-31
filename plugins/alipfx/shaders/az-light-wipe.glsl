precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// Panzoid properties (names must match your UI properties)
uniform float Completion;            // 0..100
uniform vec2  Center;                // 0..1
uniform float Intensity;             // 0..100
uniform float Shape;                 // 0=Doors, 1=Radial, 2=Square
uniform float Direction;             // degrees
uniform float Color_From_Source;     // 0/1
uniform vec3  Color;                 // tint
uniform float Reverse_Transition;    // 0/1

// Hash helpers
float hash1(float n) { return fract(sin(n) * 43758.5453123); }

// Screen blend (AE-like brightening)
vec3 screenBlend(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }

// Max distance to cover full frame (pixel space)
float maxDistanceForShape(int shapeId, vec2 centerPx, vec2 dirUnit, vec2 orthoUnit) {
  vec2 c0 = vec2(0.0, 0.0) - centerPx;
  vec2 c1 = vec2(resolution.x, 0.0) - centerPx;
  vec2 c2 = vec2(0.0, resolution.y) - centerPx;
  vec2 c3 = vec2(resolution.x, resolution.y) - centerPx;

  float m = 0.0;

  if (shapeId == 1) {
    m = max(m, length(c0));
    m = max(m, length(c1));
    m = max(m, length(c2));
    m = max(m, length(c3));
  } else {
    // helper: evaluate
    float x0 = dot(c0, dirUnit), y0 = dot(c0, orthoUnit);
    float x1 = dot(c1, dirUnit), y1 = dot(c1, orthoUnit);
    float x2 = dot(c2, dirUnit), y2 = dot(c2, orthoUnit);
    float x3 = dot(c3, dirUnit), y3 = dot(c3, orthoUnit);

    if (shapeId == 2) {
      m = max(m, max(abs(x0), abs(y0)));
      m = max(m, max(abs(x1), abs(y1)));
      m = max(m, max(abs(x2), abs(y2)));
      m = max(m, max(abs(x3), abs(y3)));
    } else {
      m = max(m, abs(y0));
      m = max(m, abs(y1));
      m = max(m, abs(y2));
      m = max(m, abs(y3));
    }
  }

  return max(m, 1.0);
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // Normalize parameters
  float c = clamp(Completion / 100.0, 0.0, 1.0);
  float inten = clamp(Intensity / 100.0, 0.0, 1.0);
  // Make intensity feel more AE-like (stronger at higher values)
  float intenPow = pow(inten, 0.65);

  int shapeId = int(floor(Shape + 0.5)); // 0,1,2

  // Direction disabled for radial in AE
  float ang = radians(Direction);
  if (shapeId == 1) ang = 0.0;

  vec2 centerUv = Center;
  vec2 centerPx = centerUv * resolution;

  // Pixel space from center
  vec2 pPx = (vUv - centerUv) * resolution;

  // Direction basis
  vec2 dirUnit   = vec2(cos(ang), sin(ang));
  vec2 orthoUnit = vec2(-dirUnit.y, dirUnit.x);

  // Distance field per shape (pixels)
  float d;
  vec2 normalUnit;

  if (shapeId == 1) {
    float lenp = max(length(pPx), 1e-6);
    d = lenp;
    normalUnit = pPx / lenp;
  } else {
    float x = dot(pPx, dirUnit);
    float y = dot(pPx, orthoUnit);

    if (shapeId == 2) {
      float ax = abs(x), ay = abs(y);
      d = max(ax, ay);

      if (ax > ay) normalUnit = dirUnit * sign(x);
      else         normalUnit = orthoUnit * sign(y);

      if (length(normalUnit) < 1e-6) normalUnit = dirUnit;
    } else {
      d = abs(y);
      normalUnit = orthoUnit * (y >= 0.0 ? 1.0 : -1.0);
    }
  }

  float maxD = maxDistanceForShape(shapeId, centerPx, dirUnit, orthoUnit);

  // Boundary based on completion & reverse
  float boundary = (Reverse_Transition >= 0.5)
    ? (1.0 - c) * maxD
    : c * maxD;

  // Signed distance relative to boundary (pixels)
  float s = d - boundary;

  // Anti-alias width (no derivatives available)
  float aa = 1.25;

  // Opaque mask: 100% completion => transparent (transition finished)
  float opaque;
  if (Reverse_Transition >= 0.5) {
    // Opaque INSIDE the shrinking region
    opaque = smoothstep(-aa, aa, -s);
  } else {
    // Opaque OUTSIDE the expanding wiped region
    opaque = smoothstep(-aa, aa,  s);
  }

  // ---------------------------
  // AE-LIKE HALO: core + glow
  // ---------------------------

  float distToEdge = abs(s);

  // Thin bright core line (~1-2px)
  float coreWidth = mix(2.2, 1.2, intenPow);
  float core = exp(-distToEdge / max(coreWidth, 1e-3));

  // Wide bloom/glow (bigger like AE)
  float glowSigma = mix(18.0, 45.0, intenPow);     // px
  float glow = exp(-(distToEdge * distToEdge) / (2.0 * glowSigma * glowSigma));

  // Gate glow so it mostly appears near the edge but still spreads
  float edgeGate = smoothstep(160.0, 0.0, distToEdge); // fade far away
  glow *= edgeGate;

  // ---------------------------
  // RAYS (streaks outward)
  // ---------------------------
  // Rays in CC Light Wipe feel like they radiate from the CENTER.
  float r = length(pPx);
  float angle = atan(pPx.y, pPx.x); // -pi..pi
  float a01 = (angle + 3.14159265) / (6.2831853); // 0..1

  // Ray count & randomness
  float rayCount = 80.0;
  float id = floor(a01 * rayCount);
  float h = hash1(id * 19.73 + 3.1);
  // Create sharp spikes
  float spike = pow(h, 5.0);
  // Add a little periodic structure for “Cycore-ish” look
  float wav = 0.5 + 0.5 * sin(a01 * rayCount * 6.2831853 + h * 6.0);
  float rayMask = clamp(mix(spike, wav, 0.35), 0.0, 1.0);
  rayMask = smoothstep(0.55, 1.0, rayMask); // keep only stronger streaks

  // Ray length falloff (longer = more AE)
  float rayDecay = mix(110.0, 320.0, intenPow); // px
  float rayFall = exp(-r / rayDecay);

  // Rays should be strongest where the edge is
  float rayEdge = exp(-distToEdge / 14.0);

  float rays = rayMask * rayFall * rayEdge;

  // Combine halo components
  float haloStrength =
      (core * (1.4 + 3.2 * intenPow) +
       glow * (0.6 + 2.4 * intenPow) +
       rays * (0.8 + 3.8 * intenPow));

  // Optional: fade at very start/end (AE looks cleaner)
  float fadeIn  = smoothstep(0.00, 0.03, c);
  float fadeOut = 1.0 - smoothstep(0.97, 1.00, c);
  haloStrength *= (fadeIn * fadeOut);

  // ---------------------------
  // HALO COLOR
  // ---------------------------
  vec3 haloColor = Color;

  if (Color_From_Source >= 0.5) {
    // Sample the source color AT the boundary along normal direction
    vec2 boundaryPx = centerPx + normalUnit * boundary;
    vec2 boundaryUv = clamp(boundaryPx / resolution, vec2(0.0), vec2(1.0));
    vec4 edgeSample = texture2D(tDiffuse, boundaryUv * uvScale);

    // CC Light Wipe often “pops” brighter than source, so boost toward white a bit
    vec3 src = edgeSample.rgb;
    float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));
    // If source is dark, push glow toward white so it’s still visible like AE
    vec3 boosted = mix(src, vec3(1.0), clamp(0.55 - lum, 0.0, 0.55));
    haloColor = mix(src, boosted, 0.65);
  }

  // ---------------------------
  // COMPOSITE
  // ---------------------------
  vec4 base = vec4(texel.rgb, texel.a) * opaque;

  // Make halo look “overexposed”: screen blend + add
  vec3 haloRgb = haloColor * clamp(haloStrength, 0.0, 1.0);
  vec3 outRgb = screenBlend(base.rgb, haloRgb);
  outRgb = clamp(outRgb + haloRgb * 0.55, 0.0, 1.0);

  // Alpha: ensure halo still draws even where base is transparent
  float haloA = clamp(haloStrength * 0.85, 0.0, 1.0);
  float outA = max(base.a, haloA);

  gl_FragColor = vec4(outRgb, outA);
}
