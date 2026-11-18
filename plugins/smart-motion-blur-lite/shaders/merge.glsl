precision highp float;
varying vec2 vUv;
uniform sampler2D tCurrent,tBlur,tFlow;
uniform vec2 uvScale,resolution,levelSize;
uniform float strength;
void main(){
  vec2 pixel=vUv*resolution-0.5;
  vec2 fieldPixel=pixel*(levelSize-1.0)/(resolution-1.0);
  vec2 motion=texture2D(tFlow,(fieldPixel+0.5)/levelSize).rg;
  float reach=length(0.5*strength*motion);
  vec4 original=texture2D(tCurrent,vUv*uvScale);
  // Native source detail remains untouched where motion is absent. Smooth
  // blending avoids a hard resolution switch when motion grows or settles.
  gl_FragColor=mix(original,texture2D(tBlur,vUv),smoothstep(0.0,1.0,reach));
}
