precision highp float;
precision highp int;

// --- Panzoid Built-in Variables ---
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// --- Custom Panzoid Properties ---
// IMPORTANT: You must create dynamic number properties named "time" and "ALPHA_MODE" in Panzoid!
uniform float time;
uniform float ALPHA_MODE; // 0.0 = Solid Background, 1.0 = Transparent Overlay

// --- Shader Constants ---
const int ITERATIONS = 5;
const float SPEED = 2.0;

const float STRIP_CHARS_MIN =  3.0;
const float STRIP_CHARS_MAX = 40.0;
const float STRIP_CHAR_HEIGHT = 0.10;
const float STRIP_CHAR_WIDTH = 0.15;
const float ZCELL_SIZE = 1.0 * (STRIP_CHAR_HEIGHT * STRIP_CHARS_MAX);
const float XYCELL_SIZE = 12.0 * STRIP_CHAR_WIDTH;
const int BLOCK_SIZE = 8;
const int BLOCK_GAP = 0;

const float PI = 3.14159265359;

// --- Helper Functions ---
float hash(float v) {
    return fract(sin(v)*43758.5453123);
}

float hash(vec2 v) {
    return hash(dot(v, vec2(5.3983, 5.4427)));
}

vec2 hash2(vec2 v) {
    return fract(sin(v)*43758.5453123);
}

// Converted mat4x2 to dot products for standard WebGL 1.0 compatibility
vec4 hash4(vec2 v) {
    vec4 p = vec4(
        dot(v, vec2(127.1, 311.7)),
        dot(v, vec2(269.5, 183.3)),
        dot(v, vec2(113.5, 271.9)),
        dot(v, vec2(246.1, 124.6))
    );
    return fract(sin(p)*43758.5453123);
}

// Converted mat4x3 to dot products for standard WebGL 1.0 compatibility
vec4 hash4(vec3 v) {
    vec4 p = vec4(
        dot(v, vec3(127.1, 311.7, 74.7)),
        dot(v, vec3(269.5, 183.3, 246.1)),
        dot(v, vec3(113.5, 271.9, 124.6)),
        dot(v, vec3(271.9, 269.5, 311.7))
    );
    return fract(sin(p)*43758.5453123);
}

float rune_line(vec2 p, vec2 a, vec2 b) {
    p -= a; b -= a;
    float h = clamp(dot(p, b) / dot(b, b), 0.0, 1.0);
    return length(p - b * h);
}

float rune(vec2 U, vec2 seed, float highlight) {
    float d = 1e5;
    for (int i = 0; i < 4; i++) {
        vec4 pos = hash4(seed);
        seed += 1.0;

        if (i == 0) pos.y = 0.0;
        if (i == 1) pos.x = 0.999;
        if (i == 2) pos.x = 0.0;
        if (i == 3) pos.y = 0.999;
        
        vec4 snaps = vec4(2.0, 3.0, 2.0, 3.0);
        pos = (floor(pos * snaps) + 0.5) / snaps;

        if (pos.xy != pos.zw) {
            d = min(d, rune_line(U, pos.xy, pos.zw + 0.001));
        }
    }
    return smoothstep(0.1, 0.0, d) + highlight*smoothstep(0.4, 0.0, d);
}

float random_char(vec2 outer, vec2 inner, float highlight) {
    vec2 seed = vec2(dot(outer, vec2(269.5, 183.3)), dot(outer, vec2(113.5, 271.9)));
    return rune(inner, seed, highlight);
}

