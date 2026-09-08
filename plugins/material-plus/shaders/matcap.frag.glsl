precision highp float;
precision highp int;

uniform sampler2D matcapTexture;
uniform float hasMatcap;
uniform vec3 tint;
uniform float brightness;
uniform float opacity;

varying vec3 vViewPosition;
varying vec3 vViewNormal;

void main() {
  vec3 normal = normalize(vViewNormal);
  vec3 viewDirection = normalize(vViewPosition);
  vec3 xAxis = normalize(vec3(viewDirection.z, 0.0, -viewDirection.x));
  vec3 yAxis = cross(viewDirection, xAxis);
  vec2 matcapUv = vec2(dot(xAxis, normal), dot(yAxis, normal));
  matcapUv = matcapUv * 0.495 + 0.5;
  matcapUv = clamp(matcapUv, 0.001, 0.999);

  vec4 fallback = vec4(0.5, 0.5, 0.5, 1.0);
  vec4 sampled = texture2D(matcapTexture, matcapUv);
  vec4 matcap = mix(fallback, sampled, clamp(hasMatcap, 0.0, 1.0));
  vec3 color = matcap.rgb * tint * max(brightness, 0.0);
  float alpha = clamp(matcap.a * opacity, 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
}
