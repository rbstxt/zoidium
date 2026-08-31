precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform float Level;

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // AE-like 8-bpc scaling: 0..256 -> 0..1
  float level01;
  if (Level <= 1.0) {
    level01 = Level;
  } else {
    level01 = Level / 256.0;
  }
  level01 = clamp(level01, 0.0, 1.0);

  // Rec.709 luma / relative luminance coefficients
  // (0.2126, 0.7152, 0.0722)
  float luma709 = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));

  // Threshold: white if luma >= level, else black
  float bw = step(level01, luma709);

  gl_FragColor = vec4(vec3(bw), texel.a);
}
