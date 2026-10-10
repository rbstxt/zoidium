precision highp float;
precision highp int;
#extension GL_OES_standard_derivatives : enable

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;
uniform vec2 uvScale;

// 28 Parameters
uniform float Preset;
uniform float Develop;
uniform float Fade;
uniform float Tint;
uniform float Frame;
uniform float Grain;
uniform float Grain_Size;
uniform float Halation;
uniform float Vignette;
uniform float Contrast;
uniform float Saturation;
uniform float Frame_Size;
uniform float Window_Aspect;
uniform float Frame_Margin;
uniform float Bottom_Margin; // FIXED: Corrected spelling to match Panzoid UI
uniform float Corner_Radius;
uniform vec3 Frame_Color;
uniform float Frame_Texture;
uniform float Develop_Order;
uniform float Develop_Unevenness;
uniform float Blotch_Size;
uniform float Develop_Softness;
uniform float Develop_Direction;
uniform float Direction_Amount;
uniform float Edge_Bleed;
uniform float Develop_Color_Shift;
uniform float Edge_Lag;
uniform vec3 Undeveloped_Color;

// Helper: Random
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

// Helper: Noise
float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// Helper: Rounded Box SDF
float sdRoundedBox( in vec2 p, in vec2 b, in vec4 r ) {
    r.xy = (p.x>0.0)?r.xy : r.zw;
    r.x  = (p.y>0.0)?r.x  : r.y;
    vec2 q = abs(p)-b+r.x;
    return min(max(q.x,q.y),0.0) + length(max(q,0.0)) - r.x;
}

