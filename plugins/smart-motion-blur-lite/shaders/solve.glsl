precision highp float;
varying vec2 vUv;
uniform sampler2D tA,tB,tFlow;
uniform vec2 levelSize,resolution;
uniform sampler2D tPair;
float errorAt(vec2 motion){
  float sum=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 p=clamp(vUv+vec2(float(x),float(y))/levelSize,0.5/levelSize,1.0-0.5/levelSize);
    vec2 q=p+motion/resolution;
    if(any(lessThan(q,0.5/levelSize))||any(greaterThan(q,1.0-0.5/levelSize)))return 1e10;
    float d=texture2D(tPair,p).r-texture2D(tPair,q).b;sum+=d*d;
  }
  return sum;
}
void main(){
  vec3 a=texture2D(tA,vUv).rgb;vec2 b=texture2D(tB,vUv).rg;
  float det=a.x*a.z-a.y*a.y;
  vec2 v=smbDecode(texture2D(tFlow,vUv));
  if(det>40.0){
    vec2 delta=-vec2(a.z*b.x-a.y*b.y,a.x*b.y-a.y*b.x)/det;
    vec2 step=clamp(delta,vec2(-2.0),vec2(2.0))*resolution/levelSize;
    vec2 best=v;float score=errorAt(v);
    for(int i=0;i<3;i++){
      vec2 candidate=v+step;float e=errorAt(candidate);
      if(e<score){best=candidate;score=e;}step*=0.5;
    }
    v=best;
  }
  gl_FragColor=smbEncode(v);
}
