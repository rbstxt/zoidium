precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// Custom Properties
uniform float Progress; 
uniform float Grid_size;
uniform float Spread;
uniform float Reverse_mode;

// Calculates distance from the center of a hexagon
float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

void main() {
    // 1. Get the original layer texture
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    // 2. Adjust UVs for aspect ratio so hexes are perfectly symmetrical
    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
    vec2 uv = vUv * aspect;

    // 3. Scale the grid
    float scale = Grid_size > 0.0 ? Grid_size : 15.0;
    uv *= scale;

    // 4. Stable Hexagon Grid generation
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    
    // Determine which hex center is closer
    vec2 gv = dot(a, a) < dot(b, b) ? a : b; 
    float dist = hexDist(gv);
    vec2 id = uv - gv; 
    
    // 5. Calculate Radial Distance from Screen Center
    vec2 center = 0.5 * aspect * scale;
    float radialDist = distance(id, center); 
    float maxDist = length(0.5 * aspect * scale);
    float normalizedDist = radialDist / maxDist; 

    // 6. Calculate the Wipe Animation with a Wider Spread
    float actualSpread = Spread > 0.0 ? Spread : 1.5; 
    float wipeRange = 1.0 + actualSpread;
    
    float wipe = (Progress * wipeRange) - normalizedDist;
    float hexSize = clamp(wipe / actualSpread, 0.0, 1.0) * 0.6;

    // 7. Create the crisp mask for the transition
    float mask = smoothstep(hexSize + 0.02, hexSize - 0.02, dist);

    // 8. Reverse Mode Logic
    mask = mix(mask, 1.0 - mask, Reverse_mode);

    // 9. Output final image with alpha transparency applied
    gl_FragColor = vec4(texel.rgb * mask, texel.a * mask);
}
