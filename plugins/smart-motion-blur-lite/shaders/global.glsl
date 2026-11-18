precision highp float;
varying vec2 vUv;
uniform sampler2D tPair,tGlobal;
uniform vec2 levelSize,resolution;
uniform float initialize;
vec2 previous(vec2 p){return texture2D(tPair,clamp(p,0.5/levelSize,1.0-0.5/levelSize)).ba;}
void main(){
  if(initialize>0.5){gl_FragColor=smbEncode(vec2(0.0));return;}
  vec2 c0=4.0*smbDecode(texture2D(tGlobal,vec2(1.0/6.0,0.5)));
  vec2 cx=4.0*smbDecode(texture2D(tGlobal,vec2(0.5,0.5)));
  vec2 cy=4.0*smbDecode(texture2D(tGlobal,vec2(5.0/6.0,0.5)));
  float a[42];float jx[6];float jy[6];
  for(int i=0;i<42;i++)a[i]=0.0;
  for(int y=0;y<27;y++)for(int x=0;x<48;x++){
    vec2 p=(vec2(float(x),float(y))+0.5)/vec2(48.0,27.0),c=2.0*p-1.0,h=1.0/levelSize;
    vec2 q=p+(c0+cx*c.x+cy*c.y)/resolution;
    if(any(lessThan(q,h))||any(greaterThan(q,1.0-h)))continue;
    vec2 residual=previous(q)-texture2D(tPair,p).rg;
    vec2 gx=0.5*(previous(q+vec2(h.x,0.0))-previous(q-vec2(h.x,0.0)));
    vec2 gy=0.5*(previous(q+vec2(0.0,h.y))-previous(q-vec2(0.0,h.y)));
    jx[0]=gx.x;jx[1]=gx.x*c.x;jx[2]=gx.x*c.y;jx[3]=gy.x;jx[4]=gy.x*c.x;jx[5]=gy.x*c.y;
    jy[0]=gx.y;jy[1]=gx.y*c.x;jy[2]=gx.y*c.y;jy[3]=gy.y;jy[4]=gy.y*c.x;jy[5]=gy.y*c.y;
    float w=1.0/(1.0+100.0*dot(residual,residual));
    for(int r=0;r<6;r++){
      for(int col=0;col<6;col++)a[r*7+col]+=w*(jx[r]*jx[col]+0.5*jy[r]*jy[col]);
      a[r*7+6]-=w*(jx[r]*residual.x+0.5*jy[r]*residual.y);
    }
  }
  for(int i=0;i<6;i++)a[i*7+i]+=0.00001;
  for(int k=0;k<6;k++){
    float pivot=a[k*7+k];
    for(int col=0;col<7;col++)a[k*7+col]/=pivot;
    for(int r=0;r<6;r++){
      if(r==k)continue;float multiplier=a[r*7+k];
      for(int col=0;col<7;col++)a[r*7+col]-=multiplier*a[k*7+col];
    }
  }
  vec2 cell=resolution/levelSize;
  c0+=clamp(vec2(a[6],a[27]),vec2(-1.0),vec2(1.0))*cell;
  cx+=clamp(vec2(a[13],a[34]),vec2(-1.0),vec2(1.0))*cell;
  cy+=clamp(vec2(a[20],a[41]),vec2(-1.0),vec2(1.0))*cell;
  vec2 result=vUv.x<0.333333?c0:vUv.x<0.666667?cx:cy;
  gl_FragColor=smbEncode(result/4.0);
}
