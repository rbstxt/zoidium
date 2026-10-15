precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;

// ==================== UNIFORMS ====================
uniform float Band_Geometry;
uniform vec2 Band_Center;
uniform float Band_Rotation;
uniform float Band_Size;
uniform float Band_Divisions;
uniform float Band_Offset;
uniform float Band_Speed;
uniform float Form_Aspect_Ratio;
uniform float Form_Points;
uniform float Form_Amplitude;
uniform float Form_Wavelength;
uniform float Form_Phase;
uniform float Form_Inner_Ratio;
uniform float Form_Roundness;
uniform float Form_Inner_Roundness;
uniform float Form_Cusp_Power;
uniform float Form_Arch_Power;
uniform float Form_Slope;
uniform float Form_Bias;
uniform float Form_Skew;
uniform float Form_Base_Radius;
uniform float Form_Dipole_Distance;
uniform float Form_Twist;
uniform float Form_Radial_Power;
uniform float Vector_Field;

uniform float Fill_Progress;
uniform float Fill_Start_Line;
uniform float Fill_Easing;
uniform vec3 Fill_Color;
uniform float Fill_Opacity;
uniform float Blend_Mode;

uniform float Range_Mode;
uniform float Range_Start_Index;
uniform float Range_End_Index;

uniform float Feather_Falloff;
uniform float Feather_Distance;
uniform float Feather_Fit_Edge;

// Size Variation parameters
uniform float S_Ramp_Ratio;
uniform float S_Ramp_Span;
uniform float S_Ramp_Offset;
uniform float S_Ramp_Flip;
uniform float S_Ramp_Repeat;
uniform float S_Noise_Amount;
uniform float S_Noise_Span;
uniform float S_Noise_Offset;
uniform float S_Noise_Seed;
uniform float S_Index_Space;

// Progress Variation parameters
uniform float P_Ramp_Delay;
uniform float P_Ramp_Span;
uniform float P_Ramp_Offset;
uniform float P_Ramp_Flip;
uniform float P_Ramp_Repeat;
uniform float P_Noise_Amount;
uniform float P_Noise_Span;
uniform float P_Noise_Offset;
uniform float P_Noise_Seed;
uniform float P_Index_Space;

// Color Variation parameters
uniform float Color_Method;
uniform vec3 C_Ramp_Start_Color;
uniform vec3 C_Ramp_End_Color;
uniform float C_Ramp_Span;
uniform float C_Ramp_Offset;
uniform float C_Ramp_Flip;
uniform float C_Ramp_Repeat;
uniform float C_Noise_Hue_Amount;
uniform float C_Noise_Saturation_Amount;
uniform float C_Noise_Brightness_Amount;
uniform float C_Noise_Span;
uniform float C_Noise_Offset;
uniform float C_Noise_Seed;
uniform float C_Index_Space;

// Opacity Variation parameters
uniform float O_Ramp_Ratio;
uniform float O_Ramp_Span;
uniform float O_Ramp_Offset;
uniform float O_Ramp_Flip;
uniform float O_Ramp_Repeat;
uniform float O_Noise_Amount;
uniform float O_Noise_Span;
uniform float O_Noise_Offset;
uniform float O_Noise_Seed;
uniform float O_Index_Space;

uniform float Distortion_Mode;
uniform float Distortion_Amplitude;
uniform float Distortion_Scale;
uniform float Distortion_Phase;
uniform float Distortion_Evolution;
uniform float Distortion_Power;

uniform float Anti_Aliasing;
uniform float Dither_Seed;

// ==================== HELPERS ====================
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
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

float linearNoise(vec2 st, float seed) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = snoise(i + vec2(0.0, 0.0) + seed);
    float b = snoise(i + vec2(1.0, 0.0) + seed);
    float c = snoise(i + vec2(0.0, 1.0) + seed);
    float d = snoise(i + vec2(1.0, 1.0) + seed);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float easeLinear(float t) { return t; }
