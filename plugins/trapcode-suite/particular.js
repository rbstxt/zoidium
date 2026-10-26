// OpenZoid Trapcode Suite — Particular.
/*
 * particular.js
 *
 * A Trapcode Particular style particle system implemented as a native
 * PZ.object3d type so it can live inside a normal 3D Scene layer next to
 * Shape / Light / Model objects. This file holds the shaders, the
 * Particular container class, and the System class core
 * (construction, presets, materials, loading). The simulation core
 * lives in particular-sim.js, the per-frame System methods in
 * particular-system.js, and the property schema with the designer
 * registration in particular-defs.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var clamp = T.clamp;
    var parseColor = T.parseColor;
    var colorBrightness = T.colorBrightness;
    var gradientColor = T.gradientColor;
    var curveValue = T.curveValue;
    var fillGradient = T.fillGradient;
    var fillCurve = T.fillCurve;
    var signature = T.signature;
    var createPalette = T.createPalette;
    var audioReactorLevel = T.particularSim.audioReactorLevel;
    var audioReactorsOn = T.particularSim.audioReactorsOn;

    // T.shading.VERTEX_LINES declares the shared light uniforms and the
    // shadeSurface() helper ahead of main(); the call site inside main is
    // gated by USE_SHADING so the legacy path is untouched while off.
    var VERTEX_MAIN = [
        "uniform vec2 resolution;",
        "uniform float time;",
        "uniform float rate;",
        "uniform float lifetime;",
        "uniform float lifeRandom;",
        "uniform vec3 accel;",
        "uniform vec3 ipos;",
        "uniform vec3 ivel;",
        "uniform float speed;",
        "uniform float emitterSize;",
        "uniform float emitterShape;",
        "uniform float behavior;",
        "uniform float burstInterval;",
        "uniform float vspread;",
        "uniform float controlSeed;",
        "uniform float velocityRandom;",
        "uniform float velocityDistribution;",
        "uniform vec3 drift;",
        "uniform float opacityRandom;",
        "uniform float colorRandom;",
        "uniform float turbulenceSize;",
        "uniform float turbulenceOpacity;",
        "uniform float turbulenceScale;",
        "uniform float size;",
        "uniform float sizeRandom;",
        "uniform float glow;",
        "uniform vec4 colorTint;",
        "uniform vec3 emitterVel;",
        "uniform float emitterVelAmt;",
        "uniform float massDiv;",
        "uniform float orient;",
        "uniform float orientFade;",
        "uniform float sceneFps;",
        "uniform vec3 rotBase;",
        "uniform vec3 spinRate;",
        "uniform float spinRnd;",
        "uniform float spinRateRnd;",
        "uniform float spinDist;",
        "uniform float rotAir;",
        "uniform float stretch;",
        "#ifdef USE_PARTICULAR_SPIN",
        "attribute vec3 spinOffset;",
        "#endif",
        "varying vec2 vMotion;",
        "varying float vElong;",
        "varying float vRot;",
        "varying vec2 vTilt;",
        "uniform sampler2D colorOverLife;",
        "uniform sampler2D sizeOverLife;",
        "uniform sampler2D opacityOverLife;",
        "uniform float audioLevel;",
        "uniform float audioOpacity;",
        "uniform float audioVelocity;",
        "uniform float audioColor;",
        "uniform float layerColorMix;",
        "uniform float layerSizeStrength;",
        "#ifdef USE_LAYER_COLOR",
        "uniform sampler2D layerColor;",
        "#endif",
        "#ifdef USE_LAYER_SIZE",
        "uniform sampler2D layerSize;",
        "#endif",
        "#ifdef USE_CPU",
        "attribute float life;",
        "attribute vec3 velocity;",
        "attribute float pid;",
        "#else",
        "attribute float pid;",
        "#endif",
        "varying vec4 vColor;",
        "varying float vGlow;",
        "float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }",
        "void main()",
        "{",
        "#ifdef USE_CPU",
        "float rawPhase = life;",
        "float alive = step(0.0, rawPhase);",
        "float phase = clamp(rawPhase, 0.0, 1.0);",
        "vec3 worldPos = position;",
        "#else",
        "float lifeScale = 1.0 + (rand(vec2(pid, 7.0)) - 0.5) * lifeRandom;",
        "float life = max(lifetime * lifeScale, 0.0001);",
        "float delay = pid / max(rate, 0.0001);",
        "float t;",
        "float alive;",
        "float age;",
        "float phase;",
        "if (behavior < 0.5) {",
        "t = time - delay;",
        "alive = step(0.0, t);",
        "age = mod(max(t, 0.0), life);",
        "phase = age / life;",
        "} else if (behavior < 1.5) {",
        "t = time;",
        "age = t;",
        "alive = step(0.0, t) * (1.0 - step(life, t));",
        "phase = clamp(age / life, 0.0, 1.0);",
        "age = min(max(age, 0.0), life);",
        "} else {",
        "float cycle = mod(time, max(burstInterval, 0.0001));",
        "t = cycle - delay;",
        "age = t;",
        "alive = step(0.0, t) * (1.0 - step(life, t));",
        "phase = clamp(max(age, 0.0) / life, 0.0, 1.0);",
        "age = min(max(age, 0.0), life);",
        "}",
        "vec3 jitter = vec3(rand(vec2(pid, 1.0)), rand(vec2(pid, 2.0)), rand(vec2(pid, 3.0))) - 0.5;",
        "vec3 jitter2 = vec3(rand(vec2(pid, 5.0)), rand(vec2(pid, 6.0)), rand(vec2(pid, 8.0))) - 0.5;",
        "vec3 emission = vec3(0.0);",
        "if (emitterShape > 0.5 && emitterShape < 1.5) emission = jitter * emitterSize;",
        "else if (emitterShape > 1.5 && emitterShape < 2.5) emission = normalize(jitter + vec3(0.0001, 0.0002, 0.0003)) * emitterSize * 0.5;",
        "vec3 rdir = normalize(jitter + vec3(0.0001, 0.0002, 0.0003));",
        "vec3 baseVel = length(ivel) > 0.0001 ? ivel : rdir * speed;",
        "if (velocityDistribution != 0.5 && velocityRandom != 0.0) {",
        "float rv = rand(vec2(pid + controlSeed, 31.0));",
        "baseVel *= 1.0 + 2.0 * velocityRandom * (pow(rv, exp((0.5 - velocityDistribution) * 4.0)) - rv);",
        "}",
        "vec3 vel = baseVel + emitterVel * emitterVelAmt + jitter2 * vspread;",
        "vec3 effAccel = accel / max(massDiv, 0.01);",
        "vec3 worldPos = ipos + emission + vel * age + effAccel * age * age * 0.5;",
        "if (length(drift) > 0.0) { worldPos += drift * age; vel += drift; }",
        "#endif",
        "#ifdef USE_CPU",
        "vec3 wVel = velocity;",
        "float wAge = clamp(phase, 0.0, 1.0) * max(lifetime, 0.0001);",
        "float wPid = pid;",
        "#else",
        "vec3 wVel = vel;",
        "float wAge = age;",
        "float wPid = pid;",
        "#endif",
        "worldPos += wVel * wAge * (audioVelocity - 1.0);",
        "wVel *= audioVelocity;",
        "float wK = max(rotAir, 0.0);",
        "float wDamp = wK > 0.0001 ? (1.0 - exp(-wK * wAge)) / wK : wAge;",
        "float wR1 = rand(vec2(wPid, 11.0));",
        "float wR2 = rand(vec2(wPid, 12.0));",
        "float wR3 = rand(vec2(wPid, 13.0));",
        "float wR4 = rand(vec2(wPid, 14.0));",
        "float wRateScale = 1.0 + (wR4 - 0.5) * 2.0 * spinRateRnd * (0.5 + spinDist);",
        "float wSpinZ = rotBase.z + (wR1 - 0.5) * 6.2831853 * spinRnd + spinRate.z * wRateScale * wDamp;",
        "float wTiltX = max(cos(rotBase.x + spinRate.x * wRateScale * wDamp), 0.2);",
        "float wTiltY = max(cos(rotBase.y + spinRate.y * wRateScale * wDamp), 0.2);",
        "#ifdef USE_PARTICULAR_SPIN",
        "wSpinZ += spinOffset.z;",
        "wTiltX = max(cos(rotBase.x + spinRate.x * wRateScale * wDamp + spinOffset.x), 0.2);",
        "wTiltY = max(cos(rotBase.y + spinRate.y * wRateScale * wDamp + spinOffset.y), 0.2);",
        "#endif",
        "vec4 wMv = modelViewMatrix * vec4(worldPos, 1.0);",
        "vec4 wCa = projectionMatrix * wMv;",
        "vec4 wCb = projectionMatrix * (modelViewMatrix * vec4(worldPos + wVel * 0.016, 1.0));",
        "vec2 wSv = (wCb.xy / max(wCb.w, 0.0001) - wCa.xy / max(wCa.w, 0.0001));",
        "wSv.x *= resolution.x / max(resolution.y, 1.0);",
        "float wSl = length(wSv);",
        "float wSpd = wSl / 0.016;",
        "float wMAng = wSl > 0.00001 ? atan(wSv.y, wSv.x) : 0.0;",
        "float wFade = orientFade < 0.5 ? 1.0 : clamp(wAge * sceneFps / orientFade, 0.0, 1.0);",
        "float wBlend = orient * wFade;",
        "float wElong = 1.0 + stretch * min(wSpd * 0.9, 3.0) * wBlend;",
        "vMotion = vec2(cos(wMAng), sin(wMAng));",
        "vElong = wElong;",
        "vRot = mix(wSpinZ, wMAng, wBlend);",
        "vTilt = vec2(wTiltX, wTiltY);",
        "vec2 layerUv = clamp(vec2(0.5) + worldPos.xy * 0.001, 0.0, 1.0);",
        "vec4 layerSample = vec4(1.0);",
        "float layerSizeSample = 1.0;",
        "#ifdef USE_LAYER_COLOR",
        "layerSample = texture2D(layerColor, layerUv);",
        "#endif",
        "#ifdef USE_LAYER_SIZE",
        "layerSizeSample = texture2D(layerSize, layerUv).r;",
        "#endif",
        "vec4 lifeColor = texture2D(colorOverLife, vec2(phase, 0.0));",
        "float lifeSize = texture2D(sizeOverLife, vec2(phase, 0.0)).r;",
        "float lifeOpacity = texture2D(opacityOverLife, vec2(phase, 0.0)).r;",
        "vec3 baseRgb = mix(lifeColor.rgb, lifeColor.rgb * layerSample.rgb, layerColorMix);",
        "float layerAlpha = mix(1.0, layerSample.a, layerColorMix);",
        "float sizeCull = step(0.004, lifeSize);",
        "vColor = vec4(baseRgb * colorTint.rgb, lifeColor.a * colorTint.a * lifeOpacity * layerAlpha) * (alive * sizeCull);",
        "if (colorRandom != 0.0) {",
        "vec3 randomRgb = vec3(rand(vec2(wPid + controlSeed, 41.0)), rand(vec2(wPid + controlSeed, 42.0)), rand(vec2(wPid + controlSeed, 43.0)));",
        "vColor.rgb = mix(vColor.rgb, randomRgb, colorRandom);",
        "}",
        "if (opacityRandom != 0.0) vColor.a *= 1.0 - rand(vec2(wPid + controlSeed, 44.0)) * opacityRandom;",
        "float fieldSize = 1.0;",
        "if (turbulenceSize != 0.0 || turbulenceOpacity != 0.0) {",
        "vec3 fieldPos = worldPos / max(turbulenceScale, 0.0001);",
        "float fieldTime = time * 0.1;",
        "float field = (sin(fieldPos.x + fieldTime) * cos(fieldPos.y * 1.3 - fieldTime) + sin(fieldPos.z * 0.7 + fieldTime * 0.5)) * 0.5;",
        "fieldSize = max(0.0, 1.0 + field * turbulenceSize);",
        "vColor.a *= max(0.0, 1.0 + field * turbulenceOpacity);",
        "}",
        "vColor.rgb *= audioColor;",
        "vColor.a *= audioOpacity;",
        "vGlow = glow;",
        "vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);",
        "#ifdef USE_SHADING",
        "vec3 shadeSpecTmp;",
        "vColor.rgb = vColor.rgb * shadeSurface(worldPos, shadeSpecTmp) + shadeSpecTmp;",
        "#endif",
        "#ifdef USE_CPU",
        "float pointSize = size * lifeSize * mix(1.0, layerSizeSample, layerSizeStrength);",
        "#else",
        "float pointSize = size * (1.0 + (rand(vec2(pid, 4.0)) - 0.5) * sizeRandom) * lifeSize * mix(1.0, layerSizeSample, layerSizeStrength);",
        "#endif",
        "if (turbulenceSize != 0.0) pointSize *= fieldSize;",
        "pointSize *= max(audioLevel, 0.0001);",
        "pointSize *= mix(1.0, wElong, 0.85);",
        "gl_PointSize = max(pointSize * resolution.y * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 1.0), 1.0);",
        "gl_Position = projectionMatrix * mvPosition;",
        "}",
    ];

    var VERTEX_SHADER = T.shading.VERTEX_LINES.concat(VERTEX_MAIN).join("\n");

    var FRAGMENT_SHADER = [
        "uniform sampler2D image;",
        "uniform float opacity;",
        "uniform float aspect;",
        "varying vec4 vColor;",
        "varying float vGlow;",
        "varying vec2 vMotion;",
        "varying float vElong;",
        "varying float vRot;",
        "varying vec2 vTilt;",
        "void main()",
        "{",
        "vec2 pc = gl_PointCoord - 0.5;",
        "vec2 pt = vec2(pc.x / max(vTilt.x, 0.2), pc.y / max(vTilt.y, 0.2));",
        "float mAng = atan(vMotion.y, vMotion.x);",
        "float mc = cos(-mAng);",
        "float ms = sin(-mAng);",
        "vec2 mq = vec2(pt.x * mc - pt.y * ms, pt.x * ms + pt.y * mc);",
        "mq.x /= max(vElong, 1.0);",
        "float maskAmt = clamp(max(vElong - 1.0, (1.0 - min(vTilt.x, vTilt.y)) * 2.0), 0.0, 1.0);",
        "float mask = mix(1.0, smoothstep(0.5, 0.42, length(mq)), maskAmt);",
        "float rc = cos(-vRot);",
        "float rs = sin(-vRot);",
        "vec2 sp = vec2(pt.x * rc - pt.y * rs, pt.x * rs + pt.y * rc);",
        "if (aspect > 1.0) sp.y *= aspect;",
        "else if (aspect < 1.0) sp.x /= max(aspect, 0.01);",
        "vec4 tcolor = texture2D(image, sp + 0.5);",
        "if (aspect != 1.0 && (abs(sp.x) > 0.5 || abs(sp.y) > 0.5)) discard;",
        "vec3 rgb = tcolor.rgb * vColor.rgb + vColor.rgb * vGlow;",
        "gl_FragColor = vec4(rgb, tcolor.a * vColor.a * opacity * mask);",
        "if (gl_FragColor.a < 0.004) discard;",
        "}",
    ].join("\n");

    /* ------------------------------------------------------------------ */
    /* Particular (container of systems)                                  */
    /* ------------------------------------------------------------------ */

    PZ.object3d.particular = class extends PZ.object3d {
        constructor() {
            super();
            this.spinMode = 0;
            this.threeObj = new THREE.Object3D();
            this.systems = new PZ.objectList(this, PZ.object3d.particular.system);
            this.systems.name = "Systems";
            this.children.push(this.systems);
        }
        load(e) {
            // Picker data opts new objects into the working spin controls.
            // An absent flag always keeps saved objects on the legacy look.
            this.spinMode = e?.spinMode === 1 ? 1 : 0;
            this.properties.load(e && e.properties);
            if ("object" == typeof e && e.systems && e.systems.length) {
                for (var t = 0; t < e.systems.length; t++) {
                    var r = new PZ.object3d.particular.system();
                    this.systems.push(r);
                    r.loading = r.load(e.systems[t], this);
                }
            } else {
                var system = new PZ.object3d.particular.system();
                this.systems.push(system);
                system.loading = system.load(null, this);
                var objectType = e && "object" == typeof e ? e.objectType : 0;
                if (objectType === 1) system.applyPreset("burst");
                else if (objectType === 2) system.applyPreset("fountain");
                else if (objectType === 3) system.applyPreset("snow");
            }
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, spinMode: this.spinMode, properties: this.properties, systems: this.systems };
        }
        unload() {
            for (var i = 0; i < this.systems.length; i++) this.systems[i].unload();
        }
        update(e) {
            for (var i = 0; i < this.systems.length; i++) this.systems[i].update(e);
        }
        async prepare(e) {
            for (var i = 0; i < this.systems.length; i++) await this.systems[i].prepare(e);
        }
        zoidiumFrameReady(e) {
            for (var i = 0; i < this.systems.length; i++) {
                if (!this.systems[i].zoidiumFrameReady(e)) return false;
            }
            return true;
        }
    };

    PZ.object3d.particular.prototype.defaultName = "Particular";
    PZ.object3d.particular.presetTexturesList = [
        "circle_soft",
        "circle_sft2",
        "circle_soft3",
        "circle_soft4",
        "dots",
        "spots",
        "square_soft",
        "squae_soft_blob",
        "ring",
        "ring_blur",
        "star1",
        "star2",
        "star3",
        "flash1",
        "flash2",
        "flash3",
        "plume",
        "plume2",
        "plume3",
        "plume4",
        "nebula",
        "smokey",
        "splash",
        "splotch1",
        "splotch2",
        "artsy",
        "clumpy_blurry",
        "misc",
        "skull",
        "squiggles",
        "tentacles",
        "tribal",
        "twisted",
        "waterfall",
        "bar_blur",
        "ring_partial",
    ];

    PZ.object3d.particular.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Particular" },
    };

    /* ------------------------------------------------------------------ */
    /* System                                                             */
    /* ------------------------------------------------------------------ */

    PZ.object3d.particular.system = class extends PZ.object {
        static create() {
            return new PZ.object3d.particular.system();
        }
        constructor() {
            super();
            this.particular = null;
            this.threeObj = new THREE.Points(new THREE.BufferGeometry(), new THREE.Material());
            this.threeObj.frustumCulled = false;
            this.threeObj.onBeforeRender = function (renderer) {
                if (!this.material || !this.material.uniforms) return;
                var size = renderer.getSize();
                this.material.uniforms.resolution.value.set(size.width, size.height);
            };
            this.material = null;
            this.texture = null;
            this.palettes = {
                colorOverLife: createPalette(),
                sizeOverLife: createPalette(),
                opacityOverLife: createPalette(),
            };
            this._count = -1;
            this.properties = new PZ.propertyList(
                {
                    name: PZ.property.create(PZ.object3d.particular.system.propertyDefinitions.name),
                    emitter: new PZ.propertyList(PZ.object3d.particular.system.emitterDefinitions),
                    particle: new PZ.propertyList(PZ.object3d.particular.system.particleDefinitions),
                    physics: new PZ.propertyList(PZ.object3d.particular.system.physicsDefinitions),
                    environment: new PZ.propertyList(PZ.object3d.particular.system.environmentDefinitions),
                    displace: new PZ.propertyList(PZ.object3d.particular.system.displaceDefinitions),
                    spherical: new PZ.propertyList(PZ.object3d.particular.system.sphericalDefinitions),
                    kaleidospace: new PZ.propertyList(PZ.object3d.particular.system.kaleidoDefinitions),
                    transform: new PZ.propertyList(PZ.object3d.particular.system.transformDefinitions),
                    layerMaps: new PZ.propertyList(PZ.object3d.particular.system.layerMapDefinitions),
                    audio: new PZ.propertyList(PZ.object3d.particular.system.audioDefinitions),
                    lighting: new PZ.propertyList(PZ.object3d.particular.system.lightingDefinitions),
                },
                this
            );
            // CM3 subscribes numeric controls to onChanged when it is present.
            // Bridge native history notifications for the reactor strengths too.
            if (PZ.observable) {
                for (var reactor = 1; reactor <= 4; reactor++) {
                    var strength = this.properties.audio["reactor" + reactor + "Strength"];
                    // Dynamic values come from keyframes, not a static value.
                    // CM3 must not eagerly read the control before load seeds them.
                    strength.value = undefined;
                    if (!strength.onChanged) strength.onChanged = new PZ.observable();
                    if (strength.onKeyframeChanged) strength.onKeyframeChanged.watch(function () {
                        this.onChanged.update(PZ.trapcode.currentTime);
                    }.bind(strength));
                }
            }
            var groups = {
                emitter: "Emitter",
                particle: "Particle",
                physics: "Physics",
                environment: "Environment",
                displace: "Displace",
                spherical: "Spherical Field",
                kaleidospace: "Kaleidospace",
                transform: "Transform",
                layerMaps: "Layer Maps",
                audio: "Audio React",
                lighting: "Lighting",
            };
            for (var g in groups) {
                Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
            }
            var propertyList = this.properties;
            Object.defineProperty(propertyList, "toJSON", {
                value: function () {
                    var result = {};
                    var keys = Object.keys(this);
                    for (var k = 0; k < keys.length; k++) result[keys[k]] = this[keys[k]];
                    return result;
                },
                writable: true,
            });
            this.children = [this.properties];
            this.onParentChanged.watch(
                function () {
                    if (!this.threeObj) return;
                    if (this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
                    if (!this.parent) return;
                    var particular = T.findParent(this, PZ.object3d.particular);
                    if (particular && particular.threeObj) particular.threeObj.add(this.threeObj);
                }.bind(this)
            );
        }
        get parentParticular() {
            return T.findParent(this, PZ.object3d.particular);
        }
        get parentSystemIndex() {
            var emitter = this.properties && this.properties.emitter;
            if (emitter && emitter.parentSystemIndex) {
                return Math.max(0, Math.round(emitter.parentSystemIndex.get(PZ.trapcode.currentTime) || 0));
            }
            return 0;
        }
        get parentSystem() {
            var particular = this.parentParticular;
            if (!particular || !particular.systems || !particular.systems.length) return null;
            var idx = this.parentSystemIndex;
            if (idx >= particular.systems.length) idx = 0;
            return particular.systems[idx] || null;
        }
        get primarySystem() {
            var particular = this.parentParticular;
            if (!particular) return null;
            return particular.systems && particular.systems.length ? particular.systems[0] : null;
        }
        get palette() {
            return this.palettes;
        }
        applyPreset(name) {
            var p = this.properties;
            if (name === "burst") {
                p.emitter.particlesPerSec.set(0);
                p.emitter.burstCount.set(120);
                p.particle.life.set(1.6);
                p.emitter.velocity.set(380);
                p.emitter.velocityRandom.set(80);
                p.emitter.directionSpread.set(180);
                p.particle.size.set(6);
                p.particle.colorGradient.set([
                    { position: 0, color: "rgba(255,255,255,1)" },
                    { position: 0.6, color: "rgba(255,220,120,1)" },
                    { position: 1, color: "rgba(255,60,0,0)" },
                ]);
                p.physics.drag.set(0.02);
                p.emitter.randomSeed.set(101);
            } else if (name === "fountain") {
                p.emitter.particlesPerSec.set(300);
                p.emitter.burstCount.set(0);
                p.particle.life.set(2.4);
                p.emitter.velocity.set(260);
                p.emitter.velocityRandom.set(12);
                p.emitter.direction.set([0, -1, 0]);
                p.emitter.directionSpread.set(16);
                p.particle.size.set(4);
                p.physics.gravity.set(180);
                p.particle.colorGradient.set([
                    { position: 0, color: "rgba(180,220,255,1)" },
                    { position: 1, color: "rgba(40,90,255,0)" },
                ]);
                p.emitter.randomSeed.set(202);
            } else if (name === "snow") {
                p.emitter.particlesPerSec.set(220);
                p.emitter.burstCount.set(0);
                p.particle.life.set(6);
                p.particle.lifeRandom.set(40);
                p.emitter.velocity.set(40);
                p.emitter.velocityRandom.set(50);
                p.particle.size.set(3);
                p.physics.gravity.set(12);
                p.environment.windX.set(25);
                p.particle.opacity.set(90);
                p.particle.colorGradient.set([{ position: 0, color: "rgba(255,255,255,1)" }]);
                p.emitter.randomSeed.set(303);
            }
            this.rebuildMaterial();
            this.redrawTexture();
        }
        rebuildMaterial() {
            var palette = this.palettes;
            this.material = new THREE.ShaderMaterial({
                uniforms: {
                    resolution: { type: "v2", value: new THREE.Vector2(1920, 1080) },
                    image: { type: "t", value: this.material ? this.material.uniforms.image.value : null },
                    colorOverLife: { type: "t", value: palette ? palette.colorOverLife : null },
                    sizeOverLife: { type: "t", value: palette ? palette.sizeOverLife : null },
                    opacityOverLife: { type: "t", value: palette ? palette.opacityOverLife : null },
                    time: { type: "f", value: 0 },
                    rate: { type: "f", value: 1 },
                    lifetime: { type: "f", value: 1 },
                    lifeRandom: { type: "f", value: 0 },
                    accel: { type: "v3", value: new THREE.Vector3() },
                    ipos: { type: "v3", value: new THREE.Vector3() },
                    ivel: { type: "v3", value: new THREE.Vector3() },
                    speed: { type: "f", value: 100 },
                    emitterSize: { type: "f", value: 0 },
                    emitterShape: { type: "f", value: 0 },
                    behavior: { type: "f", value: 0 },
                    burstInterval: { type: "f", value: 1 },
                    vspread: { type: "f", value: 0 },
                    controlSeed: { type: "f", value: 0 },
                    velocityRandom: { type: "f", value: 0.2 },
                    velocityDistribution: { type: "f", value: 0.5 },
                    drift: { type: "v3", value: new THREE.Vector3() },
                    opacityRandom: { type: "f", value: 0 },
                    colorRandom: { type: "f", value: 0 },
                    aspect: { type: "f", value: 1 },
                    turbulenceSize: { type: "f", value: 0 },
                    turbulenceOpacity: { type: "f", value: 0 },
                    turbulenceScale: { type: "f", value: 10 },
                    size: { type: "f", value: 5 },
                    sizeRandom: { type: "f", value: 0 },
                    opacity: { type: "f", value: 1 },
                    colorTint: { type: "v4", value: new THREE.Vector4(1, 1, 1, 1) },
                    glow: { type: "f", value: 0 },
                    emitterVel: { type: "v3", value: new THREE.Vector3() },
                    emitterVelAmt: { type: "f", value: 0 },
                    massDiv: { type: "f", value: 1 },
                    orient: { type: "f", value: 0 },
                    orientFade: { type: "f", value: 20 },
                    sceneFps: { type: "f", value: 30 },
                    rotBase: { type: "v3", value: new THREE.Vector3() },
                    spinRate: { type: "v3", value: new THREE.Vector3() },
                    spinRnd: { type: "f", value: 0 },
                    spinRateRnd: { type: "f", value: 0 },
                    spinDist: { type: "f", value: 0.5 },
                    rotAir: { type: "f", value: 0 },
                    stretch: { type: "f", value: 0 },
                    audioLevel: { type: "f", value: 1 },
                    audioOpacity: { type: "f", value: 1 },
                    audioVelocity: { type: "f", value: 1 },
                    audioColor: { type: "f", value: 1 },
                    layerColorMix: { type: "f", value: 1 },
                    layerSizeStrength: { type: "f", value: 1 },
                    layerColor: { type: "t", value: this.layerColorTex || null },
                    layerSize: { type: "t", value: this.layerSizeTex || null },
                },
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                defines: {},
                transparent: true,
                depthTest: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });
            // Shared light uniforms for the Lighting group. Always present so
            // toggling shading never reallocates the material; the shader
            // only reads them under USE_SHADING.
            var shadeUniforms = T.shading.newUniforms();
            for (var shadeKey in shadeUniforms) this.material.uniforms[shadeKey] = shadeUniforms[shadeKey];
            this.threeObj.material = this.material;
        }
        redrawTexture() {
            if (!this.material) return;
            var value = this.properties.particle.texture.get(PZ.trapcode.currentTime);
            if (this._textureValue === value && this.texture) return;
            this._textureValue = value;
            var project = T.findParent(this, PZ.project);
            if (this.texture) {
                T.disposeImageUniform(this.material, "image");
                project && project.assets.unload(this.texture);
                this.texture = null;
                this.material.uniforms.image.value = null;
            }
            if (value && project) {
                this.texture = new PZ.asset.image(project.assets.load(value));
                this.material.uniforms.image.value = this.texture.getTexture(true);
            }
            this.material.needsUpdate = true;
        }
        loadLayerTexture(property, key, uniformName) {
            var project = T.findParent(this, PZ.project);
            var value = property ? property.get(PZ.trapcode.currentTime) : null;
            if (this[key + "Value"] === value && this[key]) return;
            this[key + "Value"] = value;
            if (this[key]) {
                T.disposeImageUniform(this.material, uniformName);
                project && project.assets.unload(this[key]);
                this[key] = null;
            }
            if (value && project) {
                this[key] = new PZ.asset.image(project.assets.load(value));
            }
            if (this.material) {
                this.material.uniforms[uniformName].value = this[key] ? this[key].getTexture(true) : null;
                this.material.needsUpdate = true;
            }
        }
        updateLayerMaps() {
            if (!this.material) return;
            var maps = this.properties.layerMaps;
            var colorOn = maps.colorAlphaEnabled.get(PZ.trapcode.currentTime) === 1;
            var sizeOn = maps.sizeEnabled.get(PZ.trapcode.currentTime) === 1;
            if (colorOn) this.loadLayerTexture(maps.colorAlphaLayer, "layerColorTex", "layerColor");
            if (sizeOn) this.loadLayerTexture(maps.sizeLayer, "layerSizeTex", "layerSize");
            if (colorOn) this.material.defines.USE_LAYER_COLOR = 1;
            else delete this.material.defines.USE_LAYER_COLOR;
            if (sizeOn) this.material.defines.USE_LAYER_SIZE = 1;
            else delete this.material.defines.USE_LAYER_SIZE;
            this.material.uniforms.layerColorMix.value = maps.colorAlphaMix.get(PZ.trapcode.currentTime) / 100;
            this.material.uniforms.layerSizeStrength.value = maps.sizeStrength.get(PZ.trapcode.currentTime) / 100;
            this.material.needsUpdate = true;
        }
        updateAudio() {
            if (!this.material) return;
            var audio = this.properties.audio;
            var frame = PZ.trapcode.currentTime;
            var factors = [1, 1, 1, 1];
            if (audioReactorsOn(audio, frame)) {
                var source = audio.audioLayer.get(frame);
                var audioEntry = this.requestAudio(frame);
                if (source && !T.audioAnalysis.has(source) && this._audioRequest !== source) {
                    this._audioRequest = source;
                    var self = this;
                    audioEntry.promise.then(function () {
                        if (audioEntry.status !== "ready") return;
                        // The preview path never awaits prepareAudio: without
                        // an explicit redraw the reactors stay neutral until
                        // some unrelated change redraws (BUG-02). Re-running
                        // the current frame picks up the decoded levels. The
                        // one-shot flag keeps this from re-arming its own
                        // load when the analysis is still pending.
                        audio.audioLayer.onChanged?.update();
                        if (self._audioRequest === source && self._audioRedrawnFor !== source &&
                            self.material && PZ.trapcode.currentTime !== undefined) {
                            self._audioRedrawnFor = source;
                            try {
                                self.update(PZ.trapcode.currentTime);
                            } catch (_redraw) { /* best effort: next frame picks it up */ }
                        }
                    }, function (error) {
                        console.warn("Trapcode Particular: audio analysis failed; reactors stay neutral.", error);
                    });
                }
                var level = audioReactorLevel(this, frame);
                for (var i = 1; i <= 4; i++) {
                    if (audio["reactor" + i + "Enabled"].get(frame) !== 1) continue;
                    var target = Math.round(audio["reactor" + i + "Target"].get(frame));
                    var strength = audio["reactor" + i + "Strength"].get(frame) / 100;
                    if (target >= 0 && target < 4) factors[target] *= Math.max(0, 1 + (level - 0.5) * 2 * strength);
                }
            }
            this.material.uniforms.audioLevel.value = factors[0];
            this.material.uniforms.audioOpacity.value = factors[1];
            this.material.uniforms.audioVelocity.value = factors[2];
            this.material.uniforms.audioColor.value = factors[3];
        }

        load(e, parent) {
            this.particular = parent || this.particular;
            this.properties.load(e && e.properties);
            if (!this.material) this.rebuildMaterial();
            this.redrawTexture();
            this._count = -1;
            var particular = this.particular || this.parentParticular;
            if (this.threeObj) {
                if (this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
                if (particular && particular.threeObj) particular.threeObj.add(this.threeObj);
            }
        }
        toJSON() {
            return { type: this.type, properties: this.properties };
        }
        unload() {
            if (this._audioAssets) this._audioAssets.clear();
            if (this.threeObj && this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
            if (this.threeObj && this.threeObj.geometry) this.threeObj.geometry.dispose();
            T.disposeImageUniform(this.material, "image");
            T.disposeImageUniform(this.material, "layerColor");
            T.disposeImageUniform(this.material, "layerSize");
            if (this.material) this.material.dispose();
            if (this.palettes) {
                this.palettes.colorOverLife.dispose();
                this.palettes.sizeOverLife.dispose();
                this.palettes.opacityOverLife.dispose();
                this.palettes = null;
            }
            if (this.texture) {
                var project = T.findParent(this, PZ.project);
                project && project.assets.unload(this.texture);
                this.texture = null;
            }
            var unloadLayer = function (self, key) {
                if (self[key]) {
                    var p = T.findParent(self, PZ.project);
                    p && p.assets.unload(self[key]);
                    self[key] = null;
                }
            };
            unloadLayer(this, "layerColorTex");
            unloadLayer(this, "layerSizeTex");
        }
        particleCount() {
            var emitter = this.properties.emitter;
            var perSec = emitter.particlesPerSec.get(PZ.trapcode.currentTime);
            var life = this.properties.particle.life.get(PZ.trapcode.currentTime);
            var base = Math.max(1, Math.round(perSec * life));
            if (emitter.emitFromParent && emitter.emitFromParent.get(PZ.trapcode.currentTime) === 1) {
                var parent = this.parentSystem;
                if (parent && parent !== this) {
                    // each parent particle acts as an emitter at perSec (like AE Particular)
                    var ratePerParent = perSec;
                    if (emitter.ratePercent && emitter.ratePercent.get(PZ.trapcode.currentTime) === 1) {
                        ratePerParent = parent.properties.emitter.particlesPerSec.get(PZ.trapcode.currentTime) * (perSec / 100);
                    }
                    var parentCount = Math.max(1, Math.round(parent.particleCount ? parent.particleCount() : 1));
                    base = Math.max(1, Math.round(ratePerParent * life * parentCount));
                }
            }
            // System 2+: double the particles/sec-driven count (2x density).
            return Math.max(1, Math.round(base * this.secondaryCountMultiplier()));
        }
        updateGeometry() {
            var emitter = this.properties.emitter;
            var burst = emitter.burstCount.get(PZ.trapcode.currentTime);
            var count = Math.round(burst > 0 ? burst * this.secondaryCountMultiplier() : this.particleCount());
            count = clamp(count, 0, 50000);
            if (this._count === count && this._mode === "gpu") return;
            this._count = count;
            this._mode = "gpu";
            if (this.threeObj.geometry) this.threeObj.geometry.dispose();
            var pid = new Float32Array(count);
            for (var i = 0; i < count; i++) pid[i] = i;
            var geometry = new THREE.BufferGeometry();
            geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            geometry.addAttribute("pid", new THREE.BufferAttribute(pid, 1));
            this.threeObj.geometry = geometry;
        }
        emitterVectors() {
            var emitter = this.properties.emitter;
            var t = PZ.trapcode.currentTime;
            var position = emitter.position.get(t);
            var direction = emitter.direction.get(t);
            var speed = emitter.velocity.get(t);
            var velocity = [0, 0, 0];
            var length = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
            if (length > 0.0001) {
                velocity = [(direction[0] / length) * speed, (direction[1] / length) * speed, (direction[2] / length) * speed];
            }
            var spread = speed * (emitter.velocityRandom.get(t) / 100) + speed * (emitter.directionSpread.get(t) / 360);
            return {
                position: position,
                velocity: velocity,
                speed: speed,
                emitterSize: emitter.emitterSize.get(t),
                emitterShape: emitter.emitterType.get(t),
                behavior: emitter.emitterBehavior.get(t),
                burstInterval: emitter.burstInterval.get(t),
                spread: spread,
            };
        }
        sceneRate() {
            var sequence = T.findParent(this, PZ.sequence);
            return sequence ? sequence.properties.rate.get(PZ.trapcode.currentTime) || 1 : 1;
        }
    };

})();
