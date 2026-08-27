precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform float Offset;
uniform float Offset2;
uniform float Margin;
uniform float StripeWidth;
uniform float StripeMargin;
uniform float StripeOffset;
uniform float StripeRotation;
uniform float PatternRotation;
uniform vec2 PatternScale;
uniform vec2 Position;
uniform vec3 Color;

vec4 premultiplyColor(vec4 colorValue) {
    float alpha = clamp(colorValue.a, 0.0, 1.0);
    return vec4(colorValue.rgb * alpha, alpha);
}

vec4 sourceOverColor(vec4 backgroundColor, vec3 effectColor, float effectAlpha) {
    float sourceAlpha = clamp(effectAlpha, 0.0, 1.0);
    float backgroundAlpha = clamp(backgroundColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = effectColor * sourceAlpha + backgroundColor.rgb * remainingBackground;
    return vec4(outputColor, outputAlpha);
}

varying vec2 vUvScaled;
vec2 objectUv;

vec2 standardObjectUv(vec2 uv) {
    vec2 p = uv * 2.0 - 1.0;
    p -= Position;
    p.x *= 16.0 / 9.0;
    
    float standardRotation = Rotation * 3.14159265359 / 180.0;
    p = vec2(
        cos(standardRotation) * p.x + sin(standardRotation) * p.y,
        -sin(standardRotation) * p.x + cos(standardRotation) * p.y
    );
    p /= max(abs(Scale), vec2(0.0001));
    p.x /= 16.0 / 9.0;
    return p * 0.5 + 0.5;
}

vec2 rotate(vec2 uv, float angle) {
    float cosR = cos(angle);
    float sinR = sin(angle);
    vec2 rotatedUv;
    rotatedUv.x = uv.x * cosR - uv.y * sinR;
    rotatedUv.y = uv.x * sinR + uv.y * cosR;
    return rotatedUv;
}

void main()
{
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
  vec4 texel = premultiplyColor(texture2D(tDiffuse, vUvScaled));

  vec2 uv = objectUv + Position / 20.0;
  uv.y = (uv.y - 0.5) * (9.0 / 16.0) + 0.5;

  vec2 centeredUv = uv - 0.5;

  vec2 rotatedUv = rotate(centeredUv, PatternRotation * 3.14159265359 / 180.0);

  vec2 rotatedUv2 = rotate(centeredUv, StripeRotation * 3.14159265359 / 180.0);

  float newOffset = Offset + Offset2;
  float newStripeOffset = StripeOffset + StripeWidth * StripeMargin / 2.0;
  
  float manhattanDist = abs(rotatedUv.x) / PatternScale.x + abs(rotatedUv.y) / PatternScale.y - newOffset;

  if (fract(manhattanDist) < Margin && fract((rotatedUv2.y + newStripeOffset / 100.0) / (StripeWidth / 100.0)) < StripeMargin) {
    texel = sourceOverColor(sourceTexel, Color, Opacity);
  }

  gl_FragColor = texel;
}
