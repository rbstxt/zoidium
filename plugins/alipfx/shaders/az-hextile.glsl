precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// ---- Panzoid properties ----
uniform float Render;            // 0 Tile, 1 Fold Aligned, 2 Fold Seamlessly
uniform float Radius;            // pixels
uniform vec2  Center;            // pixels
uniform float Lock_Center_Tile;  // 0/1
uniform float Rotate;            // degrees
uniform float Smearing;          // 0..100 suggested

const float PI = 3.14159265358979323846;

vec2 rot2(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
}
vec2 rotateAround(vec2 p, vec2 pivot, float a) {
  return pivot + rot2(p - pivot, a);
}

float roundN(float x) { return (x < 0.0) ? ceil(x - 0.5) : floor(x + 0.5); }

vec3 axialToCube(vec2 h) {
  float x = h.x;
  float z = h.y;
  float y = -x - z;
  return vec3(x, y, z);
}
vec2 cubeToAxial(vec3 c) { return vec2(c.x, c.z); }

vec3 cubeRound(vec3 c) {
  float rx = roundN(c.x);
  float ry = roundN(c.y);
  float rz = roundN(c.z);

  float x_diff = abs(rx - c.x);
  float y_diff = abs(ry - c.y);
  float z_diff = abs(rz - c.z);

  if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
  else if (y_diff > z_diff) ry = -rx - rz;
  else rz = -rx - ry;

  return vec3(rx, ry, rz);
}

// Flat-top hex pixel<->axial (Radius is circumradius in pixels)
vec2 pixelToAxial(vec2 p, float size) {
  float q = (2.0/3.0) * (p.x / size);
  float r = (-1.0/3.0) * (p.x / size) + (0.5773502691896258) * (p.y / size);
  return vec2(q, r);
}
vec2 axialToPixel(vec2 h, float size) {
  float q = h.x;
  float r = h.y;
  float x = size * 1.5 * q;
  float y = size * 1.7320508075688772 * (r + 0.5*q);
  return vec2(x, y);
}

// Hex SDF for seams (flat-top)
float sdHexFlat(vec2 p, float r) {
  p = abs(p);
  return max(p.y, dot(p, vec2(0.8660254037844386, 0.5))) - r;
}

// Fold Aligned: 6-way fold
vec2 foldAligned(vec2 p) {
  float r = length(p);
  float ang = atan(p.y, p.x);

  float wedge = PI / 3.0;
  float k = floor((ang + wedge*0.5) / wedge);
  float a = ang - k * wedge;     // [-30..+30]
  a = abs(a);                    // [0..30]

  return vec2(cos(a), sin(a)) * r;
}

// Fold Seamlessly (approx): parity phase
vec2 foldSeamless(vec2 p, float parity) {
  float r = length(p);
  float ang = atan(p.y, p.x);

  ang += parity * (PI / 6.0);
  float wedge = PI / 3.0;
  float k = floor((ang + wedge*0.5) / wedge);
  float a = ang - k * wedge;
  a = abs(a);

  return vec2(cos(a), sin(a)) * r;
}

// Smearing: directional drag/stretch across all modes
vec2 perp(vec2 v) { return vec2(-v.y, v.x); }

vec2 applySmear(vec2 warped, vec2 tileCenter, vec2 CenterPx, float size, float sm01)
{
  vec2 d = tileCenter - CenterPx;
  float dist = length(d);
  vec2 dir = (dist > 1e-5) ? (d / dist) : vec2(1.0, 0.0);
  vec2 tanDir = perp(dir);

  float distN = dist / (size * 6.0 + 1e-5);
  float t = sm01 * clamp(distN, 0.0, 1.5);

  float par = dot(warped, dir);
  float per = dot(warped, tanDir);

  float drag = t * dist * 0.40;
  float stretch = 1.0 + t * (1.35 + 0.85 * clamp(distN, 0.0, 1.0));
  float squeeze = 1.0 - t * 0.22;

  par = par * stretch - drag;
  per = per * squeeze;

  return dir * par + tanDir * per;
}

// Neighbor directions in axial coords (flat-top axial)
vec2 axialDir(int i) {
  if (i == 0) return vec2( 1.0,  0.0);
  if (i == 1) return vec2( 1.0, -1.0);
  if (i == 2) return vec2( 0.0, -1.0);
  if (i == 3) return vec2(-1.0,  0.0);
  if (i == 4) return vec2(-1.0,  1.0);
  return vec2( 0.0,  1.0);
}

// Pick nearest neighbor direction by comparing dot to the 6 neighbor vectors in pixel space
int nearestNeighborDir(vec2 localGrid) {
  vec2 u = normalize(localGrid + vec2(1e-6, 0.0));
  float best = -1e9;
  int bestI = 0;
  for (int i = 0; i < 6; i++) {
    vec2 dp = normalize(axialToPixel(axialDir(i), 1.0));
    float s = dot(u, dp);
    if (s > best) { best = s; bestI = i; }
  }
  return bestI;
}

vec2 wrap01(vec2 uv) { return fract(uv); }

vec4 sampleRepeat(vec2 samplePosPx) {
  vec2 uv = samplePosPx / resolution;
  uv = wrap01(uv);
  vec2 uvBuf = uv * uvScale;
  return texture2D(tDiffuse, uvBuf);
}

