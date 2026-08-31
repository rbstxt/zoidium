precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUvScaled;

// ---- Custom properties (Panzoid: spaces become underscores) ----
uniform float Edge_Thickness;   // pixels
uniform float Light_Angle;      // degrees
uniform vec3  Light_Color;      // 0..1
uniform float Light_Intensity;  // 0..1 (can exceed)

// Fixed shadow color (AE-like: shadow is essentially black)
const vec3 SHADOW_COLOR = vec3(0.0);

// Samples for the soft bevel (AE Bevel Alpha is softer than Bevel Edges)
const int SAMPLES = 12;

// Helper: alpha sample
float alphaAt(vec2 uv) {
  return texture2D(tDiffuse, uv).a;
}

void main() {
  vec2 uv = vUvScaled;
  vec4 texel = texture2D(tDiffuse, uv);

  // Early out
  float thicknessPx = max(0.0, Edge_Thickness);
  if (thicknessPx <= 0.0001) {
    gl_FragColor = texel;
    return;
  }

  // Pixel step in scaled-UV space (Panzoid mapping)
  vec2 px = uvScale / resolution;

  // -------------------------------
  // AE-ish light angle mapping
  // AE default Light Angle is often -60°; we bias so -60 tends to look like AE's default direction.
  // If your highlight/shadow feel rotated vs AE, change ANGLE_OFFSET slightly.
  // -------------------------------
  const float ANGLE_OFFSET = 195.0; // tweakable constant for "AE feel"
  float rad = radians(Light_Angle + ANGLE_OFFSET);
  vec2 lightDir = normalize(vec2(cos(rad), sin(rad)));

  // -----------------------------------------
  // 1) Bevel from ALPHA edges (main AE mode)
  // -----------------------------------------
  float accum = 0.0;
  float wsum  = 0.0;

  for (int i = 1; i <= SAMPLES; i++) {
    float t = float(i) / float(SAMPLES); // 0..1
    float w = 1.0 - t;                   // stronger near edge
    vec2 off = lightDir * (t * thicknessPx) * px;

    float ap = alphaAt(uv + off);
    float am = alphaAt(uv - off);

    accum += (ap - am) * w;
    wsum  += w;
  }

  float bevelAlpha = (wsum > 0.0) ? (accum / wsum) : 0.0;

  // Mask the bevel to the edge area (keeps interior flatter)
  float edgeMask = clamp(abs(bevelAlpha) * 2.0, 0.0, 1.0);
  edgeMask *= smoothstep(0.0, 0.01, texel.a); // avoid affecting fully transparent pixels

  // ---------------------------------------------------------
  // 2) AE behavior: if layer is fully opaque, bevel the BBOX
  // (AE manual: fully opaque → bevel applies to bounding box)
  // We detect "locally opaque everywhere" using neighborhood samples.
  // ---------------------------------------------------------
  float opaqueTest = texel.a;
  // quick neighborhood check (small)
  opaqueTest = min(opaqueTest, alphaAt(uv + vec2( 1.0, 0.0) * px));
  opaqueTest = min(opaqueTest, alphaAt(uv + vec2(-1.0, 0.0) * px));
  opaqueTest = min(opaqueTest, alphaAt(uv + vec2(0.0,  1.0) * px));
  opaqueTest = min(opaqueTest, alphaAt(uv + vec2(0.0, -1.0) * px));

  bool fullyOpaqueLocal = (opaqueTest > 0.999);

  // Bounding-box bevel mask + direction signal (only if fully opaque)
  float bevelBBox = 0.0;
  float bboxMask  = 0.0;

  if (fullyOpaqueLocal) {
    // distance to nearest box edge in UV units (vUvScaled ranges 0..uvScale)
    float dL = uv.x;
    float dR = uvScale.x - uv.x;
    float dB = uv.y;
    float dT = uvScale.y - uv.y;

    float dMin = min(min(dL, dR), min(dB, dT)); // nearest distance to box edge (UV)
    float distPx = dMin / max(px.x, px.y);      // approx pixels

    bboxMask = 1.0 - clamp(distPx / thicknessPx, 0.0, 1.0);

    // Determine approximate outward normal of nearest edge
    vec2 n = vec2(0.0);
    if (dMin == dL) n = vec2(-1.0, 0.0);
    else if (dMin == dR) n = vec2( 1.0, 0.0);
    else if (dMin == dB) n = vec2(0.0, -1.0);
    else                 n = vec2(0.0,  1.0);

    bevelBBox = dot(n, lightDir) * bboxMask;
  }

  // Choose alpha-bevel normally; if fully opaque, prefer bbox bevel
  float bevel = fullyOpaqueLocal ? bevelBBox : bevelAlpha;
  float mask  = fullyOpaqueLocal ? bboxMask  : edgeMask;

  // -------------------------------
  // Lighting application (AE-like)
  // Highlights tinted by Light Color
  // Shadows go toward black (fixed)
  // Both driven by Light Intensity
  // -------------------------------
  float intensity = max(0.0, Light_Intensity);

  float hi = max(bevel, 0.0) * intensity;
  float sh = max(-bevel, 0.0) * intensity;

  vec3 col = texel.rgb;

  // Highlight: mix toward Light_Color
  col = mix(col, Light_Color, clamp(mask * hi, 0.0, 1.0));

  // Shadow: mix toward black
  col = mix(col, SHADOW_COLOR, clamp(mask * sh, 0.0, 1.0));

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), texel.a);
}
