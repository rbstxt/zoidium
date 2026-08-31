precision highp float;
precision highp int;

// ============================================================
// HOTWAVE SHADER FOR PANZOID CM3
// 1:1 Match to After Effects Hotwave by BthJon on BOOTH
// ============================================================

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;

// --- DISTORTION (1-4) ---
uniform float Amount;
uniform float X_Bias;
uniform float Y_Bias;
uniform float Flow_Direction;

// --- NOISE (5-10) ---
uniform float Type;
uniform float Scale;
uniform float Octaves;
uniform float Persistence;
uniform float Lacunarity;
uniform float Random_Seed;

// --- ANIMATION (11-14) ---
uniform float Speed;
uniform float Wind_Direction;
uniform float Wind_Speed;
uniform float Evolution;

// --- HAZE/BLUR (15-16) ---
uniform float Blur_Strength;
uniform float Blur_Radius;

// --- GRADIENT MASK (17-20) ---
uniform float Enable_Mask;
uniform float Top;
uniform float Bottom;
uniform float Softness;

// --- CHROMATIC ABERRATION (21-24) ---
uniform float Direction;
uniform float Red_Offset;
uniform float Green_Offset;
uniform float Blue_Offset;

// --- SECONDARY TURBULENCE (25-27) ---
uniform float Enable_Turb;
uniform float Sec_Scale;
uniform float Sec_Speed;

// --- STEAM/VAPOR (28-33) ---
uniform float Enable_Steam;
uniform float Steam_Dir;
uniform float Steam_Scale;
uniform float Steam_Density;
uniform float Steam_Opacity;
uniform float Steam_Speed;

// ============================================================
// NOISE FUNCTIONS
// ============================================================

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                     + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float billowed(vec2 p) { return abs(snoise(p)); }
float ridged(vec2 p) { return 1.0 - abs(snoise(p)); }
float standard(vec2 p) { return snoise(p) * 0.5 + 0.5; }

float fbm(vec2 p, float oct, float persist, float lacun, float ntype) {
    float total = 0.0, amp = 1.0, freq = 1.0, maxv = 0.0;
    float pn = persist / 100.0;
    float ln = lacun / 1000.0;
    int o = int(floor(oct));

    for (int i = 0; i < 8; i++) {
        if (i >= o) break;
        vec2 sp = p * freq;
        float n;
        if (ntype < 0.5) n = billowed(sp);
        else if (ntype < 1.5) n = ridged(sp);
        else n = standard(sp);
        total += n * amp;
        maxv += amp;
        amp *= pn;
        freq *= ln;
    }

    float fo = fract(oct);
    if (fo > 0.0 && o < 8) {
        vec2 sp = p * freq;
        float n;
        if (ntype < 0.5) n = billowed(sp);
        else if (ntype < 1.5) n = ridged(sp);
        else n = standard(sp);
        total += n * amp * fo;
        maxv += amp * fo;
    }
    return total / maxv;
}

// ============================================================
// UTILITIES
// ============================================================

float deg2rad(float d) { return d * 0.01745329252; }

vec4 gblur(sampler2D t, vec2 uv, float r) {
    float px = r / resolution.x;
    float py = r / resolution.y;
    vec4 c = texture2D(t, uv) * 0.227027;
    c += texture2D(t, uv + vec2(px*1.0, 0.0)) * 0.1945946;
    c += texture2D(t, uv - vec2(px*1.0, 0.0)) * 0.1945946;
    c += texture2D(t, uv + vec2(px*2.0, 0.0)) * 0.1216216;
    c += texture2D(t, uv - vec2(px*2.0, 0.0)) * 0.1216216;
    c += texture2D(t, uv + vec2(px*3.0, 0.0)) * 0.054054;
    c += texture2D(t, uv - vec2(px*3.0, 0.0)) * 0.054054;
    c += texture2D(t, uv + vec2(px*4.0, 0.0)) * 0.016216;
    c += texture2D(t, uv - vec2(px*4.0, 0.0)) * 0.016216;

    vec4 c2 = texture2D(t, uv) * 0.227027;
    c2 += texture2D(t, uv + vec2(0.0, py*1.0)) * 0.1945946;
    c2 += texture2D(t, uv - vec2(0.0, py*1.0)) * 0.1945946;
    c2 += texture2D(t, uv + vec2(0.0, py*2.0)) * 0.1216216;
    c2 += texture2D(t, uv - vec2(0.0, py*2.0)) * 0.1216216;
    c2 += texture2D(t, uv + vec2(0.0, py*3.0)) * 0.054054;
    c2 += texture2D(t, uv - vec2(0.0, py*3.0)) * 0.054054;
    c2 += texture2D(t, uv + vec2(0.0, py*4.0)) * 0.016216;
    c2 += texture2D(t, uv - vec2(0.0, py*4.0)) * 0.016216;
    return (c + c2) * 0.5;
}

