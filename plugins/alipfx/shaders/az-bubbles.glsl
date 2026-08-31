precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// Panzoid custom properties
uniform float Bubble_Amount;
uniform float Bubble_Speed;
uniform float Wobble_Amplitude;
uniform float Wobble_Frequency;
uniform float Bubble_Size;
uniform float Reflection_Type; // 0 = Liquid, 1 = Metal
uniform float Shading_Type;    // 0=None, 1=Lighten, 2=Darken, 3=Fade Inwards, 4=Fade Outwards
uniform float time;

const int MAX_BUBBLES = 180;
const float TAU = 6.28318530717958647692;

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

vec2 safeUV(vec2 uv) {
    return clamp(uv, vec2(0.0), vec2(1.0));
}

vec4 sampleScene(vec2 uv) {
    return texture2D(tDiffuse, safeUV(uv) * uvScale);
}

float hash11(float p) {
    return fract(sin(p * 127.1) * 43758.5453123);
}

vec4 blendBubble(vec4 underCol, vec3 bubbleCol, float alpha, float shadingType) {
    vec4 result = underCol;

    if (shadingType < 0.5) {
        // None
        result.rgb = mix(result.rgb, bubbleCol, alpha);
        result.a = max(result.a, alpha);
        return result;
    }

    if (shadingType < 1.5) {
        // Lighten
        vec3 mixedCol = mix(result.rgb, bubbleCol, alpha);
        result.rgb = max(result.rgb, mixedCol);
        result.a = max(result.a, alpha);
        return result;
    }

    if (shadingType < 2.5) {
        // Darken
        vec3 mixedCol = mix(result.rgb, bubbleCol, alpha);
        result.rgb = min(result.rgb, mixedCol);
        result.a = max(result.a, alpha);
        return result;
    }

    // Fade Inwards / Fade Outwards
    result.rgb = mix(result.rgb, bubbleCol, alpha);
    result.a = max(result.a, alpha);
    return result;
}