float easeQuadIn(float t) { return t * t; }
float easeQuadOut(float t) { return t * (2.0 - t); }
float easeQuadInOut(float t) { return t < 0.5 ? 2.0 * t * t : -1.0 + (4.0 - 2.0 * t) * t; }
float easeCubicIn(float t) { return t * t * t; }
float easeCubicOut(float t) { return 1.0 - pow(1.0 - t, 3.0); }
float easeCubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
float easeExpoIn(float t) { return t == 0.0 ? 0.0 : pow(2.0, 10.0 * t - 10.0); }
float easeExpoOut(float t) { return t == 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t); }
float easeExpoInOut(float t) {
    return t == 0.0 || t == 1.0 ? t : t < 0.5 ? pow(2.0, 20.0 * t - 10.0) / 2.0 : (2.0 - pow(2.0, -20.0 * t + 10.0)) / 2.0;
}

float applyEasing(float t, float easingType) {
    int et = int(easingType);
    if (et == 0) return easeLinear(t);
    else if (et == 1) return easeQuadInOut(t);
    else if (et == 2) return easeQuadIn(t);
    else if (et == 3) return easeQuadOut(t);
    else if (et == 4) return easeCubicInOut(t);
    else if (et == 5) return easeCubicIn(t);
    else if (et == 6) return easeCubicOut(t);
    else if (et == 7) return easeExpoInOut(t);
    else if (et == 8) return easeExpoIn(t);
    else if (et == 9) return easeExpoOut(t);
    else return t;
}

float easeSmoothIn(float t) { return 1.0 - cos(t * 1.5708); }
float easeSmoothOut(float t) { return sin(t * 1.5708); }
float easeSmoothInOut(float t) { return -cos(t * 3.14159) * 0.5 + 0.5; }

float featherFalloff(float t, float type) {
    int ft = int(type);
    if (ft == 0) return t;
    else if (ft == 1) return easeSmoothInOut(t);
    else if (ft == 2) return easeSmoothIn(t);
    else if (ft == 3) return easeSmoothOut(t);
    else return t;
}

vec3 rgb2hsl(vec3 rgb) {
    float r = rgb.r, g = rgb.g, b = rgb.b;
    float maxC = max(max(r, g), b);
    float minC = min(min(r, g), b);
    float l = (maxC + minC) / 2.0;
    if (maxC == minC) return vec3(0.0, 0.0, l);
    float d = maxC - minC;
    float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    float h;
    if (maxC == r) h = (g - b) / d + (g < b ? 6.0 : 0.0);
    else if (maxC == g) h = (b - r) / d + 2.0;
    else h = (r - g) / d + 4.0;
    h /= 6.0;
    return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}

vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x, s = hsl.y, l = hsl.z;
    if (s == 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    vec3 rgb;
    rgb.r = hue2rgb(p, q, h + 1.0/3.0);
    rgb.g = hue2rgb(p, q, h);
    rgb.b = hue2rgb(p, q, h - 1.0/3.0);
    return rgb;
}

// Ramp repeat modes: 0=Cycle, 1=Mirror, 2=Constant
float rampRepeat(float t, float mode) {
    int m = int(mode);
    if (m == 0) { // Cycle
        return fract(t);
    } else if (m == 1) { // Mirror
        float i = floor(t);
        float f = fract(t);
        return mod(i, 2.0) < 1.0 ? f : 1.0 - f;
    } else { // Constant
        return clamp(t, 0.0, 1.0);
    }
}

vec3 applyBlendMode(vec3 base, vec3 blend, float mode) {
    int m = int(mode);
    if (m == 0) return base;
    else if (m == 1) return blend;
    else if (m == 4) return base + blend;
    else if (m == 5) return base - blend;
    else if (m == 6) return base * blend;
    else if (m == 7) return 1.0 - (1.0 - base) * (1.0 - blend);
    else if (m == 8) return mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(0.5, base));
    else if (m == 12) return max(base, blend);
    else if (m == 13) return min(base, blend);
    else if (m == 14) return abs(base - blend);
    else return blend;
}

// ==================== GEOMETRY ====================
struct BandResult {
    float index;
    float localCoord;
    float distance;
};

