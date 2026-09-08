precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform float t;
uniform float size;
uniform float min;
uniform float u_max; // Renamed from 'max' to avoid compiler error
uniform float wl;
uniform vec2 u_center; // <-- New uniform for the dynamic center position

void main()
{
  // vec4 texel = texture2D(tDiffuse, vUvScaled); // Keep this if you use the texture later
  vec2 vSc = vUvScaled * vec2(1.0, 0.5625);
  // gl_FragColor = texel; 

  // --- MODIFIED TO USE U_CENTER ---
  
  // Calculate the coordinate within each tile
  vec2 tiled_coords = mod(vSc * vec2(size), vec2(1.0));

  // Use the 'max' of the coordinate delta from the center (0.5) to define squares
  float grid_dst = max(abs(tiled_coords.x - 0.5), abs(tiled_coords.y - 0.5));
  
  // Normalize/Scale if necessary (not strictly needed for this approach)
  // grid_dst /= 1.41421356237; 

  // --- MODIFIED TO USE U_CENTER ---
  // The animation wave now originates from the dynamic center U_CENTER
  float main_dst = distance(vSc, u_center * vec2(1.0, 0.5625));
  grid_dst += sin(main_dst * wl - t) / 2.0 + 0.5;


  gl_FragColor = vec4(1.0);
  // The thresholding line still works perfectly to cut the gradient into solid shapes
  gl_FragColor[3] = float(1.0 - grid_dst * u_max > min);
}
