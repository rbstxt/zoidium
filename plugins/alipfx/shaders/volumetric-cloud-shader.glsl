precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUv;
varying vec2 vUvScaled;
uniform vec2 resolution;
uniform float time;

// ================= 67 PARAMETERS (names / defaults) =================
// Volume & Render Quality
uniform float Layer_Thickness;      // 2.00
uniform float Coverage_Density;     // 1.00
uniform float Absorption;           // 1.00
uniform float Scattering;           // 0.25
uniform float March_Steps;          // 80
uniform float Light_Steps;          // 10
// Manual Sun
uniform float Sun_X;                // 3.00
uniform float Sun_Y;                // 1.50
uniform float Sun_Z;                // 1.00
uniform vec3  Sun_Color;            // white
// Camera
uniform float Manual_Focal_Length;  // 550.00
uniform float Manual_Pitch;         // 40.00
uniform float Manual_Yaw;           // 45.00
// Cloud Shape & Motion
uniform float Wind_Speed;           // 3.00
uniform float Noise_Scale;          // 1.80
uniform float Detail;               // 55.00
uniform float Cloud_Coverage;       // 55.00
uniform float Cloud_Type;           // 80.00
uniform float Edge_Erosion;         // 12.00
uniform float Billow_Size;          // 1.15
uniform float Wind_Direction;       // 0.00
uniform float Altitude_Wind_Shear;  // 35.00
uniform float Turbulent_Evolution;  // 80.00
// Cloud Types & Layers
uniform float Cloud_Regime;         // 0 = Mixed,1 Cirrus,2 Cirrostratus,3 Cirrocumulus,4 Altocumulus,
                                    // 5 Altostratus,6 Nimbostratus,7 Stratocumulus,8 Stratus,9 Cumulus,10 Cumulonimbus
uniform float Mid_Level_Clouds;     // 55.00
uniform float High_Level_Clouds;    // 15.00
uniform float Storm_Development;    // 5.00
// Hero Cloud Tower
uniform float Tower_Development;    // 0.00
uniform float Tower_Width;          // 120.00
uniform float Cauliflower_Detail;   // 100.00
uniform float Tower_Position_X;     // 0.00
uniform float Tower_Distance;       // 150.00
uniform float Tower_Isolation;      // 70.00
// Rain & Virga
uniform float Enable_Rain;          // 0
uniform float Rain_Amount;          // 35.00
uniform float Rain_Prevalence;      // 65.00
uniform float Rain_Shaft_Detail;    // 65.00
uniform float Rain_Mist;            // 30.00
uniform float Virga_Evaporation;    // 45.00
uniform float Rain_Fall_Speed;      // 100.00
// Day Cycle & Sky
uniform float Enable_Time_Of_Day;   // 0
uniform float Day_Cycle_Phase;      // 35.00
uniform float Day_Cycle_Speed;      // 8.00
uniform float Sun_Path_Rotation;    // 0.00
uniform float Sun_Peak_Elevation;   // 65.00
uniform float Sky_Vibrancy;         // 130.00
uniform float Sky_Exposure;         // 100.00
uniform float Twilight_Vibrancy;    // 100.00
uniform float Twilight_Range;       // 120.00
uniform float Horizon_Haze;         // 60.00
uniform float Sun_Disc_Size;        // 100.00
uniform float Sun_Brightness;       // 100.00
uniform float Night_Brightness;     // 12.00
// Stars
uniform float Enable_Stars;         // 0
uniform float Star_Amount;          // 100.00
uniform float Star_Brightness;      // 130.00
uniform float Star_Twinkle;         // 30.00
// Moon
uniform float Enable_Moon;          // 0
uniform float Moon_Azimuth;         // 150.00
uniform float Moon_Elevation;       // 42.00
uniform float Moon_Drift_Speed;     // 0.00
uniform float Moon_Size;            // 100.00
uniform float Moon_Phase;           // 55.00
uniform float Moon_Brightness;      // 100.00
uniform float Moon_Glow;            // 50.00
uniform float Moon_Surface_Detail;  // 60.00
uniform float Moon_Earthshine;      // 4.00
// ====================================================================

