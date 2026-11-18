precision highp float;
varying vec2 vUv;
uniform sampler2D tFlow;
uniform vec2 levelSize;
uniform float smoothing;
void main(){
  float mx[9];float my[9];
  for(int y=0;y<3;y++)for(int x=0;x<3;x++){
    vec2 p=clamp(vUv+4.0*(vec2(float(x),float(y))-1.0)/levelSize,0.5/levelSize,1.0-0.5/levelSize);
    vec2 sample=smbDecode(texture2D(tFlow,p));mx[y*3+x]=sample.x;my[y*3+x]=sample.y;
  }
  // Filter velocity outliers, not the source colors or opacity.
  for(int i=0;i<9;i++)for(int j=0;j<8;j++){
    if(mx[j]>mx[j+1]){float t=mx[j];mx[j]=mx[j+1];mx[j+1]=t;}
    if(my[j]>my[j+1]){float t=my[j];my[j]=my[j+1];my[j+1]=t;}
  }
  vec2 center=smbDecode(texture2D(tFlow,vUv));
  vec2 median=vec2(mx[4],my[4]),sum=vec2(0.0);float total=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 p=clamp(vUv+vec2(float(x),float(y))/levelSize,0.5/levelSize,1.0-0.5/levelSize);
    vec2 v=smbDecode(texture2D(tFlow,p));
    float w=exp(-dot(v-median,v-median)/32.0);
    sum+=v*w;total+=w;
  }
  gl_FragColor=smbEncode(mix(sum/max(total,0.00001),median,smoothing));
}
