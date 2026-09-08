precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// The resolution of the composition (e.g., 1920.0, 1080.0)
// Needed to normalize the pixel coordinates of Start and End.
uniform vec2 resolution;

// The Start point: The anchor of the effect. The image remains fixed here.
// Default: 960.0, 540.0 (Half of 1080p)
uniform vec2 start;

// The End point: Defines the direction and height of the bend area.
// Default: 960.0, 540.0 (Half of 1080p)
// Note: Ideally offset this from start (e.g. 960.0, 0.0) to see the effect.
uniform vec2 end;

// Controls the intensity of the bend.
uniform float bend;

void main()
{
  // 1. SETUP CONSTANTS
  float zero = 0.0;
  float one = 1.0;
  float two = 2.0;
  float pi = 3.14159265;
  float epsilon = 0.0001;

  // 2. CONVERT TO PIXEL SPACE
  // We work in pixel coordinates to match the "Start" and "End" uniform behavior.
  vec2 texCoord = vUvScaled * resolution;
  
  // 3. DEFINE LOCAL COORDINATE SYSTEM
  // Calculate the vector from Start to End
  vec2 segment = end - start;
  float segmentLength = length(segment);
  
  // If Start and End are too close, avoid division by zero and return original pixel
  if (segmentLength < epsilon) {
    gl_FragColor = texture2D(tDiffuse, vUvScaled);
    return;
  }

  // Calculate basis vectors for a local coordinate system where:
  // Y-axis aligns with the Start -> End line.
  // X-axis is perpendicular.
  vec2 axisY = normalize(segment);
  vec2 axisX = vec2(axisY.y, -axisY.x); // Rotate 90 degrees

  // 4. TRANSFORM PIXEL TO LOCAL SPACE
  // Shift origin to Start point
  vec2 delta = texCoord - start;
  
  // Project current pixel onto our local axes
  // localPos.x = distance to the right/left of the spine
  // localPos.y = distance along the spine (up/down)
  vec2 localPos = vec2(dot(delta, axisX), dot(delta, axisY));

  // 5. APPLY INVERSE BEND DISTORTION
  // We want to find which source pixel maps to this current local position.
  vec2 sourceLocalPos = localPos;

  if (abs(bend) > epsilon) {
    // Radius R = Length / Bend
    // Note: We assume 'bend' ranges roughly 0.0 to 1.0 or 0.0 to 100.0.
    // We multiply by segmentLength to scale relative to the size of the selection.
    float radius = segmentLength / bend * 100.0; // Scaling factor for sensitivity

    // Calculate the Center of Curvature.
    // Since we are bending along the Y-axis, the center is offset along the X-axis.
    vec2 centerOfCurvature = vec2(radius, zero);

    // Vector from Center of Curvature to our current pixel
    vec2 diff = localPos - centerOfCurvature;
    
    // Inverse Polar Mapping:
    // The current Angle determines the Source Y (height along the original spine).
    // The current Distance determines the Source X (distance from the original spine).
    float currentDist = length(diff);
    
    // Calculate angle. We use atan(y, -x) because our center is at +radius.
    // We adjust the sign based on the radius direction.
    float currentAngle = atan(diff.y, -diff.x * sign(radius));

    // Map back to straight Cartesian space
    // Source X is the difference between the radius and the current distance
    sourceLocalPos.x = (currentDist - abs(radius)) * sign(radius);
    
    // Source Y is the arc length: Angle * Radius
    sourceLocalPos.y = currentAngle * abs(radius);
  }

  // 6. TRANSFORM BACK TO UV SPACE
  // Rotate and Translate back to global pixel space
  vec2 sourcePixel = start + (axisX * sourceLocalPos.x) + (axisY * sourceLocalPos.y);
  
  // Normalize back to 0.0 - 1.0 UV range
  vec2 finalUv = sourcePixel / resolution;

  // 7. BOUNDS CHECKING (Optional "Crop" like CC Bend It)
  // Check if the calculated UV is outside the texture bounds
  if (finalUv.x < zero || finalUv.x > one || finalUv.y < zero || finalUv.y > one) {
     gl_FragColor = vec4(zero, zero, zero, zero);
  } else {
     gl_FragColor = texture2D(tDiffuse, finalUv);
  }
}
