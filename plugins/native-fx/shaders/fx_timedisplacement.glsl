// Time Displacement (Native FX): one gather pass per sampled time slice. Each
// output pixel takes the slice frame whose index matches the displacement map
// luminance at that pixel (Rec.709 luma of the unpremultiplied map color,
// mid grey when the map is transparent, exactly like EffectCraft's
// time_displacement); every other pixel keeps the running accumulation, which
// starts as the current input so the zero-offset slice needs no tap. The map
// is the layer itself unless the Layer Input plugin resolves another video
// track. Sampled with uv * uvScale because CM3 effect buffers can be larger
// than the layer.
precision highp float;

uniform sampler2D tAcc;
uniform sampler2D tSlice;
uniform sampler2D tMap;
uniform int uSlice;
uniform int uSlices;
uniform vec2 uMapScale;
uniform vec2 uMapOffset;

varying vec2 vUvScaled;

float mapLuma(vec3 color) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

void main() {
  vec2 mapUv = vUvScaled * uMapScale + uMapOffset;
  vec4 map = texture2D(tMap, mapUv);
  float luma = 0.5;
  if (map.a > 0.0) {
    luma = mapLuma(map.rgb / map.a);
  }
  int slice = int(floor(luma * float(uSlices - 1) + 0.5));
  // GLSL ES 1.00 has no integer min/max overloads; clamp with branches.
  if (slice < 0) {
    slice = 0;
  }
  if (slice > uSlices - 1) {
    slice = uSlices - 1;
  }
  if (slice == uSlice) {
    gl_FragColor = texture2D(tSlice, vUvScaled);
  } else {
    gl_FragColor = texture2D(tAcc, vUvScaled);
  }
}