void main() {
    vec2 uv = vUvScaled;
    vec2 layerAspect = vec2(resolution.x / resolution.y, 1.0);
    
    // --- Frame Geometry Calculation ---
    float frameOn = step(0.5, Frame);
    float scale = Frame_Size / 100.0;
    
    float mSide = Frame_Margin / 100.0;
    float mTop = Frame_Margin / 100.0; 
    float mBot = Bottom_Margin / 100.0; // FIXED: Using correct variable name
    
    float frameAspect = Window_Aspect;
    float frameH_uv = scale; 
    float frameW_uv = scale * (frameAspect / layerAspect.x); 
    
    vec2 frameCenter = vec2(0.5, 0.5);
    vec2 frameHalfSize = vec2(frameW_uv, frameH_uv) * 0.5;
    
    vec2 frameUv = (uv - (frameCenter - frameHalfSize)) / (frameHalfSize * 2.0);
    
    vec2 pFrame = frameUv - 0.5;
    vec2 bFrame = vec2(0.5);
    
    float maxRadius = min(frameW_uv, frameH_uv) * 0.5;
    float radiusUV = (Corner_Radius / 100.0) * frameH_uv;
    radiusUV = min(radiusUV, maxRadius * 0.9);
    
    float distFrame = sdRoundedBox(pFrame, bFrame, vec4(radiusUV));
    float insideFrame = 1.0 - smoothstep(-0.002, 0.002, distFrame);

    float photoW = 1.0 - 2.0 * mSide;
    float photoH = 1.0 - mTop - mBot;
    float photoX = mSide;
    float photoY = mBot; 
    
    vec2 pPhoto = frameUv - vec2(photoX + photoW*0.5, photoY + photoH*0.5);
    vec2 bPhoto = vec2(photoW, photoH) * 0.5;
    float radiusPhoto = radiusUV * 0.5; 
    float distPhoto = sdRoundedBox(pPhoto, bPhoto, vec4(radiusPhoto));
    float insidePhoto = 1.0 - smoothstep(-0.002, 0.002, distPhoto);

    // --- Determine Sample UV ---
    vec2 sampleUv = uv;
    if (frameOn > 0.5) {
        sampleUv = (frameUv - vec2(photoX, photoY)) / vec2(photoW, photoH);
    }
    
    vec4 texel = texture2D(tDiffuse, sampleUv);
    vec3 color = texel.rgb;
    
    // --- Apply Develop Effect ---
    // We run this always, but if Develop is 100, we force visibility to 1.0 to avoid jagged edges
    float visibility = 1.0;
    
    if (Develop < 99.9) {
        float lum = dot(color, vec3(0.299, 0.587, 0.114));
        float orderThreshold = lum;
        if (Develop_Order > 0.5 && Develop_Order < 1.5) {
            orderThreshold = 1.0 - lum;
        } else if (Develop_Order > 1.5) {
            orderThreshold = 0.5;
        }
        
        float n = noise(sampleUv * (100.0 / max(Blotch_Size, 0.1)));
        n = n * 0.5 + 0.5;
        float threshold = mix(orderThreshold, n, Develop_Unevenness / 100.0);
        
        float dirAngle = Develop_Direction * 3.14159 / 180.0;
        float dirVal = sin((sampleUv.x * cos(dirAngle) + sampleUv.y * sin(dirAngle)) * 20.0);
        threshold += dirVal * (Direction_Amount / 100.0) * 0.05;
        
        float edge = abs(dFdx(lum)) + abs(dFdy(lum));
        threshold += edge * (Edge_Lag / 100.0) * 5.0;
        
        // FIX: Clamp threshold to 0.95 max. 
        // This ensures that even with high edge lag, the pixel can fully develop at 100%
        threshold = min(threshold, 0.95);
        
        float devProgress = Develop / 100.0;
        float softness = (Develop_Softness / 100.0) * 0.1;
        visibility = smoothstep(threshold - softness, threshold + softness, devProgress);
        
        vec3 bleedColor = texture2D(tDiffuse, sampleUv + vec2(0.01, 0.0)).rgb;
        color = mix(color, bleedColor, (Edge_Bleed / 100.0) * (1.0 - visibility) * 0.5);
        
        vec3 shiftColor = vec3((Develop_Color_Shift / 100.0) * 0.1);
        color = mix(color, color + shiftColor, (1.0 - visibility) * 0.5);
        
        vec3 undeveloped = Undeveloped_Color;
        color = mix(undeveloped, color, visibility);
    }
    
    // --- Apply Post Processing (Always) ---
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    float bright = smoothstep(0.7, 1.0, lum);
    vec3 halo = vec3(1.0, 0.4, 0.2) * bright * (Halation / 100.0) * 0.2;
    color += halo;
    
    float grainVal = random(sampleUv * Grain_Size + vec2(0.0)) * 2.0 - 1.0;
    color += grainVal * (Grain / 100.0) * 0.05;
    
    float vig = 1.0 - length(sampleUv - 0.5) * (Vignette / 100.0) * 0.5;
    color *= vig;
    
    color = (color - 0.5) * (1.0 + (Contrast / 100.0) * 0.02) + 0.5;
    
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gray), color, 1.0 + (Saturation / 100.0) * 0.02);
    
    color = mix(color, vec3(0.5), (Fade / 100.0) * 0.3);

    vec3 tintCol = vec3(0.6, 0.65, 0.75); 
    color = mix(color, tintCol, (Tint / 100.0) * 0.4);
    
    if (Preset < 0.5) {
        color = mix(color, color * vec3(0.9, 0.95, 1.0), 0.2);
    } else if (Preset < 1.5) {
        color = mix(color, color * vec3(0.8, 0.9, 1.1), 0.3);
    } else if (Preset < 2.5) {
        color = mix(color, color * vec3(1.1, 1.0, 0.8), 0.3);
    }
    
    // --- Handle Frame Rendering ---
    vec3 finalColor = color;
    float alpha = 1.0;
    
    if (frameOn > 0.5) {
        if (insideFrame > 0.5) {
            if (insidePhoto < 0.5) {
                finalColor = Frame_Color;
                float fTex = random(frameUv * 200.0);
                finalColor = mix(finalColor, finalColor * fTex, (Frame_Texture / 100.0) * 0.3);
            }
        } else {
            finalColor = vec3(0.0, 0.0, 0.0); 
            alpha = 0.0; 
        }
    }
    
    gl_FragColor = vec4(finalColor, alpha);
}
