precision highp float;
varying vec2 vUv;
uniform sampler2D tCurrent,tFlow;
uniform vec2 resolution,levelSize,uvScale;
uniform float strength,sampleDivisor;
vec4 source(vec2 p){return texture2D(tCurrent,clamp((p+0.5)/resolution,0.5/resolution,1.0-0.5/resolution)*uvScale);}
void main(){
  vec2 pixel=vUv*resolution-0.5;
  vec2 fieldPixel=pixel*(levelSize-1.0)/(resolution-1.0);
  vec2 motion=texture2D(tFlow,(fieldPixel+0.5)/levelSize).rg;
  vec2 halfVector=0.5*strength*motion;
  float len=length(halfVector);
  if(len<0.000001){gl_FragColor=source(pixel);return;}
  float n=min(2048.0,max(2.0,floor(len/sampleDivisor+1.0)));
  vec2 stepVector=halfVector/(n-1.0);
  vec4 sum=source(pixel);float total=1.0;
  for(int i=1;i<2048;i++){
    if(float(i)>=n)break;
    vec2 d=float(i)*stepVector;
    vec2 p=pixel+d;
    if(all(greaterThanEqual(p,vec2(0.0)))&&all(lessThan(p,resolution))){sum+=source(p);total+=1.0;}
    p=pixel-d;
    if(all(greaterThanEqual(p,vec2(0.0)))&&all(lessThan(p,resolution))){sum+=source(p);total+=1.0;}
  }
  gl_FragColor=sum/total;
}