// Changed to return vec4 to pass both color and alpha
vec4 rain(vec3 ro3, vec3 rd3, float t) {
    vec4 result = vec4(0.0);

    vec2 ro2 = normalize(ro3.xy);
    vec2 rd2 = normalize(rd3.xy);

    bool prefer_dx = abs(rd2.x) > abs(rd2.y);
    float t3_to_t2 = prefer_dx ? rd3.x / rd2.x : rd3.y / rd2.y;

    ivec3 cell_side = ivec3(step(0.0, rd3));
    ivec3 cell_shift = ivec3(sign(rd3));

    float t2 = 0.0;
    ivec2 next_cell = ivec2(floor(ro2/XYCELL_SIZE));

    for (int i=0; i<ITERATIONS; i++) {
        ivec2 cell = next_cell;
        float t2s = t2;

        vec2 side = vec2(next_cell + cell_side.xy) * XYCELL_SIZE;
        vec2 t2_side = (side - ro2) / rd2;
        if (t2_side.x < t2_side.y) {
            t2 = t2_side.x;
            next_cell.x += cell_shift.x;
        } else {
            t2 = t2_side.y;
            next_cell.y += cell_shift.y;
        }

        vec2 cell_in_block = fract(vec2(cell) / float(BLOCK_SIZE));
        float gap = float(BLOCK_GAP) / float(BLOCK_SIZE);
        if (cell_in_block.x < gap || cell_in_block.y < gap || (cell_in_block.x < (gap+0.1) && cell_in_block.y < (gap+0.1))) {
            continue;
        }

        float t3s = t2s / t3_to_t2;
        float pos_z = ro3.z + rd3.z * t3s;
        float xycell_hash = hash(vec2(cell));
        float z_shift = xycell_hash*11.0 - t * (0.5 + xycell_hash * 1.0 + xycell_hash * xycell_hash * 1.0 + pow(xycell_hash, 16.0) * 3.0);
        float char_z_shift = floor(z_shift / STRIP_CHAR_HEIGHT);
        z_shift = char_z_shift * STRIP_CHAR_HEIGHT;
        int zcell = int(floor((pos_z - z_shift)/ZCELL_SIZE));

        for (int j=0; j<2; j++) {
            vec4 cell_hash = hash4(vec3(float(cell.x), float(cell.y), float(zcell)));
            vec4 cell_hash2 = fract(cell_hash * vec4(127.1, 311.7, 271.9, 124.6));

            float chars_count = cell_hash.w * (STRIP_CHARS_MAX - STRIP_CHARS_MIN) + STRIP_CHARS_MIN;
            float target_length = chars_count * STRIP_CHAR_HEIGHT;
            float target_rad = STRIP_CHAR_WIDTH / 2.0;
            float target_z = (float(zcell)*ZCELL_SIZE + z_shift) + cell_hash.z * (ZCELL_SIZE - target_length);
            vec2 target = vec2(cell) * XYCELL_SIZE + target_rad + cell_hash.xy * (XYCELL_SIZE - target_rad*2.0);

            vec2 s = target - ro2;
            float tmin = dot(s, rd2);
            if (tmin >= t2s && tmin <= t2) {
                float u = s.x * rd2.y - s.y * rd2.x;
                if (abs(u) < target_rad) {
                    u = (u/target_rad + 1.0) / 2.0;
                    float z = ro3.z + rd3.z * tmin/t3_to_t2;
                    float v = (z - target_z) / target_length;
                    if (v >= 0.0 && v < 1.0) {
                        float c = floor(v * chars_count);
                        float q = fract(v * chars_count);
                        vec2 char_hash = hash2(vec2(c+char_z_shift, cell_hash2.x));
                        if (char_hash.x >= 0.1 || c == 0.0) {
                            float time_factor = floor(c == 0.0 ? t*5.0 : 
                                t*(1.0*cell_hash2.z + cell_hash2.w*cell_hash2.w*4.0*pow(char_hash.y, 4.0)));
                            float a = random_char(vec2(char_hash.x, time_factor), vec2(u,q), max(1.0, 3.0 - c/2.0)*0.2);
                            a *= clamp((chars_count - 0.5 - c) / 2.0, 0.0, 1.0);
                            if (a > 0.0) {
                                float attenuation = 1.0 + pow(0.06*tmin/t3_to_t2, 2.0);
                                vec3 c_col = (c == 0.0 ? vec3(0.67, 1.0, 0.82) : vec3(0.25, 0.80, 0.40)) / attenuation;
                                float a1 = result.a;
                                result.a = a1 + (1.0 - a1) * a;
                                result.xyz = (result.xyz * a1 + c_col * (1.0 - a1) * a) / result.a;
                                if (result.a > 0.98) return result;
                            }
                        }
                    }
                }
            }
            zcell += cell_shift.z;
        }
    }
    return result;
}

// --- Main Panzoid Entry Point ---
void main() {
    if (STRIP_CHAR_WIDTH > XYCELL_SIZE || STRIP_CHAR_HEIGHT * STRIP_CHARS_MAX > ZCELL_SIZE) {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
        return;
    }

    vec2 uv = (vUv * 2.0 - 1.0) * (resolution / resolution.y);
    float t = time * SPEED;

    float level1_size = float(BLOCK_SIZE) * XYCELL_SIZE;
    float gap_size = float(BLOCK_GAP) * XYCELL_SIZE;

    vec3 ro = vec3(gap_size/2.0, gap_size/2.0, 0.0);
    vec3 rd = vec3(uv.x, 2.0, uv.y);
    
    vec2 p = vec2(0.0);
    ro.xy += level1_size * p;

    ro += rd * 0.2;
    rd = normalize(rd);

    // Get color and alpha composition from rain calculations
    vec4 rain_out = rain(ro, rd, t);

    // Fetch the original layer behind the shader effect
    vec4 background = texture2D(tDiffuse, vUvScaled);

    if (ALPHA_MODE > 0.5) {
        // Transparent Overlay Mode: blend matrix over background
        gl_FragColor = vec4(mix(background.rgb, rain_out.xyz, rain_out.a), background.a);
    } else {
        // Solid Background Mode: display on pure black backdrop
        gl_FragColor = vec4(rain_out.xyz * rain_out.a, 1.0);
    }
}
