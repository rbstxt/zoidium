uniform sampler2D uFlow;
uniform vec2 uFlowSize;
void main() { gl_FragColor = encodeFlow(flowAt(uFlow, vUv, uFlowSize)); }
