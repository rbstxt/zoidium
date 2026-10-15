precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;

// === 11 PARAMETERS ===
uniform float Protons;
uniform float Neutrons;
uniform vec4 Electrons_per_shell;
uniform float Particles;
uniform float Electron_Speed;
uniform float Orbit_Spacing;
uniform float Orbit_1_Distance;
uniform float Electron_Size;
uniform float Nucleon_Size;
uniform float Nucleus_Size;
uniform float Seed;

// --- Utility Functions ---
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Soft circle with anti-aliasing
float softCircle(vec2 p, vec2 center, float radius) {
    float d = length(p - center);
    return smoothstep(radius, radius * 0.1, d);
}

// Dashed ring for orbit paths
float dashedRing(vec2 p, float radius, float numDashes, float dashRatio) {
    float d = length(p);
    float ringWidth = 0.002;
    float ring = smoothstep(radius + ringWidth, radius - ringWidth * 0.5, d) -
                 smoothstep(radius - ringWidth * 0.5, radius - ringWidth * 1.5, d);

    float angle = atan(p.y, p.x);
    float a = mod(angle + 6.28318, 6.28318);
    float segAngle = 6.28318 / max(numDashes, 1.0);
    float posInSeg = mod(a, segAngle);
    float dash = step(posInSeg, segAngle * dashRatio);

    return ring * dash;
}

// Particle style shading
vec3 applyParticleStyle(vec3 baseColor, float dist, float radius, float style) {
    vec3 col = baseColor;
    float normDist = dist / max(radius, 0.001);

    if (style < 0.5) {
        // 0: Classic
        col *= (1.0 - normDist * 0.3);
    } else if (style < 1.5) {
        // 1: Glossy
        float spec = pow(max(1.0 - normDist, 0.0), 8.0);
        float diff = max(1.0 - normDist * 0.5, 0.0);
        col = col * diff * 0.5 + vec3(1.0) * spec * 0.8;
    } else if (style < 2.5) {
        // 2: Matte
        col *= 0.78;
    } else if (style < 3.5) {
        // 3: Soft
        float glow = exp(-normDist * 2.5);
        col = col * 0.75 + col * 0.5 * glow;
    } else {
        // 4: Flat
        col = baseColor;
    }
    return col;
}

void main() {
    vec2 uv = vUvScaled;
    vec2 center = vec2(0.5);
    float aspect = resolution.x / resolution.y;

    // Aspect-corrected coordinates
    vec2 p = (uv - center) * vec2(aspect, 1.0);

    vec4 texel = texture2D(tDiffuse, uv);
    vec3 color = texel.rgb;
    float alpha = texel.a;

    // Scale params to normalized UV space
    float maxDim = max(resolution.x, resolution.y);
    float o1d  = Orbit_1_Distance / maxDim;
    float oSp  = Orbit_Spacing      / maxDim;
    float eSz  = Electron_Size      / maxDim;
    float nSz  = Nucleon_Size       / maxDim;
    float nuSz = Nucleus_Size       / maxDim;

    float t = time * Electron_Speed * 0.001;

    // ============================================================
    // 1. DRAW ORBIT PATHS (dashed white circles)
    // ============================================================
    for (int shell = 0; shell < 4; shell++) {
        float nE = 0.0;
        if (shell == 0) nE = Electrons_per_shell.x;
        else if (shell == 1) nE = Electrons_per_shell.y;
        else if (shell == 2) nE = Electrons_per_shell.z;
        else if (shell == 3) nE = Electrons_per_shell.w;

        if (nE > 0.5) {
            float orbitR = o1d + float(shell) * oSp;
            float ring = dashedRing(p, orbitR, nE * 8.0, 0.45);
            color = mix(color, vec3(1.0), ring * 0.65);
            alpha = max(alpha, ring * 0.65);
        }
    }

    // ============================================================
    // 2. DRAW ELECTRONS (Evenly spaced, NO SEED RANDOMIZATION)
    // ============================================================
    for (int shell = 0; shell < 4; shell++) {
        float nE = 0.0;
        if (shell == 0) nE = Electrons_per_shell.x;
        else if (shell == 1) nE = Electrons_per_shell.y;
        else if (shell == 2) nE = Electrons_per_shell.z;
        else if (shell == 3) nE = Electrons_per_shell.w;

        if (nE > 0.5) {
            float orbitR = o1d + float(shell) * oSp;
            // Inner shells orbit faster
            float speed = t / (float(shell) + 1.0);

            for (int e = 0; e < 14; e++) {
                if (float(e) < nE) {
                    // Perfectly even spacing, no seed offset
                    float baseAngle = (6.28318 / nE) * float(e);
                    float angle     = baseAngle + speed;

                    vec2 ePos = vec2(cos(angle), sin(angle)) * orbitR;
                    float electron = softCircle(p, ePos, eSz);

                    vec3 eColor = vec3(0.15, 0.95, 0.35);
                    eColor = applyParticleStyle(eColor, length(p - ePos), eSz, Particles);

                    color = mix(color, eColor, electron);
                    alpha = max(alpha, electron);
                }
            }
        }
    }

    // ============================================================
    // 3. DRAW NUCLEUS (Seed ONLY affects this part)
    // ============================================================
    float totalN = Protons + Neutrons;

    if (totalN > 0.5) {
        float goldenAngle = 2.39996;

        for (int i = 0; i < 30; i++) {
            if (float(i) < totalN) {
                float isProton = float(i) < Protons ? 1.0 : 0.0;

                // Spread outward based on Nucleus_Size
                float r = nuSz * sqrt((float(i) + 0.5) / max(totalN, 1.0));

                // SEED ONLY APPLIES HERE: Randomizes the angular position
                float seedAngle = hash(vec2(float(i) * 7.3, Seed * 13.7)) * 6.28318;
                float angle = goldenAngle * float(i) + seedAngle;

                vec2 nPos = vec2(cos(angle), sin(angle)) * r;
                float dist = length(p - nPos);
                float nucleon = softCircle(p, nPos, nSz * 0.5);

                vec3 nColor;
                if (isProton > 0.5) {
                    nColor = vec3(0.88, 0.12, 0.12);  // Red protons
                } else {
                    nColor = vec3(0.72, 0.72, 0.78);  // Grey neutrons
                }

                nColor = applyParticleStyle(nColor, dist, nSz * 0.5, Particles);

                color = mix(color, nColor, nucleon);
                alpha = max(alpha, nucleon);
            }
        }
    }

    gl_FragColor = vec4(color, alpha);
}
