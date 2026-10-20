
precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;
vec4 ne_sample(vec2 uv) {
 vec4 p=texture2D(tDiffuse,uv*uvScale);
 return vec4(p.a>0.000001?p.rgb/p.a:vec3(0.0),p.a);
}
float ne_safe(float x) { return x<=1.0e30 && x>=-1.0e30 ? x : 0.0; }
float ne_div(float a,float b) { return abs(b)<1.0e-12 ? 0.0 : ne_safe(a/b); }
vec3 ne_rgb(vec3 c) {
 vec3 p=abs(fract(c.xxx+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0);
 return c.z*mix(vec3(1.0),clamp(p-1.0,0.0,1.0),c.y);
}
vec3 ne_hsv(vec3 c) {
 float hi=max(c.r,max(c.g,c.b)),lo=min(c.r,min(c.g,c.b)),d=hi-lo,h=0.0;
 if(d>0.0) { if(hi==c.r) h=mod((c.g-c.b)/d,6.0); else if(hi==c.g) h=(c.b-c.r)/d+2.0; else h=(c.r-c.g)/d+4.0; }
 return vec3(fract(h/6.0),hi==0.0?0.0:d/hi,hi);
}
float ne_math(float a,float b,float c,int mode) {
 float r=0.0;
 if(mode==0) r=a+b;
 else if(mode==1) r=a-b;
 else if(mode==2) r=a*b;
 else if(mode==3) r=ne_div(a,b);
 else if(mode==4) r=min(a,b);
 else if(mode==5) r=max(a,b);
 else if(mode==6) r=a<0.0?(fract(b)==0.0?pow(-a,b)*(mod(abs(b),2.0)==0.0?1.0:-1.0):0.0):pow(a,b);
 else if(mode==7) r=abs(b)<1.0e-12?0.0:a-b*(a/b<0.0?ceil(a/b):floor(a/b));
 else if(mode==8) r=abs(a);
 else if(mode==9) r=1.0-a;
 else if(mode==10) r=clamp(a,0.0,1.0);
 else if(mode==11) r=abs(a-b)<=0.01?1.0:0.0;
 else if(mode==12) r=sin(a);
 else if(mode==13) r=floor(a+0.5);
 else if(mode==14) r=sqrt(a);
 else if(mode==15) r=a>0.0 && b>0.0 && abs(b-1.0)>1.0e-12 ? log(a)/log(b) : 0.0;
 else if(mode==16) r=exp(a);
 else if(mode==17) r=floor(a);
 else if(mode==18) r=ceil(a);
 else if(mode==19) r=fract(a);
 else if(mode==20) r=sign(a);
 else if(mode==21 || mode==22) { float k=max(c,0.0),h=k==0.0?0.0:max(k-abs(a-b),0.0)/k; r=mode==21?min(a,b)-h*h*k*0.25:max(a,b)+h*h*k*0.25; }
 else if(mode==23) r=abs(b)<1.0e-12?0.0:floor(a/b)*b;
 else if(mode==24) r=b==c?c:a-(b-c)*floor((a-c)/(b-c));
 else if(mode==25) r=abs(b)<1.0e-12?0.0:abs(b)-abs(mod(a,2.0*abs(b))-abs(b));
 else if(mode==26) r=cos(a);
 else if(mode==27) r=tan(a);
 else if(mode==28) r=a==0.0 && b==0.0?0.0:atan(a,b);
 else if(mode==29) r=a>b?1.0:0.0;
 else if(mode==30) r=a<b?1.0:0.0;
 return ne_safe(r);
}
float ne_blend(float a,float b,int m) {
 if(m==1)return a+b; if(m==2)return a-b; if(m==3)return a*b;
 if(m==4)return 1.0-(1.0-a)*(1.0-b);
 if(m==5)return a<0.5?2.0*a*b:1.0-2.0*(1.0-a)*(1.0-b);
 if(m==6)return min(a,b); if(m==7)return max(a,b); if(m==8)return abs(a-b);
 if(m==9)return b<=0.5?a-(1.0-2.0*b)*a*(1.0-a):a+(2.0*b-1.0)*((a<=0.25?((16.0*a-12.0)*a+4.0)*a:sqrt(a))-a);
 if(m==10)return b>=1.0?1.0:min(1.0,a/(1.0-b));
 if(m==11)return b<=0.0?0.0:1.0-min(1.0,(1.0-a)/b);
 if(m==12)return a+2.0*b-1.0; if(m==13)return ne_div(a,b); if(m==14)return a+b-2.0*a*b;
 return b;
}
vec3 ne_mix(vec3 a,vec3 b,float f,int m) {
 vec3 r;
 if(m>=15) {vec3 x=ne_hsv(a),y=ne_hsv(b);r=ne_rgb(vec3(m==15||m==17?y.x:x.x,m==16||m==17?y.y:x.y,m==18?y.z:x.z));}
 else r=vec3(ne_blend(a.r,b.r,m),ne_blend(a.g,b.g,m),ne_blend(a.b,b.b,m));
 return mix(a,r,clamp(f,0.0,1.0));
}
float ne_hash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ne_noise(vec2 p) {
 vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(ne_hash(i),ne_hash(i+vec2(1,0)),f.x),mix(ne_hash(i+vec2(0,1)),ne_hash(i+vec2(1,1)),f.x),f.y);
}
vec3 ne_voronoi(vec2 p,float t) {
 vec2 cell=floor(p),f=fract(p),nearest=vec2(0.0),best=vec2(0.0);float f1=1.0e10,f2=f1;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) {
  vec2 g=vec2(float(x),float(y)),c=cell+g;
  vec2 point=0.5+0.5*sin(t+6.2831853*vec2(ne_hash(c),ne_hash(c+19.1)));
  vec2 r=g+point-f;float d=dot(r,r);
  if(d<f1){f2=f1;f1=d;nearest=r;best=g;}else if(d<f2)f2=d;
 }
 float edge=1.0e10;
 for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++) {
  vec2 g=best+vec2(float(x),float(y)),c=cell+g;
  vec2 r=g+0.5+0.5*sin(t+6.2831853*vec2(ne_hash(c),ne_hash(c+19.1)))-f;
  vec2 d=r-nearest;if(dot(d,d)>0.000001)edge=min(edge,dot(0.5*(nearest+r),normalize(d)));
 }
 return vec3(sqrt(f1),sqrt(f2),edge);
}


void main(){
 vec4 n0=ne_sample(vUv);
 vec4 n1=vec4(vec3((n0).a),1.0);
 float ne_alpha=clamp((n1).x,0.0,1.0);
 gl_FragColor=vec4((n0).rgb*ne_alpha,ne_alpha);
}
// @zoidium-node-effect {"version":1,"nodes":[{"id":"input","type":"layer","x":0,"y":0,"params":{}},{"id":"output","type":"output","x":320,"y":0,"params":{"alpha":1}}],"links":[{"id":"l0","from":{"node":"input","port":"color"},"to":{"node":"output","port":"color"}},{"id":"l1","from":{"node":"input","port":"alpha"},"to":{"node":"output","port":"alpha"}}]}
