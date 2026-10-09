uniform sampler2D tHeld;
uniform vec2 uvScale;

varying vec2 vUvScaled;

void main()
{
  gl_FragColor = texture2D(tHeld, vUvScaled);
}
