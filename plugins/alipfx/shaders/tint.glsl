precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

/* Panzoid custom properties (created in the UI) */
uniform vec3 Map_Black_To;     // Color
uniform vec3 Map_White_To;     // Color
uniform float Amount_to_Tint;  // Number (0..100 like AE)
uniform float Swap_Colors;     // Number (0 or 1)

float getLuma(vec3 c)
{
  // NTSC / “perceived” luma weights
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // --- Amount to Tint: strict AE percent 0..100 ---
  float amt = clamp(Amount_to_Tint, 0.0, 100.0) / 100.0;

  // --- Swap colors (0 = normal, 1 = swapped) ---
  float s = step(0.5, Swap_Colors); // >= 0.5 counts as "on"
  vec3 blackMap = mix(Map_Black_To, Map_White_To, s);
  vec3 whiteMap = mix(Map_White_To, Map_Black_To, s);

  // --- Luminance mapping ---
  float luma = clamp(getLuma(texel.rgb), 0.0, 1.0);
  vec3 tinted = mix(blackMap, whiteMap, luma);

  // --- Blend original <-> tinted ---
  vec3 outRgb = mix(texel.rgb, tinted, amt);

  // Preserve original alpha
  gl_FragColor = vec4(outRgb, texel.a);
}
