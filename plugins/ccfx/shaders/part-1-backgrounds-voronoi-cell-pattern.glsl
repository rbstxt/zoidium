precision highp float;
// precision highp int; // Integers avoided

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --- Controls ---

// 0.0: Bubbles, 1.0: Crystals, 2.0: Plates, 3.0: Static Plates, 
// 4.0: Crystallize, 5.0: Pillow, 6.0: Mixed Crystals, 7.0: Tubular, 
// 8.0: Pillow HQ
uniform float uPatternType; 

uniform float uInvert; // 0.0 = No, 1.0 = Yes
uniform float uContrast; // 1.0 default
uniform float uOverflow; // 0.0: Clip, 1.0: Soft Clamp, 2.0: Wrap Back

uniform float uDisperse; // 0.0 to 1.0
uniform float uSize; // Default ~60.0
uniform vec2 uOffset;

// Tiling
uniform float uEnableTiling; // 0.0 or 1.0
uniform vec2 uCellsTiling; // x: Horizontal, y: Vertical

// Evolution
uniform float uEvolution;
uniform float uCycleEvolution; 
uniform float uCycle; 
uniform float uSeed;

// --- Helper Functions ---

// Float-only Modulo
float fmod(float x, float y) {
    return x - y * floor(x / y);
}

vec2 fmod2(vec2 x, vec2 y) {
    return x - y * floor(x / y);
}

// Random Hash Function
vec3 hash3(vec2 p) {
    vec3 q = vec3(dot(p, vec2(127.1, 311.7)), 
                  dot(p, vec2(269.5, 183.3)), 
                  dot(p, vec2(419.2, 371.9)));
    return fract(sin(q) * (43758.5453 + uSeed));
}

// 3D Cellular Noise
vec3 cellularNoise(vec2 uv, float time) {
    vec2 i_st = floor(uv);
    vec2 f_st = fract(uv);
    
    float m_dist = 10.0;  
    float m_dist2 = 10.0; 
    float m_id = 0.0;
    
    for (float y = -1.0; y <= 1.0; y += 1.0) {
        for (float x = -1.0; x <= 1.0; x += 1.0) {
            vec2 neighbor = vec2(x, y);
            
            vec2 tiledCoord = i_st + neighbor;
            if (uEnableTiling > 0.5) {
                 tiledCoord = fmod2(tiledCoord, uCellsTiling);
            }

            vec3 pointHash = hash3(tiledCoord);
            vec2 point = 0.5 + 0.5 * sin(time + 6.2831 * pointHash.xy);
            point = mix(vec2(0.5), point, uDisperse);

            vec2 diff = neighbor + point - f_st;
            float dist = length(diff);

            if (dist < m_dist) {
                m_dist2 = m_dist;
                m_dist = dist;
                m_id = pointHash.z; 
            } else if (dist < m_dist2) {
                m_dist2 = dist;
            }
        }
    }
    
    return vec3(m_dist, m_dist2, m_id);
}

void main() {
    // 1. Setup Coordinates
    vec2 uv = vUvScaled;
    uv += uOffset;

    if (uEnableTiling > 0.5) {
        uv *= uCellsTiling;
    } else {
        uv *= (uSize / 10.0); 
    }

    // 2. Evolution
    float time = uEvolution;
    if (uCycleEvolution > 0.5 && uCycle > 0.0) {
         time = fmod(time, uCycle);
    }

    // 3. Generate Noise
    vec3 noise = cellularNoise(uv, time);
    float f1 = noise.x;
    float f2 = noise.y;
    float cellID = noise.z;

    // 4. Pattern Generation
    float val = 0.0;

    if (uPatternType < 0.5) { 
        // Bubbles
        val = 1.0 - f1;
    } 
    else if (uPatternType < 1.5) { 
        // Crystals
        val = f1;
    } 
    else if (uPatternType < 2.5) { 
        // Plates
        val = cellID;
    } 
    else if (uPatternType < 3.5) { 
        // Static Plates
        vec2 staticGrid = floor(uv);
        if (uEnableTiling > 0.5) staticGrid = fmod2(staticGrid, uCellsTiling);
        val = hash3(staticGrid).z; 
    }
    else if (uPatternType < 4.5) { 
        // Crystallize: Raw Gradient
        val = f2 - f1;
    }
    else if (uPatternType < 5.5) { 
        // Pillow (Regular): Gradient shape * Random Cell ID
        float shape = 1.0 - (f2 - f1);
        val = shape * cellID; 
    }
    else if (uPatternType < 6.5) { 
        // Mixed Crystals
        val = (f1 + cellID) * 0.5;
    }
    else if (uPatternType < 7.5) { 
        // Tubular
        val = (f1 + f2) * 0.5;
    }
    else { 
        // Pillow HQ (Fixed): 
        // Uses f2-f1 (Distance to edge)
        // smoothstep creates a hard cut: 0.0 at edge, 1.0 inside.
        // This results in Solid White Cells with Black Borders.
        val = smoothstep(0.0, 0.1, f2 - f1);
    }

    // 5. Contrast
    val = (val - 0.5) * uContrast + 0.5;

    // 6. Overflow
    if (uOverflow < 0.5) {
        val = clamp(val, 0.0, 1.0);
    } 
    else if (uOverflow < 1.5) {
        val = smoothstep(0.0, 1.0, val);
    } 
    else {
        float temp = abs(val);
        temp = fmod(temp, 2.0);
        if (temp > 1.0) temp = 2.0 - temp;
        val = temp;
    }

    // 7. Invert
    if (uInvert > 0.5) {
        val = 1.0 - val;
    }

    gl_FragColor = vec4(vec3(val), 1.0);
}