void main() {
  vec2 pos = vUv * resolution;

  float size = max(Radius, 0.0001);
  int mode = int(floor(Render + 0.5));
  float lockC = step(0.5, Lock_Center_Tile);
  float theta = radians(Rotate);

  vec2 compCenter = resolution * 0.5;

  // AE behavior notes:
  // Rotate is around Center; when Lock Center Tile is enabled, rotation behaves as comp-centered. [1](https://www.youtube.com/watch?v=OeXte_Q19oQ)[2](https://www.youtube.com/watch?v=sIu3fHVzfwA)
  vec2 gridOrigin  = mix(Center, compCenter, lockC);
  vec2 rotatePivot = mix(Center, compCenter, lockC);

  // ✅ Rotate affects entire honeycomb arrangement: rotate coordinates for quantization
  vec2 posGrid = rotateAround(pos, rotatePivot, -theta);
  vec2 gridOriginGrid = rotateAround(gridOrigin, rotatePivot, -theta);

  vec2 rel = posGrid - gridOriginGrid;

  // nearest hex cell
  vec2 axialF = pixelToAxial(rel, size);
  vec3 cube  = axialToCube(axialF);
  vec3 cubeI = cubeRound(cube);
  vec2 cell  = cubeToAxial(cubeI);

  vec2 tileCenterRel  = axialToPixel(cell, size);
  vec2 tileCenterGrid = gridOriginGrid + tileCenterRel;

  // local in rotated GRID space (for seams + neighbor selection)
  vec2 localGrid = posGrid - tileCenterGrid;

  // tile center back in unrotated space
  vec2 tileCenter = rotateAround(tileCenterGrid, rotatePivot, theta);

  float sm01 = clamp(Smearing / 100.0, 0.0, 1.0);

  // ----------------------------
  // Build "warped" sampling vector
  // ----------------------------
  vec2 warped;

  if (mode == 0) {
    // Tile: repeat around Center
    warped = pos - tileCenter;
  } else {
    // Fold modes should rotate with the honeycomb:
    // fold in GRID space, then rotate back
    vec2 baseGrid = posGrid - tileCenterGrid;

    vec2 foldedGrid;
    if (mode == 1) {
      foldedGrid = foldAligned(baseGrid);
    } else {
      float parity = mod(cell.x + cell.y, 2.0);
      foldedGrid = foldSeamless(baseGrid, parity);
    }

    warped = rot2(foldedGrid, theta);
  }

  // Smearing: directional drag/stretch across all modes (AE-like character) [1](https://www.youtube.com/watch?v=OeXte_Q19oQ)[2](https://www.youtube.com/watch?v=sIu3fHVzfwA)
  warped = applySmear(warped, tileCenter, Center, size, sm01);

  // Current sample
  vec2 samplePos = Center + warped;
  vec4 col = sampleRepeat(samplePos);

  // ----------------------------
  // ✅ Fold Seamlessly: remove seams regardless of rotation
  // - no alpha cutting
  // - blend with neighbor near the closest edge to hide coordinate discontinuities
  // ----------------------------
  if (mode == 2) {
    // distance to hex boundary (negative inside)
    float dEdge = sdHexFlat(localGrid, size);

    // Blend width in pixels (bigger tile => slightly wider blend)
    float seamW = max(1.5, size * 0.08);

    // w = 1 inside, 0 near edge
    float w = smoothstep(0.0, seamW, -dEdge);

    // near the edge, sample the neighbor cell across the nearest edge
    int di = nearestNeighborDir(localGrid);
    vec2 nCell = cell + axialDir(di);

    vec2 nCenterRel  = axialToPixel(nCell, size);
    vec2 nCenterGrid = gridOriginGrid + nCenterRel;
    vec2 nCenter     = rotateAround(nCenterGrid, rotatePivot, theta);

    // neighbor fold in grid space, then rotate back
    vec2 nBaseGrid = posGrid - nCenterGrid;
    float nParity = mod(nCell.x + nCell.y, 2.0);
    vec2 nFoldedGrid = foldSeamless(nBaseGrid, nParity);
    vec2 nWarped = rot2(nFoldedGrid, theta);
    nWarped = applySmear(nWarped, nCenter, Center, size, sm01);

    vec4 colN = sampleRepeat(Center + nWarped);

    // Blend neighbor at boundary to hide seams (rotation-safe)
    col = mix(colN, col, w);

    // No alpha seam in Fold Seamlessly, like AE mode intent [2](https://www.youtube.com/watch?v=sIu3fHVzfwA)[1](https://www.youtube.com/watch?v=OeXte_Q19oQ)
    gl_FragColor = col;
    return;
  }

  // ----------------------------
  // Tile / Fold Aligned: allow visible hex edges via alpha (like AE can show seams) [2](https://www.youtube.com/watch?v=sIu3fHVzfwA)[1](https://www.youtube.com/watch?v=OeXte_Q19oQ)
  // ----------------------------
  float alpha = 1.0;
  {
    float d = sdHexFlat(localGrid, size);
    float aa = 1.25; // constant px smoothing (no derivatives)
    alpha = smoothstep(0.0, -aa, d);
  }

  gl_FragColor = vec4(col.rgb, col.a * alpha);
}
