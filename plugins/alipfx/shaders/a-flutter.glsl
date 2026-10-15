precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;

uniform float Loop_Duration;
uniform float Flutter_Speed;
uniform float Freq_Rotation;
uniform float Random_Seed;
uniform vec2  Position;
uniform float Uniform_Scale;
uniform float Scale_X;
uniform float Scale_Y;
uniform float Rotation_X;
uniform float Rotation_Y;
uniform float Rotation_Z;
uniform float Fold_Strength;
uniform float Fold_Travel;
uniform float Wobble_Amount;
uniform float Ripple_Amount;
uniform float Shading_Amount;
uniform float Enable_Loop;

varying vec2 vUv;
varying vec2 vUvScaled;

const float TAU = 6.28318530718;
const float COMP_REF = 2500.0;
const float KX = 6.2831853;
const float KY = 5.0;
const float KR = 14.0;

float g_ph, g_phF, g_phR, g_rCyc;
float g_foldA, g_rA, g_wA;
float g_s1, g_s2, g_s3, g_s4, g_s5, g_s6;

float hash(float n){ return fract(sin(n)*43758.5453123); }

// average of sin(k*t + ph) over t in [0,1] => used to make waves zero-mean
// so the sheet flutters IN PLACE instead of drifting with the traveling wave
float avgSin(float k, float ph){ return (cos(ph) - cos(k + ph)) / k; }

// forward paper deformation (fold can fold back on itself => mirrored fold-over)
float fxU(float u, float v){
  float x = u;
  float p1 = g_ph*g_rCyc + g_s1;
  float p3 = -g_phF - g_s3;
  float p4 = v*0.6*KR - g_phR - g_s4;
  x += g_wA*0.30*(sin(u*2.0 + p1) - avgSin(2.0, p1));
  x -= g_foldA*(sin(u*KX + p3) - avgSin(KX, p3));
  x += g_rA*(sin(u*KR + p4) - avgSin(KR, p4));
  return x;
}
float dfxU(float u, float v){
  float d = 1.0;
  d += g_wA*0.60*cos(u*2.0 + g_ph*g_rCyc + g_s1);
  d -= g_foldA*KX*cos(u*KX - g_phF - g_s3);
  d += g_rA*KR*cos(u*KR + v*0.6*KR - g_phR - g_s4);
  return d;
}
float fyV(float v, float u){
  float y = v;
  float p2 = g_ph*g_rCyc + g_s2;
  float p5 = -g_phF*0.9 - g_s5;
  float p6 = u*0.6*KR - g_phR*1.1 - g_s6;
  y += g_wA*0.22*(sin(v*2.0 + p2) - avgSin(2.0, p2));
  y -= g_foldA*0.35*(sin(v*KY + p5) - avgSin(KY, p5));
  y += g_rA*0.8*(sin(v*KR + p6) - avgSin(KR, p6));
  return y;
}
float dfyV(float v, float u){
  float d = 1.0;
  d += g_wA*0.44*cos(v*2.0 + g_ph*g_rCyc + g_s2);
  d -= g_foldA*0.35*KY*cos(v*KY - g_phF*0.9 - g_s5);
  d += g_rA*0.8*KR*cos(v*KR + u*0.6*KR - g_phR*1.1 - g_s6);
  return d;
}

mat3 rotXm(float a){ float c=cos(a), s=sin(a); return mat3(vec3(1.0,0.0,0.0), vec3(0.0,c,s), vec3(0.0,-s,c)); }
mat3 rotYm(float a){ float c=cos(a), s=sin(a); return mat3(vec3(c,0.0,-s), vec3(0.0,1.0,0.0), vec3(s,0.0,c)); }

