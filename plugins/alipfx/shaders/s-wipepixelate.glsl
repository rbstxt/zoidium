precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// Panzoid properties
uniform float Transition_Dir;   // 0 = Wipe Off to Bg, 1 = Wipe On from Bg
uniform float Auto_Trans;       // 0 = use Wipe Percent, 1 = use time
uniform float Wipe_Percent;     // 0..100
uniform float Edge_Width;       // pixels
uniform float Angle;            // degrees
uniform float Pixel_Frequency;  // higher = smaller blocks
uniform float Pixel_Rel_Width;  // 1 = square-ish
uniform float Chunky;           // 0..1
uniform float Seed;             // any float
uniform float time;             // normalized 0..1 for Auto Trans

// ------------------------------------------------------------
// Hash / noise
// ------------------------------------------------------------
float hash21(vec2 p)
{
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Project UV onto wipe axis, normalized across frame
float projectedPos(vec2 uv, vec2 dir)
{
  vec2 c = uv - 0.5;
  float span = abs(dir.x) + abs(dir.y);
  span = max(span, 1e-5);
  return clamp(0.5 + dot(c, dir) / span, 0.0, 1.0);
}

// Cell size in UV space
vec2 getCellSize(float freq, float relWidth)
{
  float aspect = resolution.x / max(resolution.y, 1.0);

  // vertical density
  float cellH = 1.0 / max(freq, 1.0);

  // relative horizontal scaling
  float cellW = cellH * max(relWidth, 0.001) / aspect;

  // never smaller than one physical pixel
  cellW = max(cellW, 1.0 / max(resolution.x, 1.0));
  cellH = max(cellH, 1.0 / max(resolution.y, 1.0));

  return vec2(cellW, cellH);
}

// Per-cell order value with optional chunk grouping
float cellOrder(vec2 cellId, float chunky, float seed)
{
  vec2 s = vec2(seed * 71.13 + 19.7, seed * 131.97 + 7.31);

  float fine = hash21(cellId + s);

  float clusterSize = mix(1.0, 7.0, clamp(chunky, 0.0, 1.0));
  vec2 coarseId = floor(cellId / clusterSize);
  float coarse = hash21(coarseId + s * 1.618);

  // Chunky = more grouped blocks, but still keeps some local variation
  return mix(fine, mix(fine, coarse, 0.82), clamp(chunky, 0.0, 1.0));
}

void main()
{
  // ----------------------------------------------------------
  // Progress
  // ----------------------------------------------------------
  float progress = (Auto_Trans >= 0.5)
    ? clamp(time, 0.0, 1.0)
    : clamp(Wipe_Percent / 100.0, 0.0, 1.0);

  // ----------------------------------------------------------
  // Hard exact start/end states
  // ----------------------------------------------------------
  vec4 fgFull = texture2D(tDiffuse, vUvScaled);

  if (Transition_Dir < 0.5)
  {
    // Wipe Off to Bg
    if (progress <= 0.0)
    {
      gl_FragColor = fgFull;
      return;
    }
    if (progress >= 1.0)
    {
      gl_FragColor = vec4(0.0);
      return;
    }
  }
  else
  {
    // Wipe On from Bg
    if (progress <= 0.0)
    {
      gl_FragColor = vec4(0.0);
      return;
    }
    if (progress >= 1.0)
    {
      gl_FragColor = fgFull;
      return;
    }
  }

  // ----------------------------------------------------------
  // Wipe direction
  // 0° = left -> right
  // 90° = bottom -> top
  // ----------------------------------------------------------
  float ang = radians(Angle);
  vec2 dir = normalize(vec2(cos(ang), sin(ang)));

  // ----------------------------------------------------------
  // Cell grid
  // ----------------------------------------------------------
  vec2 cellSize = getCellSize(Pixel_Frequency, Pixel_Rel_Width);
  vec2 cellId = floor(vUv / cellSize);
  vec2 cellCenter = (cellId + 0.5) * cellSize;
  cellCenter = clamp(cellCenter, vec2(0.0), vec2(1.0));

  // ----------------------------------------------------------
  // Directional base position of this block
  // ----------------------------------------------------------
  float axisPos = projectedPos(cellCenter, dir);

  // Edge width -> normalized transition band size
  float axisPixels = abs(dir.x) * resolution.x + abs(dir.y) * resolution.y;
  axisPixels = max(axisPixels, 1.0);

  float band = max(Edge_Width, 0.0138) / axisPixels;

  // Keep band from becoming absurdly tiny compared to cell scale
  float minBand = 0.35 * max(cellSize.x, cellSize.y);
  band = max(band, minBand);

  // ----------------------------------------------------------
  // Randomized order inside the transition band
  // ----------------------------------------------------------
  float order = cellOrder(cellId, Chunky, Seed);

  // More Chunky = more grouped change, slightly less random spread
  float scatterAmount = mix(1.0, 0.7, clamp(Chunky, 0.0, 1.0));
  float offsetAmp = band * scatterAmount;

  // Final block threshold:
  // a directional wipe with random spread inside the edge zone
  float threshold = axisPos + (order - 0.5) * 2.0 * offsetAmp;

  // Frontier goes from before all possible thresholds
  // to after all possible thresholds
  float frontierStart = -offsetAmp - band;
  float frontierEnd   = 1.0 + offsetAmp + band;
  float frontier = mix(frontierStart, frontierEnd, progress);

  // ----------------------------------------------------------
  // BINARY block transition
  // No pixelation of image, no soft pixelated edge.
  // Each block is either already switched or not.
  // ----------------------------------------------------------
  float transitioned = step(threshold, frontier);

  // ----------------------------------------------------------
  // Transition Dir
  // 0 = Wipe Off to Bg  => FG disappears block-by-block
  // 1 = Wipe On from Bg => FG appears block-by-block
  // ----------------------------------------------------------
  float vis;
  if (Transition_Dir < 0.5)
  {
    vis = 1.0 - transitioned;
  }
  else
  {
    vis = transitioned;
  }

  // Preserve full-res foreground, only mask visibility by blocks
  gl_FragColor = vec4(fgFull.rgb * vis, fgFull.a * vis);
}
