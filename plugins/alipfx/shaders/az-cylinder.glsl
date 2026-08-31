precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;

/* ----------- User properties ----------- */
uniform float Radius_percent;      // % of comp height (100 -> radius = half height)
uniform float Position_X;          // pixels
uniform float Position_Y;          // pixels
uniform float Position_Z;          // pixels (positive = toward camera)

uniform vec3  Rotation_degs;       // degrees
uniform float Rotation_Order_f;    // 0..5
uniform float Render_Mode_f;       // 0=Full, 1=Outside, 2=Inside

const float PI = 3.141592653589793;

/* ----------- Helpers ----------- */
float d2r(float d){ return d * PI / 180.0; }

mat3 rotX(float a){
  float c=cos(a), s=sin(a);
  return mat3(
    1.0,0.0,0.0,
    0.0,c,-s,
    0.0,s,c
  );
}
mat3 rotY(float a){
  float c=cos(a), s=sin(a);
  return mat3(
     c,0.0,s,
     0.0,1.0,0.0,
    -s,0.0,c
  );
}
mat3 rotZ(float a){
  float c=cos(a), s=sin(a);
  return mat3(
    c,-s,0.0,
    s, c,0.0,
    0.0,0.0,1.0
  );
}

mat3 composeRotation(int o, vec3 a){
  mat3 RX=rotX(a.x), RY=rotY(a.y), RZ=rotZ(a.z);
  if(o==0) return RZ*RY*RX; // XYZ
  if(o==1) return RY*RZ*RX; // XZY
  if(o==2) return RZ*RX*RY; // YXZ
  if(o==3) return RX*RZ*RY; // YZX
  if(o==4) return RY*RX*RZ; // ZXY
  return RX*RY*RZ;          // ZYX
}

mat3 transpose3(mat3 m){
  return mat3(
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2]
  );
}

vec4 over(vec4 A, vec4 B){
  return A + (1.0 - A.a) * B;
}

// Sample cylinder at t in cylinder-local space
vec4 sampleCylinder(vec3 ro, vec3 rd, float t, bool backFace){
  vec3 ph = ro + rd * t;  // cylinder-local hit point

  // ✅ FIX #1: Correct cylinder wrap angle (around Y axis)
  float u = atan(ph.x, ph.z) / (2.0 * PI) + 0.5;

  // ✅ FIX #2: Push seam behind the cylinder so it doesn't cut your text
  // (Half turn shift; you can remove +0.5 if you prefer original seam position)
  u = fract(u + 0.5);

  // ✅ Keep inside readable (no mirrored text)
  if(backFace){
    u = fract(1.0 - u);
  }

  // Rigid 3D V mapping (y in [-1..1] maps to v in [0..1])
  float v = 0.5 - 0.5 * ph.y;
  if(v < 0.0 || v > 1.0) return vec4(0.0);

  return texture2D(tDiffuse, vec2(u, v));
}

void main(){
  int rotOrder   = int(floor(Rotation_Order_f + 0.5));
  int renderMode = int(floor(Render_Mode_f + 0.5));

  float aspect = resolution.x / resolution.y;

  // Camera at +Z looking toward screen plane at z=0
  float camDist = 2.0;

  vec2 uv = vUvScaled;
  vec2 screen = (uv - 0.5) * vec2(aspect * 2.0, 2.0);

  vec3 rayOrigin = vec3(0.0, 0.0, camDist);
  vec3 target    = vec3(screen.x, -screen.y, 0.0);
  vec3 rayDir    = normalize(target - rayOrigin);

  // Cylinder center (pixels -> world units)
  vec3 cylCenter = vec3(
    ((Position_X / resolution.x) - 0.5) * (aspect * 2.0),
    -((Position_Y / resolution.y) - 0.5) * 2.0,
    (Position_Z / resolution.y) * 2.0
  );

  // Radius: 100% = radius of 1.0 (half height)
  float R = max(0.001, (Radius_percent * 0.01) * 1.0);

  vec3 ang = vec3(d2r(Rotation_degs.x), d2r(Rotation_degs.y), d2r(Rotation_degs.z));
  mat3 Rm = composeRotation(rotOrder, ang);
  mat3 Ri = transpose3(Rm);

  // Ray into cylinder local
  vec3 ro = Ri * (rayOrigin - cylCenter);
  vec3 rd = Ri * rayDir;

  // Intersect infinite cylinder (axis Y)
  vec2 roxz = ro.xz;
  vec2 rdxz = rd.xz;

  float a = dot(rdxz, rdxz);
  float b = 2.0 * dot(roxz, rdxz);
  float c = dot(roxz, roxz) - R * R;
  float d = b*b - 4.0*a*c;

  if(d < 0.0 || a < 1e-8){
    gl_FragColor = vec4(0.0);
    return;
  }

  float sqrtD = sqrt(d);
  float tNear = (-b - sqrtD) / (2.0*a);
  float tFar  = (-b + sqrtD) / (2.0*a);

  if(tFar < 0.0){
    gl_FragColor = vec4(0.0);
    return;
  }

  if(tNear > tFar){
    float tmp = tNear; tNear = tFar; tFar = tmp;
  }

  bool hasNear = (tNear > 0.0);
  bool hasFar  = (tFar  > 0.0);

  // Outside only
  if(renderMode == 1){
    if(!hasNear){ gl_FragColor = vec4(0.0); return; }
    gl_FragColor = sampleCylinder(ro, rd, tNear, false);
    return;
  }

  // Inside only
  if(renderMode == 2){
    if(!hasFar){ gl_FragColor = vec4(0.0); return; }
    gl_FragColor = sampleCylinder(ro, rd, tFar, true);
    return;
  }

  // Full: both sides (front over back)
  vec4 colFront = hasNear ? sampleCylinder(ro, rd, tNear, false) : vec4(0.0);
  vec4 colBack  = hasFar  ? sampleCylinder(ro, rd, tFar,  true)  : vec4(0.0);

  gl_FragColor = over(colFront, colBack);
}
