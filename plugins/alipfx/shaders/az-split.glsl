precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// Custom properties (spaces -> underscores)
uniform vec2 Point_A;
uniform vec2 Point_B;
uniform float Split;

vec4 sampleLayer(vec2 uv)
{
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(tDiffuse, uv * uvScale);
}

void main()
{
  // --- HARD BYPASS WHEN SPLIT IS (NEAR) ZERO ---
  // This removes the residual AA mask line entirely.
  float splitAbs = abs(Split);
  if (splitAbs < 1e-4) {
    gl_FragColor = texture2D(tDiffuse, vUvScaled);
    return;
  }

  vec2 A = Point_A;
  vec2 B = Point_B;

  vec2 d = B - A;
  float L = length(d);

  if (L < 1e-5) {
    gl_FragColor = texture2D(tDiffuse, vUvScaled);
    return;
  }

  vec2 p = vUv * resolution;

  // Tangent and normal
  vec2 t = d / L;
  vec2 n = normalize(vec2(-t.y, t.x));

  // Position along the AB segment in pixels
  float u = dot(p - A, t);   // 0..L
  float s = u / L;           // 0..1

  // Signed distance to the AB line
  float distN = dot(p - A, n);
  float absDistN = abs(distN);
  float sgn = (distN >= 0.0) ? 1.0 : -1.0;

  // Segment mask with pixel-based taper
  float taperPx = clamp(0.12 * L, 18.0, 90.0);
  float segMask = step(0.0, u) * step(u, L);
  float endMask = smoothstep(0.0, taperPx, u) * smoothstep(0.0, taperPx, (L - u));
  segMask *= endMask;

  // AE-like mouth profile along AB
  float sc = clamp(s, 0.0, 1.0);
  float profile = sin(3.14159265 * sc);
  profile = pow(max(profile, 0.0), 2.6);
  profile *= segMask;

  // Half-gap at this 's'
  float gapHalf = 0.5 * Split * profile;

  // Smooth influence away from the split line
  float sigma = max(1.0, splitAbs * 0.65);
  float influence = exp(-absDistN / sigma);

  // Inverse warp sample
  float disp = gapHalf * influence;
  vec2 sampleUv = (p - n * disp * sgn) / resolution;

  vec4 col = sampleLayer(sampleUv);

  // True cutout gap (AA)
  float aa = 1.25;
  float outsideGap = smoothstep(gapHalf - aa, gapHalf + aa, absDistN);

  // Only cut inside segment region
  float gapMask = mix(1.0, outsideGap, segMask);

  gl_FragColor = col * gapMask;
}
