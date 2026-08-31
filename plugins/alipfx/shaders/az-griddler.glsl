precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

uniform float Horizontal_Scale; // percent, 100 = unchanged
uniform float Vertical_Scale;   // percent, 100 = unchanged
uniform float Tile_Size;        // tile size in pixels
uniform float Rotation;         // degrees
uniform float Cut_Tiles;        // 0 = off, 1 = on

const float PI = 3.1415926535897932384626433832795;

vec2 rotate2D(vec2 p, float a)
{
    float s = sin(a);
    float c = cos(a);
    return vec2(
        c * p.x - s * p.y,
        s * p.x + c * p.y
    );
}

vec2 pmod(vec2 x, vec2 y)
{
    return mod(mod(x, y) + y, y);
}

void main()
{
    // Current pixel position in layer pixel space
    vec2 fragPx = vUv * resolution;

    // Prevent invalid values
    float tileSize = max(Tile_Size, 0.0001);

    // Tile index + tile origin in pixel space
    vec2 tileIndex  = floor(fragPx / tileSize);
    vec2 tileOrigin = tileIndex * tileSize;

    // Handle partial tiles at frame edges
    vec2 cellSize = min(vec2(tileSize), resolution - tileOrigin);
    cellSize = max(cellSize, vec2(0.0001));

    // Local pixel coords inside tile
    vec2 localPx = fragPx - tileOrigin;
    vec2 center  = cellSize * 0.5;
    vec2 d       = localPx - center;

    // Convert user controls
    vec2 scalePct = vec2(
        max(Horizontal_Scale, 0.0001),
        max(Vertical_Scale,   0.0001)
    ) / 100.0;

    float ang = radians(Rotation);

    // Inverse transform:
    // output pixel -> source pixel inside the same tile
    // transform order = scale first, then rotate around tile center
    vec2 q = rotate2D(d, -ang);
    q /= scalePct;

    vec2 sampleLocal;
    bool outside = false;

    if (Cut_Tiles >= 0.5)
    {
        // Clip anything that would sample outside the tile
        sampleLocal = q + center;

        if (sampleLocal.x < 0.0 || sampleLocal.x > cellSize.x ||
            sampleLocal.y < 0.0 || sampleLocal.y > cellSize.y)
        {
            outside = true;
        }
    }
    else
    {
        // Wrap/repeat inside each tile instead of cutting
        sampleLocal = pmod(q + center, cellSize);
    }

    if (outside)
    {
        gl_FragColor = vec4(0.0);
        return;
    }

    // Back to full-layer pixel space
    vec2 samplePx = tileOrigin + sampleLocal;

    // Convert to texture UV
    vec2 sampleUv = samplePx / resolution;

    // Panzoid requires uvScale mapping for texture lookup
    vec4 texel = texture2D(tDiffuse, sampleUv * uvScale);

    gl_FragColor = texel;
}
