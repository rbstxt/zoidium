// Radio Waves (NATIVE FX): analytic concentric waves from a producer point.
// Each live wave is one entry of the uniform tables (centre, radius,
// half-width, rotation, fade, color, shape); the pixel shader only evaluates
// the closed-form distance to each wave. No particle history.
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

#define MAX_WAVES 24

uniform vec4 uWavesA[MAX_WAVES]; // cx, cy, radius, halfWidth (px, y down)
uniform vec4 uWavesB[MAX_WAVES]; // rotation, fade, opacity, sides (0 = circle)
uniform vec4 uWavesC[MAX_WAVES]; // stroke color rgb, color alpha
uniform vec4 uWavesD[MAX_WAVES]; // star inner factor (0 = plain polygon), spare, spare, spare
uniform float uWaveCount;
uniform float uProfile;   // 0..6 stroke profile
uniform float uComposite; // 1 = blend over the layer, 0 = waves on transparency

float zss(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a;
  float t = clamp(dot(p - a, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
  return length(p - (a + e * t));
}

// Signed distance to a regular polygon (starK == 0) or star outline with the
// given circumradius, centred at the origin. Vertices sit at relative angles
// 2*PI*k/sides (the top vertex first, matching the reference unit outline
// rotated by rot). Dihedral fold: every pixel maps into one sector, so only
// the two edges around the sector vertex are measured.
float polySD(vec2 dp, float R, float sides, float starK, float rot) {
  float r = length(dp);
  if (r < 1e-9) {
    return -R;
  }
  float an = 3.14159265 / sides;
  float theta = atan(dp.y, dp.x) - rot + 1.5707963;
  float a = mod(theta + an, 2.0 * an) - an;
  vec2 v = vec2(r * cos(a), abs(r * sin(a)));
  vec2 v0 = vec2(R, 0.0);
  vec2 v1;
  if (starK > 0.0) {
    v1 = vec2(starK * R * cos(an), starK * R * sin(an));
  } else {
    v1 = vec2(R * cos(2.0 * an), R * sin(2.0 * an));
  }
  float d = min(segDist(v, v0, v1), segDist(vec2(v.x, -v.y), v0, v1));
  vec2 e = v1 - v0;
  vec2 w = v - v0;
  float cross_ = e.x * w.y - e.y * w.x;
  return cross_ > 0.0 ? -d : d;
}

float profile(float u) {
  float c = clamp(u, -1.0, 1.0);
  int kind = int(uProfile + 0.5);
  if (kind == 1) {
    return (1.0 - c) * 0.5;
  } else if (kind == 2) {
    return (1.0 + c) * 0.5;
  } else if (kind == 3) {
    return 1.0 - abs(c);
  } else if (kind == 4) {
    return cos(c * 1.5707963);
  } else if (kind == 5) {
    return c < 0.0 ? 1.0 + c : 1.0;
  } else if (kind == 6) {
    return c > 0.0 ? 1.0 - c : 1.0;
  }
  return 1.0;
}

vec4 over(vec4 dst, vec4 src) {
  return src + dst * (1.0 - src.a);
}

void main() {
  vec2 p = vec2(vUv.x * resolution.x, (1.0 - vUv.y) * resolution.y);
  vec4 out_;
  if (uComposite > 0.5) {
    out_ = texture2D(tDiffuse, vUv * uvScale);
  } else {
    out_ = vec4(0.0);
  }
  int count = int(min(uWaveCount + 0.5, float(MAX_WAVES)));
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= count) {
      break;
    }
    vec4 A = uWavesA[i];
    vec4 B = uWavesB[i];
    vec2 dp = p - A.xy;
    float d;
    if (B.w < 0.5) {
      d = length(dp) - A.z;
    } else {
      d = polySD(dp, A.z, B.w, uWavesD[i].x, B.x);
    }
    float hw = max(A.w, 1e-4);
    float cov = clamp((hw - abs(d)) + 0.5, 0.0, 1.0);
    if (cov <= 0.0) {
      continue;
    }
    vec4 C = uWavesC[i];
    float a = cov * profile(d / hw) * B.y * B.z * C.a;
    if (a <= 0.0) {
      continue;
    }
    out_ = over(out_, vec4(C.rgb * a, a));
  }
  gl_FragColor = out_;
}
