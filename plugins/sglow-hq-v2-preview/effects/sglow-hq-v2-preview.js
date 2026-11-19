"use strict";
    
    // S_Glow HQ native FX — experimental five-level Gaussian bloom for Zoidium.
    // One effect, many internal GPU passes. No layer inputs or CM3 shader assets.
    // Based on the runtime conventions in Native FX / Drop Shadow (not its code).
    this.defaultName = "S_Glow (beta 1.0)";
    const number = (name, value, min, max, step) => ({
      dynamic: true, name, type: PZ.property.type.NUMBER, value,
      min, max, step: (step || 1) * 0.1, decimals: 2,
    });
    const option = (name, items, value) => ({
      dynamic: true, name, type: PZ.property.type.OPTION, value, items,
    });
    const color = (name, value) => ({
      dynamic: true, name, type: PZ.property.type.COLOR, value,
    });
    this.propertyDefinitions = {
      enabled: option("Enabled", "off;on", 1),
      brightness: number("Brightness", 2, 0, undefined, 10),
      color: color("Color", [1, 1, 1]),
      threshold: number("Threshold", .5, 0, undefined),
      thresholdAddColor: color("Threshold Add Color", [0, 0, 0]),
      glowWidth: number("Glow Width", 96, 0, undefined, 100),
      widthX: number("Width X", 1, 0, undefined, 5),
      widthY: number("Width Y", 1, 0, undefined, 5),
      widthRed: number("Width Red", 1, 0, undefined, 5),
      widthGreen: number("Width Green", 1.2, 0, undefined, 5),
      widthBlue: number("Width Blue", 1.4, 0, undefined, 5),
      subpixel: option("Subpixel", "off;on", 1),
      show: option("Show", "Result;Threshold", 0),
      combine: option("Combine", "Mult;Add;Screen;Difference;Overlay", 2),
      edgeMode: option("Edge Mode", "Transparent;Reflect", 1),
      affectAlpha: number("Affect Alpha", 1, 0, undefined, 5),
      glowFromAlpha: number("Glow From Alpha", 0, 0, 1),
      glowUnderSource: number("Glow Under Source", 0, 0, 1),
      lightBackground: number("Light Background", 0, 0, 1),
      sourceOpacity: number("Source Opacity", 1, 0, 1),
      atmosphereAmp: number("Atmosphere Amp", 0, 0, undefined, 10),
      atmosphereFreq: number("Atmosphere Freq", 1, .1, 20, 10),
      atmosphereDetail: number("Atmosphere Detail", .6, 0, 1),
      atmosphereSeed: number("Atmosphere Seed", .123, 0, 100),
      atmosphereSpeed: number("Atmosphere Speed", 1, undefined, undefined, 5),
      expandBorders: option("Expand Borders", "off;on", 0),
      opacity: option("Opacity", "All Opaque;Normal;As Premult", 1),
        quality: option("Quality", "Fast;Balanced;High;Ultra", 2),
        engine: option("Blur Engine", "Performance (legacy);AE Match (3-box)", 1),
        previewMatch: option("Preview Resolution", "Legacy v2;Match full render", 1),
      deband: option("Deband Output", "off;on", 1),
      time: {...number("Time", 0, -1000000, 1000000, 10),decimals:3},
      timeMode: {
        name:"Time Mode",type:PZ.property.type.OPTION,value:0,items:"Automatic;Manual",
        changed(){ this.parentObject.syncAtmosphereTimeMode(); },
      },
      manualTimeExpression:{visible:false,name:"Manual Time Expression",type:PZ.property.type.TEXT,value:""},
      manualTimeAnimated:{visible:false,name:"Manual Time Animation",type:PZ.property.type.NUMBER,value:0},
      atmosphereModel:option("Atmosphere Model","AE Style;Legacy Clouds;Fine Dust",0),
    };
    for(const [key,decimals] of Object.entries({"brightness":3,"threshold":4,"glowWidth":2,"widthX":3,"widthY":3,"widthRed":3,"widthGreen":3,"widthBlue":3,"affectAlpha":4,"glowFromAlpha":4,"glowUnderSource":4,"lightBackground":4,"sourceOpacity":4,"atmosphereAmp":3,"atmosphereFreq":2,"atmosphereDetail":4,"atmosphereSeed":3,"atmosphereSpeed":3}))this.propertyDefinitions[key].decimals=decimals;
    const tips={
  "enabled": "Turns this effect on or off.",
  "brightness": "Controls glow intensity; values above 1000 are allowed.",
  "color": "Tints emitted light.",
  "threshold": "Excludes dim source pixels.",
  "thresholdAddColor": "Raises thresholds separately per color channel.",
  "glowWidth": "Sets glow reach in native image pixels.",
  "widthX": "Scales horizontal glow width.",
  "widthY": "Scales vertical glow width.",
  "widthRed": "Scales red glow width.",
  "widthGreen": "Scales green glow width.",
  "widthBlue": "Scales blue glow width.",
  "subpixel": "Smooths animation of fractional widths.",
  "show": "Displays the final result or thresholded emitter.",
  "combine": "Chooses how glow blends with the source.",
  "edgeMode": "Chooses sampling outside the input edges.",
  "affectAlpha": "Controls the glow contribution to opacity.",
  "glowFromAlpha": "Blends from RGB emission to alpha emission.",
  "glowUnderSource": "Places the source over the glow.",
  "lightBackground": "Modulates glow with source brightness.",
  "sourceOpacity": "Fades the source without reducing glow generation.",
  "expandBorders": "Adds transparent padding so soft glow extends beyond image edges. The composition still clips its final frame.",
  "atmosphereAmp": "Controls atmospheric dust and shadows; zero gives smooth glow.",
  "atmosphereFreq": "Higher values make finer atmosphere patterns.",
  "atmosphereDetail": "Adds fine grain to the atmosphere.",
  "atmosphereSeed": "Changes the repeatable noise pattern.",
  "atmosphereSpeed": "Controls atmosphere evolution; zero freezes it.",
  "time": "Sets atmosphere time in seconds in Manual mode.",
  "timeMode": "Automatic follows the project timeline. Manual reveals an editable Time value.",
  "opacity": "Selects how input alpha is interpreted.",
  "quality": "Controls blur sampling precision and GPU cost.",
  "engine": "Chooses the performance blur or calibrated three-box blur."
};
    for(const [key,tip] of Object.entries(tips))this.propertyDefinitions[key].description=tip;
    for(const key of ["previewMatch","deband","atmosphereModel"])this.propertyDefinitions[key].visible=false;
    let support;
    if(this._zoidiumGetAsset && ZoidiumPluginApis.modules){
      support=ZoidiumPluginApis.modules.createRequire(this._zoidiumGetAsset,{root:"./plugins/sglow-hq-v2-preview/"})("./support.js");
      this.releaseSupport=support.install(this,PZ,THREE,ZoidiumPluginApis);
    }
    let appliedTimeMode=null,timeReady=false,timeDisposed=false,timeRefreshQueued=false;
    const refreshTimeView=()=>{
      if(timeRefreshQueued)return;
      timeRefreshQueued=true;
      // Defer row rebuilding until the native control finishes its change event.
      queueMicrotask(()=>{
        timeRefreshQueued=false;
        if(timeDisposed)return;
        const view=this.children.find(child=>child._zoidiumCategoryName==="Atmosphere");
        view?.onListChanged.update();
      });
    };
    this.syncAtmosphereTimeMode=()=>{
      if(!timeReady)return;
      const mode=Number(this.properties.timeMode.get()),time=this.properties.time;
      if(mode===appliedTimeMode)return;
      if(mode===0){
        if(appliedTimeMode===1 || appliedTimeMode===null && time.expression?.source!=="time"){
          this.properties.manualTimeExpression.set(time.expression?.source||"");
          this.properties.manualTimeAnimated.set(time.animated?1:0);
        }
        if(time.keyframes.length===0)time.keyframes.push(new PZ.keyframe(0,0));
        time.expression=new PZ.expression("time");
        time.animated=true;
      }else if(appliedTimeMode===0){
        const manual=this.properties.manualTimeExpression.get();
        time.expression=manual?new PZ.expression(manual):null;
        time.animated=this.properties.manualTimeAnimated.get()===1;
      }
      time.visible=mode===1;
      appliedTimeMode=mode;
      refreshTimeView();
    };
    // Restore existing property objects so saved addresses and UI views stay valid.
    this.applySettingsSnapshot=data=>{
      timeReady=false;appliedTimeMode=null;
      for(const property of this.properties){
        if(property instanceof PZ.property.dynamic){
          property.expression=null;property.animated=false;
          if(property.keyframes)property.keyframes.splice(0,property.keyframes.length);
        }
      }
      this.properties.load(data);
      timeReady=true;
      this.syncAtmosphereTimeMode();
      this.update(0);
      queueMicrotask(()=>{
        if(timeDisposed)return;
        for(const child of this.children)if(child._sglowParameterSection)child.onListChanged.update();
      });
    };
    this.properties.addAll(this.propertyDefinitions, this);
    // These lists are display views of the original properties, not new storage.
    // Keep the original list at children[0] so saved animation addresses stay valid.
    const sections = [
      ["Glow", ["enabled", "brightness", "color", "threshold", "thresholdAddColor",
        "glowWidth", "widthX", "widthY", "widthRed", "widthGreen", "widthBlue",
        "subpixel", "show", "combine", "edgeMode", "affectAlpha", "glowFromAlpha",
        "glowUnderSource", "lightBackground", "sourceOpacity", "expandBorders"]],
      ["Atmosphere", ["atmosphereAmp", "atmosphereFreq", "atmosphereDetail",
        "atmosphereSeed", "atmosphereSpeed", "timeMode", "time"]],
      ["Output", ["opacity"]],
      ["Advanced", ["quality", "engine"]],
    ];
    this.properties.visible=false;
    this.children=this.children.filter(child=>!child._sglowParameterSection);
    for(const [label,keys] of sections){
      const view=new PZ.propertyList(null,this);
      view.addAll(Object.fromEntries(keys.map(key=>[key,this.properties[key]])));
      Object.defineProperties(view,{
        _zoidiumCategoryName:{value:label},
        _sglowParameterSection:{value:true},
        // The original hidden list owns runtime traversal and asset collection.
        // Do not visit the same animated properties again through their UI views.
        forEachItemOfType:{value:()=>{}},
        traverse:{value:()=>{}},
      });
      this.children.push(view);
    }

    
    // Fragment inputs are normalized [0..1]. First pass uses CM3 uvScale;
    // offscreen pyramid textures always occupy full [0..1].
    const vertex = `
    varying vec2 vUv;
    void main(){
      vUv=uv;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
    }`;
    const prelude = `
    precision highp float;
    precision highp int;
    varying vec2 vUv;
    vec2 mirrorUV(vec2 p){
      vec2 x=mod(p,2.0);
      return 1.0-abs(x-1.0);
    }
    `;
    const brightFns = `
    vec3 bright(vec4 c, float threshold, vec3 thresholdAdd, float fromAlpha, float opacityMode){
      if(opacityMode>0.5 && opacityMode<1.5)c.rgb*=c.a;
      if(opacityMode<0.5)c.a=1.0;
      vec3 s=mix(c.rgb,vec3(c.a),clamp(fromAlpha,0.0,1.0));
      vec3 t=vec3(threshold)+thresholdAdd;
      vec3 q=max(s-t,vec3(0.0));
      float sum=max(s.r,0.0)+max(s.g,0.0)+max(s.b,0.0);
      float lowest=min(t.r,min(t.g,t.b));
      float gain=min(1.0,(q.r+q.g+q.b)/(max(1.0-lowest,0.0078125)*max(sum,1.0e-20)));
      return s*gain;
    }
    `;
    const extractFS = prelude + `
    uniform sampler2D uSource;
    uniform vec2 uSrcScale,uTexel;
    uniform float uThreshold,uFromAlpha,uOpacityMode,uEdgeMode,uSharp;
    uniform vec3 uThresholdAdd;
    ` + brightFns + `
    vec3 sampleBright(vec2 uv){
      if(uEdgeMode<0.5 && (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0))return vec3(0.0);
      if(uEdgeMode>0.5)uv=mirrorUV(uv);
      return bright(texture2D(uSource,clamp(uv,0.0,1.0)*uSrcScale),uThreshold,uThresholdAdd,uFromAlpha,uOpacityMode);
    }
    void main(){
      // Soft 9-tap downsample preserves small bright points without grid aliasing.
          if(uSharp>0.5){gl_FragColor=vec4(sampleBright(vUv),1.0);return;}
          vec2 d=uTexel;
          vec3 c=sampleBright(vUv)*4.0;
      c+=(sampleBright(vUv+vec2(-d.x,0.0))+sampleBright(vUv+vec2(d.x,0.0))
        +sampleBright(vUv+vec2(0.0,-d.y))+sampleBright(vUv+vec2(0.0,d.y)))*2.0;
      c+=sampleBright(vUv+vec2(-d.x,-d.y))+sampleBright(vUv+vec2(d.x,-d.y))
        +sampleBright(vUv+vec2(-d.x,d.y))+sampleBright(vUv+vec2(d.x,d.y));
      gl_FragColor=vec4(c/16.0,1.0);
    }`;
    const downFS = prelude + `
    uniform sampler2D uSource;
    uniform vec2 uTexel;
    uniform float uEdgeMode;
    vec3 take(vec2 p){
      if(uEdgeMode<0.5 && (p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0))return vec3(0.0);
      if(uEdgeMode>0.5)p=mirrorUV(p);
      return texture2D(uSource,clamp(p,0.0,1.0)).rgb;
    }
    void main(){
      vec2 d=uTexel;
      vec3 c=take(vUv)*4.0;
      c+=(take(vUv+vec2(-d.x,0.0))+take(vUv+vec2(d.x,0.0))
        +take(vUv+vec2(0.0,-d.y))+take(vUv+vec2(0.0,d.y)))*2.0;
      c+=take(vUv+vec2(-d.x,-d.y))+take(vUv+vec2(d.x,-d.y))
        +take(vUv+vec2(-d.x,d.y))+take(vUv+vec2(d.x,d.y));
      gl_FragColor=vec4(c/16.0,1.0);
    }`;
    const blurFS = prelude + `
    uniform sampler2D uSource;
    uniform vec2 uTexel,uDirection;
    uniform float uAxisScale,uEdgeMode;
    vec3 take(vec2 p){
      if(uEdgeMode<0.5 && (p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0))return vec3(0.0);
      if(uEdgeMode>0.5)p=mirrorUV(p);
      return texture2D(uSource,clamp(p,0.0,1.0)).rgb;
    }
    void main(){
      // 19-tap deterministic Gaussian; no stochastic/dither/grid skipping.
      // Each pass samples densely in reduced-resolution space.
      if(uAxisScale<0.0001){gl_FragColor=vec4(take(vUv),1.0);return;}
      const float sigma=3.0;
      float sum=1.0;
      vec3 c=take(vUv);
      for(int i=1;i<=9;i++){
        float x=float(i);
        float w=exp(-0.5*x*x/(sigma*sigma));
        vec2 d=uDirection*uTexel*x*uAxisScale;
        c+=(take(vUv+d)+take(vUv-d))*w;
        sum+=2.0*w;
      }
      gl_FragColor=vec4(c/sum,1.0);
    }`;
        // Three consecutive normalized box filters along each axis reproduce the
        // OG GLSL three-box blur kernel, including independent RGB width values.
        // At mip levels the source is prefiltered; exact AE agreement requires
        // native-resolution convolution, so this remains an approximation.
        const boxFS = prelude + `
        uniform sampler2D uSource;
        uniform vec2 uTexel,uDirection;
        uniform float uEdgeMode,uMaxRadius;
        uniform vec3 uR0,uR1,uFrac;
        vec3 take(vec2 p){
          if(uEdgeMode<0.5 && (p.x<0.0||p.y<0.0||p.x>1.0||p.y>1.0))return vec3(0.0);
          if(uEdgeMode>0.5)p=mirrorUV(p);
          return texture2D(uSource,clamp(p,0.0,1.0)).rgb;
        }
        vec3 discreteBox(float x,vec3 r){
          vec3 low=floor(max(r,vec3(0.0)));
          vec3 fractR=clamp(r-low,0.0,1.0);
          vec3 a=step(vec3(abs(x)),low+vec3(0.0001))/(2.0*low+1.0);
          vec3 b=step(vec3(abs(x)),low+1.0001)/(2.0*low+3.0);
          return mix(a,b,fractR);
        }
        void main(){
          vec3 color=vec3(0.0);
          // Fixed loop bound is compatible with WebGL1; dynamic cutoff avoids
          // executing texture reads outside the actual three-box support.
          for(int i=-32;i<=32;i++){
            float off=float(i);
            if(abs(off)>uMaxRadius)continue;
            vec3 weight=mix(discreteBox(off,uR0),discreteBox(off,uR1),uFrac);
            if(max(weight.r,max(weight.g,weight.b))<0.000001)continue;
            color+=take(vUv+uDirection*uTexel*off)*weight;
          }
          gl_FragColor=vec4(color,1.0);
        }`;
    
    const compositeFS = prelude + `
    uniform sampler2D uOriginal,uL0,uL1,uL2,uL3,uL4;
    uniform vec2 uSrcScale,uResolution,uAtmosScale,uAtmosOffset;
    uniform vec3 uW0,uW1,uW2,uW3,uW4,uColor,uThresholdAdd;
    uniform float uBrightness,uThreshold,uFromAlpha,uOpacityMode,uShow;
    uniform float uCombine,uAffectAlpha,uGlowUnder,uLight,uSourceOpacity;
        uniform float uAtmosAmp,uAtmosFreq,uAtmosDetail,uAtmosSeed,uAtmosSpeed,uTime,uAtmosModel;
        uniform sampler2D uAEGlow,uAEFine;
    uniform float uAEMix;
        uniform float uUseAE,uNoBlur,uDither;
    ` + brightFns + `
    float screen1(float x,float y){return x+y-x*y;}
    vec4 combine4(vec4 g,vec4 b){
      if(uCombine<0.5)return g*b;
      if(uCombine<1.5)return g+b;
      if(uCombine<2.5)return g+b-min(g,vec4(1.0))*min(b,vec4(1.0));
      if(uCombine<3.5)return vec4(abs(g.rgb-b.rgb),screen1(g.a,b.a));
      vec3 rgb=mix(2.0*g.rgb*b.rgb,1.0-2.0*(1.0-g.rgb)*(1.0-b.rgb),step(vec3(0.5),b.rgb));
      float a=b.a<0.5?2.0*g.a*b.a:1.0-2.0*(1.0-g.a)*(1.0-b.a);
      return vec4(rgb,a);
    }
    float hash13(vec3 p){
      p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);
    }
    float noise3(vec3 p){
      vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      float a=hash13(i),b=hash13(i+vec3(1,0,0));
      float c=hash13(i+vec3(0,1,0)),d=hash13(i+vec3(1,1,0));
      float e=hash13(i+vec3(0,0,1)),g=hash13(i+vec3(1,0,1));
      float h=hash13(i+vec3(0,1,1)),j=hash13(i+vec3(1,1,1));
      return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,j,f.x),f.y),f.z)*2.0-1.0;
    }
    // Gradient noise removes the grid-shaped plateaus of value noise.
    float gradientDot(vec3 cell,vec3 offset){
      float h=floor(hash13(mod(cell,289.0))*16.0);
      float u=h<8.0?offset.x:offset.y;
      float v=h<4.0?offset.y:((h==12.0||h==14.0)?offset.x:offset.z);
      return (mod(h,2.0)<1.0?u:-u)+(mod(floor(h*0.5),2.0)<1.0?v:-v);
    }
    float gradientNoise(vec3 p){
      vec3 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.0-15.0)+10.0);
      float a=gradientDot(i,f),b=gradientDot(i+vec3(1,0,0),f-vec3(1,0,0));
      float c=gradientDot(i+vec3(0,1,0),f-vec3(0,1,0));
      float d=gradientDot(i+vec3(1,1,0),f-vec3(1,1,0));
      float e=gradientDot(i+vec3(0,0,1),f-vec3(0,0,1));
      float g=gradientDot(i+vec3(1,0,1),f-vec3(1,0,1));
      float h=gradientDot(i+vec3(0,1,1),f-vec3(0,1,1));
      float j=gradientDot(i+vec3(1,1,1),f-vec3(1,1,1));
      return 1.35*mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,j,u.x),u.y),u.z);
    }
    // The eight-octave wrapper and temporal phase come from RAYS_ATMOSPHERE.
    // This standard simplex implementation and seed translation remain approximate.
    vec3 mod289(vec3 x){return x-floor(x/289.0)*289.0;}
vec4 mod289(vec4 x){return x-floor(x/289.0)*289.0;}
vec4 permute(vec4 x){return mod289((x*34.0+1.0)*x);}
float simplex(vec3 v){
 const vec2 C=vec2(1.0/6.0,1.0/3.0);
 vec3 i=floor(v+dot(v,C.yyy)),x0=v-i+dot(i,C.xxx);
 vec3 g=step(x0.yzx,x0.xyz),l=1.0-g;
 vec3 i1=min(g,l.zxy),i2=max(g,l.zxy);
 vec3 x1=x0-i1+C.xxx,x2=x0-i2+C.yyy,x3=x0-0.5;
 i=mod289(i);
 vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
 vec4 j=p-49.0*floor(p/49.0),x_=floor(j/7.0),y_=floor(j-7.0*x_);
 vec4 x=(x_*2.0+0.5)/7.0-1.0,y=(y_*2.0+0.5)/7.0-1.0,h=1.0-abs(x)-abs(y);
 vec4 b0=vec4(x.xy,y.xy),b1=vec4(x.zw,y.zw),s0=floor(b0)*2.0+1.0,s1=floor(b1)*2.0+1.0,sh=-step(h,vec4(0.0));
 vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy,a1=b1.xzyw+s1.xzyw*sh.zzww;
 vec3 p0=vec3(a0.xy,h.x),p1=vec3(a0.zw,h.y),p2=vec3(a1.xy,h.z),p3=vec3(a1.zw,h.w);
 vec4 norm=inversesqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
 p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
 vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m*=m;
 return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

    float recoveredAtmosphere(vec2 uv){
      // The native DSL coordinate unit is unresolved; calibrate grain scale
      // against the same-image AE preview rather than changing octave count.
      vec2 xy=2.8*(uv-0.5)*vec2(1.0,uResolution.y/uResolution.x);
      vec3 q=vec3(uAtmosFreq*xy,0.1*uAtmosSpeed*(uTime+1.0));
      q+=uAtmosSeed*vec3(17.17,41.73,93.31);
      float value=0.0,weight=1.0,energy=0.0;
      for(int octave=0;octave<8;octave++){
        value+=weight*simplex(q);energy+=weight*weight;
        q*=2.0;weight*=clamp(uAtmosDetail,0.0,1.0);
      }
      // Preserve noise contrast as Detail adds octaves: normalize by energy,
      // rather than dividing their amplitude by the sum of all eight weights.
      // This amplitude convention is a visual calibration, not a recovered
      // implementation of Sapphire's unresolved native noise primitive.
      float noise=value/sqrt(max(energy,0.000001))-0.07*clamp(uAtmosDetail,0.0,1.0);
      return 1.0-uAtmosAmp*noise;
    }
    float atmosphere(vec2 uv){
      if(abs(uAtmosAmp)<0.00001)return 1.0;
      if(uAtmosModel<0.5)return recoveredAtmosphere(uv);
      if(uAtmosModel>1.5){
        // Coordinates stay in image space, independent of preview pixel count.
        vec2 p=(uv-0.5)*vec2(uResolution.x/uResolution.y,1.0);
        vec3 q=vec3(p*(4.0*uAtmosFreq)+uAtmosSeed*vec2(17.17,41.73),
          0.25*uAtmosSpeed*uTime+uAtmosSeed*19.31);
        const mat3 turn=mat3(0.0,0.8,0.6,-0.8,0.36,-0.48,-0.6,-0.48,0.64);
        float v=0.0,w=1.0,total=0.0;
        float footprint=4.0*uAtmosFreq/max(uResolution.y,1.0);
        for(int octave=0;octave<12;octave++){
          // Suppress unresolved octaves rather than aliasing them into pixels.
          float visibility=1.0-smoothstep(0.2,0.5,footprint);
          if(visibility>0.0)v+=w*visibility*gradientNoise(q);
          total+=w;
          q=turn*q*2.03+vec3(19.1,7.7,3.4);
          footprint*=2.03;w*=clamp(uAtmosDetail,0.0,1.0);
        }
        // Atmospheric shadowing cannot create negative light.
        return max(0.0,1.0-uAtmosAmp*v/max(total,0.000001));
      }
      if(abs(uAtmosAmp)<0.00001)return 1.0;
      vec2 p=2.0*(uv-0.5)*vec2(1.0,uResolution.y/uResolution.x);
      vec3 q=vec3(p*uAtmosFreq+uAtmosSeed*vec2(17.17,41.73),0.1*uAtmosSpeed*(uTime+1.0)+uAtmosSeed*93.31);
      float v=0.0,w=1.0,total=0.0;
      for(int i=0;i<8;i++){
        v+=w*noise3(q); total+=w; q*=2.0; w*=clamp(uAtmosDetail,0.0,1.0);
      }
      return 1.0-uAtmosAmp*v/max(total,0.000001);
    }
    void main(){
      vec4 source=texture2D(uOriginal,vUv*uSrcScale);
      if(uOpacityMode>0.5 && uOpacityMode<1.5)source.rgb*=source.a;
      if(uOpacityMode<0.5)source.a=1.0;
      if(uShow>0.5){
        vec3 t=bright(texture2D(uOriginal,vUv*uSrcScale),uThreshold,uThresholdAdd,uFromAlpha,uOpacityMode);
        gl_FragColor=vec4(t*atmosphere(vUv*uAtmosScale+uAtmosOffset),1.0);return;
      }
          vec3 rgb=vec3(0.0);
          if(uUseAE>0.5){
            if(uNoBlur>0.5){
              rgb=bright(texture2D(uOriginal,vUv*uSrcScale),uThreshold,uThresholdAdd,uFromAlpha,uOpacityMode);
            }else{
              rgb=mix(texture2D(uAEFine,vUv).rgb,texture2D(uAEGlow,vUv).rgb,uAEMix);
            }
          }else{
            rgb=texture2D(uL0,vUv).rgb*uW0;
            rgb+=texture2D(uL1,vUv).rgb*uW1;
            rgb+=texture2D(uL2,vUv).rgb*uW2;
            rgb+=texture2D(uL3,vUv).rgb*uW3;
            rgb+=texture2D(uL4,vUv).rgb*uW4;
          }
      rgb*=uBrightness*uColor*atmosphere(vUv*uAtmosScale+uAtmosOffset);
      float light=clamp(uLight,0.0,1.0);
      rgb*=mix(vec3(1.0),2.0*source.rgb,light);
      // A negative atmosphere sample is a hole in the emitted glow, not
      // negative light that subtracts from the retained source underneath.
      // Apply this at the glow/alpha boundary, preserving positive HDR peaks.
      rgb=max(rgb,vec3(0.0));
      vec4 glow=vec4(rgb,clamp(max(rgb.r,max(rgb.g,rgb.b))*uAffectAlpha,0.0,1.0));
      vec4 s=source*clamp(uSourceOpacity,0.0,1.0);
      vec4 normal=mix(combine4(glow,s),s+glow,light);
      vec4 back=mix(combine4(glow,vec4(0.0)),glow,light);
      vec4 under=s+back*(1.0-s.a);
      vec4 result=mix(normal,under,screen1(clamp(uGlowUnder,0.0,1.0),light));
      if(uOpacityMode<0.5)result.a=1.0;
      if(uOpacityMode>1.5)result.rgb*=result.a;
      // Stable, neutral sub-LSB dither at the final 8-bit output only.
      // Float scratch buffers preserve the much fainter halo before this step.
      if(uDither>0.5 && max(result.r,max(result.g,result.b))>0.0){
        float noise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))-0.5;
        result.rgb=max(vec3(0.0),result.rgb+vec3(noise*clamp(result.a,0.0,1.0)/255.0));
      }
      gl_FragColor=result;
    }`;
    
    this.load = async function(data) {
      timeReady=false;appliedTimeMode=null;timeDisposed=false;
      const makeMat = (fs, uniforms) => new THREE.ShaderMaterial({
        uniforms, vertexShader: vertex, fragmentShader: fs,
        transparent: true, premultipliedAlpha: true,
        depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      });
      const uv = () => new THREE.Vector2(1, 1);
      this.extractMat = makeMat(extractFS, {
        uSource:{value:null}, uSrcScale:{value:uv()}, uTexel:{value:uv()},
        uThreshold:{value:0.5},uFromAlpha:{value:0},uOpacityMode:{value:1},
        uEdgeMode:{value:1},uSharp:{value:0},uThresholdAdd:{value:new THREE.Vector3()},
      });
      this.downMat = makeMat(downFS, {
        uSource:{value:null},uTexel:{value:uv()},uEdgeMode:{value:1},
      });
      const blurUniforms = () => ({
        uSource:{value:null},uTexel:{value:uv()},uDirection:{value:uv()},
        uAxisScale:{value:1},uEdgeMode:{value:1},
      });
      this.hMat = makeMat(blurFS, blurUniforms());
        this.vMat = makeMat(blurFS, blurUniforms());
        this.boxMat = makeMat(boxFS,{
          uSource:{value:null},uTexel:{value:uv()},uDirection:{value:uv()},
          uEdgeMode:{value:1},uMaxRadius:{value:0},
          uR0:{value:new THREE.Vector3()},uR1:{value:new THREE.Vector3()},
          uFrac:{value:new THREE.Vector3()},
        });
      const compositeUniforms = {
        uOriginal:{value:null},uSrcScale:{value:uv()},uResolution:{value:uv()},
        uAtmosScale:{value:uv()},uAtmosOffset:{value:new THREE.Vector2()},
        uBrightness:{value:2},uColor:{value:new THREE.Vector3(1,1,1)},
        uThreshold:{value:.5},uThresholdAdd:{value:new THREE.Vector3()},
        uFromAlpha:{value:0},uOpacityMode:{value:1},uShow:{value:0},
        uCombine:{value:2},uAffectAlpha:{value:1},uGlowUnder:{value:0},
        uLight:{value:0},uSourceOpacity:{value:1},
        uAtmosAmp:{value:0},uAtmosFreq:{value:1},uAtmosDetail:{value:.6},
        uAtmosSeed:{value:.123},uAtmosSpeed:{value:1},uTime:{value:0},uAtmosModel:{value:0},
          uAEGlow:{value:null},uAEFine:{value:null},uAEMix:{value:0},uUseAE:{value:0},uNoBlur:{value:0},uDither:{value:0},
      };
      for(let i=0;i<5;i++){
        compositeUniforms[`uL${i}`]={value:null};
        compositeUniforms[`uW${i}`]={value:new THREE.Vector3(0,0,0)};
      }
      this.compositeMat=makeMat(compositeFS,compositeUniforms);
      this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
      this.scene=new THREE.Scene();
      this.quad=new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2),this.extractMat);
      this.scene.add(this.quad);
      const options={minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat,
        type:THREE.UnsignedByteType,depthBuffer:false,stencilBuffer:false};
      const makeTarget=(w,h)=>ZoidiumPluginApis.gl.createRenderTarget(THREE,w,h,options);
        this.levels=Array.from({length:11},()=>({
        down:makeTarget(1,1),temp:makeTarget(1,1),blur:makeTarget(1,1),
      }));
        // Two reusable ping-pong surfaces; the selected mip controls their size.
        this.aeTargets=[makeTarget(1,1),makeTarget(1,1)];
        this.aeCoarseTargets=[makeTarget(1,1),makeTarget(1,1)];
        // Only allocated once, and used when original widths are so small that
        // downsampling to half resolution would lose noticeable detail.
        this.fullExtract=makeTarget(1,1);
        this.aeFine=makeTarget(1,1);
      let precisionRenderer=null;
      const selectPrecision=(renderer)=>{
        if(precisionRenderer===renderer && !renderer.getContext().isContextLost())return;
        const gl=renderer.getContext();
        if(gl.isContextLost())return;
        const getExtension=(name)=>renderer.extensions.get(name);
        const candidates=[];
        if(THREE.HalfFloatType!==undefined && getExtension("OES_texture_half_float") &&
            getExtension("OES_texture_half_float_linear")){
          getExtension("EXT_color_buffer_half_float");
          candidates.push([THREE.HalfFloatType,"16-bit float"]);
        }
        if(THREE.FloatType!==undefined && getExtension("OES_texture_float") &&
            getExtension("OES_texture_float_linear")){
          getExtension("WEBGL_color_buffer_float");
          candidates.push([THREE.FloatType,"32-bit float"]);
        }
        let chosen=[THREE.UnsignedByteType,"8-bit fallback"];
        for(const candidate of candidates){
          const previous=renderer.getRenderTarget();
          const probe=ZoidiumPluginApis.gl.createRenderTarget(THREE,2,2,{...options,type:candidate[0]});
          let supported=false;
          try{
            renderer.setRenderTarget(probe);
            supported=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
          }catch(error){ supported=false; }
          finally{ renderer.setRenderTarget(previous);probe.dispose(); }
          if(supported){chosen=candidate;break;}
        }
        const targets=[this.fullExtract,this.aeFine,...this.aeTargets,...this.aeCoarseTargets,
          ...this.levels.flatMap(level=>[level.down,level.temp,level.blur])];
        for(const target of targets){
          if(target.texture.type!==chosen[0]){
            target.dispose();target.texture.type=chosen[0];
          }
        }
        precisionRenderer=renderer;
        this.glowPrecision=chosen[1];
        if(chosen[0]===THREE.UnsignedByteType){
          console.warn("[S_Glow HQ] Float glow buffers are unavailable; using 8-bit fallback. Faint halos may show bands.");
        }
      };
        this.pass={
        enabled:true,needsSwap:true,clear:false,renderToScreen:false,
        uniforms:{uvScale:{value:uv()}},
        render:(renderer,writeBuffer,readBuffer)=>{
          selectPrecision(renderer);
          const w=readBuffer.width,h=readBuffer.height;
          const p=this.expandedFrame&&this.cached?.opacity===0?{...this.cached,opacity:1}:this.cached||{};
          // Zoidium may render a smaller input buffer for the windowed preview.
          // The OG filter widths are in native layer pixels, not preview pixels.
          // Convert the per-channel width into CURRENT buffer pixels only after
          // computing/rounding it in the reference resolution.
          const reference=this.getReferenceResolution(w,h);
          const renderScaleX=this.expandedFrame?.scaleX || w/reference[0];
          const renderScaleY=this.expandedFrame?.scaleY || h/reference[1];
          if (typeof window!=="undefined" && window.SGlowHQPreviewDevtools) {
            window.SGlowHQPreviewDevtools.lastRender={
              input:[w,h],reference:reference.slice(),scale:[renderScaleX,renderScaleY],
              compensated:p.previewMatch!==0,engine:p.engine,
            };
          }
          const mipCount=p.quality===0?3:p.quality===1?4:5;
          const uvScale=this.pass.uniforms.uvScale.value;
          const source=readBuffer.texture;
          const C=this.compositeMat.uniforms;
          C.uOriginal.value=source;
          C.uSrcScale.value.copy(uvScale);
          const expanded=this.expandedFrame;
          C.uResolution.value.set(expanded?.sourceW||w,expanded?.sourceH||h);
          C.uAtmosScale.value.set(expanded?w/expanded.sourceW:1,expanded?h/expanded.sourceH:1);
          C.uAtmosOffset.value.set(expanded?-expanded.padX/expanded.sourceW:0,expanded?-expanded.padY/expanded.sourceH:0);
          C.uBrightness.value=p.brightness===undefined?2:p.brightness;
          C.uColor.value.set(...(p.color||[1,1,1]));
          C.uThreshold.value=p.threshold===undefined?.5:p.threshold;
          C.uThresholdAdd.value.set(...(p.thresholdAddColor||[0,0,0]));
          C.uFromAlpha.value=p.glowFromAlpha||0;
          C.uOpacityMode.value=p.opacity===undefined?1:p.opacity;
          C.uShow.value=p.show||0;
          C.uCombine.value=p.combine===undefined?2:p.combine;
          C.uAffectAlpha.value=p.affectAlpha===undefined?1:p.affectAlpha;
          C.uGlowUnder.value=p.glowUnderSource||0;
          C.uLight.value=p.lightBackground||0;
          C.uSourceOpacity.value=p.sourceOpacity===undefined?1:p.sourceOpacity;
          C.uAtmosAmp.value=p.atmosphereAmp||0;
          C.uAtmosFreq.value=p.atmosphereFreq||1;
          C.uAtmosDetail.value=p.atmosphereDetail===undefined?.6:p.atmosphereDetail;
          C.uAtmosSeed.value=p.atmosphereSeed||0;
          C.uAtmosSpeed.value=p.atmosphereSpeed===undefined?1:p.atmosphereSpeed;
              C.uTime.value=p.time||0;
              C.uAtmosModel.value=p.atmosphereModel||0;
              C.uUseAE.value=p.engine===1?1:0;
              C.uNoBlur.value=0;
              C.uDither.value=p.deband!==0 && (p.brightness||0)>0 &&
                (!writeBuffer || !writeBuffer.texture || writeBuffer.texture.type===THREE.UnsignedByteType)?1:0;
              C.uAEGlow.value=this.aeTargets[1].texture;
          const originalColor=renderer.getClearColor?renderer.getClearColor().clone():null;
          const originalAlpha=renderer.getClearAlpha?renderer.getClearAlpha():1;
          try{
            // Some CM3 renderers disable autoClear; the old THREE.render 4th
            // argument forces a clear on every offscreen output.
            renderer.setClearColor(0x000000,0);
                if(!p.show && (p.brightness||0)>0 && p.engine===1){
                  const glowWidth=Math.max(0,p.glowWidth===undefined?96:p.glowWidth);
                  const xMul=Math.max(0,p.widthX===undefined?1:p.widthX);
                  const yMul=Math.max(0,p.widthY===undefined?1:p.widthY);
                  const channels=[p.widthRed,p.widthGreen,p.widthBlue].map(v=>Math.max(0,v===undefined?1:v));
                  const capX=3*Math.max(0,Math.floor(reference[0]*0.5)-1);
                  const capY=3*Math.max(0,Math.floor(reference[1]*0.5)-1);
                  const rounding=p.subpixel===0;
                  const widthsX=channels.map(c=>{
                    const nativeWidth=Math.min(capX,glowWidth*xMul*c);
                    return (rounding?Math.floor(nativeWidth+0.5):nativeWidth)*renderScaleX;
                  });
                  const widthsY=channels.map(c=>{
                    const nativeWidth=Math.min(capY,glowWidth*yMul*c);
                    return (rounding?Math.floor(nativeWidth+0.5):nativeWidth)*renderScaleY;
                  });
                  const maxWidth=Math.max(...widthsX,...widthsY);
                  if(maxWidth<=0.000001){
                    C.uNoBlur.value=1;
                  }else{
                    // Budget controls how finely the true three-box kernel is
                    // evaluated. Increasing quality trades GPU cost for less mip
                    // prefiltering, not for skipped samples.
                    const maxPerBox=p.quality===0?5:p.quality===1?8:p.quality===2?12:16;
                    const lod=Math.min(10,Math.max(0,Math.log2((maxWidth/3+1)/maxPerBox)));
                    const fineLevel=Math.floor(lod)-1,mix=lod-Math.floor(lod);
                    const runKernel=(selected,targets)=>{
                    let workTexture;
                    let workW=w,workH=h;
                    if(selected<0){
                      // Full resolution: no prefilter when very narrow glow.
                      const target=this.fullExtract;
                      if(target.width!==w||target.height!==h)target.setSize(w,h);
                      const u=this.extractMat.uniforms;
                      u.uSource.value=source;
                      u.uSrcScale.value.copy(uvScale);
                      u.uTexel.value.set(0,0);
                      u.uSharp.value=1;
                  u.uThreshold.value=p.threshold===undefined?.5:p.threshold;
                      u.uThresholdAdd.value.set(...(p.thresholdAddColor||[0,0,0]));
                      u.uFromAlpha.value=p.glowFromAlpha||0;
                      u.uOpacityMode.value=p.opacity===undefined?1:p.opacity;
                      u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                      this.quad.material=this.extractMat;
                      renderer.render(this.scene,this.camera,target,true);
                      workTexture=target.texture;
                    }else{
                      let previous=null,oldW=w,oldH=h;
                      for(let i=0;i<=selected;i++){
                        const target=this.levels[i].down;
                        const nw=Math.max(1,Math.round(oldW/2));
                        const nh=Math.max(1,Math.round(oldH/2));
                        if(target.width!==nw||target.height!==nh)target.setSize(nw,nh);
                        if(i===0){
                          const u=this.extractMat.uniforms;
                          u.uSource.value=source;
                          u.uSrcScale.value.copy(uvScale);
                          u.uTexel.value.set(1/w,1/h);
                          u.uSharp.value=0;
                          u.uThreshold.value=p.threshold===undefined?.5:p.threshold;
                          u.uThresholdAdd.value.set(...(p.thresholdAddColor||[0,0,0]));
                          u.uFromAlpha.value=p.glowFromAlpha||0;
                          u.uOpacityMode.value=p.opacity===undefined?1:p.opacity;
                          u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                          this.quad.material=this.extractMat;
                        }else{
                          const u=this.downMat.uniforms;
                          u.uSource.value=previous.texture;
                          u.uTexel.value.set(1/oldW,1/oldH);
                          u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                          this.quad.material=this.downMat;
                        }
                        renderer.render(this.scene,this.camera,target,true);
                        previous=target;
                        oldW=nw;oldH=nh;
                      }
                      workTexture=previous.texture;
                      workW=oldW;workH=oldH;
                    }
                    for(const target of targets){
                      if(target.width!==workW||target.height!==workH)target.setSize(workW,workH);
                    }
                    const split=r=>{
                      const n=Math.floor(r/3);
                      const rem=r-3*n;
                      return [n,n+(rem>=2?1:0),n+(rem>=1?1:0)];
                    };
                    const scaleX=w/workW,scaleY=h/workH;
                    // Six low-resolution passes: X box 1,2,3 then Y box 1,2,3.
                    // Each GPU sample contributes to all three RGB channels with
                    // independent weights, unlike the former common-width kernel.
                    for(let passIndex=0;passIndex<6;passIndex++){
                      const isX=passIndex<3;
                      const stage=passIndex%3;
                      const pixelWidths=isX?widthsX:widthsY;
                      const scale=isX?scaleX:scaleY;
                      const r0=[],r1=[],fracs=[];
                      for(const width of pixelWidths){
                        const low=Math.floor(width);
                        const fraction=rounding?0:width-low;
                        r0.push(split(low)[stage]/scale);
                        r1.push(split(low+1)[stage]/scale);
                        fracs.push(fraction);
                      }
                      const u=this.boxMat.uniforms;
                      u.uSource.value=workTexture;
                      u.uTexel.value.set(1/workW,1/workH);
                      u.uDirection.value.set(isX?1:0,isX?0:1);
                      u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                      u.uR0.value.set(...r0);
                      u.uR1.value.set(...r1);
                      u.uFrac.value.set(...fracs);
                      u.uMaxRadius.value=Math.min(32,Math.ceil(Math.max(...r0,...r1)));
                      const target=targets[passIndex%2];
                      this.quad.material=this.boxMat;
                      renderer.render(this.scene,this.camera,target,true);
                      workTexture=target.texture;
                    }
                    return workTexture;
                    };
                    const fine=runKernel(fineLevel,this.aeTargets);
                    if(mix>0.000001){
                      const target=this.aeFine;
                      const fw=fine.image?.width||this.aeTargets[1].width;
                      const fh=fine.image?.height||this.aeTargets[1].height;
                      if(target.width!==fw||target.height!==fh)target.setSize(fw,fh);
                      const u=this.downMat.uniforms;
                      u.uSource.value=fine;u.uTexel.value.set(0,0);u.uEdgeMode.value=1;
                      this.quad.material=this.downMat;
                      renderer.render(this.scene,this.camera,target,true);
                      C.uAEFine.value=target.texture;
                      C.uAEGlow.value=runKernel(fineLevel+1,this.aeCoarseTargets);
                    }else{C.uAEFine.value=fine;C.uAEGlow.value=fine;}
                    C.uAEMix.value=mix;
                  }
                  // Performance mip samplers are still valid uniforms; they are
                  // ignored by the AE Match branch in the composite program.
                  for(let i=0;i<5;i++){
                    C[`uL${i}`].value=this.levels[0].blur.texture;
                    C[`uW${i}`].value.set(0,0,0);
                  }
                }else if(!p.show && (p.brightness||0)>0 && (p.glowWidth||0)>0 && p.engine!==1){
              const xWidth=Math.max(0,p.widthX===undefined?1:p.widthX);
              const yWidth=Math.max(0,p.widthY===undefined?1:p.widthY);
              const xScale=xWidth<.0001?0:Math.min(3,Math.sqrt(xWidth/Math.max(yWidth,.0001)));
              const yScale=yWidth<.0001?0:Math.min(3,Math.sqrt(yWidth/Math.max(xWidth,.0001)));
              const channel=[p.widthRed,p.widthGreen,p.widthBlue];
              const viewScale=Math.sqrt(renderScaleX*renderScaleY);
              const target=channel.map((v)=>Math.max(.01,(p.glowWidth||96)*Math.max(0,v===undefined?1:v)*Math.sqrt(xWidth*yWidth)*viewScale/3.0));
              const sigmaMip=[6,12,24,48,96];
              const weights=Array.from({length:5},()=>[0,0,0]);
              for(let channelIndex=0;channelIndex<3;channelIndex++){
                let sum=0;
                for(let i=0;i<mipCount;i++){
                  const ratio=Math.log(target[channelIndex]/sigmaMip[i]);
                  const weight=Math.exp(-.5*ratio*ratio/(.78*.78));
                  weights[i][channelIndex]=weight;
                  sum+=weight;
                }
                for(let i=0;i<mipCount;i++)weights[i][channelIndex]/=Math.max(sum,1e-12);
              }
              let previous=null,oldW=w,oldH=h;
              for(let i=0;i<mipCount;i++){
                const level=this.levels[i];
                const nw=Math.max(1,Math.round(oldW/2));
                const nh=Math.max(1,Math.round(oldH/2));
                for(const targetTex of [level.down,level.temp,level.blur]){
                  if(targetTex.width!==nw||targetTex.height!==nh)targetTex.setSize(nw,nh);
                }
                if(i===0){
                  const u=this.extractMat.uniforms;
                  u.uSource.value=source;
                  u.uSrcScale.value.copy(uvScale);
                      u.uTexel.value.set(1/w,1/h);
                      u.uSharp.value=0;
                      u.uThreshold.value=p.threshold===undefined?.5:p.threshold;
                  u.uThresholdAdd.value.set(...(p.thresholdAddColor||[0,0,0]));
                  u.uFromAlpha.value=p.glowFromAlpha||0;
                  u.uOpacityMode.value=p.opacity===undefined?1:p.opacity;
                  u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                  this.quad.material=this.extractMat;
                }else{
                  const u=this.downMat.uniforms;
                  u.uSource.value=previous.blur.texture;
                  u.uTexel.value.set(1/oldW,1/oldH);
                  u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                  this.quad.material=this.downMat;
                }
                renderer.render(this.scene,this.camera,level.down,true);
                let u=this.hMat.uniforms;
                u.uSource.value=level.down.texture;
                u.uTexel.value.set(1/nw,1/nh);
                u.uDirection.value.set(1,0);
                u.uAxisScale.value=xScale;
                u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                this.quad.material=this.hMat;
                renderer.render(this.scene,this.camera,level.temp,true);
                u=this.vMat.uniforms;
                u.uSource.value=level.temp.texture;
                u.uTexel.value.set(1/nw,1/nh);
                u.uDirection.value.set(0,1);
                u.uAxisScale.value=yScale;
                u.uEdgeMode.value=p.edgeMode===undefined?1:p.edgeMode;
                this.quad.material=this.vMat;
                renderer.render(this.scene,this.camera,level.blur,true);
                previous=level;
                oldW=nw;oldH=nh;
              }
              for(let i=0;i<5;i++){
                C[`uL${i}`].value=this.levels[Math.min(i,mipCount-1)].blur.texture;
                C[`uW${i}`].value.set(...weights[i]);
              }
            }else{
              // No glow work: use already initialized target objects (not read).
              for(let i=0;i<5;i++){
                C[`uL${i}`].value=this.levels[0].blur.texture;
                C[`uW${i}`].value.set(0,0,0);
              }
            }
            this.quad.material=this.compositeMat;
            renderer.render(this.scene,this.camera,writeBuffer,true);
          }finally{
            if(originalColor)renderer.setClearColor(originalColor,originalAlpha);
          }
        },
      };
      if(support)this.pass.render=support.matchPreview(this,THREE,this.pass.render);
      this.properties.load(data&&data.properties);
      if(/^S_Glow(?: HQ.*| \(beta [\d.]+\))?$/.test(data?.properties?.name||""))this.properties.name?.set("S_Glow (beta 1.0)");
      timeReady=true;
      const saved=data?.properties;
      if(saved?.time!==undefined && saved.timeMode===undefined){
        const savedTime=saved.time;
        const expression=typeof savedTime?.expression==="string"?savedTime.expression:savedTime?.expression?.source;
        const customKeys=Array.isArray(savedTime?.keyframes)&&savedTime.keyframes.some(key=>
          Number(key.value||0)!==0 || Number(key.frame||0)!==0);
        // Preserve explicit older clocks; migrate a plain "time" expression to Automatic.
        if(expression?.trim()!=="time" && (expression || customKeys))this.properties.timeMode.set(1);
      }
      this.syncAtmosphereTimeMode();
      this.update(0); // Ensure usable defaults before the first preview render.
    };
    this.toJSON=function(){return {type:this.type,properties:this.properties};};
    this.update=function(frame){
      this._sglowEnsureSequence?.();
      if(!this.pass)return;
      this.cached={};
      for(const key of Object.keys(this.propertyDefinitions)){
        if(["enabled","previewMatch","deband","atmosphereModel"].includes(key))continue;
        this.cached[key]=this.properties[key].get(frame);
      }
      Object.assign(this.cached,{previewMatch:1,deband:1,atmosphereModel:0});
      this.pass.enabled=this.properties.enabled.get(frame)===1;
    };
    // Native layer resolution is stable when the preview viewport changes.
    // Fall back to the input buffer for effects not attached to a normal layer.
    this.getReferenceResolution=function(w,h){
      let result=this.referenceResolution;
      try {
        const prop=this.parentLayer&&this.parentLayer.properties&&this.parentLayer.properties.resolution;
        if(prop&&typeof prop.get==="function"){
          const raw=prop.get();
          const x=Number(Array.isArray(raw)?raw[0]:raw&&raw.x);
          const y=Number(Array.isArray(raw)?raw[1]:raw&&raw.y);
          if(Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0){
            result=[x,y];this.referenceResolution=result;
          }
        }
      }catch(error){/* Parent layer may be initializing. */}
      return Array.isArray(result)&&result[0]>0&&result[1]>0?result:[w,h];
    };
    this.resize=function(){
      // readBuffer dimensions are still used for actual intermediate buffers.
      // This method only refreshes the native pixel reference for width mapping.
      this.getReferenceResolution(1,1);
    };
        this.unload=function(){
          timeDisposed=true;
          this.releaseSupport?.();
          this.borderResources?.dispose();
          this.previewResources?.dispose();
          this.aeFine?.dispose();
          if(this.aeTargets)for(const target of this.aeTargets)target.dispose();
          if(this.aeCoarseTargets)for(const target of this.aeCoarseTargets)target.dispose();
          if(this.fullExtract)this.fullExtract.dispose();
          if(this.levels)for(const level of this.levels){
        level.down.dispose();level.temp.dispose();level.blur.dispose();
      }
      for(const m of [this.extractMat,this.downMat,this.hMat,this.vMat,this.boxMat,this.compositeMat]){
        if(m)m.dispose();
      }
      if(this.quad&&this.quad.geometry)this.quad.geometry.dispose();
    };