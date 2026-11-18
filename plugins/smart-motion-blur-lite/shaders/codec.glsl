precision highp float;
// Two signed 16-bit fixed-point components, 1/64 px, +/-511 px. RG and BA must never be
// interpolated as encoded bytes; decode each neighboring texel first.
vec2 smbDecode(vec4 p) {
  vec4 b = floor(p * 255.0 + 0.5);
  return vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) / 64.0 - 512.0;
}
vec4 smbEncode(vec2 v) {
  vec2 code = floor((clamp(v, vec2(-511.0), vec2(511.0)) + 512.0) * 64.0 + 0.5);
  vec2 hi = floor(code / 256.0);
  return vec4(hi.x, code.x - hi.x * 256.0, hi.y, code.y - hi.y * 256.0) / 255.0;
}