void main() {
    vec2 uv = vUv;
    vec4 baseCol = sampleScene(uv);
    vec4 outCol = baseCol;

    float aspect = resolution.x / max(resolution.y, 1.0);
    float bubbleCount = clamp(Bubble_Amount, 0.0, float(MAX_BUBBLES));

    float speed = Bubble_Speed * 0.10;
    float wobbleAmpUV = Wobble_Amplitude / max(resolution.x, 1.0);
    float wobbleFreq = max(Wobble_Frequency, 0.0);
    float baseRadiusUV = max(Bubble_Size, 0.1) / max(resolution.y, 1.0);

    vec2 lightDir = normalize(vec2(-0.6, 0.8));
    vec2 darkDir  = normalize(vec2(0.7, -0.5));

    for (int i = 0; i < MAX_BUBBLES; i++) {
        if (float(i) >= bubbleCount) break;

        float fi = float(i) + 1.0;

        float s1 = hash11(fi * 1.371);
        float s2 = hash11(fi * 2.913);
        float s3 = hash11(fi * 5.127);
        float s4 = hash11(fi * 7.411);

        float x0 = s1;
        float y0 = s2;
        float sizeVar = mix(0.78, 1.22, s3);
        float r = baseRadiusUV * sizeVar;

        float y = fract(y0 + time * speed);
        float phase = s4 * TAU;

        float wobble = 0.0;
        wobble += sin((time * wobbleFreq + y * 0.8) * TAU + phase);
        wobble += 0.5 * sin((time * wobbleFreq * 0.61 + y * 1.3) * TAU + phase * 1.71);
        wobble *= wobbleAmpUV;

        float x = x0 + wobble;
        vec2 center = vec2(x, y);

        vec2 dp = uv - center;
        vec2 p = vec2(dp.x * aspect, dp.y);

        float dist = length(p);
        float d = dist / max(r, 1e-5);

        if (d > 1.02) continue;

        vec2 local = p / max(r, 1e-5);
        float rr = dot(local, local);
        if (rr > 1.0) continue;

        float nz = sqrt(max(1.0 - rr, 0.0));
        vec3 N = normalize(vec3(local, nz));

        vec2 nUV = vec2(N.x / aspect, N.y);

        float interior = 1.0 - smoothstep(0.96, 1.0, d);

        float ringOuter = 1.0 - smoothstep(0.88, 1.0, d);
        float ringInner = 1.0 - smoothstep(0.70, 0.84, d);
        float rim = saturate(ringOuter - ringInner);

        float fresnel = pow(1.0 - nz, 2.2);

        float spec = pow(max(dot(normalize(N.xy), lightDir), 0.0), 18.0) * interior;
        float shadow = pow(max(dot(normalize(N.xy), darkDir), 0.0), 2.5) * interior;

        vec3 sceneCenter = sampleScene(uv).rgb;

        // Bubble vector in UV space
        vec2 bubbleVecUV = vec2(local.x / aspect, local.y) * r;

        // =========================================================
        // LIQUID (normal modes)
        // center clearer, edge more refractive / reflective
        // =========================================================
        float liquidEdgeFactor = smoothstep(0.15, 1.0, d);
        float liquidEdgeDistort = r * (0.08 + 0.55 * liquidEdgeFactor * liquidEdgeFactor);

        vec2 liquidRefractUV = uv + nUV * liquidEdgeDistort;
        vec2 liquidReflectUV = uv + nUV * (r * (0.18 + 0.55 * fresnel));

        vec3 sceneLiquidRefract = sampleScene(liquidRefractUV).rgb;
        vec3 sceneLiquidReflect = sampleScene(liquidReflectUV).rgb;

        // =========================================================
        // LIQUID + FADE OUTWARDS
        // Strong CC Lens-style spherical bulge:
        // - center strongly magnified
        // - edge returns to normal
        // =========================================================
        float liquidLensMask = 1.0 - rr;

        // Stronger radial compression for noticeable bulge.
        // At center this becomes much less than 1, causing magnification.
        // At the edge it becomes 1, so the rim stays anchored.
        float liquidLensScale = 1.0 - 0.90 * pow(liquidLensMask, 0.55);

        vec2 liquidBulgedLocal = local * liquidLensScale;
        vec2 liquidBulgeUV = center + vec2(liquidBulgedLocal.x / aspect, liquidBulgedLocal.y) * r;

        vec3 sceneLiquidBulge = sampleScene(liquidBulgeUV).rgb;

        // Optional faint shell refraction near the outside so it still reads as a bubble
        float liquidShellMask = smoothstep(0.45, 1.0, d);
        vec2 liquidShellUV = uv + nUV * (r * 0.22 * liquidShellMask * liquidShellMask);
        vec3 sceneLiquidShell = sampleScene(liquidShellUV).rgb;

        // =========================================================
        // METAL
        // =========================================================
        vec2 metalFlipUV = center + vec2(bubbleVecUV.x, -bubbleVecUV.y);
        vec3 sceneMetalFlip = sampleScene(metalFlipUV).rgb;

        float metalEdgeMask = pow(smoothstep(0.35, 1.0, d), 1.6);
        float metalCenterMask = pow(max(1.0 - d, 0.0), 0.85);

        bool isLiquid = (Reflection_Type < 0.5);
        bool isFadeOut = (Shading_Type >= 3.5);

        vec3 bubbleCol = sceneCenter;
        float alpha = 0.0;

        if (isLiquid) {
    if (isFadeOut) {
        // Liquid + Fade Outwards
        bubbleCol = sceneLiquidBulge;
        bubbleCol = mix(bubbleCol, sceneLiquidShell, 0.18 * liquidShellMask);
        bubbleCol += vec3(spec * 0.05);
        bubbleCol += vec3(rim * 0.02);
        alpha = interior;
    } else {
        // Liquid normal
        vec3 transmitted = mix(sceneCenter, sceneLiquidRefract, liquidEdgeFactor * 0.85);
        vec3 rimReflect = mix(transmitted, sceneLiquidReflect, fresnel * 0.75);

        bubbleCol = rimReflect;
        bubbleCol += vec3(rim * (0.08 + 0.35 * fresnel));
        bubbleCol += vec3(spec * 0.22);
        bubbleCol -= vec3(shadow * 0.07);

        if (Shading_Type < 0.5) {
            // None (Liquid)
            float liquidNoneDistort = r * (0.22 + 0.95 * pow(liquidEdgeFactor, 1.15));
            vec2 liquidNoneUV = uv + nUV * liquidNoneDistort;
            vec3 sceneLiquidNone = sampleScene(liquidNoneUV).rgb;

            bubbleCol = sceneLiquidNone;
            bubbleCol += vec3(rim * 0.015);
            bubbleCol += vec3(spec * 0.02);

            alpha = interior;
        }
        else if (Shading_Type < 1.5) {
            // Lighten
            alpha = saturate(rim * 0.95 + fresnel * 0.32 + interior * 0.18);
        }
        else if (Shading_Type < 2.5) {
            // Darken
            bubbleCol *= 0.75;
            alpha = saturate(interior * 0.72 + rim * 0.28);
        }
        else {
            // Fade Inwards
            float liquidFadeInEdgeAlpha = smoothstep(0.25, 1.0, d);
            alpha = saturate(rim * 0.85 + liquidFadeInEdgeAlpha * 0.25);
        }
    }
} else {
    if (isFadeOut) {
        // Metal + Fade Outwards
        bubbleCol = mix(sceneCenter, sceneMetalFlip, metalCenterMask);
        bubbleCol += vec3(spec * 0.06);
        bubbleCol -= vec3(shadow * 0.05);
        alpha = saturate(interior * 0.82);
    } else {
        // Metal normal
        vec3 metalBody = mix(sceneCenter, sceneMetalFlip, metalEdgeMask);
        metalBody *= (0.94 - 0.08 * (1.0 - nz));
        metalBody += vec3(spec * 0.22);
        metalBody += vec3(rim * 0.06);
        metalBody -= vec3(shadow * 0.10);

        bubbleCol = metalBody;

        if (Shading_Type < 0.5) {
            // None (Metal)
            float metalNoneFlipMask = smoothstep(0.08, 0.95, d);

            bubbleCol = mix(sceneCenter, sceneMetalFlip, metalNoneFlipMask);
            bubbleCol += vec3(spec * 0.01);
            bubbleCol -= vec3(shadow * 0.015);

            alpha = interior * 0.95;
        }
        else if (Shading_Type < 1.5) {
            // Lighten
            alpha = saturate(rim * 0.55 + metalEdgeMask * 0.42 + spec * 0.12);
        }
        else if (Shading_Type < 2.5) {
            // Darken
            bubbleCol *= 0.72;
            alpha = saturate(interior * 0.58 + metalEdgeMask * 0.30 + rim * 0.12);
        }
        else {
            // Fade Inwards
            alpha = saturate(metalEdgeMask * 0.62 + rim * 0.30);
        }
    }
}
        outCol = blendBubble(outCol, bubbleCol, alpha, Shading_Type);
    }

    gl_FragColor = outCol;
}