BandResult calculateBandIndex(vec2 uv_pix, vec2 center, float rotation, float offset) {
    BandResult result;
    result.index = 0.0;
    result.localCoord = 0.0;
    result.distance = 0.0;
    
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 rotatedUV = uv_pix - center;
    vec2 rotated = vec2(rotatedUV.x * c - rotatedUV.y * s, rotatedUV.x * s + rotatedUV.y * c) + center;
    
    float x = rotated.x;
    float y = rotated.y;
    float aspect = Form_Aspect_Ratio;
    
    int geom = int(Band_Geometry);
    
    // --- LINEAR TYPES ---
    if (geom == 0) { // Linear
        float skewX = x + y * Form_Skew;
        result.index = skewX / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = abs(fract(result.index + offset + 0.5) - 0.5) * 2.0;
    }
    else if (geom == 1) { // Triangle Wave
        float skewX = x + y * Form_Skew;
        float wave = y / Form_Wavelength;
        float t = abs(fract(wave + 0.5) - 0.5) * 4.0 - 1.0;
        if (Form_Roundness > 0.0) {
            float smoothT = sin(t * 1.5708);
            t = mix(t, smoothT, Form_Roundness);
        }
        result.index = (skewX + t * Form_Amplitude) / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = abs(fract(result.index + offset + 0.5) - 0.5) * 2.0;
    }
    else if (geom == 2) { // Sine Wave
        float skewX = x + y * Form_Skew;
        float wave = y / Form_Wavelength;
        float sine = sin(wave * 6.28318 + Form_Phase) * Form_Amplitude;
        result.index = (skewX + sine) / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = abs(fract(result.index + offset + 0.5) - 0.5) * 2.0;
    }
      else if (geom == 3) { // Arc Wave
        float skewX = x + y * Form_Skew;
        float phaseOffset = Form_Phase / 6.28318;
        float wave = y / Form_Wavelength + phaseOffset;
        
        // Arc Wave: creates smooth arc-shaped bands
        float t = fract(wave);
        float arc;
        if (t < 0.5) {
            arc = sqrt(max(0.0, 1.0 - pow((t - 0.25) * 4.0, 2.0))) - 0.5;
        } else {
            arc = -sqrt(max(0.0, 1.0 - pow((t - 0.75) * 4.0, 2.0))) + 0.5;
        }
        
        result.index = (skewX + arc * Form_Amplitude) / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = abs(fract(result.index + offset + 0.5) - 0.5) * 2.0;
    }
    else if (geom == 4) { // Trapezoid
        float skewX = x + y * Form_Skew;
        float phaseOffset = Form_Phase / 6.28318;
        float wave = y / Form_Wavelength + phaseOffset;
        
        // Trapezoid: angular waves with flat sections
        float t = fract(wave);
        float slope = clamp(Form_Slope, 0.01, 0.5);
        float val;
        
        if (t < slope) {
            val = -1.0 + 2.0 * t / slope;
        } else if (t < 0.5) {
            val = 1.0;
        } else if (t < 0.5 + slope) {
            val = 1.0 - 2.0 * (t - 0.5) / slope;
        } else {
            val = -1.0;
        }
        
        result.index = (skewX + val * Form_Amplitude) / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = abs(fract(result.index + offset + 0.5) - 0.5) * 2.0;
    }
    else if (geom == 5) { // Parabola
        float skewX = x + y * Form_Skew;
        float phaseOffset = Form_Phase / 6.28318;
        float wave = y / Form_Wavelength + phaseOffset;
        
        // Parabola: creates mirrored parabolic curves
        float t = fract(wave);
        float parabola;
        if (t < 0.5) {
            parabola = 1.0 - pow((t - 0.25) * 4.0, 2.0);
        } else {
            parabola = -1.0 + pow((t - 0.75) * 4.0, 2.0);
        }
        
        result.index = (skewX + parabola * Form_Amplitude) / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = abs(fract(result.index + offset + 0.5) - 0.5) * 2.0;
    }
    
    // --- RADIAL TYPES ---
    else if (geom == 6) { // Ellipse
        vec2 d = rotated - center;
        d.x *= aspect;
        float dist = length(d);
        result.index = dist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = dist;
    }
    else if (geom == 7) { // Rectangle
        vec2 d = abs(rotated - center);
        d.x *= aspect;
        float rectDist = max(d.x, d.y);
        float circleDist = length(d);
        float dist = mix(rectDist, circleDist, Form_Roundness);
        result.index = dist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = dist;
    }
    else if (geom == 8) { // Polygon
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float sides = max(3.0, Form_Points);
        float segmentAngle = 6.28318 / sides;
        float normalizedAngle = mod(angle + 3.14159 / sides, segmentAngle) - segmentAngle / 2.0;
        float polyDist = dist * cos(normalizedAngle) / cos(segmentAngle / 2.0);
        float circleDist = dist;
        float finalDist = mix(polyDist, circleDist, Form_Roundness);
        result.index = finalDist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = finalDist;
    }
    else if (geom == 9) { // Star
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float sides = max(3.0, Form_Points);
        float innerRatio = Form_Inner_Ratio;
        float segmentAngle = 6.28318 / sides;
        float normalizedAngle = mod(angle, segmentAngle);
        float starDist;
        if (normalizedAngle < segmentAngle / 2.0) {
            starDist = mix(dist / max(0.001, cos(normalizedAngle)), 
                          dist / max(0.001, cos(normalizedAngle - segmentAngle / 2.0)) * innerRatio,
                          normalizedAngle / (segmentAngle / 2.0));
        } else {
            starDist = mix(dist / max(0.001, cos(normalizedAngle - segmentAngle / 2.0)) * innerRatio,
                          dist / max(0.001, cos(normalizedAngle - segmentAngle)),
                          (normalizedAngle - segmentAngle / 2.0) / (segmentAngle / 2.0));
        }
        float circleDist = dist * mix(1.0, innerRatio, 0.5);
        float finalDist = mix(starDist, circleDist, Form_Roundness * 0.5);
        result.index = finalDist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = finalDist;
    }
    else if (geom == 10) { // Flower
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float petals = max(1.0, Form_Points);
        float flowerDist = dist * (1.0 + Form_Inner_Ratio * sin(angle * petals));
        result.index = flowerDist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = dist;
    }
    else if (geom == 11) { // Clover
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float lobes = max(1.0, Form_Points);
        float cloverDist = dist * pow(abs(cos(angle * lobes / 2.0)), Form_Cusp_Power);
        cloverDist *= mix(1.0, Form_Inner_Ratio, 0.5); 
        result.index = cloverDist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = dist;
    }
    else if (geom == 12) { // Crown
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float peaks = max(1.0, Form_Points);
        float crownDist = dist * (1.0 - Form_Inner_Ratio * pow(abs(sin(angle * peaks / 2.0)), Form_Cusp_Power));
        result.index = crownDist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = dist;
    }
    else if (geom == 13) { // Ray
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float rays = max(1.0, Form_Points);
        float archCurve = pow(max(0.0, dist * 0.01), Form_Arch_Power) * Form_Slope * 2.0;
        float effectiveAngle = angle + archCurve;
        float segmentAngle = 6.28318 / rays;
        float normalizedAngle = mod(effectiveAngle + 3.14159 / rays, segmentAngle) - segmentAngle / 2.0;
        float rayDist = dist * (1.0 + Form_Slope * abs(normalizedAngle));
        result.index = rayDist / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = dist;
    }
    
    // --- ANGULAR TYPES ---
    else if (geom == 14) { // Angular
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float divisions = max(1.0, Band_Divisions);
        float segmentAngle = 6.28318 / divisions;
        result.index = floor((angle + 3.14159) / segmentAngle);
        result.localCoord = fract((angle + 3.14159) / segmentAngle + offset);
        result.distance = length(d);
    }
    else if (geom == 15) { // Spiral
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float baseRadius = max(0.1, Form_Base_Radius);
        float radialPower = Form_Radial_Power;
        float twist = Form_Twist;
        float spiralIndex;
        if (radialPower < 0.01) {
            spiralIndex = (dist - baseRadius) / Band_Size + angle * twist / 6.28318;
        } else {
            float power = mix(1.0, 0.1, radialPower);
            spiralIndex = pow(max(0.001, dist / baseRadius), power) / Band_Size * 10.0 + angle * twist / 6.28318;
        }
        result.index = spiralIndex;
        result.localCoord = fract(spiralIndex + offset);
        result.distance = dist;
    }
    else if (geom == 16) { // Ripple
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float divisions = max(1.0, Band_Divisions);
        float segmentAngle = 6.28318 / divisions;
        float wave = sin(dist / Form_Wavelength * 6.28318 + Form_Phase) * Form_Amplitude * 0.1;
        float effectiveAngle = angle + wave;
        result.index = floor((effectiveAngle + 3.14159) / segmentAngle);
        result.localCoord = fract((effectiveAngle + 3.14159) / segmentAngle + offset);
        result.distance = dist;
    }
    else if (geom == 17) { // Bolt
        vec2 d = rotated - center;
        float angle = atan(d.y, d.x);
        float dist = length(d);
        float divisions = max(1.0, Band_Divisions);
        float segmentAngle = 6.28318 / divisions;
        float t = abs(fract(dist / Form_Wavelength) - 0.5) * 2.0;
        t = t * 2.0 - 1.0;
        if (Form_Roundness > 0.0) t = sign(t) * pow(abs(t), 1.0 - Form_Roundness);
        float wave = t * Form_Amplitude * 0.1;
        float effectiveAngle = angle + wave;
        result.index = floor((effectiveAngle + 3.14159) / segmentAngle);
        result.localCoord = fract((effectiveAngle + 3.14159) / segmentAngle + offset);
        result.distance = dist;
    }
    
    // --- DIPOLE TYPES ---
    else if (geom == 18) { // Dipole Radial
        vec2 d = rotated - center;
        float dipoleDist = Form_Dipole_Distance;
        vec2 pole1 = vec2(-dipoleDist / 2.0, 0.0);
        vec2 pole2 = vec2(dipoleDist / 2.0, 0.0);
        float dist1 = length(d - pole1);
        float dist2 = length(d - pole2);
        float ratio = dist1 / max(dist2, 0.001);
        result.index = log(max(0.001, ratio)) / Band_Size;
        result.localCoord = fract(result.index + offset);
        result.distance = (dist1 + dist2) / 2.0;
    }
    else if (geom == 19) { // Dipole Spiral
        vec2 d = rotated - center;
        float dipoleDist = Form_Dipole_Distance;
        float twist = Form_Twist;
        vec2 pole1 = vec2(-dipoleDist / 2.0, 0.0);
        vec2 pole2 = vec2(dipoleDist / 2.0, 0.0);
        vec2 d1 = d - pole1;
        vec2 d2 = d - pole2;
        float angle1 = atan(d1.y, d1.x);
        float angle2 = atan(d2.y, d2.x);
        float dist1 = length(d1);
        float dist2 = length(d2);
        float spiralIndex = (dist1 - dist2) / Band_Size + (angle1 - angle2) * twist / 6.28318;
        result.index = spiralIndex;
        result.localCoord = fract(spiralIndex + offset);
        result.distance = (dist1 + dist2) / 2.0;
    }
    
    float vectorFieldMultiplier = (Vector_Field > 0.5) ? -1.0 : 1.0;
    result.index = result.index * vectorFieldMultiplier;
    
    return result;
}

