uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform sampler2D uPrevious;
uniform sampler2D uNext;
uniform sampler2D uTranslation;
uniform float uStep;
float direction;
vec4 otherAt(vec2 uv) { return direction < 0.5 ? texture2D(uBefore, uv) : texture2D(uAfter, uv); }
float cost(vec2 motion) {
    float total = 0.0;
    for (int y = 0; y < 12; y++) {
        for (int x = 0; x < 16; x++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(16.0, 12.0);
            vec2 moved = uv + motion / uProject;
            if (any(lessThan(moved, vec2(0.0))) || any(greaterThan(moved, vec2(1.0))))
                continue;
            total += length(texture2D(uCurrent, uv) - otherAt(moved));
        }
    }
    return total;
}
void main() {
    float candidate = floor(gl_FragCoord.x);
    direction = floor(gl_FragCoord.y);
    vec2 motion = vec2(0.0);
    if (uStep < -0.5) {
        if (candidate < 63.5) {
            vec2 uv = (vec2(mod(candidate, 8.0), floor(candidate / 8.0)) + 0.5) / 8.0;
            motion = direction < 0.5 ? decodeFlow(texture2D(uPrevious, uv)) : decodeFlow(texture2D(uNext, uv));
        }
    } else {
        if (candidate > 8.5) { gl_FragColor = vec4(1.0); return; }
        motion = decodeFlow(texture2D(uTranslation, vec2((direction + 0.5) / 2.0, 0.5)));
        motion += (vec2(mod(candidate, 3.0), floor(candidate / 3.0)) - 1.0) * uStep;
    }
    gl_FragColor = packStatistic(cost(motion) / 384.0);
}
