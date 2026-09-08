precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --- User Defined Variables ---
// Adjusts the angle at which the light sweep moves
uniform float Direction; 

// Controls how bright the light sweep appears
uniform float SweepIntensity;

// 0.0 = Linear Sweep, 1.0 = Circular Sweep
uniform float Shape;

// Modifies the brightness at the edge of the light sweep
uniform float EdgeIntensity;

// Adjusts the thickness of the light sweep edge
uniform float EdgeThickness;

// Color of the light sweep
uniform vec3 LightColor;

// 0.0 = Add, 1.0 = Composite, 2.0 = Cutout
uniform float LightReception;

// Center position of the sweep (Required for rotation/positioning)
uniform vec2 Center;

// Width of the light beam (Added to ensure the sweep has visibility)
uniform float BeamWidth;


void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);
  float alpha = texel.a;

  // --- 1. Calculate Sweep Geometry ---
  vec2 coord = vUvScaled - Center;
  float dist = 0.0;

  if (Shape < 0.5) {
      // Linear Sweep: Rotate coordinates to find distance from the "beam" line
      // Converting degrees to radians
      float rad = radians(Direction);
      float s = sin(-rad); // Negative to align rotation with standard clockwise feel
      float c = cos(-rad);
      
      // Rotate the coordinate system relative to center
      vec2 rotated = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
      
      // Distance is the absolute width from the center line
      dist = abs(rotated.x);
  } else {
      // Circular Sweep: Distance is simply length from center
      dist = length(coord);
  }

  // Create the beam profile (Soft edge falloff)
  // 1.0 at the center, fading to 0.0 at BeamWidth
  float beam = 1.0 - smoothstep(0.0, BeamWidth, dist);


  // --- 2. Top-Left Edge Detection ---
  // To highlight top-left edges, we look at neighbors in the top-left direction.
  // We offset the UV lookup by the EdgeThickness.
  
  // Scale thickness to a small UV offset (avoiding integers)
  float thicknessScale = 0.002; 
  vec2 offsetDirection = vec2(-1.0, 1.0); // Left and Up (Assuming Y is Up)
  vec2 offset = offsetDirection * EdgeThickness * thicknessScale;

  // Sample the alpha of the neighbor
  float neighborAlpha = texture2D(tDiffuse, vUvScaled + offset).a;

  // Calculate Edge Factor: 
  // We want pixels that are opaque (current alpha) but have transparent neighbors (neighbor alpha).
  // max(0.0, ...) ensures we only highlight the "lit" side (Top-Left) and not the shadowed side.
  float edgeFactor = max(0.0, alpha - neighborAlpha);


  // --- 3. Combine Lights ---
  // Calculate the individual light components
  vec3 sweepLight = LightColor * beam * SweepIntensity;
  
  // The edge highlight is also masked by the sweep "beam" so it moves with the light
  vec3 edgeLight = LightColor * edgeFactor * EdgeIntensity * beam;

  // Total light to apply
  vec3 totalLight = sweepLight + edgeLight;


  // --- 4. Light Reception ---
  vec4 finalColor = vec4(0.0);
  
  // Mask light to the image's alpha channel
  vec3 litRGB = totalLight * alpha;

  if (LightReception < 0.5) {
      // Add Mode: Adds light purely to the image (can blow out to white)
      finalColor.rgb = texel.rgb + litRGB;
      finalColor.a = alpha;

  } else if (LightReception < 1.5) {
      // Composite Mode: Blends light using Screen logic (softer, preserves details better than Add)
      // Screen = 1.0 - (1.0 - Base) * (1.0 - Blend)
      finalColor.rgb = 1.0 - (1.0 - texel.rgb) * (1.0 - litRGB);
      finalColor.a = alpha;

  } else {
      // Cutout Mode: Shows only the light sweep
      finalColor.rgb = litRGB;
      finalColor.a = alpha;
  }

  gl_FragColor = finalColor;
}
