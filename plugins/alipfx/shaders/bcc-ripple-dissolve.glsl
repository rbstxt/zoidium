precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// --- User properties ---
uniform float Animation;               // 0 = Auto, 1 = Pct. Done
uniform float Percent_Done;            // 0..100
uniform float Radius_Peak;             // pixels
uniform vec2  Center;                  // pixels
uniform float Height;                  // pixels
uniform float Perpendicular_Height;    // pixels
uniform float Wave_Width;              // pixels
uniform float Width_Percent_Increase;  // percent
uniform float Speed;                   // arbitrary units
uniform float Speed_Deceleration;      // percent-ish control
uniform float Phase;                   // degrees
uniform float Inside_Radius;           // pixels
uniform float Fall_Off;                // pixels
uniform float Light_Level;             // typical 0..200+
uniform vec3  Light_Color;             // RGB
uniform float Pin_Width;               // pixels
uniform float time;                    // for Auto mode

const float PI  = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;

float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

vec2 bufferUV(vec2 uv) {
  return uv * uvScale;
}

vec4 sampleCurrent(vec2 uv) {
  return texture2D(tDiffuse, bufferUV(clamp(uv, 0.0, 1.0)));
}

// Best if time is animated 0..1 across the transition
float getProgress() {
  float autoP = saturate(time);
  autoP = autoP * autoP * (3.0 - 2.0 * autoP);

  float manualP = saturate(Percent_Done / 100.0);

  return mix(autoP, manualP, step(0.5, Animation));
}

// Reduces tearing near the edges
float getPinMask(vec2 uv) {
  float edgeDistX = min(uv.x * resolution.x, (1.0 - uv.x) * resolution.x);
  float edgeDistY = min(uv.y * resolution.y, (1.0 - uv.y) * resolution.y);
  float edgeDist  = min(edgeDistX, edgeDistY);

  if (Pin_Width <= 0.0) return 1.0;
  return smoothstep(0.0, Pin_Width, edgeDist);
}

void main() {
  vec2 uv = vUv;

  // Center uses pixel coordinates
  vec2 centerUV = Center / resolution;

  // Pixel-space delta from center
  vec2 dp = (uv - centerUV) * resolution;
  float r = length(dp);

  vec2 dir = (r > 0.0001) ? (dp / r) : vec2(1.0, 0.0);
  vec2 tangent = vec2(-dir.y, dir.x);

  float progress = getProgress();

  // Peaks mid-transition and returns to zero at end
  float envelope = sin(progress * PI);

  // Expanding ripple radius
  float outerRadius = Radius_Peak * progress;

  // Wave width expands over time
  float widthNow = max(
    0.001,
    Wave_Width * (1.0 + (Width_Percent_Increase / 100.0) * progress)
  );

  // Speed with deceleration
  float decel = max(0.0, Speed_Deceleration / 100.0);
  float travelT = progress - 0.5 * decel * progress * progress;
  travelT = max(0.0, travelT);

  float phaseRad = radians(Phase);

  // Active ripple zone
  float innerMask = smoothstep(
    Inside_Radius,
    Inside_Radius + max(Fall_Off, 0.001),
    r
  );

  float outerMask = 1.0 - smoothstep(
    outerRadius,
    outerRadius + max(Fall_Off, 0.001),
    r
  );

  float bandMask = innerMask * outerMask;

  // Ripple waveform
  float motion = Speed * travelT;
  float waveArg = TAU * ((r - motion) / widthNow) + phaseRad;
  float wave = sin(waveArg);

  float strength = bandMask * envelope;

  // Distortion
  float radialDispPx     = Height * wave * strength;
  float tangentialDispPx = Perpendicular_Height * wave * strength;

  // Slight outer boost
  float radialBoost = mix(0.75, 1.15, saturate(r / max(Radius_Peak, 1.0)));
  tangentialDispPx *= radialBoost;

  // Pinning
  float pinMask = getPinMask(uv);
  radialDispPx     *= pinMask;
  tangentialDispPx *= pinMask;

  vec2 dispUV = (dir * radialDispPx + tangent * tangentialDispPx) / resolution;
  vec2 warpedUV = uv + dispUV;

  // Base + warped sample of the same current layer
  vec4 baseCol   = sampleCurrent(uv);
  vec4 warpedCol = sampleCurrent(warpedUV);

  // Distortion only: no alpha blackout at progress 0
  float distortionMix = saturate(strength);
  vec4 outCol = mix(baseCol, warpedCol, distortionMix);

  // Crest lighting
  float crest = max(wave, 0.0);
  crest = crest * crest * strength;

  float lightAmt = Light_Level / 100.0;
  outCol.rgb += Light_Color * crest * lightAmt;

  // Preserve original alpha
  outCol.a = baseCol.a;

  gl_FragColor = vec4(clamp(outCol.rgb, 0.0, 1.0), clamp(outCol.a, 0.0, 1.0));
}
