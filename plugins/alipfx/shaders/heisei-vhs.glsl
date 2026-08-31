precision highp float;
precision highp int;

// Panzoid Built-in Uniforms
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;

// ==========================================
// CUSTOM PARAMETERS (30 Uniforms)
// ==========================================

// - Digital Layer
uniform float Apply_JPEG_Block_Noise;   
uniform float JPEG_Quality;             
uniform float Crush_Blacks;             
uniform float Blow_out_Whites;          

// - Hardware Layer
uniform float Apply_Thick_Ringing;      
uniform float Sharpen_Intensity;        
uniform float Sharpen_Width;            
uniform float Apply_Color_Cast;         
uniform float Red_Tint_Shift;           
uniform float Green_Tint_Shift;         
uniform float Blue_Tint_Shift;          

// - Analog Layer
uniform float Luminance_Bandwidth;      
uniform float Chroma_I_Bandwidth;       
uniform float Chroma_Q_Bandwidth;       
uniform float Chroma_Crosstalk;         
uniform float Chroma_Shift_X;           
uniform float Luma_Noise;               
uniform float Chroma_Noise;             

// - Mechanical Error
uniform float Jitter_Frequency;         
uniform float Jitter_Amplitude;         
uniform float Independent_Jitter;       
uniform float Jitter_Roughness;         
uniform float Head_Switch_Height;       
uniform float Bottom_Distortion;        
uniform float Bottom_Static_Density;    
uniform float Dropout_Count;            
uniform float Scratch_Max_Length;       
uniform float Scratch_Intensity;        
uniform float Apply_Scanlines;          
uniform float Scanline_Brightness;      

varying vec2 vUv;
varying vec2 vUvScaled;

// ==========================================
// MATH & SIGNAL HELPERS
// ==========================================

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}

// RGB to YIQ Color Space
vec3 rgb2yiq(vec3 c) {
    return vec3(
        0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
        0.596 * c.r - 0.274 * c.g - 0.322 * c.b,
        0.211 * c.r - 0.523 * c.g + 0.312 * c.b
    );
}

vec3 yiq2rgb(vec3 c) {
    return vec3(
        c.x + 0.956 * c.y + 0.621 * c.z,
        c.x - 0.272 * c.y - 0.647 * c.z,
        c.x - 1.106 * c.y + 1.703 * c.z
    );
}

