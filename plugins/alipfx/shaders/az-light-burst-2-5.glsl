precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

/* ---- Custom properties ---- */
uniform vec2 Center;        // pixels (AE-style: origin top-left, Y down)
uniform float Intensity;    // 100 = default-ish
uniform float Ray_Length;   // pixels
uniform float Burst;        // 0 Straight, 1 Fade, 2 Center
uniform float Halo_Alpha;   // 0/1
uniform float Set_Color;    // 0/1
uniform vec3 Color;         // tint color

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec4 texAt(vec2 uv01) {
  return texture2D(tDiffuse, uv01 * uvScale);
}

float alphaEdge(vec2 uv01) {
  vec2 px = 1.0 / resolution;

  float ax = texAt(uv01 + vec2(px.x, 0.0)).a;
  float bx = texAt(uv01 - vec2(px.x, 0.0)).a;
  float ay = texAt(uv01 + vec2(0.0, px.y)).a;
  float by = texAt(uv01 - vec2(0.0, px.y)).a;

  float gx = abs(ax - bx);
  float gy = abs(ay - by);

  return clamp((gx + gy) * 0.75, 0.0, 1.0);
}

float sourceStrength(vec4 s, vec2 uv01) {
  if (Halo_Alpha >= 0.5) {
    return alphaEdge(uv01);
  } else {
    return clamp(luma(s.rgb) * s.a, 0.0, 1.0);
  }
}

void main() {
  vec2 uv = vUv;
  vec4 base = texture2D(tDiffuse, vUvScaled);

  // AE-style pixel center -> Panzoid UV (flip Y)
  vec2 cUv = vec2(
    Center.x / resolution.x,
    1.0 - (Center.y / resolution.y)
  );

  vec2 d = uv - cUv;
  float dist = length(d);
  vec2 dir = d / max(dist, 1e-6);

  // Ray length in pixels -> UV (use min dimension for consistent feel)
  float denom = max(min(resolution.x, resolution.y), 1.0);
  float rayLenUv = abs(Ray_Length) / denom;

  const int MAX_SAMPLES = 96;

  float lenPx = abs(Ray_Length);

  // sample count scales with length (smooth like AE)
  float sCount = clamp(10.0 + sqrt(lenPx) * 6.0, 12.0, float(MAX_SAMPLES));
  int samples = int(sCount);

  // ✅ avoid max(int,int) : make safeSamples as float
  int safeSamplesInt = (samples > 0) ? samples : 1;
  float safeSamples = float(safeSamplesInt);

  float stepUv = rayLenUv / safeSamples;

  vec3 accumRGB = vec3(0.0);
  float accumA = 0.0;
  float wsum = 0.0;

  float inten = max(Intensity, 0.0) / 100.0;
  int mode = int(floor(Burst + 0.5)); // 0/1/2

  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= samples) break;

    float t = float(i) * stepUv;

    // sample toward center (gives outward streaks)
    vec2 suv1 = clamp(uv - dir * t, vec2(0.0), vec2(1.0));
    vec4 s1 = texAt(suv1);
    float src1 = sourceStrength(s1, suv1);

    float w1 = 1.0;

    // Fade mode falloff
    if (mode == 1) {
      float f = 1.0 - (t / max(rayLenUv, 1e-6));
      w1 = clamp(f * f, 0.0, 1.0);
    }

    vec3 rayColor1 = (Set_Color >= 0.5) ? Color : s1.rgb;

    accumRGB += rayColor1 * (src1 * w1);
    accumA   += src1 * w1;
    wsum     += w1;

    // Center mode: blur both directions
    if (mode == 2) {
      vec2 suv2 = clamp(uv + dir * t, vec2(0.0), vec2(1.0));
      vec4 s2 = texAt(suv2);
      float src2 = sourceStrength(s2, suv2);

      vec3 rayColor2 = (Set_Color >= 0.5) ? Color : s2.rgb;

      accumRGB += rayColor2 * (src2 * w1);
      accumA   += src2 * w1;
      wsum     += w1;
    }
  }

  vec3 burstRGB = (wsum > 0.0) ? (accumRGB / wsum) : vec3(0.0);
  float burstA  = (wsum > 0.0) ? (accumA   / wsum) : 0.0;

  // Intensity response (AE-ish additive light)
  burstA   = clamp(burstA * inten, 0.0, 8.0);
  burstRGB = burstRGB * burstA;

  vec3 outRGB = base.rgb + burstRGB;
  float outA  = clamp(max(base.a, base.a + burstA * 0.25), 0.0, 1.0);

  gl_FragColor = vec4(outRGB, outA);
}
