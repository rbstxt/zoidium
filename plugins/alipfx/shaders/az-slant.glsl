precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// ===== Custom properties =====
uniform float Slant;       // degrees, +right / -left
uniform float Stretching;  // 0 = off, 1 = on
uniform float Height;      // percent, 100 = normal, 0 = flat, negative = flip
uniform vec2 Floor;        // pixel position, AE-style: x from left, y from top
uniform float Set_Color;   // 0 = off, 1 = on
uniform vec3 Color;        // solid color fill when Set Color = 1

float safeSign(float v) {
  return (v < 0.0) ? -1.0 : 1.0;
}

bool inside01(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

void main() {
  // Current output UV in normal layer space (0..1, bottom-left origin)
  vec2 uv = vUv;

  // Convert AE-style Floor pixels (top-left origin) to GLSL UV (bottom-left origin)
  vec2 floorUv = vec2(
    Floor.x / resolution.x,
    1.0 - (Floor.y / resolution.y)
  );

  // Parameters
  float angle = radians(Slant);
  float s = sin(angle);
  float c = cos(angle);

  // Height is percent
  float h = Height / 100.0;

  // Numerical protection
  float eps = 0.0001;
  float safeC = (abs(c) < eps) ? (eps * safeSign(c)) : c;
  float safeH = (abs(h) < eps) ? (eps * safeSign(h)) : h;
  float safeTan = s / safeC;

  // Destination point relative to Floor
  vec2 d = uv - floorUv;

  // Inverse-map destination -> source
  vec2 srcRel;

  if (Stretching >= 0.5) {
    // STRETCHING ON:
    // Keeps the top edge on a fixed horizontal line -> shear-like
    //
    // Forward model:
    //   x' = x + y * h * tan(angle)
    //   y' = y * h
    //
    // Inverse:
    //   y  = y' / h
    //   x  = x' - y' * tan(angle)
    srcRel = vec2(
      d.x - d.y * safeTan,
      d.y / safeH
    );
  } else {
    // STRETCHING OFF:
    // "Falls backward/forward" -> tilt/projection-like
    //
    // Forward model:
    //   x' = x + y * h * sin(angle)
    //   y' = y * h * cos(angle)
    //
    // Inverse:
    //   y  = y' / (h * cos(angle))
    //   x  = x' - y' * tan(angle)
    srcRel = vec2(
      d.x - d.y * safeTan,
      d.y / (safeH * safeC)
    );
  }

  vec2 srcUv = floorUv + srcRel;

  vec4 outColor = vec4(0.0);

  // Transparent outside source bounds (like a normal effect buffer crop)
  if (inside01(srcUv)) {
    vec4 texel = texture2D(tDiffuse, srcUv * uvScale);

    if (Set_Color >= 0.5) {
      outColor = vec4(Color, texel.a);
    } else {
      outColor = texel;
    }
  }

  gl_FragColor = outColor;
}
