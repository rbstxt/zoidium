uniform sampler2D uImage;
uniform sampler2D uPrevious;
uniform float uWeight;
void main() {
    // An incremental mean preserves an unchanged sample exactly on RGBA8.
    // The previous target is distinct from the output target.
    gl_FragColor = mix(texture2D(uPrevious, vUv), texture2D(uImage, vUv), uWeight);
}
