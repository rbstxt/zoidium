uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform sampler2D uScore;
uniform vec2 uSize;
uniform float uRadius;
uniform float uOutput;
float patchCost(vec2 v) {
    float cost=0.0;
    vec4 center=features(texture2D(uCurrent,vUv));
    for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++) {
        vec2 uv=vUv+vec2(float(x),float(y))/uSize;
        vec4 a=features(texture2D(uCurrent,uv)),b=features(texture2D(uOther,uv+v/uProject));
        float ma=1.0-smoothstep(0.002,0.01,dot(a-center,a-center));
        float mb=1.0-smoothstep(0.002,0.01,dot(b-center,b-center));
        cost+=abs(ma-mb)+0.01*robust(a-b);
    }
    return cost/25.0;
}
vec4 scoreValue(float valid,float distance) {
    float code=floor(min(distance*8.0,65535.0)+0.5);
    return vec4(valid,floor(code/256.0)/255.0,mod(code,256.0)/255.0,1.0);
}
float distanceAt(vec4 score) { return (floor(score.g*255.0+0.5)*256.0+floor(score.b*255.0+0.5))/8.0; }
void main() {
    vec2 best=decodeFlow(texture2D(uFlow,vUv));
    if(uRadius<0.5) {
        vec2 e=1.0/uSize;
        float xx=0.0,xy=0.0,yy=0.0,stationaryPatch=0.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
            vec2 p=vUv+vec2(float(x),float(y))*e;
            vec4 gx=features(texture2D(uCurrent,p+vec2(e.x,0.0)))-features(texture2D(uCurrent,p-vec2(e.x,0.0)));
            vec4 gy=features(texture2D(uCurrent,p+vec2(0.0,e.y)))-features(texture2D(uCurrent,p-vec2(0.0,e.y)));
            xx+=dot(gx,gx);xy+=dot(gx,gy);yy+=dot(gy,gy);
            stationaryPatch+=dot(abs(texture2D(uCurrent,p)-texture2D(uOther,p)),vec4(1.0));
        }
        float eigen=(xx+yy-sqrt((xx-yy)*(xx-yy)+4.0*xy*xy))/18.0;
        float valid=0.0;
        if(eigen>0.003 && stationaryPatch<0.001) {best=vec2(0.0);valid=1.0;}
        else if(eigen>0.003) {
            float cost=patchCost(best);
            for(int step=0;step<7;step++) {
                vec2 center=best;
                float spacing=exp2(2.0-float(step));
                for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
                    vec2 v=center+vec2(float(x),float(y))*spacing*uProject/uSize;
                    float c=patchCost(v);
                    if(c<cost-0.000001 && length(v)<=uLimit) {best=v;cost=c;}
                }
            }
            if(cost<0.08) valid=1.0;
        }
        gl_FragColor=uOutput>0.5?scoreValue(valid,0.0):encodeFlow(best);return;
    }
    vec4 own=texture2D(uScore,vUv);
    float distance=own.r>0.5?distanceAt(own):100000.0;
    vec4 center=features(texture2D(uCurrent,vUv));
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
        vec2 offset=vec2(float(x),float(y))*uRadius;
        vec2 p=vUv+offset/uSize;
        if(p.x<0.0 || p.y<0.0 || p.x>1.0 || p.y>1.0) continue;
        vec4 score=texture2D(uScore,p);
        float candidateDistance=distanceAt(score)+length(offset*uProject/uSize);
        vec4 difference=features(texture2D(uCurrent,p))-center;
        if(score.r>0.5 && candidateDistance<distance && dot(difference,difference)<0.002) {
            best=decodeFlow(texture2D(uFlow,p));distance=candidateDistance;
        }
    }
    gl_FragColor=uOutput>0.5?scoreValue(distance<99999.0?1.0:0.0,min(distance,8191.0)):encodeFlow(best);
}
