precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;
varying vec2 vUvScaled;

uniform float time;

// ==================== CORE ====================
uniform float Mode;                    // 0=Radial Lines, 1=Speed Lines
uniform vec2 Center;                 // Center position in pixels
uniform float Lines;                 // Number of lines

// ==================== SHAPE ====================
uniform float Center_Gap;            // Inner gap radius
uniform float Outer_Radius;          // Outer radius
uniform float Radial_Expansion;      // Expand while keeping ratio
uniform float Radial_Y_Scale;        // Y-axis squash/stretch
uniform float Speed_Line_Length;     // Length for speed lines

// ==================== STROKE ====================
uniform vec3 Color;                  // Line color
uniform float Opacity;               // Overall opacity
uniform float Thickness;             // Line thickness
uniform float Taper;                 // Tip taper
uniform float Start_Taper;           // Start-end taper
uniform float End_Taper;             // End-end taper
uniform float Line_Style;              // 0=Clean, 1=Zigzag, 2=Tilda
uniform float Rough_Edge;            // Edge roughness
uniform float Style_Count;           // Zigzag/Tilda frequency
uniform float Style_Amount;          // Zigzag/Tilda amplitude

// ==================== VARIATION ====================
uniform float Variation;             // Global variation (0-100)
uniform float Animate;                 // 0=Off, 1=Grow, 2=Flow, 3=Infinite Speed Line
uniform float Auto_Animation;          // 0=Disabled, 1=Enabled
uniform float Direction;               // 0=Outward, 1=Inward
uniform float Grow_Phase;            // Grow animation phase
uniform float Flow_Phase;            // Flow animation phase
uniform float Speed;                 // Animation speed
uniform float Speed_Variation;       // Per-line speed variation
uniform float Flow_Life_Time;        // Flow segment lifetime
uniform float Flow_Length;           // Flow segment length
uniform float Flow_Min_Scale;        // Flow tail shrink
uniform float Phase_Randomness;      // Flow phase randomness
uniform float Rotation;              // Global rotation (degrees)

// ==================== ADVANCED SHAPE ====================
uniform float Length_Origin;           // 0=Start, 1=Center, 2=End
uniform float Angle_Range;           // Fan angle in degrees
uniform float Angle_Offset;          // Angle offset in degrees
uniform float Fade_Start;            // Start fade distance (px)
uniform float Fade_End;              // End fade distance (px)
uniform float Cap_Style;               // 0=Butt, 1=Round
uniform float Dash_Length;           // Dash segment length
uniform float Dash_Gap;              // Dash gap length
uniform float Dash_Gap_Randomness;   // Dash gap variation

// ==================== ADVANCED VARIATION ====================
uniform float Angle_Randomness;      // Per-line angle randomness
uniform float Length_Randomness;     // Per-line length randomness
uniform float Start_Position_Randomness;
uniform float Thickness_Randomness;
uniform float Opacity_Randomness;
uniform float Speed_Spacing_Randomness;   // Speed lines only
uniform float Speed_Position_Randomness;  // Speed lines only
uniform float Color_Randomness;
uniform float Seed;
uniform float Rotation_Randomness;

// ==================== ADVANCED MOTION ====================
uniform float Flow_Fade;
uniform float Depth_Curve;
uniform float FPS;

// ==================== ADVANCED EVOLUTION ====================
uniform float Evolution_Enable;        // 0=Disabled, 1=Enabled
uniform float Auto_Evolution;          // 0=Disabled, 1=Enabled
uniform float Auto_Evolution_Speed;
uniform float Evolution;
uniform float Evolution_Amount;
uniform float Evolution_Speed;
uniform float Evolution_Angle;
uniform float Evolution_Rotation;
uniform float Evolution_Rotation_Randomness;
uniform float Evolution_Length;
uniform float Evolution_Thickness;
uniform float Evolution_Opacity;

// ==================== OUTPUT ====================
uniform float Output_Mode;             // 0=Composite, 1=Lines Only
uniform float Blend_Mode;              // 0=Normal, 1=Add, 2=Multiply

// ============================================================
// HASH & NOISE FUNCTIONS
// ============================================================
float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

