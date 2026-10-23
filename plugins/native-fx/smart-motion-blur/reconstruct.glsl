uniform sampler2D uImage;
uniform sampler2D uPrevious;
uniform sampler2D uNext;
uniform sampler2D uPreviousMax;
uniform sampler2D uNextMax;
uniform sampler2D uPreviousConfidence;
uniform sampler2D uNextConfidence;
uniform sampler2D uGuide;
uniform vec2 uScale;
uniform vec2 uFlowSize;
uniform vec2 uProcessing;
uniform vec2 uTileSize;
uniform vec2 uDeltas;
uniform float uAmount;
uniform int uSamples;
uniform int uView;

vec4 colorAt(vec2 uv) {
    if(uv.x<0.0 || uv.y<0.0 || uv.x>1.0 || uv.y>1.0) return vec4(0.0);
    vec2 lo=0.5*uScale/uProcessing;
    return texture2D(uImage,clamp(uv*uScale,lo,uScale-lo));
}
vec2 velocity(sampler2D field,vec2 uv,float delta,float signValue) {
    // Joint bilateral upsampling keeps a flat object's field off its background.
    vec2 p=uv*uFlowSize-0.5, b=floor(p), f=fract(p);
    vec4 center=features(colorAt(uv));
    vec2 sum=vec2(0.0); float weights=0.0;
    for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
        vec2 q=(b+vec2(float(x),float(y))+0.5)/uFlowSize;
        vec4 c=features(texture2D(uGuide,q));
        float w=(x==0?1.0-f.x:f.x)*(y==0?1.0-f.y:f.y);
        w*=exp(-dot(c-center,c-center)*80.0)+0.00001;
        sum+=decodeFlow(texture2D(field,q))*w;weights+=w;
    }
    vec2 result=sum/max(weights,0.000001)*signValue/delta;
    return length(result)<0.25 ? vec2(0.0) : result;
}
vec4 integrate(vec2 uv,float tau,sampler2D field,sampler2D maxField,sampler2D conf,float delta,float signValue) {
    vec2 own=velocity(field,uv,delta,signValue);
    vec2 candidate=decodeFlow(texture2D(maxField,uv));
    vec2 q=uv-own*tau/uProject;
    vec4 result=colorAt(q);
    // Neighbor-max proposes a foreground trajectory reaching this destination.
    // Verify its donor's motion before replacing the ordinary gather sample.
    vec2 donor=uv-candidate*tau/uProject;
    vec2 tracked=velocity(field,donor,delta,signValue);
    vec2 error=(donor+tracked*tau/uProject-uv)*uProcessing;
    float confidence=texture2D(conf,donor).a;
    if(length(candidate)>0.25 && length(error)<1.5 &&
        dot(tracked,candidate)>0.75*dot(candidate,candidate) && confidence>0.12 &&
        length(tracked)>=length(own)-0.5) {
        result=colorAt(donor);
    }
    return result;
}
void main() {
    vec2 previous=velocity(uPrevious,vUv,uDeltas.x,-1.0);
    vec2 next=velocity(uNext,vUv,uDeltas.y,1.0);
    if(uView==1) {
        vec2 v=(previous+next)*0.5;
        gl_FragColor=vec4(0.5+v.x/512.0,0.5+v.y/512.0,min(1.0,length(v)/64.0),1.0);return;
    }
    if(uView==2) {
        float c=min(texture2D(uPreviousConfidence,vUv).a,texture2D(uNextConfidence,vUv).a);
        gl_FragColor=vec4(vec3(c),1.0);return;
    }
    vec4 sum=vec4(0.0);
    for(int i=0;i<64;i++) {
        if(i>=uSamples) break;
        float tau=((float(i)+0.5)/float(uSamples)-0.5)*uAmount;
        if(tau<0.0) sum+=integrate(vUv,tau,uPrevious,uPreviousMax,uPreviousConfidence,uDeltas.x,-1.0);
        else sum+=integrate(vUv,tau,uNext,uNextMax,uNextConfidence,uDeltas.y,1.0);
    }
    // Inputs and output are premultiplied. Never normalize RGB by alpha.
    gl_FragColor=sum/float(uSamples);
}
