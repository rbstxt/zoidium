precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;

uniform float Progress; 
uniform float Edge_Thickness;
uniform float Char_Thickness; 
uniform float Noise_Scale;

// 2D Random function
float random (vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

// 2D Noise function
float noise (in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// Fractional Brownian Motion (fbm)
float fbm (in vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(st);
        st *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    // Total thickness of the fire + char effect combined
    float totalThickness = Edge_Thickness + Char_Thickness;
    
    // Ignore effect if progress is at 0
    if (Progress <= 0.0) {
        gl_FragColor = texel;
        return;
    }
    
    // Render invisible if completely done burning
    if (Progress >= 1.0 + totalThickness) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }
    
    vec2 scaledUv = vUv * Noise_Scale;
    float n = fbm(scaledUv);
    
    if (n < Progress) {
        // 1. Completely burned away (Transparent)
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        
    } else if (n < Progress + Edge_Thickness) {
        // 2. The glowing fire edge
        float edgeFactor = (n - Progress) / Edge_Thickness; 
        
        vec3 innerColor = vec3(1.0, 0.9, 0.2); // Bright yellow core
        vec3 outerColor = vec3(1.0, 0.1, 0.0); // Deep red outer edge
        
        vec3 fireColor = mix(innerColor, outerColor, edgeFactor);
        gl_FragColor = vec4(fireColor, texel.a);
        
    } else if (n < Progress + Edge_Thickness + Char_Thickness) {
        // 3. The shadow/char darkening the original image
        float charFactor = (n - (Progress + Edge_Thickness)) / Char_Thickness; 
        
        // This mixes pure black with your original video based on how close it is to the fire
        vec3 shadowedImage = mix(vec3(0.0, 0.0, 0.0), texel.rgb, charFactor);
        
        gl_FragColor = vec4(shadowedImage, texel.a);
        
    } else {
        // 4. Not yet burned (Clean original image)
        gl_FragColor = texel;
    }
}
