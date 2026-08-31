precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

/* --- Time (see notes above) --- */
uniform float time;

/* --- 42 Parameters --- */
uniform float Style;
uniform float Amplitude;
uniform float Frequency;
uniform float Phase;
uniform float Z_Dist;
uniform float Motion_Blur;
uniform float Mo_Blur_Length;
uniform float Seed;
uniform float Wrap_X;
uniform float Wrap_Y;

uniform float X_Rand_Amp;
uniform float X_Rand_Freq;
uniform float X_Wave_Amp;
uniform float X_Wave_Freq;
uniform float X_Phase;

uniform float Y_Rand_Amp;
uniform float Y_Rand_Freq;
uniform float Y_Wave_Amp;
uniform float Y_Wave_Freq;
uniform float Y_Phase;

uniform float Z_Rand_Amp;
uniform float Z_Rand_Freq;
uniform float Z_Wave_Amp;
uniform float Z_Wave_Freq;
uniform float Z_Phase;

uniform float Tilt_Rand_Amp;
uniform float Tilt_Rand_Freq;
uniform float Tilt_Wave_Amp;
uniform float Tilt_Wave_Freq;
uniform float Tilt_Phase;

uniform float Red_Amplitude;
uniform float Green_Amplitude;
uniform float Blue_Amplitude;
uniform float Red_Phase;
uniform float Green_Phase;
uniform float Blue_Phase;
uniform float RGB_Randomness;
uniform float RGB_Frequency;

uniform float Crop_Left;
uniform float Crop_Right;
uniform float Crop_Top;
uniform float Crop_Bottom;

/* --- Constants --- */
const float PI = 3.14159265358979323846264;

/* Sapphire extra style controls (hardcoded defaults) */
const float TWITCH_STILLNESS = 0.7;     // Sapphire default in Twitchy [1](https://borisfx.com/documentation/sapphire/ae/shake/)
const float TWITCH_FREQ     = 2.0;      // Sapphire default in Twitchy [1](https://borisfx.com/documentation/sapphire/ae/shake/)
const float JUMPY_DRIFT     = 0.3;      // Sapphire default in Jumpy   [1](https://borisfx.com/documentation/sapphire/ae/shake/)
const float JUMPY_CENTER_BIAS = 0.0;    // Sapphire default            [1](https://borisfx.com/documentation/sapphire/ae/shake/)

/* --- Hash / Noise (repeatable, smooth) --- */
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  float a = hash11(i);
  float b = hash11(i + 1.0);
  return mix(a, b, u) * 2.0 - 1.0; // [-1,1]
}

float stepNoise1(float x) {
  return hash11(floor(x)) * 2.0 - 1.0; // [-1,1], no smoothing
}

/* --- Rotation helper --- */
vec2 rot2(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
}

/* --- Wrap helpers (operate within [mn,mx] box) --- */
float wrap1(float x, float mn, float mx, float mode) {
  float r = mx - mn;
  if (r <= 0.0) return mn;

  // 0 = No
  if (mode < 0.5) return x;

  // Tile: 1
  if (mode < 1.5) {
    float t = (x - mn) / r;
    t = fract(t);
    return mn + t * r;
  }

  // Reflect: 2
  float t = (x - mn) / r;
  float m = mod(t, 2.0);
  float tri = 1.0 - abs(m - 1.0); // 0..1..0
  return mn + tri * r;
}

vec2 wrapUV(vec2 uv, vec2 mn, vec2 mx, float modeX, float modeY) {
  return vec2(
    wrap1(uv.x, mn.x, mx.x, modeX),
    wrap1(uv.y, mn.y, mx.y, modeY)
  );
}

bool outsideBox(vec2 uv, vec2 mn, vec2 mx) {
  return (uv.x < mn.x || uv.x > mx.x || uv.y < mn.y || uv.y > mx.y);
}

