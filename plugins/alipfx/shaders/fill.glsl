precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Custom properties (Panzoid)
uniform vec3 Color;     // Color picker
uniform float Opacity;  // 0..100

void main()
{
  vec4 src = texture2D(tDiffuse, vUvScaled);

  // Convert 0..100 to 0..1
  float op = clamp(Opacity / 100.0, 0.0, 1.0);

  // Mix fill color over the original RGB
  vec3 outRgb = mix(src.rgb, Color, op);

  // Keep original alpha (recommended for AE-like "Fill" on most layers)
  gl_FragColor = vec4(outRgb, src.a);
}
