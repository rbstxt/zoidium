uniform sampler2D uFlow;
uniform vec2 uSize;
uniform vec2 uProcessing;
uniform float uAmount;
void main() {
    vec2 best=vec2(0.0);
    vec2 radius=ceil(uLimit*uProcessing/uProject*uAmount/32.0)+1.0;
    for(int y=-9;y<=9;y++) for(int x=-9;x<=9;x++) {
        if(abs(float(x))>radius.x || abs(float(y))>radius.y) continue;
        vec2 uv=vUv+vec2(float(x),float(y))/uSize;
        vec2 f=decodeFlow(texture2D(uFlow,uv));
        if(dot(f,f)>dot(best,best)) best=f;
    }
    gl_FragColor=encodeFlow(best);
}