/* --- Core shake at time t:
      returns vec4(dx_pixels, dy_pixels, rot_radians, zoom_mult_delta)
      zoom_mult_delta is additive (e.g. 0.02 = +2%)
--- */
vec4 shakeBase(float t) {
  float T = t + Phase;

  float baseF = max(0.0, Frequency);

  // Build per-axis time arguments (Sapphire: “time shift” per axis) [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  float tx = T + X_Phase;
  float ty = T + Y_Phase;
  float tz = T + Z_Phase;
  float tt = T + Tilt_Phase;

  // Random “seed” offsets [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  float s = Seed * 19.19 + 7.13;

  // Total freqs: global Frequency scales overall speed; axis freqs shape it. [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  float fxr = baseF * X_Rand_Freq;
  float fyr = baseF * Y_Rand_Freq;
  float fzr = baseF * Z_Rand_Freq;
  float ftr = baseF * Tilt_Rand_Freq;

  float fxw = baseF * X_Wave_Freq;
  float fyw = baseF * Y_Wave_Freq;
  float fzw = baseF * Z_Wave_Freq;
  float ftw = baseF * Tilt_Wave_Freq;

  // Style handling [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  float style = floor(Style + 0.5);

  // NORMAL signals (smooth random + sine wave)
  float nx = noise1(tx * fxr + s + 10.0);
  float ny = noise1(ty * fyr + s + 20.0);
  float nz = noise1(tz * fzr + s + 30.0);
  float nt = noise1(tt * ftr + s + 40.0);

  // WAVES
  float wx = sin(2.0 * PI * (tx * fxw));
  float wy = sin(2.0 * PI * (ty * fyw));
  float wz = sin(2.0 * PI * (tz * fzw));
  float wt = sin(2.0 * PI * (tt * ftw));

  // Twitchy: intermittent bursts [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  if (style > 0.5 && style < 1.5) {
    float period = max(0.0001, TWITCH_FREQ);
    float k = floor(T * period);
    // TWITCH_STILLNESS interpreted as “probability of being active” (matches doc wording) [1](https://borisfx.com/documentation/sapphire/ae/shake/)
    float active = step(hash11(k + s + 99.0), TWITCH_STILLNESS);

    // when inactive -> no shake
    if (active < 0.5) {
      return vec4(0.0);
    }

    // when active -> boost the internal speed a bit (burst feel)
    float boost = 4.0;
    nx = noise1(tx * fxr * boost + s + 10.0);
    ny = noise1(ty * fyr * boost + s + 20.0);
    nz = noise1(tz * fzr * boost + s + 30.0);
    nt = noise1(tt * ftr * boost + s + 40.0);

    wx = sin(2.0 * PI * (tx * fxw * boost));
    wy = sin(2.0 * PI * (ty * fyw * boost));
    wz = sin(2.0 * PI * (tz * fzw * boost));
    wt = sin(2.0 * PI * (tt * ftw * boost));
  }

  // Jumpy: discrete jumps + drift between [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  if (style > 1.5) {
    float jf = max(0.0001, baseF);
    float u = fract(T * jf);
    float i = floor(T * jf);

    // step targets
    float nx0 = stepNoise1(i + s + 10.0);
    float ny0 = stepNoise1(i + s + 20.0);
    float nz0 = stepNoise1(i + s + 30.0);
    float nt0 = stepNoise1(i + s + 40.0);

    float nx1 = stepNoise1(i + 1.0 + s + 10.0);
    float ny1 = stepNoise1(i + 1.0 + s + 20.0);
    float nz1 = stepNoise1(i + 1.0 + s + 30.0);
    float nt1 = stepNoise1(i + 1.0 + s + 40.0);

    // drift controls how much of the interval is spent moving
    float drift = clamp(JUMPY_DRIFT, 0.0, 1.0);
    float w = (drift <= 0.0001) ? 0.0 : clamp(u / drift, 0.0, 1.0);

    nx = mix(nx0, nx1, w);
    ny = mix(ny0, ny1, w);
    nz = mix(nz0, nz1, w);
    nt = mix(nt0, nt1, w);

    // Optional: Center bias default 0 -> no forced recentering [1](https://borisfx.com/documentation/sapphire/ae/shake/)
    // (kept for fidelity, but bias=0 means ignore)
    if (JUMPY_CENTER_BIAS > 0.0001) {
      float b = clamp(JUMPY_CENTER_BIAS, 0.0, 1.0);
      float rec = step(hash11(i + s + 123.4), b);
      nx *= (1.0 - rec);
      ny *= (1.0 - rec);
      nz *= (1.0 - rec);
      nt *= (1.0 - rec);
    }

    // wave component still allowed in Jumpy, but typically minimal
  }

  // Compose displacement (pixels for XY; percent for Z; degrees for tilt)
  float dx = (X_Rand_Amp * nx + X_Wave_Amp * wx) * Amplitude;
  float dy = (Y_Rand_Amp * ny + Y_Wave_Amp * wy) * Amplitude;

  float zoomPct = (Z_Rand_Amp * nz + Z_Wave_Amp * wz) * Amplitude; // interpret as % points
  float rotDeg  = (Tilt_Rand_Amp * nt + Tilt_Wave_Amp * wt) * Amplitude;

  return vec4(dx, dy, radians(rotDeg), zoomPct * 0.01); // zoom as multiplier delta
}


