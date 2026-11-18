precision highp float;
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 levelSize,direction;
uniform float radius,packedFlow;
void main(){
  vec4 sum=vec4(0.0);float total=0.0;
  for(int i=-7;i<=7;i++){
    float x=float(i);if(abs(x)>radius)continue;
    float w=exp2(-9.0*x*x/(radius*radius));
    vec2 p=clamp(vUv+x*direction/levelSize,0.5/levelSize,1.0-0.5/levelSize);
    vec4 v=texture2D(tInput,p);if(packedFlow>0.5)v=vec4(smbDecode(v),0.0,1.0);
    sum+=v*w;total+=w;
  }
  sum/=total;gl_FragColor=packedFlow>0.5?smbEncode(sum.xy):sum;
}

