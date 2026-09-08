precision highp float;
precision highp int;

varying vec3 vViewPosition;
varying vec3 vViewNormal;

void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -viewPosition.xyz;
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewPosition;
}
