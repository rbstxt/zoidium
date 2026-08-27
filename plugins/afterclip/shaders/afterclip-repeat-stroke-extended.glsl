precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Width;
uniform float Hue;
uniform vec3 Color;
uniform int Iterations;

vec4 premultiplyColor(vec4 colorValue) {
    float alpha = clamp(colorValue.a, 0.0, 1.0);
    return vec4(colorValue.rgb * alpha, alpha);
}

vec4 sourceOverColor(vec4 backgroundColor, vec3 effectColor, float effectAlpha) {
    float sourceAlpha = clamp(effectAlpha, 0.0, 1.0);
    float backgroundAlpha = clamp(backgroundColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = effectColor * sourceAlpha + backgroundColor.rgb * remainingBackground;
    return vec4(outputColor, outputAlpha);
}

varying vec2 vUvScaled;


vec3 rgb2hsv(vec3 c){
    vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);
    vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
    vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
    float d=q.x-min(q.w,q.y);
    float e=1.0e-10;
    return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)),d/(q.x+e),q.x);
}

vec3 hsv2rgb(vec3 c){
    vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
    vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);
    return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);
}

void main(){
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    vec4 texel=texture2D(tDiffuse, vUvScaled);
    if(texel.a!=1.0&&Width>0.0){
        float width180=Width/180.0;
        float width90=Width/90.0;
        float angleStep=360.0/float(Iterations);
        for(int i=0;i<360;i+=1){
            if(i>=Iterations) break;
            float angle=radians(float(i)*angleStep);
            vec2 offset=vec2(cos(angle)*width180,sin(angle)*width90);
            vec2 newUV=vUvScaled+offset;
            if(texture2D(tDiffuse,newUV).a!=0.0){
                vec3 hsv=rgb2hsv(Color);
                hsv.x+=Hue;
                vec3 newColor=hsv2rgb(hsv);
                gl_FragColor = sourceOverColor(sourceTexel, newColor, 1.0);
                return;
            }
        }
    }
    gl_FragColor = premultiplyColor(texel);
}
