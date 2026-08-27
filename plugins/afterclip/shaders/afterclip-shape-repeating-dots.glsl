precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform vec3 Color;
uniform vec2 Position;
uniform float Radius;
uniform float YInterval;
uniform float XInterval;
uniform int XRepeat;

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

void main()
{
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
  vec2 coord = (objectUv - 0.5) * 20.0;
  
  vec2 circleCenter = vec2(0.0);
  
  vec2 adjustedCoord = coord;
  adjustedCoord.x *= 16.0 / 9.0;
  
  vec2 adjustedCenter = circleCenter;
  adjustedCenter.x *= 16.0 / 9.0;
  
  
  float offsetY = mod(adjustedCoord.y - adjustedCenter.y + YInterval * 0.5, YInterval) - YInterval * 0.5;
  
  
  bool drawn = false;
  for (int i = 0; i < 100; i++) {
    if (i > XRepeat) break;
    
    float xOffset = float(i) * XInterval;
    float scale = 1.0 - float(i) / float(XRepeat + 1);
    float scaledRadius = Radius * scale;
    
    vec2 repeatedCenter = vec2(adjustedCenter.x + xOffset, adjustedCenter.y);
    vec2 repeatedCoord = vec2(adjustedCoord.x, repeatedCenter.y + offsetY);
    
    float dist = distance(repeatedCoord, repeatedCenter);
    
    if (dist <= scaledRadius) {
      drawn = true;
      break;
    }
  }
  
  if (drawn) {
    gl_FragColor = sourceOverColor(sourceTexel, Color, Opacity);
  } else {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = premultiplyColor(texel);
  }
}
