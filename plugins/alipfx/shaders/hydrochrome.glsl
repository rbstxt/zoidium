precision highp float;
precision highp int;

// Panzoid Built-ins
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUvScaled;

// Built-in project clock
uniform float time; 

// Parameters
uniform float Iterations;       
uniform float Seed;             
uniform float Follow_Comp_Time; // 1.0 = Auto, 0.0 = Manual
uniform float Time_Offset;      
uniform float UniformDisplace;  
uniform float X_Displace;       
uniform float Y_Displace;       
uniform float Displace_Angle;   
uniform float Hue_Shift;        
uniform float Chromatic;        
uniform float Adding;           
uniform float Power;            
uniform float Multiplier;       

mat2 rotate2d(float angle){
    return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
}

vec3 applyHue(vec3 col, float h) {
    vec3 k = vec3(0.57735, 0.57735, 0.57735);
    float a = radians(h);
    float cosA = cos(a);
    return col * cosA + cross(k, col) * sin(a) + k * dot(k, col) * (1.0 - cosA);
}

void main()
{
    // Capture original texture for alpha preservation
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    // Setup UVs centered for liquid math
    vec2 st = (vUvScaled / uvScale) * 2.0 - 1.0;
    st.x *= resolution.x / resolution.y;

    // Time Logic: Uses internal clock if Follow_Comp_Time > 0.5
    float t = (Follow_Comp_Time > 0.5) ? (time + Time_Offset) : Time_Offset; 
    
    // Seed Logic: Offsets coordinates to randomize the pattern
    vec2 p = st + vec2(Seed * 1.618, Seed * 0.707);
    
    float angle = radians(Displace_Angle);
    float yFactor = (UniformDisplace > 0.5) ? 0.0 : 1.0;
    vec2 amp = vec2(X_Displace, Y_Displace * yFactor) * 0.01;
    
    p *= rotate2d(angle);

    // Liquid Iterations (1-20)
    int iterLimit = int(clamp(Iterations, 1.0, 20.0));
    for(int i = 0; i < 20; i++) {
        if (i >= iterLimit) break;
        p += sin(p.yx * 2.2 + vec2(t * 1.1, t * 0.9)) * amp;
        p *= 1.05; 
        p *= rotate2d(0.5 + Seed * 0.001); 
    }

    // Color Generation with multi-phase offset for full hue spectrum
    float chrom = Chromatic * 0.05;
    vec3 color;
    color.r = sin(p.x + p.y - chrom) * 0.5 + 0.5;
    color.g = sin(p.x + p.y) * 0.5 + 0.5;
    color.b = sin(p.x + p.y + chrom) * 0.5 + 0.5;

    // Blending and Brightness
    color += vec3(Adding * 0.01);   
    color *= vec3(Multiplier * 0.01);  
    color = pow(max(color, 0.0001), vec3(max(0.1, Power * 0.01)));

    // Final Hue Shift
    vec3 finalRGB = applyHue(color, Hue_Shift);
    
    // Output final result using original texture alpha
    gl_FragColor = vec4(finalRGB, texel.a);
}