// ---------- globals ----------
vec3  gSunDir; vec3 gSunCol; float gDay; float gWdir;
vec2  gAdv; vec2 gShearDir; float gEvolve;
float gBase; float gTop; float gCov; float gWispy; float gDark; float gFreq;
vec2  gTowerPos; float gTowerAmp; float gIso;

// ---------- noise ----------
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1.,0.)),u.x),
             mix(hash12(i+vec2(0.,1.)),hash12(i+vec2(1.,1.)),u.x),u.y);
}
float fbm(vec2 p, float oct){
  float s=0.0, a=0.55, t=0.0;
  for(int i=0;i<6;i++){
    if(float(i)>=oct) break;
    s+=a*vnoise(p); t+=a;
    p=p*2.07+vec2(19.13,7.7); a*=0.5;
  }
  return s/t;
}
vec2 rot2(vec2 p, float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c)*p; }
vec3 sphDir(float azDeg, float elDeg){
  float az=radians(azDeg), el=radians(elDeg);
  return vec3(cos(el)*cos(az), sin(el), cos(el)*sin(az));
}

// ---------- regime presets ----------
void regime(float r, out float covM, out float dark, out float baseM, out float thickM, out float wispy){
  covM=1.0; dark=0.25; baseM=1.0; thickM=1.0; wispy=0.25;
  if(r>0.5&&r<1.5){covM=0.55;dark=0.05;baseM=1.60;thickM=0.45;wispy=1.00;}
  else if(r<2.5){covM=0.80;dark=0.08;baseM=1.60;thickM=0.40;wispy=0.90;}
  else if(r<3.5){covM=0.60;dark=0.08;baseM=1.50;thickM=0.50;wispy=0.80;}
  else if(r<4.5){covM=0.75;dark=0.15;baseM=1.30;thickM=0.70;wispy=0.50;}
  else if(r<5.5){covM=0.95;dark=0.30;baseM=1.25;thickM=0.90;wispy=0.40;}
  else if(r<6.5){covM=1.25;dark=0.80;baseM=0.95;thickM=1.50;wispy=0.30;}
  else if(r<7.5){covM=0.90;dark=0.20;baseM=1.00;thickM=0.80;wispy=0.40;}
  else if(r<8.5){covM=1.15;dark=0.35;baseM=0.85;thickM=0.70;wispy=0.15;}
  else if(r<9.5){covM=0.70;dark=0.15;baseM=1.00;thickM=1.00;wispy=0.12;}
  else if(r<10.5){covM=0.85;dark=0.70;baseM=0.95;thickM=1.80;wispy=0.30;}
}

