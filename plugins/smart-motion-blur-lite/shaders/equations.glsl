precision highp float;
varying vec2 vUv;
uniform sampler2D tPair,tFlow;
uniform vec2 levelSize,resolution;
uniform float equation;
float current(vec2 p){return 255.0*texture2D(tPair,clamp(p,0.5/levelSize,1.0-0.5/levelSize)).r;}
void main(){
  vec2 d=1.0/levelSize;
  vec2 g=0.5*vec2(current(vUv+vec2(d.x,0.0))-current(vUv-vec2(d.x,0.0)),current(vUv+vec2(0.0,d.y))-current(vUv-vec2(0.0,d.y)));
  if(equation<0.5){gl_FragColor=vec4(g.x*g.x,g.x*g.y,g.y*g.y,1.0);return;}
  vec2 v=smbDecode(texture2D(tFlow,vUv)),q=vUv+v/resolution;
  float residual=255.0*texture2D(tPair,clamp(q,0.5/levelSize,1.0-0.5/levelSize)).b-current(vUv);
  if(any(lessThan(q,0.5/levelSize))||any(greaterThan(q,1.0-0.5/levelSize)))residual=0.0;
  gl_FragColor=vec4(g*residual,0.0,1.0);
}