// ==================== SIZE VARIATION (FIXED) ====================
// Based on video explanation at 4:00-4:50
// Calculates size variation for each band using ramp and noise approaches
float calculateSizeVariation(float bandIndex, float bandOffset) {
    float variation = 1.0;
    
    // Determine effective index based on Index Space
    // S_Index_Space: 0=Relative (ties to bands, scrolls with Band Offset)
    //                1=Absolute (detaches, moves independently)
    float effectiveIndex = bandIndex;
    if (S_Index_Space < 0.5) {
        // Relative: ties it to the bands, scrolls along with Band Offset
        effectiveIndex = bandIndex + bandOffset;
    }
    // Absolute: detaches it so it moves independently (just use bandIndex)
    
    // RAMP APPROACH
    // S Ramp Ratio makes outer bands thinner
    // S Ramp Span sets the spread
    // S Ramp Offset shifts the ramp
    // S Ramp Flip reverses the direction
    // S Ramp Repeat handles what happens beyond the Span (0=Cycle, 1=Mirror, 2=Constant)
    if (S_Ramp_Span > 0.0) {
        float rampIndex = (effectiveIndex + S_Ramp_Offset) / S_Ramp_Span;
        
        // Flip reverses direction
        if (S_Ramp_Flip > 0.5) {
            rampIndex = -rampIndex;
        }
        
        // Apply repeat mode
        rampIndex = rampRepeat(rampIndex, S_Ramp_Repeat);
        
        // S Ramp Ratio makes outer bands thinner (mixes between 1.0 and ratio)
        variation = mix(1.0, S_Ramp_Ratio, rampIndex);
    }
    
    // NOISE APPROACH
    // S Noise Amount gives each band a random value
    // S Noise Span sets the scale
    // S Noise Offset shifts the noise
    // S Noise Seed sets the pattern
    if (S_Noise_Amount > 0.0 && S_Noise_Span > 0.0) {
        float noiseIndex = effectiveIndex / S_Noise_Span + S_Noise_Offset + S_Noise_Seed;
        float noiseValue = linearNoise(vec2(noiseIndex, 0.0), S_Noise_Seed);
        // Noise gives random variation centered around 0
        variation += (noiseValue - 0.5) * S_Noise_Amount;
    }
    
    return variation;
}

