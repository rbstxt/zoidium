precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

uniform float Pixel_Size;
uniform float Dither;
uniform float Chroma_Shift;

/* ---- ordered (Bayer) dither matrix ---- */
float bayer2(vec2 a){
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float bayer4(vec2 a){
    return bayer2(a * 0.5) * 0.25 + bayer2(a);
}

/* ---- nearest color in the TMS9918A 15-color palette ---- */
vec3 tms9918(vec3 c){
    vec3 pal[15];
    pal[0]  = vec3(0.000, 0.000, 0.000); // black
    pal[1]  = vec3(0.239, 0.722, 0.353); // medium green
    pal[2]  = vec3(0.490, 0.878, 0.541); // light green
    pal[3]  = vec3(0.329, 0.329, 0.949); // dark blue
    pal[4]  = vec3(0.522, 0.522, 0.988); // light blue
    pal[5]  = vec3(0.831, 0.329, 0.298); // dark red
    pal[6]  = vec3(0.329, 0.988, 0.988); // cyan
    pal[7]  = vec3(0.988, 0.329, 0.329); // medium red
    pal[8]  = vec3(0.988, 0.522, 0.522); // light red
    pal[9]  = vec3(0.831, 0.722, 0.298); // dark yellow
    pal[10] = vec3(0.831, 0.831, 0.490); // light yellow
    pal[11] = vec3(0.169, 0.416, 0.169); // dark green
    pal[12] = vec3(0.769, 0.329, 0.769); // magenta
    pal[13] = vec3(0.800, 0.800, 0.800); // gray
    pal[14] = vec3(1.000, 1.000, 1.000); // white

    vec3 best = pal[0];
    float bd = 1e9;
    for (int i = 0; i < 15; i++){
        float d = dot(c - pal[i], c - pal[i]);
        if (d < bd){ bd = d; best = pal[i]; }
    }
    return best;
}

void main()
{
    // 1) pixelate: snap UVs to a coarse virtual-pixel grid
    vec2 grid = resolution / Pixel_Size;
    vec2 pc   = floor(vUv * grid);          // virtual pixel coordinate
    vec2 uv   = (pc + 0.5) / grid;          // sample at pixel center

    // 2) slight horizontal chroma fringing (like the reference video)
    vec2 off = vec2(Chroma_Shift * Pixel_Size / resolution.x, 0.0);
    vec3 col;
    col.r = texture2D(tDiffuse, (uv + off) * uvScale).r;
    col.g = texture2D(tDiffuse,  uv         * uvScale).g;
    col.b = texture2D(tDiffuse, (uv - off) * uvScale).b;

    // 3) ordered dither: add Bayer threshold BEFORE quantizing,
    //    evaluated per virtual pixel so dots align with the pixel grid
    col += (bayer4(pc) - 0.5) * Dither;

    // 4) quantize to the TMS9918 palette
    gl_FragColor = vec4(tms9918(col), 1.0);
}
