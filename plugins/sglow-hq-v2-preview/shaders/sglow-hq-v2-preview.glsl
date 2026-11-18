precision highp float;

uniform sampler2D tDiffuse;
uniform float strength;
varying vec2 vUv;

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(mix(source.rgb, vec3(1.0) - source.rgb, strength), source.a);
}
