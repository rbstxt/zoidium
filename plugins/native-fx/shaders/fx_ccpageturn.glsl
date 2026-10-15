// CC Page Turn: analytic cylinder curl of the layer around a fold line.
// vUv.y = 0 is the image top (like CM3 image pixels), so the reference
// image-space math ports directly. All sampling goes through uvScale.
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform vec2 foldPos;
uniform float foldDir;
uniform float foldRadius;
uniform float lightDir;
uniform float renderMode;
uniform float backOpacity;
uniform vec3 paperColor;
uniform float backSource;

#define PI 3.141592653589793

vec4 sampleLayer(vec2 luv) {
  if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(tDiffuse, luv * uvScale);
}

// Evaluate one curl candidate. sampled = false means the caller must try
// the next candidate (hidden by Render mode or transparent source).
vec4 evalCandidate(float u, float isBack, float shade, vec2 s, vec2 n, float d, float aspect, out bool sampled) {
  bool back = isBack > 0.5;
  bool showFront = renderMode < 0.5 || renderMode > 1.5;
  bool showBack = renderMode < 1.5;
  sampled = false;
  if ((back && !showBack) || (!back && !showFront)) {
    return vec4(0.0);
  }
  vec2 sq = s + (u - d) * n;
  vec2 luv = vec2(sq.x / aspect, sq.y);
  vec4 v = sampleLayer(luv);
  if (v.a <= 0.0001) {
    return vec4(0.0);
  }
  vec3 c = v.a > 0.00001 ? v.rgb / v.a : vec3(0.0);
  if (back) {
    if (backSource > 0.5) {
      c = paperColor;
    } else {
      c = paperColor * (1.0 - backOpacity) + c * backOpacity;
    }
  }
  sampled = true;
  return vec4(c * shade * v.a, v.a);
}

void main() {
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 ar = vec2(aspect, 1.0);
  vec2 s = vUv * ar;
  vec2 sf = foldPos * ar;
  float phi = radians(foldDir);
  vec2 n = vec2(-sin(phi), cos(phi));
  float lam = radians(lightDir);
  float ldot = n.x * sin(lam) - n.y * cos(lam);
  float resY = max(resolution.y, 1.0);
  float r = max(foldRadius / resY, 0.5 / resY);
  float d = dot(s - sf, n);
  if (d > r) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float u1;
  float b1;
  float sh1;
  float u2;
  float b2;
  float sh2;
  if (d <= 0.0) {
    u1 = PI * r - d;
    b1 = 1.0;
    sh1 = 0.9;
    u2 = d;
    b2 = 0.0;
    sh2 = 1.0;
  } else {
    float a = asin(clamp(d / r, -1.0, 1.0));
    u1 = PI * r - r * a;
    b1 = 1.0;
    sh1 = 0.6 + 0.4 * cos(a);
    float psi = a / (PI * 0.5);
    u2 = r * a;
    b2 = 0.0;
    sh2 = 1.0 - 0.4 * psi * (0.5 + 0.5 * ldot);
  }
  bool ok = false;
  vec4 c1 = evalCandidate(u1, b1, sh1, s, n, d, aspect, ok);
  if (ok) {
    gl_FragColor = c1;
    return;
  }
  vec4 c2 = evalCandidate(u2, b2, sh2, s, n, d, aspect, ok);
  if (ok) {
    gl_FragColor = c2;
    return;
  }
  gl_FragColor = vec4(0.0);
}
