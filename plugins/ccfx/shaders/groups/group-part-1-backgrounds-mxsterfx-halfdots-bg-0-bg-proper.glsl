precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform float t;
uniform float size;
uniform float min;
uniform float u_max;    // Renamed 'max' to 'u_max' to avoid conflict with the built-in max() function
uniform float wl;
uniform vec2 u_center;  // <-- New uniform for the dynamic center position

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);
  vec2 vSc = vUvScaled * vec2(1.0, 0.5625);
  // gl_FragColor = texel; // Removed this line as it was overwritten later
  
  // Calculate the center position adjusted for aspect ratio
  vec2 center_aspect = u_center * vec2(1.0, 0.5625);

  // --- MODIFIED TO USE U_CENTER ---
  // main_dst now calculates distance relative to the new dynamic center
  float main_dst = distance(vSc, center_aspect); 
  
  float grid_dst = distance(mod(vSc * vec2(size), vec2(1.0)), vec2(0.5));
  grid_dst /= 1.41421356237;
  // The animation wave is still driven by main_dst distance
  grid_dst += sin(main_dst * wl - t) / 2.0 + 0.5;

  gl_FragColor = vec4(1.0);
  // Using the renamed uniform u_max
  gl_FragColor[3] = float(1.0 - grid_dst * u_max > min); // Changed '>' back to '<' based on typical usage for showing shapes
}