// ---------- density ----------
float densityLite(vec3 p){
  float hf = clamp((p.y-gBase)/(gTop-gBase),0.0,1.0);
  vec2 q = rot2(p.xz+gAdv+gShearDir*(hf*Altitude_Wind_Shear*0.03), -gWdir);
  q.x = mix(q.x, q.x*0.35, gWispy);
  q *= gFreq;
  float d = max(fbm(q,3.0)-(1.0-gCov),0.0);
  d *= smoothstep(0.0,0.2,hf)*(1.0-smoothstep(0.6,1.0,hf));
  return d*1.6;
}
float cloudDensity(vec3 p){
  float hf = clamp((p.y-gBase)/(gTop-gBase),0.0,1.0);
  vec2 q = p.xz + gAdv + gShearDir*(hf*Altitude_Wind_Shear*0.03);
  q += vec2(gEvolve*0.7, gEvolve*0.35);
  q = rot2(q, -gWdir);
  float w = gWispy;
  q.x = mix(q.x, q.x*0.35, w);
  q *= gFreq;
  float shape = fbm(q,4.0);
  float det = fbm(q*3.1+41.7, min(Detail*0.04,3.0));
  shape = shape*0.75 + det*(0.10+0.25*Detail*0.01);
  float ridge = 1.0-abs(shape*2.0-1.0);
  shape = mix(shape, ridge*ridge, w*0.7);
  float d = max(shape-(1.0-gCov), 0.0);
  float ero = Edge_Erosion*0.01;
  float en = fbm(q*(2.5/max(Billow_Size,0.1))+vec2(gEvolve),3.0);
  d -= ero*0.55*en*smoothstep(0.0,0.35,d)*(1.0-smoothstep(0.35,0.8,d));
  d = max(d,0.0);
  d *= smoothstep(0.0,0.2,hf)*(1.0-smoothstep(mix(0.6,1.0,w),1.0,hf));
  d *= 0.8+0.4*vnoise(q*(4.0/max(Billow_Size,0.1))+vec2(gEvolve*2.0,0.0));
  // mid + high layers
  float midN = max(fbm(q*1.6+7.7,3.0)-(1.0-gCov*Mid_Level_Clouds*0.012),0.0);
  d += midN*smoothstep(0.25,0.5,hf)*(1.0-smoothstep(0.7,0.95,hf))*0.8;
  vec2 qh = vec2(q.x*0.3,q.y);
  float hi = 1.0-abs(fbm(qh+3.3,3.0)*2.0-1.0);
  d += max(hi*hi-(1.0-High_Level_Clouds*0.012),0.0)*smoothstep(0.55,0.85,hf)*1.2;
  // hero tower
  if(gTowerAmp>0.001){
    float r = length(p.xz-gTowerPos);
    d *= 1.0-gIso*exp(-r*r*0.02);
    float col = 1.0-smoothstep(Tower_Width*0.005, Tower_Width*0.012, r);
    float tTop = gTop + gTowerAmp*2.5;
    float cauli = fbm(p.xz*(1.5+Cauliflower_Detail*0.04)+vec2(p.y*3.0),3.0);
    d += col*smoothstep(tTop, gBase+0.3, p.y)*(0.5+0.8*cauli)*gTowerAmp;
  }
  return d*1.6;
}
float rainDensity(vec3 p){
  float hN = clamp(p.y/gBase,0.0,1.0);
  vec2 rq = rot2(p.xz, -gWdir);
  float fall = time*Rain_Fall_Speed*0.06;
  float streak = pow(vnoise(vec2(rq.x*(2.0+Rain_Shaft_Detail*0.06), rq.y*0.7-fall)),3.0);
  float m = smoothstep(0.0,0.25, fbm(rot2(p.xz,-gWdir)*gFreq,3.0)-(1.0-gCov));
  float virga = Virga_Evaporation*0.01;
  float bottom = mix(0.05,0.85,virga);
  float fade = smoothstep(bottom, bottom+0.25, hN);
  float mist = Rain_Mist*0.01*0.35*m;
  return (streak*Rain_Amount*0.02*Rain_Prevalence*0.015*m*fade + mist*fade);
}
float lightEnergy(vec3 p){
  float acc=0.0; int ls=int(Light_Steps);
  float st = 0.18+0.05*(gTop-gBase);
  for(int i=0;i<80;i++){
    if(i>=ls) break;
    vec3 lp = p+gSunDir*(st*float(i+1));
    if(lp.y>gTop+2.0) break;
    if(lp.y>gBase) acc += densityLite(lp)*st;
  }
  return acc;
}

// ---------- sky ----------
vec3 renderSky(vec3 rd){
  float el = gSunDir.y; float day = gDay;
  vec3 zen = mix(vec3(0.004,0.006,0.015), vec3(0.09,0.28,0.62), day);
  vec3 hor = mix(vec3(0.010,0.014,0.030), vec3(0.45,0.62,0.85), day);
  zen = mix(vec3(dot(zen,vec3(0.333))), zen, Sky_Vibrancy*0.01);
  float h = clamp(rd.y,-1.0,1.0);
  vec3 col = mix(hor, zen, pow(clamp(h,0.0,1.0),0.55));
  col = mix(col, hor, clamp(Horizon_Haze*0.01,0.0,1.0)*exp(-max(h,0.0)*5.0));
  float tw = (1.0-smoothstep(0.0,0.12+Twilight_Range*0.003,abs(el)))*smoothstep(-0.25-Twilight_Range*0.002,-0.05,el);
  col += vec3(1.0,0.42,0.18)*(Twilight_Vibrancy*0.01)*tw*pow(1.0-abs(h),2.0)*0.3;
  col = mix(col, mix(vec3(0.02),vec3(0.32,0.34,0.36),day), smoothstep(0.0,-0.15,h));
  float sd = clamp(dot(rd,gSunDir),0.0,1.0);
  float sz = max(Sun_Disc_Size*0.01,0.05);
  col += gSunCol*(smoothstep(cos(0.02*sz),cos(0.018*sz),sd)*2.0
        + pow(sd,120.0/sz)*0.25 + pow(sd,8.0)*0.08)*Sun_Brightness*0.01*max(day,0.15);
  col *= Sky_Exposure*0.01;
  col += vec3(0.002,0.003,0.006)*Night_Brightness*(1.0-day);
  return col;
}

