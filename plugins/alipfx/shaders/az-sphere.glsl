precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

uniform float RotX;
uniform float RotY;
uniform float RotZ;
uniform float RotOrder;   // use float in Panzoid
uniform float Radius;
uniform vec2 Offset;
uniform float RenderMode; // 0 Both, 1 Outside, 2 Inside

#define PI 3.141592653589793

mat3 rotationMatrix(float x, float y, float z, int order) {
    float cx = cos(radians(x)), sx = sin(radians(x));
    float cy = cos(radians(y)), sy = sin(radians(y));
    float cz = cos(radians(z)), sz = sin(radians(z));

    mat3 Rx = mat3(
        1.0, 0.0, 0.0,
        0.0,  cx, -sx,
        0.0,  sx,  cx
    );

    mat3 Ry = mat3(
         cy, 0.0,  sy,
        0.0, 1.0, 0.0,
        -sy, 0.0,  cy
    );

    mat3 Rz = mat3(
         cz, -sz, 0.0,
         sz,  cz, 0.0,
        0.0, 0.0, 1.0
    );

    if(order==0) return Rz * Ry * Rx; // XYZ
    if(order==1) return Ry * Rz * Rx; // XZY
    if(order==2) return Rz * Rx * Ry; // YXZ
    if(order==3) return Rx * Rz * Ry; // YZX
    if(order==4) return Ry * Rx * Rz; // ZXY
    return Rx * Ry * Rz;              // ZYX
}

vec2 sphereToUV(vec3 p) {
    float theta = atan(p.x, p.z);                 // [-pi..pi]
    float phi   = acos(clamp(p.y, -1.0, 1.0));    // [0..pi]
    return vec2(theta / (2.0 * PI) + 0.5, phi / PI);
}

void main() {
    // Convert fragment position into sphere-plane coords
    vec2 uv = (vUvScaled * resolution - Offset) / max(Radius, 1e-6);

    float r2 = dot(uv, uv);
    if (r2 > 1.0) {
        gl_FragColor = vec4(0.0);
        return;
    }

    float z = sqrt(max(1.0 - r2, 0.0));

    // Front and back intersections on unit sphere
    vec3 pFront = vec3(uv.x, uv.y,  z);
    vec3 pBack  = vec3(uv.x, uv.y, -z);

    int order = int(floor(RotOrder + 0.5));
    mat3 rot = rotationMatrix(RotX, RotY, RotZ, order);

    pFront = rot * pFront;
    pBack  = rot * pBack;

    int mode = int(floor(RenderMode + 0.5)); // 0,1,2

    // UVs
    vec2 uvFront = sphereToUV(pFront);
    vec2 uvBack  = sphereToUV(pBack);

    // ✅ KEY FIX: prevent mirrored text on the back/inside surface
    // Flip U for the back face so it reads the same direction
    uvBack.x = fract(1.0 - uvBack.x);

    vec4 colFront = texture2D(tDiffuse, uvFront);
    vec4 colBack  = texture2D(tDiffuse, uvBack);

    // Outside only
    if (mode == 1) {
        gl_FragColor = colFront;
        return;
    }

    // Inside only
    if (mode == 2) {
        gl_FragColor = colBack;
        return;
    }

    // Both (front over back)
    gl_FragColor = colFront + (1.0 - colFront.a) * colBack;
}
