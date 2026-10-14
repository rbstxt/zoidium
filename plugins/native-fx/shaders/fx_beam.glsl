// Beam (NATIVE FX): a laser beam between Starting and Ending Point. Closed
// form per pixel: the Length/Time window selects the visible portion of the
// segment, thickness lerps from Starting to Ending Thickness (in beam space
// with 3D Perspective on, in head/tail space with it off), and the edge
// blends from Inside to Outside Color with Softness.
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform vec2 uStart;      // starting point, 0..1 of the buffer (y down)
uniform vec2 uEnd;        // ending point, 0..1 of the buffer (y down)
uniform vec3 uWindow;     // t0, t1, length (0 = no beam)
uniform vec2 uThick;      // starting / ending thickness in px
uniform float uSoft;      // 0..1 softness
uniform vec3 uInside;
uniform vec3 uOutside;
uniform float uPersp;     // 3D perspective on/off
uniform float uComposite; // composite on original on/off

float zss(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec4 over(vec4 dst, vec4 src) {
  return src + dst * (1.0 - src.a);
}

void main() {
  vec2 p = vec2(vUv.x * resolution.x, (1.0 - vUv.y) * resolution.y);
  vec2 s = vec2(uStart.x * resolution.x, uStart.y * resolution.y);
  vec2 e = vec2(uEnd.x * resolution.x, uEnd.y * resolution.y);
  vec2 d = e - s;
  float l2 = max(dot(d, d), 1e-9);
  vec2 v = p - s;
  float tc = clamp(dot(v, d) / l2, uWindow.x, uWindow.y);
  vec2 q = s + d * tc;
  float dist = length(p - q);
  float tk = tc;
  if (uPersp < 0.5 && (uWindow.y - uWindow.x) >= 1e-9) {
    tk = (tc - uWindow.x) / (uWindow.y - uWindow.x);
  }
  float hw = max((uThick.x + (uThick.y - uThick.x) * tk) * 0.5, 0.25);
  float tt = dist / hw;
  float a = 0.0;
  if (uWindow.z > 0.0) {
    if (uSoft > 1e-3) {
      a = 1.0 - zss(1.0 - uSoft, 1.0, tt);
    } else {
      a = clamp(hw - dist + 0.5, 0.0, 1.0);
    }
  }
  vec3 cc = uInside + (uOutside - uInside) * zss(0.0, 1.0, tt);
  vec4 beam = vec4(cc * a, a);
  if (uComposite > 0.5) {
    vec4 base = texture2D(tDiffuse, vUv * uvScale);
    gl_FragColor = over(base, beam);
  } else {
    gl_FragColor = beam;
  }
}