// ==================== PROGRESS VARIATION ====================
float calculateProgressVariation(float bandIndex, float bandOffset) {
    float variation = 0.0;
    
    float effectiveIndex = bandIndex;
    if (P_Index_Space < 0.5) {
        effectiveIndex = bandIndex + bandOffset;
    }
    
    // Ramp approach for progress delay
    if (P_Ramp_Span > 0.0) {
        float rampIndex = (effectiveIndex + P_Ramp_Offset) / P_Ramp_Span;
        if (P_Ramp_Flip > 0.5) {
            rampIndex = -rampIndex;
        }
        rampIndex = rampRepeat(rampIndex, P_Ramp_Repeat);
        variation = rampIndex * P_Ramp_Delay;
    }
    
    // Noise approach for progress
    if (P_Noise_Amount > 0.0 && P_Noise_Span > 0.0) {
        float noiseIndex = effectiveIndex / P_Noise_Span + P_Noise_Offset + P_Noise_Seed;
        float noiseValue = linearNoise(vec2(noiseIndex, 0.0), P_Noise_Seed);
        variation += (noiseValue - 0.5) * P_Noise_Amount;
    }
    
    return variation;
}

// ==================== COLOR VARIATION ====================
vec3 calculateColorVariation(float bandIndex, vec3 baseColor, float bandOffset) {
    vec3 color = baseColor;
    
    float effectiveIndex = bandIndex;
    if (C_Index_Space < 0.5) {
        effectiveIndex = bandIndex + bandOffset;
    }
    
    // Color ramp method
    if (Color_Method > 0.5 && C_Ramp_Span > 0.0) {
        float rampIndex = (effectiveIndex + C_Ramp_Offset) / C_Ramp_Span;
        if (C_Ramp_Flip > 0.5) {
            rampIndex = 1.0 - rampIndex;
        }
        rampIndex = rampRepeat(rampIndex, C_Ramp_Repeat);
        color = mix(C_Ramp_Start_Color, C_Ramp_End_Color, rampIndex);
    }
    
    // Color noise (HSB variation)
    if (C_Noise_Hue_Amount > 0.0 || C_Noise_Saturation_Amount > 0.0 || C_Noise_Brightness_Amount > 0.0) {
        float noiseIndex = effectiveIndex / C_Noise_Span + C_Noise_Offset + C_Noise_Seed;
        float noiseVal = linearNoise(vec2(noiseIndex, 0.0), C_Noise_Seed);
        vec3 hsl = rgb2hsl(color);
        hsl.x += (noiseVal - 0.5) * C_Noise_Hue_Amount;
        hsl.y = clamp(hsl.y + (noiseVal - 0.5) * C_Noise_Saturation_Amount, 0.0, 1.0);
        hsl.z = clamp(hsl.z + (noiseVal - 0.5) * C_Noise_Brightness_Amount, 0.0, 1.0);
        color = hsl2rgb(hsl);
    }
    
    return color;
}