void main() {
    vec2 baseUv = vUv;
    
    // ==========================================
    // 1. MECHANICAL ERROR (UV DISTORTION)
    // ==========================================
    
    float normHeight = Head_Switch_Height / 100.0;
    float bottomDistortionZone = step(baseUv.y, normHeight) * (1.0 - (baseUv.y / max(normHeight, 0.001)));
    
    if (baseUv.y < normHeight) {
        float wave = sin(baseUv.y * 150.0 + time * 20.0) * (Bottom_Distortion / resolution.x);
        baseUv.x += wave * bottomDistortionZone;
    }
    
    float jitterMask = step(hash(vec2(time * Jitter_Frequency * 10.0, 42.0)), 0.3);
    float jitterWave = (noise(vec2(baseUv.y * Jitter_Roughness * 10.0, time * 5.0)) - 0.5);
    float finalJitter = jitterWave * (Jitter_Amplitude / resolution.x) * jitterMask;
    
    vec2 uvR = baseUv;
    vec2 uvG = baseUv;
    vec2 uvB = baseUv;
    
    if (Independent_Jitter > 0.5) {
        uvR.x += finalJitter * 1.2;
        uvG.x -= finalJitter * 0.5;
        uvB.x += finalJitter * 0.8;
    } else {
        uvR.x += finalJitter;
        uvG.x += finalJitter;
        uvB.x += finalJitter;
    }
    
    // FIXED: Swapped baseUv.x and baseUv.y to make the dropouts horizontal instead of vertical
    float scratchTime = floor(time * 16.0); 
    float scratchIndex = floor(baseUv.y * (400.0 - Scratch_Max_Length)); // Y-axis row indexing
    float scratchCheck = step(hash(vec2(scratchIndex, scratchTime + 11.0)), 0.002 * Dropout_Count);
    float scratchLine = step(abs(hash(vec2(scratchIndex, scratchTime + 7.0)) - baseUv.x), 0.1 * Scratch_Intensity) * scratchCheck; // X-axis length check
    
    if (Apply_JPEG_Block_Noise > 0.5) {
        float blocks = max(1.0, JPEG_Quality);
        vec2 blockFactor = resolution / (blocks * 0.16);
        uvR = floor(uvR * blockFactor) / blockFactor;
        uvG = floor(uvG * blockFactor) / blockFactor;
        uvB = floor(uvB * blockFactor) / blockFactor;
    }
    
    vec4 texR = texture2D(tDiffuse, uvR * uvScale);
    vec4 texG = texture2D(tDiffuse, uvG * uvScale);
    vec4 texB = texture2D(tDiffuse, uvB * uvScale);
    
    vec3 color = vec3(texR.r, texG.g, texB.b);
    
    // ==========================================
    // 2. HARDWARE SIGNAL PROCESSING
    // ==========================================
    
    if (Apply_Thick_Ringing > 0.5) {
        vec2 shiftX = vec2(Sharpen_Width / resolution.x, 0.0);
        vec3 leftTex = texture2D(tDiffuse, (uvG - shiftX) * uvScale).rgb;
        vec3 rightTex = texture2D(tDiffuse, (uvG + shiftX) * uvScale).rgb;
        
        vec3 edgeHighPass = color - (leftTex + rightTex) * 0.5;
        color += edgeHighPass * Sharpen_Intensity;
    }
    
    if (Apply_Color_Cast > 0.5) {
        color.r *= Red_Tint_Shift;
        color.g *= Green_Tint_Shift;
        color.b *= Blue_Tint_Shift;
    }
    
    // ==========================================
    // 3. ANALOG SIGNAL & COMPOSITE BLURRING
    // ==========================================
    
    vec3 yiq = rgb2yiq(color);
    
    float chromaOffset = (Chroma_Shift_X / resolution.x);
    vec3 shiftedChroma = rgb2yiq(texture2D(tDiffuse, (uvG + vec2(chromaOffset, 0.0)) * uvScale).rgb);
    yiq.y = mix(yiq.y, shiftedChroma.y, 0.5);
    yiq.z = mix(yiq.z, shiftedChroma.z, 0.5);
    
    float lumaSpread = (1.0 - Luminance_Bandwidth) * (8.0 / resolution.x);
    float chromaI_Spread = (1.0 - Chroma_I_Bandwidth) * (16.0 / resolution.x);
    float chromaQ_Spread = (1.0 - Chroma_Q_Bandwidth) * (24.0 / resolution.x);
    
    float lumaBlur = rgb2yiq(texture2D(tDiffuse, (uvG + vec2(lumaSpread, 0.0)) * uvScale).rgb).x;
    float chromaI_Blur = rgb2yiq(texture2D(tDiffuse, (uvG + vec2(chromaI_Spread, 0.0)) * uvScale).rgb).y;
    float chromaQ_Blur = rgb2yiq(texture2D(tDiffuse, (uvG + vec2(chromaQ_Spread, 0.0)) * uvScale).rgb).z;
    
    yiq.x = mix(yiq.x, lumaBlur, 0.5);
    yiq.y = mix(yiq.y, chromaI_Blur, 0.7);
    yiq.z = mix(yiq.z, chromaQ_Blur, 0.7);
    
    yiq.y += yiq.x * Chroma_Crosstalk * 0.15;
    
    color = yiq2rgb(yiq);
    
    float baseNoise = hash(baseUv + vec2(time * 13.37, time * 37.13));
    color += (baseNoise - 0.5) * Luma_Noise * 0.18;
    
    vec3 chromaNoiseLayer = vec3(hash(baseUv + time), hash(baseUv * 1.5 - time), hash(baseUv * 0.7 + time)) - 0.5;
    color += chromaNoiseLayer * Chroma_Noise * 0.25;
    
    if (baseUv.y < normHeight) {
        float bottomStatic = hash(vec2(baseUv.x * 20.0, time * 30.0));
        if (bottomStatic < Bottom_Static_Density) {
            color = mix(color, vec3(bottomStatic), bottomStatic * bottomDistortionZone);
        }
    }
    
    // Scratch execution overlay (now properly horizontal)
    color = mix(color, vec3(0.95), scratchLine * Scratch_Intensity);
    
    // ==========================================
    // 4. DIGITAL LAYER LEVEL ADJUSTMENTS
    // ==========================================
    
    color = max(color - vec3(Crush_Blacks * 0.15), vec3(0.0));
    
    float whiteThreshold = Blow_out_Whites / 255.0;
    color = min(color / max(whiteThreshold, 0.001), vec3(1.0));
    
    if (Apply_Scanlines > 0.5) {
        float scanlinePattern = sin(vUv.y * resolution.y * 1.8) * 0.5 + 0.5;
        color = mix(color, color * scanlinePattern, (1.0 - Scanline_Brightness) * 0.65);
    }
    
    gl_FragColor = vec4(color, 1.0);
}
