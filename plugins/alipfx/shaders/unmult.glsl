precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

/* Panzoid custom properties (Number dynamic) */
uniform float Background_Color;       // 0 = Black, 1 = White
uniform float Black_Level;            // 0..255
uniform float Softness;               // 0..255
uniform float Remove_Color_Matting;   // 0/1
uniform float Clip_HDR_Results;       // 0/1

float max3(vec3 c) { return max(c.r, max(c.g, c.b)); }
float min3(vec3 c) { return min(c.r, min(c.g, c.b)); }

// Rec.709 luminance (good for smoke density)
float luminance709(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  float isWhiteBG = step(0.5, Background_Color); // 0 or 1
  vec3 matteColor = mix(vec3(0.0), vec3(1.0), isWhiteBG);

  // Normalize UI controls to 0..1
  float level = clamp(Black_Level / 255.0, 0.0, 1.0);
  float soft  = clamp(Softness   / 255.0, 0.0, 1.0);

  // --- KEY SIGNAL (adaptive: smoke-friendly) ---
  // For smoke/shockwaves (low saturation), luminance is more accurate.
  // For colorful highlights, max channel works better.
  float mx = max3(texel.rgb);
  float mn = min3(texel.rgb);
  float sat = clamp(mx - mn, 0.0, 1.0);     // simple saturation estimate
  float grayWeight = 1.0 - smoothstep(0.05, 0.25, sat); // 1=gray, 0=color

  float lum = clamp(luminance709(texel.rgb), 0.0, 1.0);
  float keyBlack = mix(mx, lum, grayWeight);             // adaptive for black BG
  float keyWhite = 1.0 - mix(1.0 - mn, lum, grayWeight); // not commonly used; keeps logic consistent

  // For white BG we generally want: white->transparent, dark->opaque
  // Use inverted logic based on min channel, but keep gray behavior stable:
  float keyForWhiteBG = clamp(1.0 - mn, 0.0, 1.0);
  keyForWhiteBG = mix(keyForWhiteBG, 1.0 - lum, grayWeight);

  float keySignal = mix(keyBlack, keyForWhiteBG, isWhiteBG);

  // --- AE-LIKE MATTE GENERATION ---
  // Softness is FEATHER WIDTH around the cutoff (level).
  float aKey;
  if (soft <= 1e-6) {
    aKey = step(level, keySignal);              // hard cutoff
  } else {
    float hi = min(level + soft, 1.0);
    aKey = smoothstep(level, hi, keySignal);    // feather only at the edge
  }

  // Preserve existing source alpha if present
  float outA = clamp(aKey * texel.a, 0.0, 1.0);

  // Start with straight (unmatted) color = original
  vec3 straightRGB = texel.rgb;

  // --- REMOVE COLOR MATTING (protected, AE-ish) ---
  if (Remove_Color_Matting >= 0.5) {
    float eps = 1e-6;

    // Protect very low alpha to avoid division blow-ups / “wipe out”
    float protect = smoothstep(0.02, 0.20, outA);

    // Unmat/unpremultiply against matte color (black/white)
    vec3 unmatted = (texel.rgb - matteColor * (1.0 - outA)) / max(outA, eps);

    if (Clip_HDR_Results >= 0.5) {
      unmatted = clamp(unmatted, 0.0, 1.0);
    }

    straightRGB = mix(texel.rgb, unmatted, protect);
  }

  // --- NORMAL BLEND FRIENDLY OUTPUT ---
  // Output premultiplied RGB (more consistent for GPU compositing)
  vec3 premultRGB = straightRGB * outA;

  gl_FragColor = vec4(premultRGB, outA);
}