void main()
{
  float loopDur = max(Loop_Duration, 0.01);
  float T  = (Enable_Loop > 0.5) ? mod(time, loopDur) : time;
  float u1 = T / loopDur;
  g_ph = TAU * u1;

  float fCyc = Flutter_Speed / 10.0;
  float rCyc = Freq_Rotation;          // tumble turns per loop (leaf "Tumble Rotations")
  float trCyc = Fold_Travel / 100.0;
  if (Enable_Loop > 0.5){
    fCyc  = max(1.0, floor(fCyc + 0.5));
    rCyc  = floor(rCyc + 0.5);
    trCyc = floor(trCyc + 0.5);
  }
  g_rCyc = rCyc;
  float fA  = max(1.0, floor(fCyc + 0.5));
  g_phF = TAU * u1 * (fCyc + trCyc);
  g_phR = TAU * u1 * max(1.0, floor(fCyc*1.6 + 0.5));

  float sd = Random_Seed;
  g_s1 = hash(sd+1.3)*TAU; g_s2 = hash(sd+2.1)*TAU; g_s3 = hash(sd+3.7)*TAU;
  g_s4 = hash(sd+4.9)*TAU; g_s5 = hash(sd+5.2)*TAU; g_s6 = hash(sd+6.8)*TAU;

  g_foldA = (Fold_Strength/100.0)*0.30;   // >100 => wilder crumple (leaf uses 999)
  g_rA    = (Ripple_Amount/100.0)*0.05;
  g_wA    = Wobble_Amount/100.0;          // >1 => flips over like falling paper

  // ---- 3D orientation: full tumble + wobble sway + user rotation ----
  float tumble = TAU * u1 * rCyc;
  float aX = radians(Rotation_X) + tumble*0.0
           + g_wA*(radians(35.0)*sin(g_ph*fA + g_s1) + radians(18.0)*sin(g_ph*max(rCyc,1.0) + g_s2));
  float aY = radians(Rotation_Y) + tumble
           + g_wA*(radians(50.0)*sin(g_ph*fA + g_s2 + 1.3));
  float aZ = radians(Rotation_Z);

  // ---- inverse transform: screen -> paper plane (with perspective) ----
  float asp = resolution.x / max(resolution.y, 1.0);
  vec2 p = (vUv - Position/COMP_REF) * vec2(asp, 1.0);
  float sx = max(Scale_X, 0.001), sy = max(Scale_Y, 0.001);
  vec2 sc = (Uniform_Scale > 0.5) ? vec2(sx) : vec2(sx, sy);
  p /= (sc/100.0);

  float cz = cos(aZ), sz = sin(aZ);
  p = mat2(cz, -sz, sz, cz) * p;

  mat3 RB = rotYm(aY) * rotXm(aX);
  vec3 ex = RB[0]; vec3 ey = RB[1];
  float a = ex.x, b = ex.y, c = ey.x, d = ey.y;
  float det = a*d - c*b;
  float backPlane = (det < 0.0) ? 1.0 : 0.0;   // back-facing => mirrored back side
  float ad = max(abs(det), 0.05);
  det = (det < 0.0) ? -ad : ad;
  mat2 Minv = mat2(d/det, -b/det, -c/det, a/det);

  vec2 q = Minv * p;                 // orthographic guess
  for (int i = 0; i < 2; i++){       // perspective refinement
    float z = ex.z*q.x + ey.z*q.y;
    float s = clamp(1.0 - z*0.6, 0.25, 3.0);
    q = Minv * (p * s);
  }
  q.x /= asp;
  q += 0.5;

  // ---- invert fold deformation (Newton) ----
  float u = q.x, v = q.y;
  for (int i = 0; i < 8; i++){
    float du = dfxU(u, v); du = (abs(du) < 0.2) ? ((du < 0.0) ? -0.2 : 0.2) : du;
    u -= clamp((fxU(u, v) - q.x)/du, -0.25, 0.25);
    float dv = dfyV(v, u); dv = (abs(dv) < 0.2) ? ((dv < 0.0) ? -0.2 : 0.2) : dv;
    v -= clamp((fyV(v, u) - q.y)/dv, -0.25, 0.25);
  }
  float backFold = (dfxU(u, v) < 0.0 || dfyV(v, u) < 0.0) ? 1.0 : 0.0;
  float back = max(backPlane, backFold);

  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0){
    gl_FragColor = vec4(0.0);
    return;
  }
  vec4 texel = texture2D(tDiffuse, vec2(u, v) * uvScale); // mirrored automatically when back

  // ---- shading from the same waves ----
  float w1 = u*KX - g_phF - g_s3;
  float w2 = v*KY - g_phF*0.9 - g_s5;
  float w3 = u*KR + v*0.6*KR - g_phR - g_s4;
  float dHdu = -g_foldA*0.9*KX*sin(w1) - g_rA*1.3*KR*sin(w3);
  float dHdv = -g_foldA*0.35*KY*sin(w2) - g_rA*1.3*0.6*KR*sin(w3);
  vec3 n = normalize(vec3(-dHdu*0.30, -dHdv*0.30, 1.0));
  n = RB * n;
  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  float diff = clamp(dot(n, L)*0.5 + 0.5, 0.0, 1.0);
  float spec = pow(clamp(dot(n, normalize(L + vec3(0.0,0.0,1.0))), 0.0, 1.0), 20.0);
  float shAmt = Shading_Amount/100.0;
  texel.rgb *= 1.0 + shAmt*((diff - 0.72)*1.1 + spec*0.6);
  if (back > 0.5) texel.rgb *= 0.8;  // back of the sheet slightly darker

  gl_FragColor = texel;
}
