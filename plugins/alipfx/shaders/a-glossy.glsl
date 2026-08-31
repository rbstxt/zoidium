precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;
uniform vec2 uvScale;

// -- PROPERTIES --
uniform vec3 Global_Color;
uniform float Enable_4_Colors;
uniform float Random_Seed;
uniform vec3 Fill_Color_1;
uniform vec3 Fill_Color_2;
uniform vec3 Fill_Color_3;
uniform vec3 Fill_Color_4;

uniform float Angle;
uniform float Gap;
uniform float Distance;
uniform float Choker_1;
uniform float Roundness;
uniform float Choker_2;
uniform float Softness;
uniform float Opacity;
uniform float Blend_Mode;
uniform float Glossy_Only;

// -- BLEND MODE FUNCTIONS --
vec3 blendDarken(vec3 base, vec3 blend) { return min(blend, base); }
vec3 blendMultiply(vec3 base, vec3 blend) { return base * blend; }
vec3 blendAdd(vec3 base, vec3 blend) { return min(base + blend, vec3(1.0)); }
vec3 blendLighten(vec3 base, vec3 blend) { return max(blend, base); }
vec3 blendScreen(vec3 base, vec3 blend) { return 1.0 - (1.0 - base) * (1.0 - blend); }
vec3 blendOverlay(vec3 base, vec3 blend) {
    return mix(
        2.0 * base * blend,
        1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
        step(0.5, base)
    );
}
vec3 blendSoftLight(vec3 base, vec3 blend) {
    return mix(
        2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
        sqrt(max(base, 0.0)) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
        step(0.5, blend)
    );
}
vec3 blendHardLight(vec3 base, vec3 blend) { return blendOverlay(blend, base); }
vec3 blendDifference(vec3 base, vec3 blend) { return abs(base - blend); }

// Blur alpha using a Vogel spiral kernel (Much better for smooth roundness)
float blurredAlpha(vec2 uv, float radiusPx) {
    if (radiusPx <= 0.001) {
        return texture2D(tDiffuse, uv).a;
    }

    const int taps = 32; // Increased taps for a smoother liquid feel
    float acc = 0.0;
    const float goldenAngle = 2.39996323; // 137.5 degrees in radians

    for (int i = 0; i < taps; i++) {
        float fi = float(i);
        // Distribute sample points evenly inside a solid circle
        float r = sqrt((fi + 0.5) / float(taps)); 
        float theta = fi * goldenAngle;
        
        vec2 dir = vec2(cos(theta), sin(theta));
        vec2 offset = dir * r * (radiusPx / resolution) * uvScale;
        
        acc += texture2D(tDiffuse, uv + offset).a;
    }

    return acc / float(taps);
}

// Smooth 4-color ramp
vec3 getGlossColor(vec2 lightDir) {
    vec3 colorOut = Global_Color;

    if (Enable_4_Colors > 0.5) {
        vec2 pos = (vUv - 0.5) * resolution;
        vec2 tangent = vec2(-lightDir.y, lightDir.x);

        // Stable 0..1 coordinate along the gloss
        float t = dot(pos, tangent) / max(resolution.x, resolution.y);
        t = fract(t + 0.5 + Random_Seed * 0.01);

        if (t < 0.25) {
            colorOut = mix(Fill_Color_1, Fill_Color_2, t / 0.25);
        } else if (t < 0.50) {
            colorOut = mix(Fill_Color_2, Fill_Color_3, (t - 0.25) / 0.25);
        } else if (t < 0.75) {
            colorOut = mix(Fill_Color_3, Fill_Color_4, (t - 0.50) / 0.25);
        } else {
            colorOut = mix(Fill_Color_4, Fill_Color_1, (t - 0.75) / 0.25);
        }
    }

    return colorOut;
}

void main() {
    vec4 baseTexel = texture2D(tDiffuse, vUvScaled);

    // Early out for transparent pixels
    if (baseTexel.a <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
    }

    // Light / gloss direction
    float rad = radians(Angle);
    vec2 lightDir = normalize(vec2(cos(rad), sin(rad)));

    // Convert 1 pixel in the chosen direction into scaled UV space
    vec2 stepUv = (lightDir / resolution) * uvScale;

    // Gap = inset from the edge
    // Distance = thickness of the glossy band
    float insetPx = max(Gap, 0.0);
    float bandWidthPx = max(Distance, 0.001);
    float blurPx = max(Roundness, 0.0);

    // Sample two "eroded" alpha fields
    float alphaNear = blurredAlpha(vUvScaled - stepUv * insetPx, blurPx);
    float alphaFar  = blurredAlpha(vUvScaled - stepUv * (insetPx + bandWidthPx), blurPx);

    // -- INDEPENDENT CHOKERS --
    // Choker 1 applies to the outer edge of the gloss
    // Choker 2 applies to the inner edge of the gloss
    float t1 = 0.5 + (Choker_1 * 0.005);
    float t2 = 0.5 + (Choker_2 * 0.005);
    float edge = max(Softness * 0.005, 0.001);

    // Apply the thresholds directly to the near/far alphas before subtracting
    float chokedNear = smoothstep(t1 - edge, t1 + edge, alphaNear);
    float chokedFar  = smoothstep(t2 - edge, t2 + edge, alphaFar);

    // Continuous inner-rim mask
    float finalAlphaMask = clamp(chokedNear - chokedFar, 0.0, 1.0);

    // Hard-clamp inside original source alpha
    finalAlphaMask *= baseTexel.a;

    float glossyAlpha = finalAlphaMask * clamp(Opacity / 100.0, 0.0, 1.0);

    // Color
    vec3 finalColor = getGlossColor(lightDir);

    // Blend modes
    vec3 blendedColor = finalColor;
    int mode = int(Blend_Mode + 0.5);

    if (mode == 1) blendedColor = blendDarken(baseTexel.rgb, finalColor);
    else if (mode == 2) blendedColor = blendMultiply(baseTexel.rgb, finalColor);
    else if (mode == 3) blendedColor = blendAdd(baseTexel.rgb, finalColor);
    else if (mode == 4) blendedColor = blendLighten(baseTexel.rgb, finalColor);
    else if (mode == 5) blendedColor = blendScreen(baseTexel.rgb, finalColor);
    else if (mode == 6) blendedColor = blendOverlay(baseTexel.rgb, finalColor);
    else if (mode == 7) blendedColor = blendSoftLight(baseTexel.rgb, finalColor);
    else if (mode == 8) blendedColor = blendHardLight(baseTexel.rgb, finalColor);
    else if (mode == 9) blendedColor = blendDifference(baseTexel.rgb, finalColor);

    // Composite
    if (Glossy_Only > 0.5) {
        gl_FragColor = vec4(finalColor, glossyAlpha);
    } else {
        vec3 compositeRGB = mix(baseTexel.rgb, blendedColor, glossyAlpha);
        float compositeAlpha = max(baseTexel.a, glossyAlpha);
        gl_FragColor = vec4(compositeRGB, compositeAlpha);
    }
}
