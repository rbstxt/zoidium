"use strict";
const vertexShader = `varying vec2 paintPosition;
void main(){paintPosition=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragmentShader = `precision highp float;
varying vec2 paintPosition;
uniform mat3 paintInverse;
uniform vec2 startPoint;
uniform vec2 endPoint;
uniform vec2 highlight;
uniform float radial;
uniform float opacity;
uniform float stopPositions[16];
uniform vec4 stopColors[16];
uniform int stopCount;
void main(){
  vec2 p=(paintInverse*vec3(paintPosition,1.0)).xy;
  vec2 axis=endPoint-startPoint;
  float radius=max(length(axis),0.000001);
  float t=dot(p-startPoint,axis)/max(dot(axis,axis),0.000001);
  if(radial>0.5){
    vec2 focus=startPoint+radius*highlight;
    vec2 d=(p-focus)/radius;
    float a=dot(d,d);
    float b=dot(highlight,d);
    t=a>0.00000001?a/max(-b+sqrt(max(0.0,b*b+a*(1.0-dot(highlight,highlight)))),0.000001):0.0;
  }
  vec4 c=stopColors[0];
  for(int i=1;i<16;i++){
    if(i<stopCount){
      float f=clamp((t-stopPositions[i-1])/max(stopPositions[i]-stopPositions[i-1],0.000001),0.0,1.0);
      c=mix(c,stopColors[i],f);
    }
  }
  gl_FragColor=c*opacity;
}`;
function uniforms(THREE, command) {
  const g = command.gradient,
    m = g.matrix,
    det = m[0] * m[3] - m[1] * m[2];
  const inverse = new THREE.Matrix3();
  if (Math.abs(det) > 1e-12)
    inverse.set(
      m[3] / det,
      -m[2] / det,
      (m[2] * m[5] - m[3] * m[4]) / det,
      -m[1] / det,
      m[0] / det,
      (m[1] * m[4] - m[0] * m[5]) / det,
      0,
      0,
      1,
    );
  const angle =
    Math.atan2(g.end[1] - g.start[1], g.end[0] - g.start[0]) + g.highlightAngle;
  const h = Math.max(-0.99, Math.min(0.99, g.highlightLength / 100));
  return {
    paintInverse: { value: inverse },
    startPoint: { value: new THREE.Vector2(...g.start) },
    endPoint: { value: new THREE.Vector2(...g.end) },
    highlight: {
      value: new THREE.Vector2(h * Math.cos(angle), h * Math.sin(angle)),
    },
    radial: { value: g.type === "radial" ? 1 : 0 },
    opacity: { value: command.opacity },
    stopCount: { value: g.stops.length },
    stopPositions: {
      value: Array.from(
        { length: 16 },
        (_, i) => g.stops[Math.min(i, g.stops.length - 1)][0],
      ),
    },
    stopColors: {
      value: Array.from({ length: 16 }, (_, i) => {
        const c = g.stops[Math.min(i, g.stops.length - 1)][1];
        return new THREE.Vector4(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]);
      }),
    },
  };
}
module.exports = { vertexShader, fragmentShader, uniforms };
