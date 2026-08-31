precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

uniform float Property;
uniform float Softness;
uniform float Height;
uniform float Displacement;

varying vec2 vUvScaled;

/* ===============================
   Channel selector (AE-style)
================================ */
float pickProperty(vec4 c)
{
    int p = int(Property + 0.5);

    if (p == 1) return c.r;
    if (p == 2) return c.g;
    if (p == 3) return c.b;
    if (p == 4) return c.a;
    if (p == 5) return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));

    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    return (mx + mn) * 0.5;
}

/* ===============================
   Height field with blur/sharpen
================================ */
float heightField(vec2 uv)
{
    float s = Softness;
    float center = pickProperty(texture2D(tDiffuse, uv));

    float hL = pickProperty(texture2D(tDiffuse, uv - vec2(1.0/resolution.x, 0.0)));
    float hR = pickProperty(texture2D(tDiffuse, uv + vec2(1.0/resolution.x, 0.0)));
    float hU = pickProperty(texture2D(tDiffuse, uv + vec2(0.0, 1.0/resolution.y)));
    float hD = pickProperty(texture2D(tDiffuse, uv - vec2(0.0, 1.0/resolution.y)));

    float blur = (hL + hR + hU + hD) * 0.25;

    if (s > 0.0) {
        return mix(center, blur, clamp(s, 0.0, 1.0));
    } else if (s < 0.0) {
        return mix(center, center + (center - blur), clamp(-s, 0.0, 1.0));
    } else {
        return center;
    }
}

/* ===============================
   Surface normal (HQ)
================================ */
vec3 surfaceNormal(vec2 uv)
{
    vec2 px = 1.0 / resolution;

    float hL = heightField(uv - vec2(px.x, 0.0));
    float hR = heightField(uv + vec2(px.x, 0.0));
    float hD = heightField(uv - vec2(0.0, px.y));
    float hU = heightField(uv + vec2(0.0, px.y));

    vec2 grad = vec2(hR - hL, hU - hD) * 0.5;

    return normalize(vec3(-grad * Height * 0.1, 1.0));
}

/* ===============================
   Main
================================ */
void main()
{
    vec2 uv = vUvScaled;
    vec3 n = surfaceNormal(uv);

    // --- Distortion (refraction-like) ---
    vec2 offset = vec2(0.0);
    if (Displacement != 0.0) {
        offset = n.xy * (Displacement / resolution.y);
    }
    vec4 base = texture2D(tDiffuse, uv + offset);

    // --- Edge gating ---
    float edge = length(n.xy);
    edge = smoothstep(0.015, 0.12, edge);

    // --- Lighting ---
    vec3 lightDir = normalize(vec3(-0.4, -0.6, 1.0));
    vec3 viewDir  = vec3(0.0, 0.0, 1.0);

    float diff = max(dot(n, lightDir), 0.0) * edge;

    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(n, halfDir), 0.0), 64.0) * edge; // sharper specular

    // --- Fresnel reflection ---
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

    // --- Final shading ---
    vec3 result =
        base.rgb * 0.9 +              // slightly darkened base
        diff * 0.35 +                 // diffuse shading
        spec * 1.2 +                  // specular highlight
        fresnel * 0.4;                // reflective sheen

    gl_FragColor = vec4(result, base.a);
}
