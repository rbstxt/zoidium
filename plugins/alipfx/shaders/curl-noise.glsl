precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time; // Panzoid's built-in time uniform for Speed and Turbulence

// --- 1. Input Noise ---
uniform float Source;
uniform float Mirror_at_Edge;
uniform float Speed;
uniform float Direction;
uniform float Softness;

// --- 2. Transform ---
uniform float Uniform_Scaling;
uniform float Scale;
uniform float Scale_Width;
uniform float Scale_Height;
uniform vec2 Offset;
uniform float Rotation;

// --- 3. Curl Generation ---
uniform float Evolution;
uniform float Turbulence_Speed;
uniform float Swirl;
uniform float Density;
uniform float Smoothness;
uniform float Vertical_Bias;

// --- 4. Flow Options ---
uniform float Sample_Count;
uniform float Sample_Radius;
uniform float Flow_Softness;
uniform float Edge_Definition;
uniform float Flow_Falloff;

// --- 5. Output ---
uniform float View;
uniform float Contrast;
uniform float Brightness;
uniform float Clip_HDR_Results;
uniform float Channel;

// ==========================================
// 3D Simplex Noise Function (Ashima Arts)
// ==========================================
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ==========================================
// Sampling & Generation Logic
// ==========================================
float getInternalNoise(vec2 uv) {
    // 1. Spatial drifting (Driven ONLY by Speed and Direction)
    float driftTime = time * Speed * 0.01;
    float dirRad = Direction * 3.14159265 / 180.0;
    vec2 flowVel = vec2(cos(dirRad), sin(dirRad)) * driftTime;
    
    // 2. Temporal morphing (Driven by Turbulence Speed and Evolution)
    float evoOffset = Evolution * 0.01;
    float turb = time * Turbulence_Speed * 0.01 + evoOffset;
    
    // Density pulls/pushes complexity
    vec2 pos = uv * (Density * 0.05 + 1.5) + flowVel;
    return snoise(vec3(pos, turb)) * 0.5 + 0.5;
}

vec4 sampleInputMap(vec2 uv) {
    if (Source < 0.5) { // Internal
        float n = getInternalNoise(uv);
        return vec4(vec3(n), 1.0);
    } else { // This Layer
        if (Mirror_at_Edge > 0.5) {
            uv = abs(mod(uv - 1.0, 2.0) - 1.0);
        } else {
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
        }
        
        if (Softness > 0.0) {
            vec4 col = vec4(0.0);
            float r = Softness * 0.001;
            // 5-tap cross blur
            col += texture2D(tDiffuse, (uv) * uvScale);
            col += texture2D(tDiffuse, (uv + vec2(r, 0.0)) * uvScale);
            col += texture2D(tDiffuse, (uv + vec2(-r, 0.0)) * uvScale);
            col += texture2D(tDiffuse, (uv + vec2(0.0, r)) * uvScale);
            col += texture2D(tDiffuse, (uv + vec2(0.0, -r)) * uvScale);
            return col / 5.0;
        }
        return texture2D(tDiffuse, uv * uvScale);
    }
}

float getLuminance(vec2 uv) {
    vec4 c = sampleInputMap(uv);
    return dot(c.rgb, vec3(0.299, 0.587, 0.114));
}

vec2 generateCurl(vec2 uv) {
    // 1. Lock a fixed base epsilon to preserve mathematically stable vector power
    float baseEps = 0.002;
    
    // 2. Smoothness pushes the sampling footprint outward to ignore high-frequency details
    float reach = baseEps + (Smoothness * 0.0005);
    
    float n0 = getLuminance(uv + vec2(0.0, reach));
    float n1 = getLuminance(uv - vec2(0.0, reach));
    float n2 = getLuminance(uv + vec2(reach, 0.0));
    float n3 = getLuminance(uv - vec2(reach, 0.0));

    // FIX: Divide by the fixed baseEps instead of the variable reach!
    float dx = (n2 - n3) / (2.0 * baseEps);
    float dy = (n0 - n1) / (2.0 * baseEps);

    vec2 curl = vec2(dy, -dx);
    
    // Gently dampen the overall strength as Smoothness scales up so it doesn't spiral out of control
    float dampening = 1.0 / (1.0 + Smoothness * 0.015);
    curl *= dampening;
    
    // Vertical Bias
    float vb = Vertical_Bias / 100.0;
    curl.x *= (1.0 - vb);
    curl.y *= (1.0 + vb);
    
    // Swirl
    return curl * (Swirl / 100.0);
}

// ==========================================
// Main Function
// ==========================================
void main() {
    vec2 uv = vUv;

    // Transform Pass
    uv -= 0.5;
    float rad = Rotation * 3.14159265 / 180.0;
    float s = sin(rad), c = cos(rad);
    uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    vec2 scaleVec = (Uniform_Scaling > 0.5) ? vec2(Scale) : vec2(Scale_Width, Scale_Height);
    scaleVec = max(scaleVec, vec2(0.001)) / 100.0;
    uv /= scaleVec;
    uv += 0.5;
    uv -= Offset;

    vec4 finalColor = vec4(0.0);

    // View Routing
    if (View < 0.5) { // 0 = Input Noise
        finalColor = sampleInputMap(uv);
        
    } else if (View < 1.5) { // 1 = Curl Generation
        vec2 curlMap = generateCurl(uv);
        finalColor = vec4(curlMap.x * 0.5 + 0.5, curlMap.y * 0.5 + 0.5, 0.5, 1.0);
        
    } else { // 2 = Final Render (LIC)
        vec2 p = uv;
        float stepSize = Sample_Radius / 1000.0;
        float iters = clamp(Sample_Count, 3.0, 24.0);
        
        vec4 accColor = vec4(0.0);
        float totalWeight = 0.0;

        for (int i = 0; i < 24; i++) {
            if (float(i) >= iters) break;
            
            vec2 flowVec = generateCurl(p);
            p += flowVec * stepSize;
            
            vec4 sampledNode = sampleInputMap(p);
            
            // Edge Definition (Sharpening the samples dynamically)
            if (Edge_Definition > 0.0) {
                float lum = dot(sampledNode.rgb, vec3(0.299, 0.587, 0.114));
                float contrastAmt = Edge_Definition / 50.0;
                sampledNode.rgb = mix(sampledNode.rgb, vec3(smoothstep(0.5 - 0.1, 0.5 + 0.1, lum)), contrastAmt);
            }

            // Flow Falloff
            float weight = 1.0 - (float(i) / iters) * (Flow_Falloff / 100.0);
            accColor += sampledNode * weight;
            totalWeight += weight;
        }
        
        finalColor = accColor / totalWeight;

        // Flow Softness
        if (Flow_Softness > 0.0) {
            vec4 rawTex = texture2D(tDiffuse, vUvScaled);
            finalColor = mix(finalColor, rawTex, Flow_Softness / 200.0); 
        }
    }

    // Output Adjustments
    float cont = Contrast / 100.0;
    finalColor.rgb = (finalColor.rgb - 0.5) * max(1.0 + cont, 0.0) + 0.5;
    finalColor.rgb += Brightness / 100.0;

    if (Clip_HDR_Results > 0.5) {
        finalColor.rgb = clamp(finalColor.rgb, 0.0, 1.0);
    }

    if (Channel > 0.5) { // Output Alpha visually
        finalColor = vec4(finalColor.a, finalColor.a, finalColor.a, 1.0);
    } else {
        finalColor.a = 1.0; 
    }

    gl_FragColor = finalColor;
}