// ==================== OPACITY VARIATION ====================
float calculateOpacityVariation(float bandIndex, float bandOffset) {
    float variation = 1.0;
    
    float effectiveIndex = bandIndex;
    if (O_Index_Space < 0.5) {
        effectiveIndex = bandIndex + bandOffset;
    }
    
    // Opacity ramp
    if (O_Ramp_Span > 0.0) {
        float rampIndex = (effectiveIndex + O_Ramp_Offset) / O_Ramp_Span;
        if (O_Ramp_Flip > 0.5) {
            rampIndex = -rampIndex;
        }
        rampIndex = rampRepeat(rampIndex, O_Ramp_Repeat);
        variation = mix(1.0, O_Ramp_Ratio, rampIndex);
    }
    
    // Opacity noise
    if (O_Noise_Amount > 0.0 && O_Noise_Span > 0.0) {
        float noiseIndex = effectiveIndex / O_Noise_Span + O_Noise_Offset + O_Noise_Seed;
        float noiseValue = linearNoise(vec2(noiseIndex, 0.0), O_Noise_Seed);
        variation += (noiseValue - 0.5) * O_Noise_Amount;
    }
    
    return variation;
}

// ==================== DISTORTION ====================
vec2 applyDistortion(vec2 uv_pix, vec2 center, float vectorFieldMultiplier) {
    if (Distortion_Amplitude == 0.0) return uv_pix / resolution;
    
    vec2 uv_norm = uv_pix / resolution;
    // Vector_Field reverses the evolution direction
    float timeOffset = time * Distortion_Evolution * vectorFieldMultiplier;
    
    // Scale noise coordinates
    // Vector_Field also reverses the phase direction
    float phaseDirection = vectorFieldMultiplier;
    vec2 noiseUV = uv_norm * Distortion_Scale + vec2(Distortion_Phase * phaseDirection, timeOffset);

    float noiseX, noiseY;
    if (Distortion_Mode == 0.0) { // Smooth (Perlin)
        noiseX = snoise(noiseUV);
        noiseY = snoise(noiseUV + vec2(5.2, 1.3));
    } else { // Linear
        noiseX = linearNoise(noiseUV, Dither_Seed);
        noiseY = linearNoise(noiseUV + vec2(5.2, 1.3), Dither_Seed + 100.0);
    }
    
    // Amplitude is relative to Band Size (pixels)
    float amp = Distortion_Amplitude * Band_Size;
    
    // Apply Power factor for radial types (depends on distance from center)
    if (Distortion_Power > 0.0 && Band_Geometry >= 6.0) {
        float dist = length(uv_pix - center);
        float normDist = dist / max(resolution.x, resolution.y); 
        amp *= mix(1.0, normDist * 2.0, Distortion_Power);
    }
    
    // Convert pixel displacement to UV displacement
    vec2 dispNorm = vec2(noiseX, noiseY) * amp / resolution;
    
    return uv_norm + dispNorm;
}

