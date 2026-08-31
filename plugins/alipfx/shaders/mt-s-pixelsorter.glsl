precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;

// Panzoid Custom Properties mapped from UI
uniform float Mode;             // 0=Brightness, 1=Saturation, 2=Hue, 3=RGB
uniform float Direction;        // 0=Left->Right, 1=Right->Left, 2=Top->Bottom, 3=Bottom->Top
uniform float Threshold;        // 0 - 255
uniform float Conditional_Sort; // 0=Disabled (Displacement), 1=Enabled (True Sort)

// PERFORMANCE TWEAK: Max search distance for sorting. 
// 50 means it can stretch/sort streaks up to 101 pixels long. 
// Higher values = longer streaks but will drastically reduce frame rate.
const int MAX_SEARCH = 50; 

// Evaluates the pixel based on the chosen Mode
float getValue(vec3 color, float mode) {
    if (mode < 0.5) {
        // 0: Brightness (Luminance)
        return dot(color, vec3(0.299, 0.587, 0.114));
    } else if (mode < 1.5) {
        // 1: Saturation
        float cMax = max(max(color.r, color.g), color.b);
        float cMin = min(min(color.r, color.g), color.b);
        return (cMax > 0.0) ? (cMax - cMin) / cMax : 0.0;
    } else if (mode < 2.5) {
        // 2: Hue
        float cMax = max(max(color.r, color.g), color.b);
        float cMin = min(min(color.r, color.g), color.b);
        float delta = cMax - cMin;
        if (delta == 0.0) return 0.0;
        float h = 0.0;
        if (cMax == color.r) h = mod((color.g - color.b) / delta, 6.0);
        else if (cMax == color.g) h = (color.b - color.r) / delta + 2.0;
        else if (cMax == color.b) h = (color.r - color.g) / delta + 4.0;
        return h / 6.0;
    } else {
        // 3: RGB Intensity
        return (color.r + color.g + color.b) / 3.0;
    }
}

// Maps the UI integer to a 2D vector direction
vec2 getDir(float dir) {
    if (dir < 0.5) return vec2(1.0, 0.0);       // Left to Right
    else if (dir < 1.5) return vec2(-1.0, 0.0); // Right to Left
    else if (dir < 2.5) return vec2(0.0, -1.0); // Top to Bottom (Y is inverted in typical UV)
    else return vec2(0.0, 1.0);                 // Bottom to Top
}

void main() {
    vec2 dirVec = getDir(Direction) / resolution;
    float thresh = Threshold / 255.0;

    vec4 myCol = texture2D(tDiffuse, vUvScaled);
    float myVal = getValue(myCol.rgb, Mode);

    // If current pixel is below threshold, it doesn't get sorted.
    if (myVal < thresh) {
        gl_FragColor = myCol;
        return;
    }

    // 1. Find the bounds of the current continuous sortable segment
    int startIdx = 0;
    int endIdx = 0;

    for (int i = 1; i <= MAX_SEARCH; i++) {
        vec2 uv = vUvScaled - dirVec * float(i);
        if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        if(getValue(texture2D(tDiffuse, uv).rgb, Mode) < thresh) break;
        startIdx = i;
    }

    for (int i = 1; i <= MAX_SEARCH; i++) {
        vec2 uv = vUvScaled + dirVec * float(i);
        if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        if(getValue(texture2D(tDiffuse, uv).rgb, Mode) < thresh) break;
        endIdx = i;
    }

    vec4 resultCol = myCol;

    if (Conditional_Sort > 0.5) {
        // --- TRADITIONAL PIXEL SORT (O(N^2) Rank Sort) ---
        // We evaluate every pixel in the streak. If its sorted rank matches 
        // our current position (startIdx), that's the color we pull.
        for (int i = -MAX_SEARCH; i <= MAX_SEARCH; i++) {
            if (i < -startIdx || i > endIdx) continue;

            vec2 pUv = vUvScaled + dirVec * float(i);
            vec4 pCol = texture2D(tDiffuse, pUv);
            float pVal = getValue(pCol.rgb, Mode);

            int pRank = 0;
            for (int j = -MAX_SEARCH; j <= MAX_SEARCH; j++) {
                if (j < -startIdx || j > endIdx) continue;
                vec2 oUv = vUvScaled + dirVec * float(j);
                float oVal = getValue(texture2D(tDiffuse, oUv).rgb, Mode);

                // Sort descending (higher values pool at the start of the vector)
                if (oVal > pVal) pRank++;
                else if (oVal == pVal && j < i) pRank++; // tie-breaker
            }

            if (pRank == startIdx) {
                resultCol = pCol;
                break;
            }
        }
    } else {
        // --- MISTAKE MODE: DISPLACEMENT BY SORTING ---
        // This calculates the rank of the current pixel, but instead of outputting 
        // the color that belongs here, it accidentally uses the rank difference as an offset distance.
        int myRank = 0;
        for (int j = -MAX_SEARCH; j <= MAX_SEARCH; j++) {
            if (j < -startIdx || j > endIdx) continue;
            vec2 oUv = vUvScaled + dirVec * float(j);
            float oVal = getValue(texture2D(tDiffuse, oUv).rgb, Mode);

            if (oVal > myVal) myRank++;
            else if (oVal == myVal && j < 0) myRank++;
        }

        // The exact "mistake" logic: Translating rank delta into a UV displacement
        float offset = float(myRank - startIdx);
        vec2 displaceUv = clamp(vUvScaled + dirVec * offset, 0.0, 1.0);
        resultCol = texture2D(tDiffuse, displaceUv);
    }

    gl_FragColor = resultCol;
}