// ============================================================
// SDF FOR ROUND-CAP SEGMENT
// ============================================================
float sdSegmentRound(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// ============================================================
// MAIN
// ============================================================
void main() {
    vec2 px = vUv * resolution;
    vec4 inputColor = texture2D(tDiffuse, vUvScaled);

    // FPS stepping for stop-motion feel
    float t = time;
    if (FPS > 1.0) {
        t = floor(time * FPS) / FPS;
    }

    // Evolution time
    float evoTime = Evolution;
    if (Evolution_Enable > 0.5 && Auto_Evolution > 0.5) {
        evoTime += t * Auto_Evolution_Speed;
    }
    float evoVal = evoTime * Evolution_Speed;
    float evoAmt = clamp(Evolution_Amount / 100.0, 0.0, 1.0);

    // Line accumulation buffer
    vec4 lineAccum = vec4(0.0);
    if (Blend_Mode > 1.5) lineAccum = vec4(1.0, 1.0, 1.0, 0.0);

    int lineCount = int(min(Lines, 300.0));
    float varNorm = clamp(Variation / 100.0, 0.0, 1.0);

    for (int i = 0; i < 300; i++) {
        if (i >= lineCount) break;

        float fi = float(i);
        float lineSeed = Seed + fi * 137.0 + floor(evoTime * 0.01) * 0.0; // prevent unroll issues

        // --------------------------------------------------------
        // 1. CALCULATE BASE GEOMETRY
        // --------------------------------------------------------
        vec2 p1, p2;
        float baseAngle = 0.0;
        vec2 lineDir = vec2(1.0, 0.0);
        vec2 linePerp = vec2(0.0, 1.0);
        float lineLenEst = 100.0;

        if (Mode < 0.5) {
            // ---- RADIAL LINES ----

            // Base angle distribution
            if (Lines > 1.5) {
                float tNorm = fi / (Lines - 1.0);
                baseAngle = (Angle_Offset + (tNorm - 0.5) * Angle_Range) * 0.01745329252;
            } else {
                baseAngle = Angle_Offset * 0.01745329252;
            }

            // Global rotation
            baseAngle += Rotation * 0.01745329252;

            // Variation (simplified all-in-one)
            baseAngle += (hash(lineSeed + 1.0) - 0.5) * varNorm * 1.0;

            // Advanced Variation - Angle
            baseAngle += (hash(lineSeed + 10.0) - 0.5) * (Angle_Randomness / 100.0) * 1.57079632679;

            // Rotation Randomness
            baseAngle += (hash(lineSeed + 11.0) - 0.5) * (Rotation_Randomness / 100.0) * 1.57079632679;

            // Evolution - Angle (wave from center)
            if (Evolution_Enable > 0.5) {
                baseAngle += sin(fi * 0.5 + evoVal) * (Evolution_Angle / 100.0) * evoAmt * 1.57079632679;
                baseAngle += evoVal * Evolution_Rotation * 0.01745329252;
                baseAngle += (hash(lineSeed + 100.0 + evoTime * 0.1) - 0.5) * (Evolution_Rotation_Randomness / 100.0) * 6.28318530718 * evoAmt;
            }

            lineDir = vec2(cos(baseAngle), sin(baseAngle));
            linePerp = vec2(-lineDir.y, lineDir.x);

            // Radial expansion (keeps inner/outer ratio)
            float ratio = Outer_Radius / max(Center_Gap, 0.001);
            float innerR = Center_Gap + Radial_Expansion;
            float outerR = innerR * ratio;

            // Apply Y-scale to create ellipse
            vec2 scaleVec = vec2(1.0, Radial_Y_Scale);

            // Length randomness
            float lenRand = hash(lineSeed + 20.0);
            outerR *= mix(1.0, 0.2 + lenRand * 1.8, Length_Randomness / 100.0);

            // Evolution length
            if (Evolution_Enable > 0.5) {
                outerR *= mix(1.0, 0.5 + 0.5 * sin(evoVal * 1.1 + fi * 0.7), (Evolution_Length / 100.0) * evoAmt);
            }

            p1 = Center + lineDir * innerR * scaleVec;
            p2 = Center + lineDir * outerR * scaleVec;

            // Start position randomness (along direction)
            float startPosRand = (hash(lineSeed + 30.0) - 0.5) * Start_Position_Randomness;
            p1 += lineDir * startPosRand * scaleVec;

            lineLenEst = length(p2 - p1);

        } else {
            // ---- SPEED LINES ----

            float speedAngle = (Rotation + Angle_Offset) * 0.01745329252;
            lineDir = vec2(cos(speedAngle), sin(speedAngle));
            linePerp = vec2(-lineDir.y, lineDir.x);

            // Distribute along perpendicular axis
            float perpPos = 0.0;
            if (Lines > 1.5) {
                perpPos = (fi / (Lines - 1.0) - 0.5) * max(resolution.x, resolution.y) * 1.5;
            }

            // Speed position randomness
            perpPos += (hash(lineSeed + 2.0) - 0.5) * Speed_Position_Randomness;

            // Speed spacing randomness
            perpPos += hash(lineSeed + 3.0) * Speed_Spacing_Randomness;

            // General variation
            perpPos += (hash(lineSeed + 4.0) - 0.5) * varNorm * 200.0;

            // Line length
            float sLen = Speed_Line_Length;
            if (sLen < 1.0) sLen = max(resolution.x, resolution.y) * 1.5;

            // Length randomness
            sLen *= mix(1.0, 0.3 + hash(lineSeed + 20.0) * 1.4, Length_Randomness / 100.0);

            // Evolution length
            if (Evolution_Enable > 0.5) {
                sLen *= mix(1.0, 0.5 + 0.5 * sin(evoVal * 1.1 + fi * 0.7), (Evolution_Length / 100.0) * evoAmt);
            }

            vec2 lineCenter = Center + linePerp * perpPos;

            // Infinite Speed Line / Flow offset
            float flowOffset = 0.0;
            if (abs(Animate - 3.0) < 0.5 || abs(Animate - 2.0) < 0.5) {
                float phase = Flow_Phase;
                if (Auto_Animation > 0.5) phase += t * Speed;

                float lineSpeed = Speed;
                if (Speed_Variation > 0.0) {
                    lineSpeed *= mix(1.0, 0.3 + hash(lineSeed + 800.0) * 1.4, Speed_Variation / 100.0);
                }

                float moveDist = phase * lineSpeed * 300.0;
                if (Direction > 0.5) moveDist = -moveDist;

                float wrapWidth = sLen * 3.0;
                flowOffset = mod(moveDist + fi * (wrapWidth / max(Lines, 1.0)) + hash(lineSeed + 5.0) * wrapWidth, wrapWidth) - wrapWidth * 0.5;
            }

            lineCenter += lineDir * flowOffset;
            p1 = lineCenter - lineDir * sLen * 0.5;
            p2 = lineCenter + lineDir * sLen * 0.5;
            lineLenEst = sLen;
        }

        // --------------------------------------------------------
        // 2. GROW ANIMATION
        // --------------------------------------------------------
        if (abs(Animate - 1.0) < 0.5) {
            float phase = clamp(Grow_Phase, 0.0, 1.0);
            if (Auto_Animation > 0.5) {
                phase = fract(t * Speed);
            }

            vec2 fullP1 = p1;
            vec2 fullP2 = p2;
            vec2 mid = (fullP1 + fullP2) * 0.5;
            vec2 halfVec = (fullP2 - fullP1) * 0.5;

            if (Direction < 0.5) {
                // Outward growth
                if (Length_Origin < 0.5) {
                    p2 = mix(fullP1, fullP2, phase);
                } else if (abs(Length_Origin - 1.0) < 0.5) {
                    p1 = mid - halfVec * phase;
                    p2 = mid + halfVec * phase;
                } else {
                    p1 = mix(fullP2, fullP1, 1.0 - phase);
                }
            } else {
                // Inward growth
                if (Length_Origin < 0.5) {
                    p1 = mix(fullP2, fullP1, 1.0 - phase);
                } else if (abs(Length_Origin - 1.0) < 0.5) {
                    p1 = mid + halfVec * phase;
                    p2 = mid - halfVec * phase;
                } else {
                    p2 = mix(fullP1, fullP2, 1.0 - phase);
                }
            }
        }

        // --------------------------------------------------------
        // 3. DISTANCE TO LINE SEGMENT
        // --------------------------------------------------------
        vec2 ba = p2 - p1;
        float segLen = length(ba);
        if (segLen < 0.001) continue;

        vec2 dirNorm = ba / segLen;
        vec2 perpNorm = vec2(-dirNorm.y, dirNorm.x);

        // Base projection for clean lines
        vec2 pa = px - p1;
        float tProj = clamp(dot(pa, dirNorm) / segLen, 0.0, 1.0);
        vec2 closest = p1 + dirNorm * segLen * tProj;
        float dist = length(px - closest);
        float bestT = tProj;

        // Styled lines: sample along path
        int samples = 1;
        if (abs(Line_Style - 1.0) < 0.5) samples = int(clamp(Style_Count * 3.0, 4.0, 40.0));
        else if (abs(Line_Style - 2.0) < 0.5) samples = 24;
        else if (Rough_Edge > 0.01) samples = 12;

        if (samples > 1) {
            float minD = dist;
            for (int s = 0; s < 40; s++) {
                if (s >= samples) break;
                float ts = float(s) / max(float(samples - 1), 1.0);
                vec2 pos = p1 + dirNorm * segLen * ts;

                if (abs(Line_Style - 1.0) < 0.5) {
                    // Zigzag
                   float phase = ts * max(Style_Count, 1.0) * 6.28318530718;
                   float wave = asin(sin(phase)) / 1.57079632679 * Style_Amount;
                    pos += perpNorm * wave;
                } else if (abs(Line_Style - 2.0) < 0.5) {
                    // Tilda (sine wave)
                    float wave = sin(ts * max(Style_Count, 1.0) * 6.28318530718) * Style_Amount;
                    pos += perpNorm * wave;
                }

                float d = length(px - pos);
                if (d < minD) {
                    minD = d;
                    bestT = ts;
                }
            }
            dist = minD;
        }

        // Rough edge noise
        if (Rough_Edge > 0.01) {
            float edgeNoise = (hash(vec2(bestT * 40.0, lineSeed + 200.0)) - 0.5) * Rough_Edge * Thickness * 3.0;
            dist += edgeNoise;
        }

        // --------------------------------------------------------
        // 4. THICKNESS PROFILE
        // --------------------------------------------------------
        float thick = Thickness;

        // General tip taper (both ends)
        thick *= mix(1.0, sin(bestT * 3.14159265), clamp(Taper, 0.0, 1.0));

        // Start taper (inner/center side)
        thick *= mix(1.0, smoothstep(0.0, 0.3, bestT), clamp(Start_Taper, 0.0, 1.0));

        // End taper (outer side)
        thick *= mix(1.0, smoothstep(1.0, 0.7, bestT), clamp(End_Taper, 0.0, 1.0));

        // Evolution thickness
        if (Evolution_Enable > 0.5) {
            thick *= mix(1.0, 0.5 + 0.5 * sin(evoVal * 1.1 + fi * 0.5), (Evolution_Thickness / 100.0) * evoAmt);
        }

        // Thickness randomness
        thick *= mix(1.0, 0.2 + hash(lineSeed + 400.0) * 1.8, Thickness_Randomness / 100.0);

        // Depth curve (tunnel effect for flow)
        if (Depth_Curve > 0.0 && Mode < 0.5) {
            float depth = mix(1.0, 1.0 - bestT * 0.7, Depth_Curve);
            thick *= depth;
        }

        // Butt cap: exclude beyond endpoints in perpendicular direction
        if (Cap_Style < 0.5) {
            float projT = dot(px - p1, dirNorm) / segLen;
            if (projT < 0.0 || projT > 1.0) {
                dist = 1e10;
            }
        }

        // Early reject
        if (dist > thick * 0.6) continue;

        // --------------------------------------------------------
        // 5. DASH PATTERN
        // --------------------------------------------------------
        float inDash = 1.0;
        if (Dash_Length > 0.5 && Dash_Gap > 0.5) {
            float dashCycle = Dash_Length + Dash_Gap;
            float dashRand = hash(lineSeed + 300.0) * Dash_Gap_Randomness;
            float dashPos = mod(bestT * segLen + dashRand, dashCycle);
            inDash = step(dashPos, Dash_Length);
        }
        if (inDash < 0.5) continue;

        // --------------------------------------------------------
        // 6. FLOW ANIMATION (Radial & Speed)
        // --------------------------------------------------------
        float flowAlpha = 1.0;
        if (abs(Animate - 2.0) < 0.5) {
            float phase = Flow_Phase;
            if (Auto_Animation > 0.5) phase += t * Speed;

            float lineSpeed = Speed;
            if (Speed_Variation > 0.0) {
                lineSpeed *= mix(1.0, 0.3 + hash(lineSeed + 800.0) * 1.4, Speed_Variation / 100.0);
            }

            float phaseRand = Phase_Randomness / 100.0;
            float linePhase = phase * lineSpeed + hash(lineSeed + 40.0) * phaseRand * 6.28318530718;

            float flowPos = bestT * segLen;
            // Inward direction for radial: reverse flow from outer to inner
            if (Mode < 0.5 && Direction > 0.5) {
            flowPos = segLen - flowPos;
            }
            float segLenFlow = max(Flow_Length, 5.0);
            float segSpacing = segLenFlow * 2.5;
            float localPos = mod(flowPos - linePhase * 80.0 + hash(lineSeed + 60.0) * segSpacing, segSpacing);

            // Segment shape: fade at head and tail
            float seg = smoothstep(segLenFlow, segLenFlow * 0.7, localPos) * smoothstep(0.0, segLenFlow * 0.15, localPos);

            // Flow Min Scale: shrink tail
            if (Flow_Min_Scale > 0.0) {
                seg *= mix(1.0, smoothstep(segLenFlow * Flow_Min_Scale, 0.0, localPos), clamp(Flow_Min_Scale, 0.0, 1.0));
            }

            // Flow life time
            if (Flow_Life_Time > 0.0) {
                float life = mod(linePhase, Flow_Life_Time * 3.0) / max(Flow_Life_Time * 3.0, 0.001);
                seg *= smoothstep(1.0, 0.3, life);
            }

            flowAlpha = seg;
        }

        // --------------------------------------------------------
        // 7. OPACITY
        // --------------------------------------------------------
        float alpha = Opacity;

        // Fade start (inner/center)
        alpha *= smoothstep(0.0, max(Fade_Start, 0.5), bestT * segLen);

        // Fade end (outer)
        alpha *= smoothstep(0.0, max(Fade_End, 0.5), (1.0 - bestT) * segLen);

        // Flow fade
        if (abs(Animate - 2.0) < 0.5 && Flow_Fade > 0.0) {
            alpha *= mix(1.0, smoothstep(1.0, 0.0, bestT), clamp(Flow_Fade, 0.0, 1.0));
        }

        // Evolution opacity
        if (Evolution_Enable > 0.5) {
            alpha *= mix(1.0, 0.5 + 0.5 * sin(evoVal * 1.3 + fi * 0.7), (Evolution_Opacity / 100.0) * evoAmt);
        }

        // Opacity randomness
        alpha *= mix(1.0, hash(lineSeed + 500.0), Opacity_Randomness / 100.0);

        // General variation opacity
        alpha *= mix(1.0, 0.3 + hash(lineSeed + 501.0) * 1.4, varNorm * 0.5);

        // Flow alpha modulation
        alpha *= flowAlpha;

        // Soft edge antialiasing
        float edgeSoft = smoothstep(thick * 0.5, thick * 0.25, dist);
        alpha *= edgeSoft;

        if (alpha < 0.001) continue;

        // --------------------------------------------------------
        // 8. COLOR
        // --------------------------------------------------------
        vec3 lineColor = Color;

        // Color randomness
        if (Color_Randomness > 0.0) {
            vec3 randCol = vec3(
                hash(lineSeed + 600.0),
                hash(lineSeed + 601.0),
                hash(lineSeed + 602.0)
            );
            lineColor = mix(lineColor, randCol, Color_Randomness / 100.0);
        }

        // --------------------------------------------------------
        // 9. ACCUMULATE
        // --------------------------------------------------------
        vec4 lc = vec4(lineColor * alpha, alpha);

        if (Blend_Mode < 0.5) {
            // Normal alpha blend
            lineAccum.rgb = mix(lineAccum.rgb, lc.rgb, lc.a);
            lineAccum.a = lineAccum.a + lc.a * (1.0 - lineAccum.a);
        } else if (Blend_Mode > 0.5) {
            // Add
            lineAccum += lc;
        } else {
            // Multiply
            lineAccum.rgb *= mix(vec3(1.0), lc.rgb, lc.a);
            lineAccum.a = max(lineAccum.a, lc.a);
        }
    }

    // Clamp
    lineAccum = clamp(lineAccum, 0.0, 1.0);

    // --------------------------------------------------------
    // 10. OUTPUT COMPOSITING
    // --------------------------------------------------------
    vec4 finalColor;

    if (Output_Mode < 0.5) {
        // Composite over input
        if (Blend_Mode > 0.5) {
            // Add blend over input
            finalColor = inputColor + lineAccum;
            finalColor.a = min(inputColor.a + lineAccum.a, 1.0);
        } else if (Blend_Mode > 1.5) {
            // Multiply blend over input
            finalColor.rgb = inputColor.rgb * mix(vec3(1.0), lineAccum.rgb, lineAccum.a);
            finalColor.a = inputColor.a;
        } else {
            // Normal blend over input
            finalColor = mix(inputColor, lineAccum, lineAccum.a);
        }
    } else {
        // Lines only
        finalColor = lineAccum;
    }

    gl_FragColor = finalColor;
}
