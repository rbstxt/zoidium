precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;

// ---- Panzoid custom properties ----
uniform vec2  Tile_Center;              // pixels, AE coords (0,0 top-left)
uniform float Tile_Width;               // percent
uniform float Tile_Height;              // percent
uniform float Output_Width;             // percent (bounds expansion)
uniform float Output_Height;            // percent (bounds expansion)
uniform float Mirror_Edges;             // 0/1
uniform float Phase;                    // pixels
uniform float Horizontal_Phase_Shift;   // 0/1

// Seams guard (avoid sampling exactly on tile borders)
vec2 safe01(vec2 uv) {
  vec2 eps = 0.5 / resolution;
  return clamp(uv, eps, 1.0 - eps);
}

float mirrorRepeat1D(float fracPart, float tileIndex) {
  float parity = mod(abs(tileIndex), 2.0);   // 0 or 1
  return mix(fracPart, 1.0 - fracPart, parity);
}

void main()
{
  // AE pixel center (top-left origin) -> UV (bottom-left origin)
  vec2 centerUV = vec2(
    Tile_Center.x / resolution.x,
    1.0 - (Tile_Center.y / resolution.y)
  );

  // Tile scaling: 100% = original
  vec2 tileScale = vec2(Tile_Width, Tile_Height) / 100.0;
  tileScale = max(tileScale, vec2(0.0001));

  // OUTPUT bounds: in AE these expand the output region without changing tile size.
  // 100% == layer size; >100% expands beyond; <100% crops.
  vec2 outHalfUV = 0.5 * vec2(Output_Width, Output_Height) / 100.0;

  // If outside output bounds, output transparent (like "outside expanded bounds")
  vec2 d = vUv - centerUV;
  if (abs(d.x) > outHalfUV.x || abs(d.y) > outHalfUV.y) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // PHASE: offsets alternating columns/rows (common Motion Tile behavior)
  // Default: vertical phase between columns; with Horizontal Phase Shift: horizontal phase between rows. [2](https://www.youtube.com/watch?v=HvaxOys1a-o)[4](https://www.youtube.com/watch?v=JQ7f19mcyyI)
  vec2 localNoPhase = (vUv - centerUV) * tileScale + 0.5;
  float colIndex = floor(localNoPhase.x);
  float rowIndex = floor(localNoPhase.y);

  float colParity = mod(abs(colIndex), 2.0);
  float rowParity = mod(abs(rowIndex), 2.0);

  // Phase is pixels; AE +Y is down so invert vertical sign
  vec2 phaseUV = vec2(Phase / resolution.x, -Phase / resolution.y);

  float hps = step(0.5, Horizontal_Phase_Shift);

  vec2 uvPhased = vUv
    + (1.0 - hps) * vec2(0.0, phaseUV.y * colParity)   // vertical phase on odd columns
    +  hps         * vec2(phaseUV.x * rowParity, 0.0);  // horizontal phase on odd rows

  // Tiling space
  vec2 local = (uvPhased - centerUV) * tileScale + 0.5;
  vec2 tileIndex = floor(local);
  vec2 f = fract(local);

  // Mirror edges: mirror every other tile for seamless tiling. [1](https://www.youtube.com/watch?v=kYhsGHdkaNE)[2](https://www.youtube.com/watch?v=HvaxOys1a-o)
  float mirrorOn = step(0.5, Mirror_Edges);
  vec2 mirrored = vec2(
    mirrorRepeat1D(f.x, tileIndex.x),
    mirrorRepeat1D(f.y, tileIndex.y)
  );

  vec2 sampleUV = mix(f, mirrored, mirrorOn);
  sampleUV = safe01(sampleUV);

  // Map into Panzoid buffer UV
  vec2 bufferUV = sampleUV * uvScale;

  gl_FragColor = texture2D(tDiffuse, bufferUV);
}