vec2 applyTransform(vec2 uv, vec2 center, vec2 transPx, float rotRad, float scale) {
  // Inverse camera transform, but done in PIXEL SPACE to avoid aspect skew.
  // This makes Tilt match Sapphire much more closely on non-square resolutions. [1](https://panzoid.com/community/official/37192?c=3)[2](https://borisfx.com/documentation/sapphire/ae/shake/)

  // Convert to pixel coordinates around center
  vec2 p = (uv - center) * resolution;

  // Inverse translation (pixels)
  p -= transPx;

  // Inverse rotation (pixel space)
  p = rot2(p, -rotRad);

  // Inverse scale
  p /= max(0.0001, scale);

  // Back to normalized UV
  return (p / resolution) + center;
}

/* Sample with crop + wrap */
vec4 sampleLayer(vec2 uv, vec2 cropMin, vec2 cropMax, float modeX, float modeY) {
  // Wrap happens on crop bounds (matches Sapphire crop behavior) [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  vec2 u = uv;
  if (modeX >= 0.5 || modeY >= 0.5) {
    u = wrapUV(u, cropMin, cropMax, modeX, modeY);
  }

  // If wrap is No and outside -> black [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  if ((modeX < 0.5 || modeY < 0.5) && outsideBox(u, cropMin, cropMax)) {
    return vec4(0.0);
  }

  // Map to buffer UV using uvScale [2](https://panzoid.com/community/official/37192?c=3)
  vec2 bufUv = u * uvScale;
  return texture2D(tDiffuse, bufUv);
}

