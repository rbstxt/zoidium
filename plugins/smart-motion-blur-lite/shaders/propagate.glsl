precision highp float;
varying vec2 vUv;
uniform sampler2D tPair;
uniform sampler2D tFlow;
uniform vec2 levelSize;
uniform vec2 resolution;
uniform float seedFraction;
uniform float proposalStep;
float score(vec2 v) {
  float sum=0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    vec2 p=clamp(vUv+vec2(float(x),float(y))/levelSize,0.5/levelSize,1.0-0.5/levelSize);
    vec2 q=p+v/resolution;
    if(any(lessThan(q,vec2(0.0)))||any(greaterThan(q,vec2(1.0))))return 2.0;
    vec2 d=texture2D(tPair,p).rg-texture2D(tPair,q).ba;
    sum+=d.x*d.x;
  }
  return sum/9.0;
}
void main(){
  vec2 best=smbDecode(texture2D(tFlow,vUv));
  float bestScore=score(best);
  if(bestScore<0.000001){gl_FragColor=smbEncode(best*seedFraction);return;}
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 p=clamp(vUv+proposalStep*vec2(float(x),float(y))/levelSize,0.5/levelSize,1.0-0.5/levelSize);
    vec2 candidate=smbDecode(texture2D(tFlow,p));
    float value=score(candidate);
    if(value<bestScore){
      best=candidate;bestScore=value;
    }
  }
  gl_FragColor=smbEncode(best*seedFraction);
}
