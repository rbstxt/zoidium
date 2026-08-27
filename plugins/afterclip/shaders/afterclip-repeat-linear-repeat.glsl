precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Rotation;
uniform vec2 Offset;
uniform float Repeat;
uniform float RepeatScale;
uniform int BlendOrder;

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


const float PI = 3.141592653589793;
const float ASPECT = 16.0 / 9.0;

vec2 rotateAspect(vec2 uv, float angle, vec2 center) {
  uv -= center;
  uv.x *= ASPECT;
  float rad = radians(angle);
  float cosA = cos(rad);
  float sinA = sin(rad);
  uv = mat2(cosA, -sinA, sinA, cosA) * uv;
  uv.x /= ASPECT;
  uv += center;
  return uv;
}

vec2 scaleUV(vec2 uv, float scale, vec2 center) {
  return (uv - center) / scale + center;
}

vec4 blendColors(vec4 baseColor, vec4 overlayColor) {
    float sourceAlpha = clamp(overlayColor.a, 0.0, 1.0);
    float backgroundAlpha = clamp(baseColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = overlayColor.rgb * sourceAlpha + baseColor.rgb * (1.0 - sourceAlpha);
    return vec4(outputColor, outputAlpha);
}

void main()
{
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
  vec2 offsetPixels = Offset / vec2(-1920.0, -1080.0);
  vec4 color = vec4(0.0);
  vec2 center = vec2(0.5);
  float angleIncrement = Rotation / float(Repeat);
  vec2 offsetIncrement = offsetPixels / float(Repeat);
  float scaleIncrement = (RepeatScale - 1.0) / float(Repeat);

  if (BlendOrder == 0) {
    for (int i = 0; i < 1000; ++i) {
      if (float(i) >= Repeat) break;
      float angle = float(i) * angleIncrement;
      vec2 offset = float(i) * offsetIncrement;
      float scale = 1.0 + float(i) * scaleIncrement;
      vec2 uv = scaleUV(vUvScaled + offset, scale, center);
      vec2 rotatedUV = rotateAspect(uv, -angle, center);
      vec4 texel = texture2D(tDiffuse, rotatedUV);
      color = blendColors(color, texel);
    }
  } else {
    for (int i = 999; i >= 0; --i) {
      if (float(i) >= Repeat) continue;
      float angle = float(i) * angleIncrement;
      vec2 offset = float(i) * offsetIncrement;
      float scale = 1.0 + float(i) * scaleIncrement;
      vec2 uv = scaleUV(vUvScaled + offset, scale, center);
      vec2 rotatedUV = rotateAspect(uv, -angle, center);
      vec4 texel = texture2D(tDiffuse, rotatedUV);
      color = blendColors(color, texel);
    }
  }

  gl_FragColor = color;
}