/* RGB channel shake (extra independent randomness) [1](https://borisfx.com/documentation/sapphire/ae/shake/) */
vec4 renderRGB(vec2 baseUv, vec2 cropMin, vec2 cropMax, vec2 center, vec4 baseShake) {
  // Base transform components
  vec2 trans = baseShake.xy;
  float rot = baseShake.z;

  // Base scale includes Z Dist semantics (distance) [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  float baseScale = 1.0 / max(0.001, Z_Dist);
  float scale = baseScale * (1.0 + baseShake.w);

  // RGB randomness: build per-channel extra shake using its own freq/phase
  float rf = max(0.0, Frequency) * max(0.0, RGB_Frequency);
  float s = Seed * 31.77 + 2.41;

  // Use the Rand amps as scaling basis (as Sapphire doc says) [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  float ax = X_Rand_Amp;
  float ay = Y_Rand_Amp;
  float az = Z_Rand_Amp;
  float at = Tilt_Rand_Amp;

  // Helper to build extra shake for a channel
  // (Different seeds so channels diverge)
  float tR = (time + Phase + Red_Phase)   * rf;
  float tG = (time + Phase + Green_Phase) * rf;
  float tB = (time + Phase + Blue_Phase)  * rf;

  // Extra random components (smooth)
  vec2 eR = vec2(noise1(tR + s + 101.0), noise1(tR + s + 201.0)) * vec2(ax, ay);
  vec2 eG = vec2(noise1(tG + s + 102.0), noise1(tG + s + 202.0)) * vec2(ax, ay);
  vec2 eB = vec2(noise1(tB + s + 103.0), noise1(tB + s + 203.0)) * vec2(ax, ay);

  float rRot = noise1(tR + s + 301.0) * radians(at);
  float gRot = noise1(tG + s + 302.0) * radians(at);
  float bRot = noise1(tB + s + 303.0) * radians(at);

  float rZoom = noise1(tR + s + 401.0) * (az * 0.01);
  float gZoom = noise1(tG + s + 402.0) * (az * 0.01);
  float bZoom = noise1(tB + s + 403.0) * (az * 0.01);

  float k = clamp(RGB_Randomness, 0.0, 1000.0);

  // Channel amplitudes [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  vec2 transR = trans + k * eR * Red_Amplitude;
  vec2 transG = trans + k * eG * Green_Amplitude;
  vec2 transB = trans + k * eB * Blue_Amplitude;

  float rotR = rot + k * rRot * Red_Amplitude;
  float rotG = rot + k * gRot * Green_Amplitude;
  float rotB = rot + k * bRot * Blue_Amplitude;

  float scaleR = scale * (1.0 + k * rZoom * Red_Amplitude);
  float scaleG = scale * (1.0 + k * gZoom * Green_Amplitude);
  float scaleB = scale * (1.0 + k * bZoom * Blue_Amplitude);

  vec2 uvR = applyTransform(baseUv, center, transR, rotR, scaleR);
  vec2 uvG = applyTransform(baseUv, center, transG, rotG, scaleG);
  vec2 uvB = applyTransform(baseUv, center, transB, rotB, scaleB);

  vec4 cR = sampleLayer(uvR, cropMin, cropMax, Wrap_X, Wrap_Y);
  vec4 cG = sampleLayer(uvG, cropMin, cropMax, Wrap_X, Wrap_Y);
  vec4 cB = sampleLayer(uvB, cropMin, cropMax, Wrap_X, Wrap_Y);

  // Recombine channels
  return vec4(cR.r, cG.g, cB.b, (cR.a + cG.a + cB.a) / 3.0);
}

/* Motion blur by multi-sampling along time (synthetic) [1](https://borisfx.com/documentation/sapphire/ae/shake/) */
vec4 renderWithMotionBlur(vec2 baseUv, vec2 cropMin, vec2 cropMax, vec2 center) {
  const int SAMPLES = 8;
  float on = step(0.5, Motion_Blur);
  if (on < 0.5) {
    vec4 sh = shakeBase(time);
    return renderRGB(baseUv, cropMin, cropMax, center, sh);
  }

  // Approx dt; host-independent. If you know your fps, you can tune this.
  float dt = 1.0 / 60.0;
  float len = max(0.0, Mo_Blur_Length);

  vec4 acc = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i) / float(SAMPLES - 1);
    float tt = time - fi * dt * len;
    vec4 sh = shakeBase(tt);
    acc += renderRGB(baseUv, cropMin, cropMax, center, sh);
  }
  return acc / float(SAMPLES);
}

void main() {
  // Crop box in normalized input UV space [1](https://borisfx.com/documentation/sapphire/ae/shake/)
  vec2 cropMin = vec2(Crop_Left, Crop_Bottom) / resolution;
  vec2 cropMax = vec2(1.0, 1.0) - vec2(Crop_Right, Crop_Top) / resolution;

  // Remap output uv (0..1) into cropped region
  vec2 uv = vUv;
  vec2 baseUv = mix(cropMin, cropMax, uv);

  // Center of crop region (transform about the visible box)
  vec2 center = (cropMin + cropMax) * 0.5;

  gl_FragColor = renderWithMotionBlur(baseUv, cropMin, cropMax, center);
}