void main(){
  // camera ray
  vec2 ndc = (vUv-0.5)*2.0;
  ndc.x *= resolution.x/resolution.y;
  vec3 rd = normalize(vec3(ndc, Manual_Focal_Length*0.01));
  rd.yz = rot2(rd.yz, radians(Manual_Pitch));
  rd.xz = rot2(rd.xz, radians(Manual_Yaw));

  // sun
  if(Enable_Time_Of_Day>0.5){
    float ph = radians(Day_Cycle_Phase) + time*Day_Cycle_Speed*0.002;
    float el = sin(ph)*radians(Sun_Peak_Elevation);
    float az = ph + radians(Sun_Path_Rotation);
    gSunDir = normalize(vec3(cos(el)*cos(az), sin(el), cos(el)*sin(az)));
  } else {
    gSunDir = normalize(vec3(Sun_X, Sun_Y, Sun_Z));
  }
  gSunCol = Sun_Color;
    gDay = smoothstep(0.0, 0.22, gSunDir.y);   // was (-0.08, 0.15) -> transition gets dark sooner

  // wind / evolution / regime
  gWdir = radians(Wind_Direction);
  vec2 wv = vec2(cos(gWdir), sin(gWdir));
  gAdv = wv*Wind_Speed*time*0.02;
  gShearDir = wv;
  gEvolve = time*(0.01+Turbulent_Evolution*0.0006);
  float covM,dark,baseM,thickM,wispR;
  regime(Cloud_Regime, covM, dark, baseM, thickM, wispR);
  gDark = clamp(dark+Storm_Development*0.006,0.0,1.0);
  gBase = 1.5*baseM;
  gTop  = gBase + (1.0+Layer_Thickness)*thickM*1.5;
  gCov  = clamp(Cloud_Coverage*0.01*Coverage_Density*covM + Storm_Development*0.003, 0.0, 1.5);
  gWispy = clamp(wispR + (1.0-Cloud_Type*0.01)*0.2, 0.0, 1.0);
  gFreq = 0.45*Noise_Scale;
  float yaw = radians(Manual_Yaw);
  vec2 fwd = vec2(-sin(yaw), cos(yaw));
  vec2 rgt = vec2( cos(yaw), sin(yaw));
  gTowerPos = fwd*Tower_Distance*0.05 + rgt*Tower_Position_X*0.05;
  gTowerAmp = Tower_Development*0.01;
  gIso = Tower_Isolation*0.01;

  vec3 col = renderSky(rd);

  // stars
  // stars - only appear once the sky is actually dark
  if(Enable_Stars>0.5){
    float night = 1.0 - smoothstep(-0.04, 0.08, gSunDir.y);
    if(night>0.001){
      vec2 g = vec2(atan(rd.z,rd.x)*2.0, rd.y*3.0)*(30.0+Star_Amount*0.5);
      vec2 cell = floor(g);
      float hsh = hash12(cell);
      float star = step(1.0-(0.02+Star_Amount*0.0015), hsh);
      float dotp = smoothstep(0.15,0.0,length(fract(g)-0.5));
      float twk = 1.0-Star_Twinkle*0.01*(0.5+0.5*sin(time*(2.0+hsh*6.0)+hsh*40.0));
      col += vec3(1.0,0.95,0.85)*star*dotp*twk*Star_Brightness*0.015*night;
    }
  }

  // moon - hidden during the day, rises again at night, OCCLUDES stars
  if(Enable_Moon>0.5){
    float moonVis = 1.0 - smoothstep(-0.03, 0.12, gSunDir.y);
    if(moonVis>0.001){
      float maz = Moon_Azimuth + time*Moon_Drift_Speed*0.05;
      float mel = mix(-25.0, Moon_Elevation, moonVis);
      vec3 md = sphDir(maz, mel);
      float m = dot(rd,md);
      float ang = radians(1.5)*Moon_Size*0.01;
      float night = moonVis;

      // opaque disc first - covers stars/sky behind it (anti-aliased rim)
      if(m>cos(ang)){
        vec3 upv = normalize(vec3(0.0001,1.0,0.0001)-md*md.y);
        vec3 rv = normalize(cross(upv,md));
        vec3 uv2 = cross(md,rv);
        vec2 dxy = vec2(dot(rd,rv),dot(rd,uv2))/sin(ang);
        float illum = clamp(Moon_Phase*0.01,0.0,1.0);
        float xt = cos(illum*3.14159);
        vec2 ldir = vec2(cos(2.0),sin(2.0));
        vec2 r2 = vec2(dot(dxy,ldir), dot(dxy,vec2(-ldir.y,ldir.x)));
        float lit = smoothstep(-0.06,0.06, r2.x - xt*sqrt(max(1.0-r2.y*r2.y,0.0)));
        float cr = fbm(dxy*(1.0+Moon_Surface_Detail*0.06)+3.1, 3.0);
        float alb = 0.7+0.5*cr;
        vec3 mc = (vec3(alb)*lit*Moon_Brightness*0.012
                + vec3(0.10,0.13,0.20)*(1.0-lit)*Moon_Earthshine*0.01)*night;
        float edge = smoothstep(cos(ang), cos(ang*0.985), m); // 0 at rim -> 1 inside
        col = mix(col, mc, edge);   // stars behind the moon are now hidden
      }

      // glow stays additive (it's light, drawn on top)
      col += vec3(0.8,0.85,1.0)*pow(max(m,0.0), 80.0/max(Moon_Glow*0.02,0.2))*Moon_Glow*0.008*night;
    }
  }

  // volumetric march (camera at origin)
  bool doRain = Enable_Rain>0.5 && rd.y>0.004;
  float tA=-1.0, tB=-1.0;
  if(rd.y>0.004){
    tA = gBase/rd.y;
    tB = (gTop+gTowerAmp*2.5)/rd.y;
  }
  float start = doRain? 0.15 : tA;
  float end = max(tB, doRain? gBase/rd.y : -1.0);
  if(end>0.0 && (tB>0.0 || doRain)){
    int ms = int(March_Steps);
    float step = (end-start)/float(ms);
    float trans = 1.0;
    vec3 acc = vec3(0.0);
    float sunUp  = smoothstep(-0.15, 0.10, gSunDir.y);
    vec3 sunTint = mix(vec3(1.0,0.45,0.25), gSunCol, smoothstep(0.02,0.25,gSunDir.y));
    for(int i=0;i<200;i++){
      if(i>=ms) break;
      vec3 p = rd*(start+(float(i)+0.5)*step);
      bool isRain = p.y<gBase;
      float d = isRain? rainDensity(p) : cloudDensity(p);
      if(d>0.001){
        float le;
        if(isRain){ le = 0.5; }
        else{
          float occ = lightEnergy(p);
          le = exp(-occ*Absorption*0.55)*(1.0+0.6*exp(-occ*0.35));
        }
        vec3 lc = sunTint*le*Scattering*3.0*(0.02+0.98*sunUp)                 // direct sun, gated + warm at twilight
                + vec3(0.25,0.32,0.42)*Scattering*2.0*(0.03+0.97*sunUp)       // sky ambient, gated
                + vec3(0.03,0.04,0.07)*(1.0-sunUp);                           // tiny night ambient
        lc *= mix(vec3(1.0), vec3(0.55,0.60,0.68), gDark);
        acc += trans*lc*d*step;
        trans *= exp(-d*step*Absorption*0.9);
        if(trans<0.03){ trans=0.0; break; }
      }
    }
     float opac = (1.0-trans)*mix(0.08, 1.0, smoothstep(-0.20, 0.05, gSunDir.y));
    col = acc + (1.0-opac)*col;
  }

  col = 1.0-exp(-col*1.4);
  gl_FragColor = vec4(col,1.0);
}