// ==================== MAIN ====================
void main() {
    vec2 uv_pix = vUvScaled * resolution;
    vec2 center = Band_Center;
    
    // Vector_Field affects the direction of band movement
    float vectorFieldMultiplier = (Vector_Field > 0.5) ? -1.0 : 1.0;
    float animatedOffset = Band_Offset + (Band_Speed * time * vectorFieldMultiplier);
    
    // Apply distortion
    vec2 distortedUV_norm = applyDistortion(uv_pix, center, vectorFieldMultiplier);
    vec2 distortedUV_pix = distortedUV_norm * resolution;

    // Calculate band index (already multiplied by vectorFieldMultiplier in calculateBandIndex)
    BandResult band = calculateBandIndex(distortedUV_pix, center, Band_Rotation, animatedOffset);
    
    // Apply range limiting
    if (Range_Mode > 0.5) {
        if (band.index < Range_Start_Index || band.index > Range_End_Index) {
            gl_FragColor = texture2D(tDiffuse, vUvScaled);
            return;
        }
    }
    
    // Calculate size variation
    float sizeVariation = calculateSizeVariation(band.index, animatedOffset);
    
    // Calculate progress variation (for stagger effect)
    float progressVariation = calculateProgressVariation(band.index, animatedOffset);
    
    // Apply fill progress with easing and variation
    float fillProgress = Fill_Progress;
    if (P_Ramp_Delay != 0.0 || P_Noise_Amount > 0.0) {
        fillProgress = applyEasing(clamp(fillProgress - progressVariation, 0.0, 1.0), Fill_Easing);
    } else {
        fillProgress = applyEasing(fillProgress, Fill_Easing);
    }
  // For fill progress, reverse the direction if Vector_Field is negative
    float fillDirection = vectorFieldMultiplier;
    float adjustedFillProgress = Fill_Progress;
    if (fillDirection < 0.0) {
        adjustedFillProgress = 1.0 - Fill_Progress;
    }
    
    // Calculate fill position
    float fillPos = band.localCoord;
    float fillStart = Fill_Start_Line;
    
    // Determine if pixel is in fill area
    float inFill;
    if (fillStart < 0.5) {
        // Grows from edge
        inFill = step(fillStart, fillPos) * step(fillPos, fillStart + fillProgress * (1.0 - fillStart));
    } else {
        // Grows both ways from center
        float halfProgress = fillProgress * 0.5;
        inFill = step(fillStart - halfProgress, fillPos) * step(fillPos, fillStart + halfProgress);
    }
    
    // Apply feathering
    if (Feather_Distance > 0.0) {
        float featherWidth = Feather_Distance;
        float denom = max(0.001, fillProgress * 0.5);
        float featherPos = abs(fillPos - fillStart - fillProgress * 0.5) / denom;
        float featherFactor = 1.0 - featherFalloff(clamp(featherPos / featherWidth, 0.0, 1.0), Feather_Falloff);
        inFill *= featherFactor;
    }
    
    // Calculate opacity variation
    float opacityVariation = calculateOpacityVariation(band.index, animatedOffset);
    
    // Calculate color variation
    vec3 bandColor = calculateColorVariation(band.index, Fill_Color, animatedOffset);
    
    // Calculate final opacity
    float finalOpacity = Fill_Opacity * opacityVariation * inFill * sizeVariation;
    
    // Get background color
    vec4 bgColor = texture2D(tDiffuse, vUvScaled);
    
    // Apply blend mode
    vec3 finalColor;
    int bm = int(Blend_Mode);
    if (bm == 2 || bm == 3) {
        // Stencil Alpha or Silhouette Alpha
        finalColor = bgColor.rgb;
        finalOpacity = inFill;
    } else if (bm == 19 || bm == 20) {
        // Dither or Dither Only
        float dither = fract(sin(dot(vUvScaled + vec2(Dither_Seed), vec2(12.9898, 78.233))) * 43758.5453);
        finalColor = mix(bgColor.rgb, bandColor, step(dither, finalOpacity));
        if (bm == 20) finalOpacity = 1.0;
    } else {
        // Standard blend modes
        finalColor = applyBlendMode(bgColor.rgb, bandColor * finalOpacity, Blend_Mode);
        finalColor = mix(bgColor.rgb, finalColor, finalOpacity);
    }
    
    // Apply anti-aliasing
    if (Anti_Aliasing > 1.5) {
        // Off - hard edges
        gl_FragColor = vec4(finalColor, 1.0);
    } else {
        // Analytical or Multi-sample
        gl_FragColor = vec4(finalColor, finalOpacity);
    }
}
