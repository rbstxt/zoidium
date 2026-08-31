precision highp float;
precision highp int;

// Enable LOD/Grad if available (WebGL1 uses EXT variants)
#ifdef GL_EXT_shader_texture_lod
#extension GL_EXT_shader_texture_lod : enable
#endif

uniform sampler2D tDiffuse;

uniform vec2 uvScale;      // Panzoid buffer mapping scale
uniform vec2 resolution;   // current layer buffer resolution (pixels)

varying vec2 vUvScaled;

// ---- Custom properties (Dynamic Number in Panzoid) ----
uniform float Horizontal_Blocks;
uniform float Vertical_Blocks;
uniform float Sharp_Colors;

// Fallback averaging quality when EXT LOD isn't available
// 4 = 16 taps (fast, close). 6 = 36 taps (closer). 8 = 64 taps (closest, heavier).
#define AVG_GRID 4

// Optional: if you want averaging in linear light (closer to AE projects set to linear)
// Set to 1 if your AE project blends in linear and you want closer matching.
#define USE_LINEAR_LIGHT 0

vec3 toLinear(vec3 c)  { return pow(c, vec3(2.2)); }
vec3 toGamma(vec3 c)   { return pow(c, vec3(1.0 / 2.2)); }

// Convert layer-space UV (0..1) to buffer UV and sample
vec4 sampleBuffer(vec2 layerUV)
{
  return texture2D(tDiffuse, layerUV * uvScale);
}

// Snap buffer UV to the center of the nearest texel.
// This makes results far less sensitive to Nearest/Linear differences and downsampling.
vec2 snapToTexelCenter(vec2 bufferUV)
{
  vec2 px = bufferUV * resolution;  // pixel coords in current buffer
  px = floor(px) + 0.5;             // center of pixel
  return px / resolution;
}

void main()
{
  // Work in layer UV (0..1), not buffer UV, so the grid is stable under buffer resizing.
  vec2 uv = vUvScaled / uvScale;
  uv = clamp(uv, 0.0, 0.999999);

  // AE-style minimum 1 block
  vec2 blocks = vec2(max(1.0, Horizontal_Blocks), max(1.0, Vertical_Blocks));
  vec2 cellSize = 1.0 / blocks;

  // Which mosaic block is this pixel in?
  vec2 cell = floor(uv * blocks);

  // Center of the block in layer UV
  vec2 centerUV = (cell + 0.5) * cellSize;
  centerUV = clamp(centerUV, 0.0, 0.999999);

  // ---- Sharp Colors (AE: center sample, solid tile) ----
  if (Sharp_Colors >= 0.5)
  {
    // Snap to texel center in *buffer space* to avoid bilinear drift between preview modes.
    vec2 centerBuf = snapToTexelCenter(centerUV * uvScale);
    gl_FragColor = texture2D(tDiffuse, centerBuf);
    return;
  }

  // ---- Non-sharp (AE: blended/averaged tile color) ----
  // Best sampling invariance is using gradient-based sampling to match the block footprint.
  // This tends to keep appearance consistent across Full/Half/Quarter previews when mipmaps exist.
  #ifdef GL_EXT_shader_texture_lod
    // Provide gradients approximately equal to a block's size in buffer UV space.
    // This asks the GPU to filter over ~the whole block area (mip/anisotropic behavior).
    vec2 gradX = vec2(cellSize.x, 0.0) * uvScale;
    vec2 gradY = vec2(0.0, cellSize.y) * uvScale;

    vec2 centerBufUV = centerUV * uvScale;
    vec4 c = texture2DGradEXT(tDiffuse, centerBufUV, gradX, gradY);

    #if USE_LINEAR_LIGHT
      c.rgb = toGamma(toLinear(c.rgb)); // noop-ish structure; kept symmetrical with fallback
    #endif

    gl_FragColor = c;
    return;
  #endif

  // Fallback: multi-sample box average inside each block.
  // Every tap is snapped to texel centers -> reduces differences across filtering & preview scaling.
  vec2 baseUV = cell * cellSize;
  vec3 accRGB = vec3(0.0);
  float accA = 0.0;

  for (int y = 0; y < AVG_GRID; y++)
  {
    for (int x = 0; x < AVG_GRID; x++)
    {
      vec2 f = (vec2(float(x), float(y)) + 0.5) / float(AVG_GRID);
      vec2 suv = baseUV + f * cellSize;
      suv = clamp(suv, 0.0, 0.999999);

      vec2 bufUV = snapToTexelCenter(suv * uvScale);
      vec4 s = texture2D(tDiffuse, bufUV);

      #if USE_LINEAR_LIGHT
        accRGB += toLinear(s.rgb);
      #else
        accRGB += s.rgb;
      #endif

      accA += s.a;
    }
  }

  float invN = 1.0 / float(AVG_GRID * AVG_GRID);

  #if USE_LINEAR_LIGHT
    vec3 outRGB = toGamma(accRGB * invN);
  #else
    vec3 outRGB = accRGB * invN;
  #endif

  gl_FragColor = vec4(outRGB, accA * invN);
}
