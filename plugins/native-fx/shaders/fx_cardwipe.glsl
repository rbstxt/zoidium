// Card Wipe: the layer flips away as a grid of cards rotating in place.
// Each output pixel belongs to its own grid cell (cards never translate),
// so the shader inverse-maps the card rotation + simple perspective exactly.
// Per-card randomness (axis/direction coins, timing jitter) arrives in the
// tRand data texture generated on the CPU from (seed, card index), keeping
// the shader free of integer math. All sampling goes through uvScale.
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform sampler2D tRand;

uniform float rows;
uniform float columns;
uniform float cardScale;
uniform float flipAxis;
uniform float flipDirection;
uniform float flipOrder;
uniform float timingRandomness;
uniform float completion;
uniform float transitionWidth;
uniform float backMode;
uniform vec3 backColor;
uniform float cameraDist;
uniform float lightIntensity;
uniform float ambient;

#define PI 3.141592653589793

vec4 sampleLayer(vec2 luv) {
  if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(tDiffuse, luv * uvScale);
}

vec3 straightOf(vec4 px) {
  if (px.a > 0.00001) {
    return px.rgb / px.a;
  }
  return vec3(0.0);
}

void main() {
  vec2 grid = vec2(max(columns, 1.0), max(rows, 1.0));
  vec2 id = floor(vUv * grid);
  id = min(id, grid - 1.0);
  vec2 cc = (id + 0.5) / grid;
  float nx = grid.x > 1.5 ? id.x / (grid.x - 1.0) : 0.0;
  float ny = grid.y > 1.5 ? id.y / (grid.y - 1.0) : 0.0;
  float order = flipOrder;
  float o = nx;
  if (order < 0.5) {
    o = nx;
  } else if (order < 1.5) {
    o = 1.0 - nx;
  } else if (order < 2.5) {
    o = ny;
  } else if (order < 3.5) {
    o = 1.0 - ny;
  } else if (order < 4.5) {
    o = (nx + ny) * 0.5;
  } else if (order < 5.5) {
    o = (1.0 - nx + ny) * 0.5;
  } else if (order < 6.5) {
    o = (nx + 1.0 - ny) * 0.5;
  } else if (order < 7.5) {
    o = 1.0 - (nx + ny) * 0.5;
  } else {
    vec4 g = sampleLayer(cc);
    vec3 sc = straightOf(g);
    o = clamp(0.2126 * sc.x + 0.7152 * sc.y + 0.0722 * sc.z, 0.0, 1.0);
  }
  vec4 rnd = texture2D(tRand, (id + 0.5) / grid);
  o = o + (rnd.b - o) * clamp(timingRandomness, 0.0, 1.0);
  float tw = clamp(transitionWidth, 0.01, 1.0);
  float p = clamp((completion - o * (1.0 - tw)) / tw, 0.0, 1.0);
  if (p <= 0.0) {
    gl_FragColor = texture2D(tDiffuse, vUv * uvScale);
    return;
  }
  bool aroundX = true;
  if (flipAxis < 0.5) {
    aroundX = true;
  } else if (flipAxis < 1.5) {
    aroundX = false;
  } else {
    aroundX = rnd.r < 0.5;
  }
  float sign = 1.0;
  if (flipDirection < 0.5) {
    sign = 1.0;
  } else if (flipDirection < 1.5) {
    sign = -1.0;
  } else {
    sign = rnd.g < 0.5 ? -1.0 : 1.0;
  }
  float a = p * PI * sign;
  float cosA = cos(a);
  float sinA = sin(a);
  if (abs(cosA) < 0.004) {
    gl_FragColor = vec4(0.0);
    return;
  }
  bool front = cosA >= 0.0;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 rel = vec2((vUv.x - cc.x) * aspect, vUv.y - cc.y);
  vec2 halfCard = vec2(0.5 * aspect / grid.x, 0.5 / grid.y);
  float D = max(cameraDist, 1.0);
  float lx;
  float ly;
  if (aroundX) {
    ly = rel.y * D / (cosA * D - rel.y * sinA);
    float s = D / (D - ly * sinA);
    lx = rel.x / s;
  } else {
    lx = rel.x * D / (cosA * D - rel.x * sinA);
    float s = D / (D - lx * sinA);
    ly = rel.y / s;
  }
  float pic = max(cardScale, 1.0);
  vec2 ext = halfCard * min(cardScale, 1.0);
  // Half-texel tolerance: card edges shared with a neighbour must not drop
  // out from a ulp of inversion noise.
  if (abs(lx) > ext.x + 1e-4 || abs(ly) > ext.y + 1e-4) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float bright = lightIntensity * (ambient + (1.0 - ambient) * (0.3 + 0.7 * abs(cosA)));
  if (!front) {
    if (backMode > 0.5) {
      gl_FragColor = vec4(0.0);
      return;
    }
    gl_FragColor = vec4(backColor * bright, 1.0);
    return;
  }
  vec2 srcLocal = vec2(lx, ly) / pic;
  vec2 luv = cc + vec2(srcLocal.x / aspect, srcLocal.y);
  vec4 texel = sampleLayer(luv);
  gl_FragColor = vec4(texel.rgb * bright, texel.a);
}
