precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

uniform float Radius;
uniform float Intensity;
uniform float Threshold;
uniform float SoftKnee;
uniform float Streaks;
uniform float Chromatic;
uniform float Saturation;
uniform float Vignette;

uniform float Gamma_Correction;
uniform float Scene_Gamma;

uniform float Aspect_Ratio;
uniform float Aspect_Angle;

uniform vec3 Color_Inner;
uniform vec3 Color_Outer;
uniform float Tint_Mode;
uniform float Tint_Blend_Mode;

// Generates pseudo-random noise to smooth out the glow and prevent banding
float hash(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float satf(float x) {
    return clamp(x, 0.0, 1.0);
}

vec3 toLinear(vec3 c) {
    float g = max(Scene_Gamma, 0.0001);
    return pow(max(c, 0.0), vec3(g));
}

vec3 toGamma(vec3 c) {
    float g = max(Scene_Gamma, 0.0001);
    return pow(max(c, 0.0), vec3(1.0 / g));
}

vec3 sampleLinear(vec2 uv) {
    vec3 c = texture2D(tDiffuse, uv * uvScale).rgb; 
    float gc = satf(Gamma_Correction / 100.0);
    return mix(c, toLinear(c), gc);
}

vec3 brightPass(vec3 c) {
    float y = luma(c);
    float knee = max(SoftKnee, 0.0001);
    float m = smoothstep(Threshold - knee, Threshold + knee, y);
    return max(c - vec3(Threshold), 0.0) * m;
}

vec3 saturateColor(vec3 c, float s) {
    float y = luma(c);
    return mix(vec3(y), c, s);
}

vec3 blendMultiply(vec3 base, vec3 blend) { return base * blend; }
vec3 blendOverlay(vec3 base, vec3 blend) {
    vec3 low = 2.0 * base * blend;
    vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
    return mix(low, high, step(vec3(0.5), base));
}
vec3 blendSoftLight(vec3 base, vec3 blend) {
    vec3 d = step(vec3(0.5), blend);
    vec3 low = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
    vec3 high = base + (2.0 * blend - 1.0) * (sqrt(max(base, 0.0)) - base);
    return mix(low, high, d);
}

vec3 applyTintBlend(vec3 glow, vec3 tint) {
    if (Tint_Blend_Mode < 0.5) return blendMultiply(glow, tint);
    else if (Tint_Blend_Mode < 1.5) return blendOverlay(glow, tint);
    return blendSoftLight(glow, tint);
}

vec3 getTintColor(float distNorm) {
    if (Tint_Mode < 0.5) return vec3(1.0);
    else if (Tint_Mode < 1.5) return clamp(Color_Inner, 0.0, 1.0);
    return mix(clamp(Color_Inner, 0.0, 1.0), clamp(Color_Outer, 0.0, 1.0), satf(distNorm));
}

vec2 rotateVec(vec2 d, float angleRad) {
    float s = sin(angleRad);
    float c = cos(angleRad);
    return vec2(c * d.x - s * d.y, s * d.x + c * d.y);
}

vec2 orientOffset(vec2 d) {
    float a = radians(Aspect_Angle);
    float ar = max(Aspect_Ratio, 0.0001);
    d.x *= ar;
    return rotateVec(d, a);
}

vec3 tintedGlow(vec3 glow, float distNorm) {
    if (Tint_Mode < 0.5) return glow;
    vec3 tint = getTintColor(distNorm);
    return applyTintBlend(glow, tint);
}

void main() {
    vec2 uv = vUv; 
    vec2 px = 1.0 / max(resolution, vec2(1.0));

    vec4 centerTex = texture2D(tDiffuse, vUvScaled);
    float gc = satf(Gamma_Correction / 100.0);
    vec3 center = mix(centerTex.rgb, toLinear(centerTex.rgb), gc);

    float spread = max(Radius, 0.0) * 0.5; 
    float noise = hash(uv * 100.0);

    vec3 bloom = vec3(0.0);
    float bloomWeight = 0.0;
    
    // Increased sample count and updated area distribution logic
    // to guarantee a smooth, radial circle with no gaps or streaks
    const int SAMPLES = 3500; 
    float goldenAngle = 2.39996323;

    for (int i = 0; i < SAMPLES; i++) {
        float t = (float(i) + noise) / float(SAMPLES);
        
        // sqrt(t) forces the samples to distribute evenly over the whole circle area
        float r = sqrt(t) * spread; 
        
        // Exponential opacity fade for the "Deep Glow" look
        float weight = 1.0 / (1.0 + r * 5.0); 
        
        float theta = float(i) * goldenAngle;
        vec2 dir = vec2(cos(theta), sin(theta));
        
        vec2 offset = orientOffset(dir * r * px);

        vec3 sampleCol;
        float cAmount = satf(Chromatic);
        
        if (cAmount > 0.0001) {
            vec2 caOffset = offset * 0.2 * cAmount; 
            sampleCol.r = brightPass(sampleLinear(uv + offset + caOffset)).r;
            sampleCol.g = brightPass(sampleLinear(uv + offset)).g;
            sampleCol.b = brightPass(sampleLinear(uv + offset - caOffset)).b;
        } else {
            sampleCol = brightPass(sampleLinear(uv + offset));
        }

        bloom += sampleCol * weight;
        bloomWeight += weight;
    }
    
    bloom /= max(bloomWeight, 0.0001);

    // Streaks fixed to only emit horizontally (anamorphic) 
    float streakAmt = max(Streaks, 0.0);
    vec3 streak = vec3(0.0);
    if (streakAmt > 0.0) {
        float streakWeight = 0.0;
        const int STREAK_SAMPLES = 40;
        for (int i = 0; i < STREAK_SAMPLES; i++) {
            float t = (float(i) + noise) / float(STREAK_SAMPLES);
            float r = t * spread * 2.5; 
            float weight = 1.0 / (1.0 + r * 2.0);

            vec2 sx = orientOffset(vec2(1.0, 0.0) * r * px);

            streak += brightPass(sampleLinear(uv + sx)) * weight;
            streak += brightPass(sampleLinear(uv - sx)) * weight;
            
            streakWeight += weight * 2.0;
        }
        streak /= max(streakWeight, 0.0001);
    }

    vec3 glow = bloom + streak * streakAmt * 0.5;
    
    glow = glow * max(Intensity, 0.0) * 1.5; 

    vec3 tinted = tintedGlow(glow, 0.65);
    tinted = tinted / (1.0 + tinted);

    vec3 outCol = center + tinted;
    outCol = saturateColor(outCol, max(Saturation, 0.0));

    vec2 p = vUv - 0.5;
    float vig = 1.0 - max(Vignette, 0.0) * smoothstep(0.08, 0.80, dot(p, p));
    outCol *= vig;

    outCol = mix(outCol, toGamma(outCol), gc);
    outCol = clamp(outCol, 0.0, 1.0);

    float glowAlpha = clamp(luma(glow) * 3.0, 0.0, 1.0); 
    float finalAlpha = max(centerTex.a, glowAlpha);

    gl_FragColor = vec4(outCol, finalAlpha);
}
