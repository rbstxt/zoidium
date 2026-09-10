precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform sampler2D curveLUT;
uniform vec2 uvScale;

varying vec2 vUv;

void main() {
  vec2 sourceUv = vUv * uvScale;
  vec4 tex = texture2D(tDiffuse, sourceUv);
  float alpha = clamp(tex.a, 0.0, 1.0);
  vec3 straight = alpha > 0.00001 ? tex.rgb / alpha : vec3(0.0);
  vec3 lookupUv = (clamp(straight, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  vec3 graded;
  graded.r = texture2D(curveLUT, vec2(lookupUv.r, 0.5)).r;
  graded.g = texture2D(curveLUT, vec2(lookupUv.g, 0.5)).g;
  graded.b = texture2D(curveLUT, vec2(lookupUv.b, 0.5)).b;
  gl_FragColor = vec4(graded * alpha, alpha);
}
