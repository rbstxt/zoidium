precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;

uniform float Scopes;
uniform float Trace_Brightness;
uniform float Trace_Opacity;
uniform float Show_Graticule;
uniform float Show_Labels;
uniform float Graticule_Lines;
uniform float Label_Start;
uniform float Label_Interval;
uniform vec3  Background;
uniform float Background_Opacity;

#define NW   192   // waveform vertical samples (quality/speed)
#define NH   96    // histogram / vectorscope grid (quality/speed)
#define MAXL 40    // max graticule lines

float luma709(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 sampleImg(vec2 p){ return texture2D(tDiffuse, p * uvScale).rgb; }

/* ---------- tiny 3x5 digit font (for labels) ---------- */
float rows5(float a,float b,float c,float d,float e,float r){
  if(r<0.5) return a;
  if(r<1.5) return b;
  if(r<2.5) return c;
  if(r<3.5) return d;
  return e;
}
float drow(float d,float r){
  if(d<0.5) return rows5(7.,5.,5.,5.,7.,r);
  if(d<1.5) return rows5(2.,6.,2.,2.,7.,r);
  if(d<2.5) return rows5(7.,1.,7.,4.,7.,r);
  if(d<3.5) return rows5(7.,1.,7.,1.,7.,r);
  if(d<4.5) return rows5(5.,5.,7.,1.,1.,r);
  if(d<5.5) return rows5(7.,4.,7.,1.,7.,r);
  if(d<6.5) return rows5(7.,4.,7.,5.,7.,r);
  if(d<7.5) return rows5(7.,1.,1.,1.,7.,r);
  if(d<8.5) return rows5(7.,5.,7.,5.,7.,r);
  return rows5(7.,5.,7.,1.,7.,r);
}
/* q in cell units: 11 wide (3 digits right aligned), 5 tall */
float textMask(vec2 q, float value){
  if(q.x<0.0||q.y<0.0||q.x>=11.0||q.y>=5.0) return 0.0;
  float val = clamp(floor(value+0.5), 0.0, 999.0);
  float cx = floor(q.x); float ry = floor(q.y);
  float col = mod(cx,4.0);
  if(col>2.5) return 0.0;
  float L = floor(cx/4.0);          // 0..2 left->right
  float posR = 2.0-L;               // position from right
  float n = 1.0 + step(9.5,val) + step(99.5,val);
  if(posR>=n) return 0.0;
  float digit = mod(floor(val*pow(10.0,-posR)),10.0);
  float row = drow(digit, ry);
  return mod(floor(row*pow(2.0,2.0-col)),2.0);
}

void main()
{
  vec2 P = vUv * resolution;
  float W = resolution.x, H = resolution.y;
  int scope = int(floor(Scopes+0.5));

  vec3 acc = vec3(0.0);      // raw trace accumulation (color)
  float yv = clamp(vUv.y,0.0,1.0);
  float xv = vUv.x;

  /* parade panel mapping */
  float panel = floor(xv*3.0);
  float local = fract(xv*3.0);
  bool inPanel = local>0.04 && local<0.96;
  float xImg = clamp((local-0.04)/0.92, 0.0, 1.0);

  float kw = H*0.5;  // 2-px triangle kernel (value space)

  if(scope==0){                                   // Luma waveform
    for(int i=0;i<NW;i++){
      float v=(float(i)+0.5)/float(NW);
      float l=luma709(sampleImg(vec2(xv,v)));
      acc += vec3(max(0.0,1.0-abs(l-yv)*kw));
    }
  }
  else if(scope==1){                              // RGB parade
    if(inPanel) for(int i=0;i<NW;i++){
      float v=(float(i)+0.5)/float(NW);
      vec3 c=sampleImg(vec2(xImg,v));
      float val = panel<0.5?c.r : (panel<1.5?c.g:c.b);
      float k=max(0.0,1.0-abs(val-yv)*kw);
      acc += panel<0.5?vec3(k,0.,0.) : (panel<1.5?vec3(0.,k,0.):vec3(0.,0.,k));
    }
  }
  else if(scope==2){                              // RGB overlay
    for(int i=0;i<NW;i++){
      float v=(float(i)+0.5)/float(NW);
      vec3 c=sampleImg(vec2(xv,v));
      acc += vec3(max(0.0,1.0-abs(c.r-yv)*kw),
                  max(0.0,1.0-abs(c.g-yv)*kw),
                  max(0.0,1.0-abs(c.b-yv)*kw));
    }
  }
  else if(scope==3){                              // YCbCr parade
    if(inPanel) for(int i=0;i<NW;i++){
      float v=(float(i)+0.5)/float(NW);
      vec3 c=sampleImg(vec2(xImg,v));
      float y=luma709(c);
      float cb=(c.b-y)/1.8556+0.5;
      float cr=(c.r-y)/1.5748+0.5;
      float val = panel<0.5?y : (panel<1.5?cb:cr);
      float k=max(0.0,1.0-abs(val-yv)*kw);
      acc += panel<0.5?vec3(k) : (panel<1.5?vec3(0.15*k,0.35*k,k):vec3(k,0.12*k,0.15*k));
    }
  }
  else if(scope==4){                              // Vectorscope
    for(int i=0;i<NH;i++) for(int j=0;j<NH;j++){
      vec2 q=(vec2(float(i),float(j))+0.5)/float(NH);
      vec3 c=sampleImg(q);
      float y=luma709(c);
      vec2 pt=vec2(0.5+(c.b-y)/1.8556*1.1, 0.5+(c.r-y)/1.5748*1.1);
      float d=length((pt-vUv)*resolution);
      acc += vec3(max(0.0,1.0-d*0.5));
    }
  }
  else if(scope==5){                              // Histogram luma
    float a=0.0;
    for(int i=0;i<NH;i++) for(int j=0;j<NH;j++){
      vec2 q=(vec2(float(i),float(j))+0.5)/float(NH);
      float l=luma709(sampleImg(q));
      a += max(0.0,1.0-abs(l-xv)*48.0);
    }
    float h=clamp(a*80.0/float(NH*NH),0.0,1.0);
    acc = vec3(clamp((h-yv)*200.0,0.0,1.0));
  }
  else if(scope==6 || scope==7){                  // Histogram RGB (parade/overlay)
    float aR=0.0,aG=0.0,aB=0.0;
    for(int i=0;i<NH;i++) for(int j=0;j<NH;j++){
      vec2 q=(vec2(float(i),float(j))+0.5)/float(NH);
      vec3 c=sampleImg(q);
      aR+=max(0.0,1.0-abs(c.r-xv)*48.0);
      aG+=max(0.0,1.0-abs(c.g-xv)*48.0);
      aB+=max(0.0,1.0-abs(c.b-xv)*48.0);
    }
    vec3 h=clamp(vec3(aR,aG,aB)*80.0/float(NH*NH),0.0,1.0);
    if(scope==6){
      float band=floor(yv*3.0); float ly=fract(yv*3.0);
      float hb = band<0.5?h.r : (band<1.5?h.g:h.b);
      float on = ly>0.03 ? clamp((hb-ly)*200.0,0.0,1.0) : 0.0;
      acc = band<0.5?vec3(on,0.,0.) : (band<1.5?vec3(0.,on,0.):vec3(0.,0.,on));
    } else {
      acc = vec3(clamp((h.r-yv)*200.0,0.0,1.0),
                 clamp((h.g-yv)*200.0,0.0,1.0),
                 clamp((h.b-yv)*200.0,0.0,1.0));
    }
  }

  /* trace shaping: brightness + opacity */
  vec3 emit = vec3(1.0)-exp(-acc*max(Trace_Brightness,0.0)*0.45);
  float alpha = max(emit.r,max(emit.g,emit.b));

  /* ---------- graticule + labels ---------- */
  float gA = 0.0; vec3 gC = vec3(0.75);
  float labA = 0.0;
  if(Show_Graticule>0.5){
    float lines = clamp(Graticule_Lines,2.0,float(MAXL));
    float s = max(1.0, floor(H/270.0));      // label pixel scale
    if(scope<=3){
      for(int i=0;i<MAXL;i++){
        float fi=float(i);
        if(fi>=lines) break;
        float f=fi/(lines-1.0);
        float yp=f*H;
        if(abs(P.y-yp)<1.0) gA=max(gA,0.30);
        if(Show_Labels>0.5){
          float vl = Label_Start + fi*Label_Interval;
          float vr = floor(255.0*f+0.5);
          labA=max(labA, textMask((P-vec2(3.0, H-yp-2.5*s))/s, vl)*0.6);
          labA=max(labA, textMask((P-vec2(W-3.0-11.0*s, H-yp-2.5*s))/s, vr)*0.6);
        }
      }
      if(abs(xv*3.0-1.0)<0.02||abs(xv*3.0-2.0)<0.02) gA=max(gA,0.3*(scope==1||scope==3?1.0:0.0));
    } else if(scope>=5){
      for(int i=0;i<MAXL;i++){
        float fi=float(i);
        if(fi>=lines) break;
        float f=fi/(lines-1.0);
        float xp=f*W;
        if(abs(P.x-xp)<1.0) gA=max(gA,0.30);
        if(Show_Labels>0.5){
          float vr=floor(255.0*f+0.5);
          labA=max(labA, textMask((P-vec2(xp-5.5*s, H-9.0*s))/s, vr)*0.6);
        }
      }
    } else { // vectorscope: circle + cross + skin line
      vec2 c=(vUv-0.5)*vec2(W,H)/min(W,H);
      if(abs(length(c)-0.42)<1.5/min(W,H)*min(W,H)*0.002+0.004) gA=max(gA,0.3);
      if(abs(c.x)<0.004||abs(c.y)<0.004) gA=max(gA,0.3);
      if(abs(c.y-c.x*1.5)<0.006 && c.x>0.0) gA=max(gA,0.25);
    }
    if(P.x<1.0||P.y<1.0||P.x>W-1.0||P.y>H-1.0) gA=max(gA,0.35); // border
  }

  /* ---------- composite: trace over graticule over background (premul) ---------- */
  float aT = clamp(alpha,0.0,1.0)*clamp(Trace_Opacity,0.0,1.0);
  float aG = clamp(gA+labA,0.0,1.0);
  vec3  cG = gC*aG;
  vec3  c2 = cG*(1.0-aT) + emit*aT;
  float a2 = aG*(1.0-aT) + aT;
  float aB = clamp(Background_Opacity,0.0,1.0);
  vec3  fin = c2 + Background*aB*(1.0-a2);
  float finA = a2 + aB*(1.0-a2);

  gl_FragColor = vec4(fin, finA);
}