// ============================================================
// MAIN
// ============================================================

void main() {
    vec2 uv = vUvScaled;
    float seed = Random_Seed * 100.0;
    float t = time;

    // Animation
    float animT = t * Speed * 0.001 + deg2rad(Evolution);
    float windT = t * Wind_Speed * 0.01;

    // Directions
    float fRad = deg2rad(Flow_Direction);
    vec2 fDir = vec2(sin(fRad), cos(fRad));
    float wRad = deg2rad(Wind_Direction);
    vec2 wDir = vec2(sin(wRad), cos(wRad));

    // --- GRADIENT MASK ---
    float mask = 1.0;
    if (Enable_Mask > 0.5) {
        float topN = Top / 100.0;
        float botN = Bottom / 100.0;
        float soft = max(Softness / 100.0, 0.001);
        float gp = 1.0 - uv.y;
        float mv = smoothstep(topN - soft, topN + soft, gp);
        mv *= smoothstep(botN + soft, botN - soft, gp);
        mask = mix(topN, botN, mv);
        mask = clamp(mask, 0.0, 1.0);
    }

    // --- MAIN NOISE ---
    float nScale = Scale * 0.0001;
    vec2 nPos = uv * nScale + seed;
    nPos += wDir * windT * 0.1;
    nPos += fDir * animT * 0.1;
    float mainN = fbm(nPos, Octaves, Persistence, Lacunarity, Type);

    // --- SECONDARY TURBULENCE ---
    float secN = 0.0;
    if (Enable_Turb > 0.5) {
        float ss = Sec_Scale * 0.0001;
        float st = t * Sec_Speed * 0.001;
        vec2 sp = uv * ss + seed + 50.0;
        sp += fDir * st * 0.1;
        secN = fbm(sp, Octaves, Persistence, Lacunarity, Type);
    }

    float cNoise = Enable_Turb > 0.5 ? mix(mainN, secN, 0.5) : mainN;

    // --- DISTORTION ---
    float xBias = (X_Bias - 50.0) / 50.0;
    float yBias = (Y_Bias - 50.0) / 50.0;
    float amt = Amount / 100.0;

    vec2 distOff = fDir * cNoise * amt * 0.05;
    distOff += vec2(xBias, yBias) * amt * 0.02;
    distOff *= mask;

    // --- STEAM/VAPOR ---
    float steamM = 0.0;
    if (Enable_Steam > 0.5) {
        float ssc = Steam_Scale * 0.0001;
        float sst = t * Steam_Speed * 0.001;
        float sRad = deg2rad(Steam_Dir);
        vec2 sDir = vec2(sin(sRad), cos(sRad));
        vec2 sp = uv * ssc + seed + 100.0;
        sp += sDir * sst * 0.2;
        float sn = fbm(sp, max(Octaves * 0.5, 1.0), Persistence, Lacunarity, 0.0);
        float dens = Steam_Density / 100.0;
        float opa = Steam_Opacity / 100.0;
        steamM = smoothstep(1.0 - dens, 1.0, sn) * opa;
        steamM *= mask;
    }

    // --- BLUR / HAZE ---
    float blurAmt = Blur_Strength / 100.0;
    vec4 col;
    if (Blur_Radius > 0.5 && blurAmt > 0.01) {
        vec4 blurC = gblur(tDiffuse, uv + distOff, Blur_Radius);
        vec4 sharpC = texture2D(tDiffuse, uv + distOff);
        col = mix(sharpC, blurC, blurAmt * mask);
    } else {
        col = texture2D(tDiffuse, uv + distOff);
    }

    // --- CHROMATIC ABERRATION ---
    if (abs(Red_Offset) > 0.1 || abs(Green_Offset) > 0.1 || abs(Blue_Offset) > 0.1) {
        float caRad = deg2rad(Direction);
        vec2 caDir = vec2(sin(caRad), cos(caRad));
        vec2 rOff = caDir * Red_Offset / resolution + distOff * 0.5;
        vec2 gOff = caDir * Green_Offset / resolution + distOff * 0.5;
        vec2 bOff = caDir * Blue_Offset / resolution + distOff * 0.5;
        col.r = texture2D(tDiffuse, uv + rOff).r;
        col.g = texture2D(tDiffuse, uv + gOff).g;
        col.b = texture2D(tDiffuse, uv + bOff).b;
    }

    // --- APPLY STEAM ---
    if (Enable_Steam > 0.5 && steamM > 0.001) {
        vec3 steamCol = vec3(0.95, 0.93, 0.90);
        col.rgb = mix(col.rgb, steamCol, steamM);
    }

    gl_FragColor = col;
}
