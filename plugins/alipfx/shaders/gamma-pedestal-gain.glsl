precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Panzoid custom properties (spaces become underscores)
uniform float Black_Stretch;

uniform float Red_Gamma;
uniform float Red_Pedestal;
uniform float Red_Gain;

uniform float Green_Gamma;
uniform float Green_Pedestal;
uniform float Green_Gain;

uniform float Blue_Gamma;
uniform float Blue_Pedestal;
uniform float Blue_Gain;

const float EPS = 0.00001;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Safe gamma so the shader never explodes at 0
float safeGamma(float g) {
    return max(g, EPS);
}

// Black Stretch curve:
// - no change at 1.0
// - > 1.0 lifts/expands shadows
// - < 1.0 compresses/crushes shadows a bit
// The shadow mask makes it affect dark values much more than highlights.
float blackStretchCurve(float x, float stretch) {
    x = clamp(x, 0.0, 1.0);
    stretch = max(stretch, EPS);

    // Base lift curve that preserves 0 and 1
    float lifted = 1.0 - pow(1.0 - x, stretch);

    // Fade the effect out toward highlights
    float shadowMask = pow(1.0 - x, 2.0);

    return mix(x, lifted, shadowMask);
}

// AE-like channel mapping:
// pedestal = output floor
// gain     = output ceiling
// gamma    = curve bend in the middle
float applyChannelGPG(float x, float gammaVal, float pedestal, float gainVal) {
    x = clamp(x, 0.0, 1.0);

    // Gamma > 1.0 brightens mids, Gamma < 1.0 darkens mids
    float curved = pow(x, 1.0 / safeGamma(gammaVal));

    // Pedestal/Gain define min/max output
    float y = pedestal + (gainVal - pedestal) * curved;

    return clamp(y, 0.0, 1.0);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 c = clamp(texel.rgb, 0.0, 1.0);

    // -------------------------------------------------
    // 1) BLACK STRETCH (global, hue-preserving)
    // -------------------------------------------------
    // Do black stretch on luminance, then rescale RGB.
    // This keeps neutrals neutral and avoids color shifts in shadows.
    float y  = dot(c, LUMA);
    float y2 = blackStretchCurve(y, Black_Stretch);

    float scale = y2 / max(y, EPS);
    c *= scale;
    c = clamp(c, 0.0, 1.0);

    // -------------------------------------------------
    // 2) PER-CHANNEL GAMMA / PEDESTAL / GAIN
    // -------------------------------------------------
    c.r = applyChannelGPG(c.r, Red_Gamma,   Red_Pedestal,   Red_Gain);
    c.g = applyChannelGPG(c.g, Green_Gamma, Green_Pedestal, Green_Gain);
    c.b = applyChannelGPG(c.b, Blue_Gamma,  Blue_Pedestal,  Blue_Gain);

    // Optional: uncomment this line if you want a more "legacy 8-bpc" feel
    // c = floor(c * 255.0 + 0.5) / 255.0;

    gl_FragColor = vec4(c, texel.a);
}
