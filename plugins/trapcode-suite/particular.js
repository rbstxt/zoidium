// OpenZoid Trapcode Suite — Particular (ported verbatim from particular.js).
/*
 * particular.js
 *
 * A Trapcode Particular style particle system implemented as a native
 * PZ.object3d type so it can live inside a normal 3D Scene layer next to
 * Shape / Light / Model objects. It plugs into the existing property,
 * keyframe, expression, material, camera, DOF and motion blur systems.
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

    // Guarded property reads for parameters added after earlier saves:
    // objects deserialized from old projects lack these controls, so every
    // new read falls back to the definition default instead of throwing.
    function tnum(obj, key, fb) {
        try {
            if (!obj || !obj[key]) return fb;
            var v = obj[key].get(PZ.trapcode.currentTime);
            return typeof v === "number" && isFinite(v) ? v : fb;
        } catch (err) {
            return fb;
        }
    }

    var VERTEX_SHADER = [
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
        "varying vec2 vMotion;",
        "varying float vElong;",
        "varying float vRot;",
        "varying vec2 vTilt;",
        "uniform sampler2D colorOverLife;",
        "uniform sampler2D sizeOverLife;",
        "uniform sampler2D opacityOverLife;",
        "uniform float audioLevel;",
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
        "vec3 vel = baseVel + emitterVel * emitterVelAmt + jitter2 * vspread;",
        "vec3 effAccel = accel / max(massDiv, 0.01);",
        "vec3 worldPos = ipos + emission + vel * age + effAccel * age * age * 0.5;",
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
        "vGlow = glow;",
        "vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);",
        "#ifdef USE_CPU",
        "float pointSize = size * lifeSize * mix(1.0, layerSizeSample, layerSizeStrength);",
        "#else",
        "float pointSize = size * (1.0 + (rand(vec2(pid, 4.0)) - 0.5) * sizeRandom) * lifeSize * mix(1.0, layerSizeSample, layerSizeStrength);",
        "#endif",
        "pointSize *= max(audioLevel, 0.0001);",
        "pointSize *= mix(1.0, wElong, 0.85);",
        "gl_PointSize = max(pointSize * resolution.y * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 1.0), 1.0);",
        "gl_Position = projectionMatrix * mvPosition;",
        "}",
    ].join("\n");

    var FRAGMENT_SHADER = [
        "uniform sampler2D image;",
        "uniform float opacity;",
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
        "vec4 tcolor = texture2D(image, sp + 0.5);",
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
            this.threeObj = new THREE.Object3D();
            this.systems = new PZ.objectList(this, PZ.object3d.particular.system);
            this.systems.name = "Systems";
            this.children.push(this.systems);
        }
        load(e) {
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
            return { type: this.type, properties: this.properties, systems: this.systems };
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

    var systemPropertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "System" },
    };

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
                    var particular = this.tryGetParentOfType(PZ.object3d.particular);
                    if (particular && particular.threeObj) particular.threeObj.add(this.threeObj);
                }.bind(this)
            );
        }
        get parentParticular() {
            return this.getParentOfType(PZ.object3d.particular);
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
        primarySource() {
            var source = this.parentSystem;
            if (!source || source === this) return null;
            if (source.cpu && source.cpu.count) return source.cpu;
            return null;
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
            this.threeObj.material = this.material;
        }
        redrawTexture() {
            if (!this.material) return;
            var value = this.properties.particle.texture.get(PZ.trapcode.currentTime);
            if (this._textureValue === value && this.texture) return;
            this._textureValue = value;
            var project = this.tryGetParentOfType(PZ.project);
            if (this.texture) {
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
            var project = this.tryGetParentOfType(PZ.project);
            var value = property ? property.get(PZ.trapcode.currentTime) : null;
            if (this[key + "Value"] === value && this[key]) return;
            this[key + "Value"] = value;
            if (this[key]) {
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
            var enabled = audio.reactor1Enabled.get(PZ.trapcode.currentTime) === 1 ||
                audio.reactor2Enabled.get(PZ.trapcode.currentTime) === 1 ||
                audio.reactor3Enabled.get(PZ.trapcode.currentTime) === 1 ||
                audio.reactor4Enabled.get(PZ.trapcode.currentTime) === 1;
            if (!enabled) {
                this.material.uniforms.audioLevel.value = 1;
                return;
            }
            var level = 1;
            if (enabled && typeof CM !== "undefined" && CM.playback && CM.playback.audioDst) {
                try {
                    var analyser = CM.playback.audioDst;
                    if (!this._audioData || this._audioData.length !== analyser.frequencyBinCount) {
                        this._audioData = new Uint8Array(analyser.frequencyBinCount);
                    }
                    analyser.getByteFrequencyData(this._audioData);
                    var sum = 0;
                    for (var i = 0; i < this._audioData.length; i++) sum += this._audioData[i];
                    level = sum / this._audioData.length / 255;
                } catch (err) {
                    level = 0.5;
                }
            } else if (enabled) {
                level = 0.5;
            }
            var strength = audio.reactor1Strength.get(PZ.trapcode.currentTime) / 100;
            this.material.uniforms.audioLevel.value = 1 + (level - 0.5) * 2 * strength;
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
            if (this.threeObj && this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
            if (this.threeObj && this.threeObj.geometry) this.threeObj.geometry.dispose();
            if (this.material) this.material.dispose();
            if (this.palettes) {
                this.palettes.colorOverLife.dispose();
                this.palettes.sizeOverLife.dispose();
                this.palettes.opacityOverLife.dispose();
                this.palettes = null;
            }
            if (this.texture) {
                var project = this.tryGetParentOfType(PZ.project);
                project && project.assets.unload(this.texture);
                this.texture = null;
            }
            var unloadLayer = function (self, key) {
                if (self[key]) {
                    var p = self.tryGetParentOfType(PZ.project);
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
            var sequence = this.tryGetParentOfType(PZ.sequence);
            return sequence ? sequence.properties.rate.get(PZ.trapcode.currentTime) || 1 : 1;
        }
        needsCPU() {
            var p = this.properties;
            var e = p.emitter;
            if (e.emitFromParent && e.emitFromParent.get(PZ.trapcode.currentTime) === 1) return true;
            var particular = this.parentParticular;
            if (particular && particular.systems && particular.systems.indexOf) {
                var myIndex = particular.systems.indexOf(this);
                for (var sib = 0; sib < particular.systems.length; sib++) {
                    var child = particular.systems[sib];
                    if (child === this) continue;
                    var ce = child.properties && child.properties.emitter;
                    if (!ce || !ce.emitFromParent || ce.emitFromParent.get(PZ.trapcode.currentTime) !== 1) continue;
                    var wants = child.parentSystemIndex !== undefined ? child.parentSystemIndex : 0;
                    if (wants === myIndex) return true;
                }
            }
            if (e.position.animated || e.direction.animated || e.velocity.animated) return true;
            if (p.physics.enabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.bounceEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.meanderEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.flockingEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.fluidEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.environment.turbulenceEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.displace.disperse.get(PZ.trapcode.currentTime) !== 0) return true;
            if (p.displace.twist.get(PZ.trapcode.currentTime) !== 0) return true;
            if (p.displace.spinAmplitude.get(PZ.trapcode.currentTime) !== 0) return true;
            // Per-particle mass/drag variance has no closed GPU form.
            try {
                if (p.physics.massRandom && p.physics.massRandom.get(PZ.trapcode.currentTime) !== 0) return true;
                if (p.physics.sizeAffectsMass && p.physics.sizeAffectsMass.get(PZ.trapcode.currentTime) !== 0) return true;
                if (p.physics.airResistanceRandom && p.physics.airResistanceRandom.get(PZ.trapcode.currentTime) !== 0) return true;
                if (p.physics.sizeAffectsAirResistance && p.physics.sizeAffectsAirResistance.get(PZ.trapcode.currentTime) !== 0) return true;
            } catch (_mv) { /* absent on old saves: stays on GPU */ }
            if (p.spherical.strength.get(PZ.trapcode.currentTime) !== 0) return true;
            if (p.kaleidospace.mirrorX.get(PZ.trapcode.currentTime) === 1 || p.kaleidospace.mirrorY.get(PZ.trapcode.currentTime) === 1 || p.kaleidospace.mirrorZ.get(PZ.trapcode.currentTime) === 1) return true;
            return false;
        }
        emitterBehaviorValue() {
            var e = this.properties && this.properties.emitter;
            if (!e || !e.emitterBehavior) return 0;
            var v = e.emitterBehavior.get(PZ.trapcode.currentTime);
            v = Math.round(v || 0);
            if (v < 0) v = 0;
            if (v > 2) v = 2;
            return v;
        }
        burstIntervalValue() {
            var e = this.properties && this.properties.emitter;
            if (!e || !e.burstInterval) return 1;
            return Math.max(e.burstInterval.get(PZ.trapcode.currentTime) || 1, 0.0001);
        }
        emissionRateValue(count) {
            var e = this.properties && this.properties.emitter;
            if (!e) return Math.max(count || 1, 1);
            var perSec = e.particlesPerSec ? e.particlesPerSec.get(PZ.trapcode.currentTime) : 0;
            var burst = e.burstCount ? e.burstCount.get(PZ.trapcode.currentTime) : 0;
            if (burst > 0 && perSec <= 0) return Math.max(count || 1, 1);
            return Math.max(perSec || 0, 1);
        }
        isEmitFromParent() {
            var e = this.properties && this.properties.emitter;
            return !!(e && e.emitFromParent && e.emitFromParent.get(PZ.trapcode.currentTime) === 1);
        }
        parentAliveFor(i) {
            // System 2 (emit from parent): is the assigned parent particle alive?
            // Dead / not-yet-born parents (phase -1: exploded finished, burst gap)
            // must not spawn new children, otherwise streaks linger forever from
            // the parent's frozen corpse positions.
            var source = this.primarySource();
            if (!source || !source.count) return true;
            var src = i % source.count;
            if (source.phases && source.phases[src] < 0) return false;
            return true;
        }
        secondaryCountMultiplier() {
            // System 2+ (any non-primary system) runs at 2x density: its final
            // particle count is doubled, so its effective particles/sec doubles.
            // Primary System (index 0) is unaffected.
            try {
                var particular = this.tryGetParentOfType(PZ.object3d.particular);
                if (!particular || !particular.systems || !particular.systems.indexOf) return 1;
                return particular.systems.indexOf(this) > 0 ? 2 : 1;
            } catch (err) {
                return 1;
            }
        }
        initCPU(count, simTime) {
            this.cpu = {
                positions: new Float32Array(count * 3),
                velocities: new Float32Array(count * 3),
                prevPositions: new Float32Array(count * 3),
                ages: new Float32Array(count),
                lives: new Float32Array(count),
                phases: new Float32Array(count),
                justReset: new Uint8Array(count),
                massVar: new Float32Array(count),
                dragVar: new Float32Array(count),
                count: count,
                initialized: false,
            };
            var behavior = this.emitterBehaviorValue();
            var now = typeof simTime === "number" && isFinite(simTime) ? Math.max(simTime, 0) : 0;
            var interval = this.burstIntervalValue();
            var rate = this.emissionRateValue(count);
            var seed = this.properties.emitter.randomSeed.get(PZ.trapcode.currentTime);
            var cycle = interval > 0 ? now % interval : 0;
            for (var i = 0; i < count; i++) {
                this.resetParticle(i, seed + i);
                var life = this.cpu.lives[i];
                if (behavior < 0.5) {
                    // continuous: stagger ages so the stream looks steady from the first frame.
                    // Applies to Primary System and System 2 alike.
                    this.cpu.ages[i] = life * ((i + 0.5) / Math.max(count, 1));
                    this.cpu.phases[i] = this.cpu.ages[i] / life;
                } else if (behavior < 1.5) {
                    // explode: every particle is born together at t=0, then dies and stays dead.
                    // Scrubbing past life shows dead particles (hidden via phase -1), not a re-loop.
                    var age = now;
                    this.cpu.ages[i] = age;
                    this.cpu.phases[i] = age >= 0 && age < life ? age / life : -1;
                } else {
                    // burst (periodic): staggered births inside each interval, dead until next burst.
                    var delay = i / Math.max(rate, 0.0001);
                    var bAge = cycle - delay;
                    this.cpu.ages[i] = bAge;
                    this.cpu.phases[i] = bAge >= 0 && bAge < life ? bAge / life : -1;
                }
                // Emit-from-parent (System 2): never spawn from a dead parent. Keeps the
                // child streaks joined to the parent explosion so no orphan pieces linger.
                if (this.isEmitFromParent() && !this.parentAliveFor(i)) {
                    this.cpu.phases[i] = -1;
                }
            }
            if (this.cpu.prevPositions) {
                this.cpu.prevPositions.set(this.cpu.positions);
            }
            this.cpu.initialized = true;
            this._lastCycle = cycle;
            this._behaviorCache = behavior;
        }
        resetParticle(i, seed, spawnFrac) {
            var p = this.properties;
            var emitter = p.emitter;
            var cpu = this.cpu;
            var vectors = this.emitterVectors();
            var position = vectors.position;
            var velocity = vectors.velocity;
            var spread = vectors.spread;
            var emitterSize = emitter.emitterSize.get(PZ.trapcode.currentTime);
            var rand = T.rand || function (s) {
                return Math.abs(Math.sin(s * 12.9898) * 43758.5453) % 1;
            };
            var jx = (rand(seed + i * 3) - 0.5) * 2;
            var jy = (rand(seed + i * 3 + 1) - 0.5) * 2;
            var jz = (rand(seed + i * 3 + 2) - 0.5) * 2;
            var emitterShape = vectors.emitterShape;
            var ex = 0;
            var ey = 0;
            var ez = 0;
            if (emitterShape === 1) {
                ex = jx * emitterSize * 0.5;
                ey = jy * emitterSize * 0.5;
                ez = jz * emitterSize * 0.5;
            } else if (emitterShape === 2) {
                var jl = Math.sqrt(jx * jx + jy * jy + jz * jz) || 1;
                ex = (jx / jl) * emitterSize * 0.5;
                ey = (jy / jl) * emitterSize * 0.5;
                ez = (jz / jl) * emitterSize * 0.5;
            }
            var emitParent = emitter.emitFromParent && emitter.emitFromParent.get(PZ.trapcode.currentTime) === 1;
            var srcPos = position;
            var srcVel = null;
            if (emitParent) {
                var source = this.primarySource();
                if (source && source.count > 0) {
                    var srcCount = source.count;
                    // deterministic even assignment: every parent gets the same number
                    // of children, evenly staggered => continuous streaks
                    var src = i % srcCount;
                    var frac = spawnFrac;
                    var parentTeleported = source.justReset && source.justReset[src];
                    if (frac !== undefined && source.prevPositions && !parentTeleported) {
                        srcPos = [
                            source.prevPositions[src * 3] + (source.positions[src * 3] - source.prevPositions[src * 3]) * frac,
                            source.prevPositions[src * 3 + 1] + (source.positions[src * 3 + 1] - source.prevPositions[src * 3 + 1]) * frac,
                            source.prevPositions[src * 3 + 2] + (source.positions[src * 3 + 2] - source.prevPositions[src * 3 + 2]) * frac,
                        ];
                    } else {
                        srcPos = [
                            source.positions[src * 3],
                            source.positions[src * 3 + 1],
                            source.positions[src * 3 + 2],
                        ];
                    }
                    if (source.velocities) {
                        srcVel = [
                            source.velocities[src * 3],
                            source.velocities[src * 3 + 1],
                            source.velocities[src * 3 + 2],
                        ];
                    }
                }
            }
            cpu.positions[i * 3] = srcPos[0] + ex;
            cpu.positions[i * 3 + 1] = srcPos[1] + ey;
            cpu.positions[i * 3 + 2] = srcPos[2] + ez;
            var baseVel = velocity;
            if (emitParent && srcVel) {
                var inherit = emitter.inheritVelocity
                    ? emitter.inheritVelocity.get(PZ.trapcode.currentTime) / 100
                    : 0;
                baseVel = [srcVel[0] * inherit, srcVel[1] * inherit, srcVel[2] * inherit];
            } else if (Math.abs(velocity[0]) + Math.abs(velocity[1]) + Math.abs(velocity[2]) < 0.0001) {
                var dx = jx;
                var dy = jy;
                var dz = jz;
                var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                baseVel = [(dx / dl) * vectors.speed, (dy / dl) * vectors.speed, (dz / dl) * vectors.speed];
            }
            var spreadScale = emitParent ? 0.12 : 1;
            cpu.velocities[i * 3] = baseVel[0] + (rand(seed + i * 13) - 0.5) * spread * spreadScale;
            cpu.velocities[i * 3 + 1] = baseVel[1] + (rand(seed + i * 13 + 1) - 0.5) * spread * spreadScale;
            cpu.velocities[i * 3 + 2] = baseVel[2] + (rand(seed + i * 13 + 2) - 0.5) * spread * spreadScale;
            // Streak support: per-particle mass/drag variance (birth-randomized)
            // plus velocity inherited from emitter motion.
            var tNow = PZ.trapcode.currentTime;
            var emitAmt = 0;
            try {
                emitAmt = emitter.velocityFromEmitterMotion
                    ? emitter.velocityFromEmitterMotion.get(tNow) / 100
                    : 0;
            } catch (_ev) { /* default 0 */ }
            if (emitAmt !== 0 && this._emitterVel && !emitParent) {
                cpu.velocities[i * 3] += this._emitterVel[0] * emitAmt;
                cpu.velocities[i * 3 + 1] += this._emitterVel[1] * emitAmt;
                cpu.velocities[i * 3 + 2] += this._emitterVel[2] * emitAmt;
            }
            var massR = 0;
            var sizeR = 0;
            var airR = 0;
            var airSizeR = 0;
            try {
                massR = p.physics.massRandom ? p.physics.massRandom.get(tNow) / 100 : 0;
                sizeR = p.physics.sizeAffectsMass ? p.physics.sizeAffectsMass.get(tNow) / 100 : 0;
                airR = p.physics.airResistanceRandom ? p.physics.airResistanceRandom.get(tNow) / 100 : 0;
                airSizeR = p.physics.sizeAffectsAirResistance ? p.physics.sizeAffectsAirResistance.get(tNow) / 100 : 0;
            } catch (_mv) { /* defaults are zero */ }
            cpu.massVar[i] = (1 + (rand(seed + i * 17) - 0.5) * 2 * massR) *
                (1 + (rand(seed + i * 19) - 0.5) * 2 * sizeR);
            cpu.dragVar[i] = (1 + (rand(seed + i * 23) - 0.5) * 2 * airR) *
                (1 + (rand(seed + i * 29) - 0.5) * 2 * airSizeR);
            cpu.ages[i] = 0;
            var lifeScale = 1 + (rand(seed + i * 7) - 0.5) * (p.particle.lifeRandom.get(PZ.trapcode.currentTime) / 100);
            cpu.lives[i] = Math.max(p.particle.life.get(PZ.trapcode.currentTime) * lifeScale, 0.0001);
            cpu.phases[i] = 0;
        }
        simulate(dt, time) {
            var p = this.properties;
            var cpu = this.cpu;
            if (!cpu) return;
            var count = cpu.count;
            if (cpu.prevPositions) {
                for (var pp = 0; pp < count * 3; pp++) cpu.prevPositions[pp] = cpu.positions[pp];
            }
            if (cpu.justReset) cpu.justReset.fill(0);
            var behavior = this.emitterBehaviorValue();
            var interval = this.burstIntervalValue();
            var gravity = p.physics.gravity.get(PZ.trapcode.currentTime);
            var windX = p.environment.windX.get(PZ.trapcode.currentTime);
            var windY = p.environment.windY.get(PZ.trapcode.currentTime) + gravity;
            var windZ = p.environment.windZ.get(PZ.trapcode.currentTime);
            var drag = p.physics.drag.get(PZ.trapcode.currentTime);
            // Mass scales force response (mass 10 is neutral, matching the
            // flat GPU path divisor); per-particle variance was rolled at birth.
            var massBase = 10;
            try {
                massBase = p.physics.mass ? p.physics.mass.get(PZ.trapcode.currentTime) : 10;
            } catch (_mb) { /* default neutral */ }
            massBase = Math.max(massBase, 0.01) / 10;
            var turbulence = p.environment.turbulenceEnabled.get(PZ.trapcode.currentTime) === 1 ? p.environment.turbulenceAffectPosition.get(PZ.trapcode.currentTime) : 0;
            var turbulenceScale = Math.max(p.environment.turbulenceScale.get(PZ.trapcode.currentTime), 0.0001);
            var meanderOn = p.physics.meanderEnabled.get(PZ.trapcode.currentTime) === 1;
            var meanderDir = meanderOn ? p.physics.meanderAffectDirection.get(PZ.trapcode.currentTime) : 0;
            var meanderSpeed = meanderOn ? p.physics.meanderAffectSpeed.get(PZ.trapcode.currentTime) : 0;
            var spherical = p.spherical;
            var sphereStrength = spherical.strength.get(PZ.trapcode.currentTime) / 100;
            var sphereCenter = spherical.position.get(PZ.trapcode.currentTime);
            var sphereRadius = Math.max(spherical.radius.get(PZ.trapcode.currentTime), 0.0001);
            var sphereFeather = spherical.feather.get(PZ.trapcode.currentTime) / 100;
            var mirrorX = p.kaleidospace.mirrorX.get(PZ.trapcode.currentTime) === 1;
            var mirrorY = p.kaleidospace.mirrorY.get(PZ.trapcode.currentTime) === 1;
            var mirrorZ = p.kaleidospace.mirrorZ.get(PZ.trapcode.currentTime) === 1;
            var kaleidoCenter = p.kaleidospace.center.get(PZ.trapcode.currentTime);
            var vortexStrength = p.physics.fluidEnabled.get(PZ.trapcode.currentTime) === 1 ? p.physics.vortexStrength.get(PZ.trapcode.currentTime) : 0;
            var vortexCore = Math.max(p.physics.vortexCoreSize.get(PZ.trapcode.currentTime) / 100, 0.0001);
            var bounceEnabled = p.physics.bounceEnabled.get(PZ.trapcode.currentTime) === 1;
            var bounceHeight = p.physics.bounceHeight.get(PZ.trapcode.currentTime);
            var bounceStrength = p.physics.bounceStrength.get(PZ.trapcode.currentTime) / 100;
            var disperse = p.displace.disperse.get(PZ.trapcode.currentTime);
            var twist = p.displace.twist.get(PZ.trapcode.currentTime);

            // Burst (periodic): detect a new interval and re-emit the whole system at once.
            // Works for Primary System and System 2 (child re-samples its parent positions).
            if (behavior > 1.5) {
                var cyc = interval > 0 ? (((time % interval) + interval) % interval) : 0;
                var lastCyc = this._lastCycle;
                if (lastCyc === undefined) lastCyc = cyc;
                if (cyc < lastCyc - 0.0001) {
                    var baseSeed = p.emitter.randomSeed.get(PZ.trapcode.currentTime) + Math.floor(time * 1000);
                    var bRate = this.emissionRateValue(count);
                    var randFn = T.rand || function (s) { return Math.abs(Math.sin(s * 12.9898) * 43758.5453) % 1; };
                    for (var r = 0; r < count; r++) {
                        this.resetParticle(r, baseSeed + r, randFn(Math.floor(time * 1000) + r * 7));
                        var rLife = cpu.lives[r];
                        var rDelay = r / Math.max(bRate, 0.0001);
                        var rAge = cyc - rDelay - dt;
                        cpu.ages[r] = rAge;
                        cpu.phases[r] = rAge >= 0 && rAge < rLife ? rAge / rLife : -1;
                        if (this.isEmitFromParent() && !this.parentAliveFor(r)) cpu.phases[r] = -1;
                        if (cpu.justReset) cpu.justReset[r] = 1;
                    }
                    if (cpu.prevPositions) cpu.prevPositions.set(cpu.positions);
                }
                this._lastCycle = cyc;
            }

            for (var i = 0; i < count; i++) {
                cpu.ages[i] += dt;
                var life = cpu.lives[i];
                var age = cpu.ages[i];
                if (behavior < 0.5) {
                    // continuous: recycle forever to sustain the stream, but never respawn
                    // from a dead parent (explode finished) -> child streaks end with it.
                    if (age >= life) {
                        if (this.isEmitFromParent() && !this.parentAliveFor(i)) {
                            cpu.phases[i] = -1;
                            continue;
                        }
                        if (cpu.justReset) cpu.justReset[i] = 1;
                        this.resetParticle(i, p.emitter.randomSeed.get(PZ.trapcode.currentTime) + Math.floor(time * 1000), (T.rand || function (s) { return Math.abs(Math.sin(s * 12.9898) * 43758.5453) % 1; })(Math.floor(time * 1000) + i * 7));
                        continue;
                    }
                } else if (behavior < 1.5) {
                    // explode: die once and stay dead (hidden via phase -1). No continuous re-emit.
                    if (age < 0 || age >= life) {
                        cpu.phases[i] = -1;
                        continue;
                    }
                } else {
                    // burst: not yet born this interval, or already dead -> wait for next burst.
                    if (age < 0 || age >= life) {
                        cpu.phases[i] = -1;
                        continue;
                    }
                }
                cpu.phases[i] = cpu.ages[i] / life;
                var ix = i * 3;
                var x = cpu.positions[ix];
                var y = cpu.positions[ix + 1];
                var z = cpu.positions[ix + 2];
                var vx = cpu.velocities[ix];
                var vy = cpu.velocities[ix + 1];
                var vz = cpu.velocities[ix + 2];

                if (turbulence !== 0) {
                    var n = this.noise(x / turbulenceScale, y / turbulenceScale, z / turbulenceScale, time);
                    vx += n[0] * turbulence * dt;
                    vy += n[1] * turbulence * dt;
                    vz += n[2] * turbulence * dt;
                }

                // Meander: independent per-particle wandering (Trapcode Particular physics).
                // Affect Direction wanders the heading like a crowd; Affect Speed varies
                // forward speed like traffic lanes. Runs for Primary System and System 2.
                if (meanderOn && (meanderDir !== 0 || meanderSpeed !== 0)) {
                    var mPhase = i * 12.9898;
                    var mT = time;
                    var wX = Math.sin(mT * 1.7 + mPhase) + 0.5 * Math.sin(mT * 3.1 + mPhase * 1.7);
                    var wY = Math.sin(mT * 1.3 + mPhase * 1.3 + 2.0) + 0.5 * Math.sin(mT * 2.7 + mPhase * 0.7);
                    var wZ = Math.cos(mT * 1.5 + mPhase * 0.9 + 4.0) + 0.5 * Math.sin(mT * 2.3 + mPhase * 1.1);
                    if (meanderDir !== 0) {
                        vx += wX * meanderDir * dt;
                        vy += wY * meanderDir * dt;
                        vz += wZ * meanderDir * dt;
                    }
                    if (meanderSpeed !== 0) {
                        var spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
                        if (spd > 0.0001) {
                            var sAmt = Math.sin(mT * 2.2 + mPhase * 2.0) * (meanderSpeed / 100) * 60 * dt;
                            vx += (vx / spd) * sAmt;
                            vy += (vy / spd) * sAmt;
                            vz += (vz / spd) * sAmt;
                        }
                    }
                }

                if (sphereStrength !== 0) {
                    var dx = x - sphereCenter[0];
                    var dy = y - sphereCenter[1];
                    var dz = z - sphereCenter[2];
                    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                    var influence = 1;
                    if (dist > sphereRadius) {
                        influence = Math.max(0, 1 - (dist - sphereRadius) / (sphereRadius * (1 - sphereFeather + 0.0001)));
                    }
                    var force = (sphereStrength * influence * 100) / (dist * dist + 1);
                    vx -= dx * force * dt;
                    vy -= dy * force * dt;
                    vz -= dz * force * dt;
                }

                if (vortexStrength !== 0) {
                    var vdx = x - sphereCenter[0];
                    var vdz = z - sphereCenter[2];
                    var vdist = Math.sqrt(vdx * vdx + vdz * vdz) || 1;
                    if (vdist < sphereRadius) {
                        var swirl = (vortexStrength / 100) * (1 - vdist / sphereRadius) * dt;
                        vx += -vdz / vdist * swirl * 100;
                        vz += vdx / vdist * swirl * 100;
                        vy += Math.sin(vdist * 0.01 + time) * swirl * 10;
                    }
                }

                var massDiv = massBase * (cpu.massVar ? cpu.massVar[i] || 1 : 1);
                if (!(massDiv > 0)) massDiv = 1;
                vx += (windX / massDiv) * dt;
                vy += (windY / massDiv) * dt;
                vz += (windZ / massDiv) * dt;
                if (drag > 0) {
                    var damp = Math.max(0, 1 - ((drag * (cpu.dragVar ? cpu.dragVar[i] || 1 : 1)) / massDiv) * dt * 10);
                    vx *= damp;
                    vy *= damp;
                    vz *= damp;
                }

                x += vx * dt;
                y += vy * dt;
                z += vz * dt;

                if (bounceEnabled && y < 0) {
                    y = 0;
                    vy = Math.abs(vy) * bounceStrength + bounceHeight * 0.01;
                }

                if (disperse !== 0) {
                    var dispAmt = disperse * dt;
                    x += Math.sin(i * 12.9898 + time) * dispAmt;
                    y += Math.sin(i * 78.233 + time) * dispAmt;
                    z += Math.sin(i * 37.719 + time) * dispAmt;
                }
                if (twist !== 0) {
                    var angle = (twist * Math.PI * dt) / 180;
                    var ca = Math.cos(angle);
                    var sa = Math.sin(angle);
                    var nx = x * ca - z * sa;
                    var nz = x * sa + z * ca;
                    x = nx;
                    z = nz;
                }

                if (mirrorX && x > kaleidoCenter[0]) x = kaleidoCenter[0] - (x - kaleidoCenter[0]);
                if (mirrorY && y > kaleidoCenter[1]) y = kaleidoCenter[1] - (y - kaleidoCenter[1]);
                if (mirrorZ && z > kaleidoCenter[2]) z = kaleidoCenter[2] - (z - kaleidoCenter[2]);

                cpu.positions[ix] = x;
                cpu.positions[ix + 1] = y;
                cpu.positions[ix + 2] = z;
                cpu.velocities[ix] = vx;
                cpu.velocities[ix + 1] = vy;
                cpu.velocities[ix + 2] = vz;
            }
        }
        noise(x, y, z, time) {
            var t = time * 0.1;
            var nx = Math.sin(x + t) * Math.cos(y * 1.3 - t) + Math.sin(z * 0.7 + t * 0.5);
            var ny = Math.cos(y + t * 1.1) * Math.sin(z * 1.1 + t) + Math.cos(x * 0.9 - t);
            var nz = Math.sin(z + t * 0.9) * Math.cos(x * 1.2 + t) + Math.sin(y * 0.8 - t * 0.7);
            return [nx, ny, nz];
        }
        updateGeometryCPU(count, simTime) {
            var behavior = this.emitterBehaviorValue();
            if (this._mode === "cpu" && this._cpuCount === count && this.cpu && this.cpu.count === count && this._behaviorCache === behavior) return;
            this._cpuCount = count;
            this._count = count;
            this._mode = "cpu";
            if (this.threeObj.geometry) this.threeObj.geometry.dispose();
            var pid = new Float32Array(count);
            for (var i = 0; i < count; i++) pid[i] = i;
            var geometry = new THREE.BufferGeometry();
            geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            geometry.addAttribute("life", new THREE.BufferAttribute(new Float32Array(count), 1));
            geometry.addAttribute("pid", new THREE.BufferAttribute(pid, 1));
            geometry.addAttribute("velocity", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            this.threeObj.geometry = geometry;
            this.initCPU(count, simTime);
            this._simTime = undefined;
        }
        update(e) {
            PZ.trapcode.setTime(e);
            if (!this.material) this.rebuildMaterial();
            var useCPU = this.needsCPU();
            var p = this.properties;
            var emitter = p.emitter;
            var burst = emitter.burstCount.get(PZ.trapcode.currentTime);
            var count = Math.round(burst > 0 ? burst * this.secondaryCountMultiplier() : this.particleCount());
            count = clamp(count, 0, 50000);

            if (useCPU) {
                var simTime = e / this.sceneRate();
                this.updateGeometryCPU(count, simTime);
                if (this._simTime === undefined) {
                    this._simTime = simTime;
                }
                var dt = simTime - this._simTime;
                if (dt < 0 || dt > 0.25) {
                    this.initCPU(count, simTime);
                    dt = 0;
                }
                if (dt > 0) this.simulate(Math.min(dt, 0.1), simTime);
                this._simTime = simTime;
                var positionAttr = this.threeObj.geometry.attributes.position;
                var lifeAttr = this.threeObj.geometry.attributes.life;
                var velocityAttr = this.threeObj.geometry.attributes.velocity;
                for (var i = 0; i < count; i++) {
                    positionAttr.array[i * 3] = this.cpu.positions[i * 3];
                    positionAttr.array[i * 3 + 1] = this.cpu.positions[i * 3 + 1];
                    positionAttr.array[i * 3 + 2] = this.cpu.positions[i * 3 + 2];
                    lifeAttr.array[i] = this.cpu.phases[i];
                    if (velocityAttr) {
                        velocityAttr.array[i * 3] = this.cpu.velocities[i * 3];
                        velocityAttr.array[i * 3 + 1] = this.cpu.velocities[i * 3 + 1];
                        velocityAttr.array[i * 3 + 2] = this.cpu.velocities[i * 3 + 2];
                    }
                }
                positionAttr.needsUpdate = true;
                lifeAttr.needsUpdate = true;
                if (velocityAttr) velocityAttr.needsUpdate = true;
            } else {
                this.updateGeometry();
            }

            this.updatePalettes();
            this.updateLayerMaps();
            this.updateAudio();
            var u = this.material.uniforms;
            var seconds = e / this.sceneRate();
            u.time.value = seconds;
            var perSec = emitter.particlesPerSec.get(PZ.trapcode.currentTime);
            u.rate.value = burst > 0 && perSec <= 0 ? this._count : Math.max(perSec, 1);
            u.lifetime.value = Math.max(p.particle.life.get(PZ.trapcode.currentTime), 0.0001);
            u.lifeRandom.value = p.particle.lifeRandom.get(PZ.trapcode.currentTime) / 100;
            var vectors = this.emitterVectors();
            u.ipos.value.set(vectors.position[0], vectors.position[1], vectors.position[2]);
            u.ivel.value.set(vectors.velocity[0], vectors.velocity[1], vectors.velocity[2]);
            u.speed.value = vectors.speed;
            u.emitterSize.value = vectors.emitterSize;
            u.emitterShape.value = vectors.emitterShape;
            u.behavior.value = vectors.behavior;
            u.burstInterval.value = Math.max(vectors.burstInterval, 0.0001);
            u.vspread.value = vectors.spread;
            var gravity = p.physics.gravity.get(PZ.trapcode.currentTime);
            u.accel.value.set(p.environment.windX.get(PZ.trapcode.currentTime), gravity + p.environment.windY.get(PZ.trapcode.currentTime), p.environment.windZ.get(PZ.trapcode.currentTime));
            u.size.value = p.particle.size.get(PZ.trapcode.currentTime);
            u.sizeRandom.value = p.particle.sizeRandom.get(PZ.trapcode.currentTime) / 100;
            u.opacity.value = p.particle.opacity.get(PZ.trapcode.currentTime) / 100;
            var tint = p.particle.color.get(PZ.trapcode.currentTime);
            u.colorTint.value.set(tint[0], tint[1], tint[2], 1);
            u.glow.value = p.particle.glow.get(PZ.trapcode.currentTime);
            // Streak controls (guarded: absent on projects saved before them).
            var pp = p.particle;
            var D2R = Math.PI / 180;
            u.emitterVelAmt.value = tnum(emitter, "velocityFromEmitterMotion", 0) / 100;
            u.massDiv.value = Math.max(tnum(p.physics, "mass", 10), 0.01) / 10;
            u.orient.value = tnum(pp, "orientToMotion", 0) / 100;
            u.orientFade.value = Math.max(tnum(pp, "orientFadeIn", 20), 0);
            u.sceneFps.value = this.sceneRate() || 30;
            u.rotBase.value.set(
                tnum(pp, "rotateX", 0) * D2R,
                tnum(pp, "rotateY", 0) * D2R,
                tnum(pp, "rotateZ", 0) * D2R
            );
            u.spinRate.value.set(
                tnum(pp, "degreesPerSecX", 0) * D2R,
                tnum(pp, "degreesPerSecY", 0) * D2R,
                tnum(pp, "degreesPerSecZ", 0) * D2R
            );
            u.spinRnd.value = tnum(pp, "randomRotation", 0) / 100;
            u.spinRateRnd.value = tnum(pp, "randomSpeedRotate", 0) / 100;
            u.spinDist.value = tnum(pp, "randomSpeedDistribution", 0.5);
            u.rotAir.value = Math.max(tnum(p.physics, "rotationalAirResistance", 0), 0);
            u.stretch.value = tnum(pp, "stretch", 0) / 100;
            // Emitter world-motion velocity by finite difference, for
            // "Velocity from emitter motion" (birth inheritance on CPU,
            // live uniform offset on GPU).
            var evel = [0, 0, 0];
            try {
                var epos = vectors.position;
                if (
                    this._emitterPrevPos &&
                    this._emitterPrevT !== undefined &&
                    epos && epos.length >= 3
                ) {
                    var edt = seconds - this._emitterPrevT;
                    if (edt > 0.0001 && edt <= 0.25) {
                        evel = [
                            (epos[0] - this._emitterPrevPos[0]) / edt,
                            (epos[1] - this._emitterPrevPos[1]) / edt,
                            (epos[2] - this._emitterPrevPos[2]) / edt,
                        ];
                    }
                }
                this._emitterPrevPos = epos ? [epos[0], epos[1], epos[2]] : null;
                this._emitterPrevT = seconds;
            } catch (_et) { /* keep still */ }
            this._emitterVel = evel;
            u.emitterVel.value.set(evel[0], evel[1], evel[2]);
            this.material.blending = p.particle.blending.get(PZ.trapcode.currentTime) === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
            if (useCPU) this.material.defines.USE_CPU = 1;
            else delete this.material.defines.USE_CPU;
            this.material.needsUpdate = true;
        }
        updatePalettes() {
            var palette = this.palettes;
            if (!this.material || !palette) return;
            if (this.material.uniforms.colorOverLife.value !== palette.colorOverLife) {
                this.material.uniforms.colorOverLife.value = palette.colorOverLife;
                this.material.uniforms.sizeOverLife.value = palette.sizeOverLife;
                this.material.uniforms.opacityOverLife.value = palette.opacityOverLife;
            }
            var particle = this.properties.particle;
            var colorGradient = particle.colorGradient.get(PZ.trapcode.currentTime);
            if (this._colorSignature !== signature(colorGradient)) {
                this._colorSignature = signature(colorGradient);
                fillGradient(palette.colorOverLife, colorGradient);
            }
            var sizeCurve = particle.sizeOverLife.get(PZ.trapcode.currentTime);
            var sizeEnabled = particle.sizeOverLifeEnabled.get(PZ.trapcode.currentTime);
            if (this._sizeSignature !== sizeEnabled + "|" + signature(sizeCurve)) {
                this._sizeSignature = sizeEnabled + "|" + signature(sizeCurve);
                fillCurve(palette.sizeOverLife, sizeCurve, sizeEnabled);
            }
            var opacityCurve = particle.opacityOverLife.get(PZ.trapcode.currentTime);
            var opacityEnabled = particle.opacityOverLifeEnabled.get(PZ.trapcode.currentTime);
            if (this._opacitySignature !== opacityEnabled + "|" + signature(opacityCurve)) {
                this._opacitySignature = opacityEnabled + "|" + signature(opacityCurve);
                fillCurve(palette.opacityOverLife, opacityCurve, opacityEnabled);
            }
        }
        async prepare(e) {
            if (this.texture) await this.texture.loading;
        }
    };

    PZ.object3d.particular.system.prototype.defaultName = "System";

    var number = T.number;
    var vector3 = T.vector3;
    var option = T.option;
    var imageAsset = T.imageAsset;
    var curveProperty = T.curveProperty;

    PZ.object3d.particular.system.propertyDefinitions = systemPropertyDefinitions;

    PZ.object3d.particular.system.emitterDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Emitter" },
        emitterType: option("Emitter type", 0, "point;box;sphere;light;layer;model;text"),
        emitterBehavior: option("Emitter behavior", 0, "continuous;explode;burst"),
        emitFromParent: option("Emit from parent", 0, "off;on"),
        parentSystemIndex: number("Parent system index", 0, { min: 0, step: 1, decimals: 0 }),
        inheritVelocity: number("Inherit parent velocity[%]", 0, { min: 0, max: 100, step: 1 }),
        ratePercent: option("Particles/sec are % of primary", 0, "off;on"),
        burstInterval: number("Burst interval", 1, { min: 0.05, step: 0.05, decimals: 2 }),
        particlesPerSec: number("Particles/sec", 100, { min: 0, step: 1, decimals: 0 }),
        burstCount: number("Burst count", 0, { min: 0, step: 1, decimals: 0 }),
        position: vector3("Position", [0, 0, 0], { step: 1 }),
        emitterSize: number("Emitter size", 100, { min: 0, step: 1 }),
        direction: vector3("Direction", [0, 0, 0], { step: 0.01, decimals: 3 }),
        directionSpread: number("Direction spread", 20, { min: 0, step: 0.1, decimals: 1 }),
        velocity: number("Velocity", 100, { step: 1 }),
        velocityRandom: number("Velocity random", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        velocityDistribution: number("Velocity distribution", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
        velocityFromEmitterMotion: number("Velocity from emitter motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        rotation: number("Rotation", 0, { step: 1 }),
        rotationRandom: number("Rotation random", 0, { min: 0, step: 0.1, decimals: 1 }),
        rotationSpeed: number("Rotation speed", 0, { step: 1 }),
        rotationSpeedRandom: number("Rotation speed random", 0, { min: 0, step: 0.1, decimals: 1 }),
        randomSeed: number("Random seed", 100000, { step: 1, decimals: 0 }),
    };

    PZ.object3d.particular.system.particleDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Particle" },
        life: number("Life (seconds)", 3, { min: 0.01, step: 0.1, decimals: 2 }),
        lifeRandom: number("Life random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        particleType: option("Particle type", 1, "sprite;sphere;box;text"),
        texture: {
            name: "Texture",
            type: PZ.property.type.ASSET,
            items: PZ.object3d.particular.presetTexturesList,
            baseUrl: "/assets/textures/particles/",
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: "/assets/textures/particles/circle_soft.png",
            changed: function () {
                this.parentObject.redrawTexture();
            },
        },
        size: number("Size", 5, { min: 0, step: 0.1, decimals: 2 }),
        sizeRandom: number("Size random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeOverLifeEnabled: option("Size over life", 0, "off;on"),
        sizeOverLife: curveProperty("Size curve"),
        aspect: number("Aspect ratio", 1, { min: 0.01, step: 0.01, decimals: 2 }),
        orientToMotion: number("Orient to motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        orientFadeIn: number("Orient to motion fade-in", 20, { min: 0, step: 1, decimals: 0 }),
        rotateX: number("Rotate X", 0, { step: 1, decimals: 1 }),
        rotateY: number("Rotate Y", 0, { step: 1, decimals: 1 }),
        rotateZ: number("Rotate Z", 0, { step: 1, decimals: 1 }),
        randomRotation: number("Random rotation", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        degreesPerSecX: number("Degrees/sec X", 0, { step: 1, decimals: 1 }),
        degreesPerSecY: number("Degrees/sec Y", 0, { step: 1, decimals: 1 }),
        degreesPerSecZ: number("Degrees/sec Z", 0, { step: 1, decimals: 1 }),
        randomSpeedRotate: number("Random speed rotate", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        randomSpeedDistribution: number("Random speed distribution", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
        stretch: number("Stretch along motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityRandom: number("Opacity random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityOverLifeEnabled: option("Opacity over life", 0, "off;on"),
        opacityOverLife: curveProperty("Opacity curve"),
        setColor: option("Set color", 0, "at start;over life"),
        color: {
            dynamic: true,
            group: true,
            objects: [
                { dynamic: true, name: "Color.R", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
                { dynamic: true, name: "Color.G", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
                { dynamic: true, name: "Color.B", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            ],
            name: "Color",
            type: PZ.property.type.COLOR,
        },
        colorGradient: {
            name: "Color over life",
            type: PZ.property.type.GRADIENT,
            value: [{ position: 0, color: "rgba(255,255,255,1)" }],
        },
        colorRandom: number("Color random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        blending: option("Blend mode", 0, "normal;add;screen;multiply"),
        glow: number("Glow", 0, { min: 0, step: 0.01, decimals: 2 }),
        randomSeed: number("Random seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.particular.system.physicsDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Physics" },
        enabled: option("Enabled", 0, "off;on"),
        gravity: number("Gravity", 0, { step: 1 }),
        drag: number("Air resistance", 0, { min: 0, step: 0.01, decimals: 3 }),
        mass: number("Mass", 10, { min: 0.01, step: 0.1, decimals: 2 }),
        massRandom: number("Mass random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeAffectsMass: number("Size affects mass", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        airResistanceRandom: number("Air resistance random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeAffectsAirResistance: number("Size affects air resistance", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        rotationalAirResistance: number("Rotational air resistance", 0, { min: 0, step: 0.01, decimals: 3 }),
        bounceEnabled: option("Enable bounce", 0, "off;on"),
        bounceHeight: number("Bounce height", 500, { step: 1 }),
        bounceStrength: number("Bounce strength", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        meanderEnabled: option("Enable meander", 0, "off;on"),
        meanderAffectDirection: number("Affect direction", 20, { step: 0.1, decimals: 1 }),
        meanderAffectSpeed: number("Affect speed", 20, { step: 0.1, decimals: 1 }),
        flockingEnabled: option("Enable flocking", 0, "off;on"),
        flockAttract: number("Attract", 10, { step: 0.1, decimals: 1 }),
        flockSeparate: number("Separate", 10, { step: 0.1, decimals: 1 }),
        flockAlign: number("Align", 10, { step: 0.1, decimals: 1 }),
        flockRangeValue: number("Range of view", 500, { step: 1 }),
        flockFieldOfView: number("Field of view", 270, { step: 1 }),
        fluidEnabled: option("Enable fluid dynamics", 0, "off;on"),
        buoyancy: number("Buoyancy", 5, { step: 0.01, decimals: 2 }),
        vortexStrength: number("Vortex strength", 100, { step: 1 }),
        vortexCoreSize: number("Vortex core size", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.environmentDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Environment" },
        windX: number("Wind X", 0, { step: 1 }),
        windY: number("Wind Y", 0, { step: 1 }),
        windZ: number("Wind Z", 0, { step: 1 }),
        airDensity: number("Air density", 1, { min: 0, step: 0.01, decimals: 3 }),
        turbulenceEnabled: option("Air turbulence", 0, "off;on"),
        turbulenceAffectPosition: number("Affect position", 0, { min: 0, step: 0.1, decimals: 1 }),
        turbulenceAffectOrientation: number("Affect orientation/spin", 0, { min: 0, step: 0.1, decimals: 1 }),
        turbulenceScale: number("Scale", 10, { step: 0.1, decimals: 1 }),
        turbulenceComplexity: number("Complexity", 3, { min: 1, max: 8, step: 1, decimals: 0 }),
        turbulenceEvolutionSpeed: number("Evolution speed", 50, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.displaceDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Displace" },
        driftX: number("Drift X", 0, { step: 1 }),
        driftY: number("Drift Y", 0, { step: 1 }),
        driftZ: number("Drift Z", 0, { step: 1 }),
        spinAmplitude: number("Spin amplitude", 0, { step: 1 }),
        spinFrequency: number("Spin frequency", 1, { step: 0.01, decimals: 2 }),
        disperse: number("Disperse", 0, { step: 1 }),
        disperseStrengthOver: option("Disperse strength over", 0, "off;life;velocity;position"),
        disperseStrengthCurve: curveProperty("Disperse curve"),
        twist: number("Twist", 0, { step: 1 }),
        turbulenceAffectSize: number("Turbulence field affect size", 0, { step: 1 }),
        turbulenceAffectOpacity: number("Turbulence field affect opacity", 0, { step: 1 }),
    };

    PZ.object3d.particular.system.sphericalDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Spherical field" },
        strength: number("Strength[%]", 0, { step: 1 }),
        radius: number("Radius", 100, { min: 0, step: 1 }),
        position: vector3("Sphere position", [720, 540, 0], { step: 1 }),
        scaleX: number("Scale X", 100, { step: 1 }),
        scaleY: number("Scale Y", 100, { step: 1 }),
        scaleZ: number("Scale Z", 100, { step: 1 }),
        feather: number("Feather", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.kaleidoDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Kaleidospace" },
        mirrorX: option("Mirror on X", 0, "off;on"),
        mirrorY: option("Mirror on Y", 0, "off;on"),
        mirrorZ: option("Mirror on Z", 0, "off;on"),
        center: vector3("Center position", [720, 540, 0], { step: 1 }),
    };

    PZ.object3d.particular.system.transformDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Transform" },
        rotationX: number("X rotation", 0, { step: 1 }),
        rotationY: number("Y rotation", 0, { step: 1 }),
        rotationZ: number("Z rotation", 0, { step: 1 }),
        scale: number("Scale", 100, { step: 1 }),
        offsetX: number("X offset", 0, { step: 1 }),
        offsetY: number("Y offset", 0, { step: 1 }),
        offsetZ: number("Z offset", 0, { step: 1 }),
    };

    PZ.object3d.particular.system.layerMapDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Layer maps" },
        colorAlphaEnabled: option("Color and alpha", 0, "off;on"),
        colorAlphaLayer: imageAsset("Color layer"),
        colorAlphaMix: number("Color mix", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeEnabled: option("Size", 0, "off;on"),
        sizeLayer: imageAsset("Size layer"),
        sizeStrength: number("Size strength", 100, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.audioDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Audio react" },
        audioLayer: {
            name: "Audio layer",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.AV,
            accept: "audio/*,video/*",
            value: null,
        },
        reactor1Enabled: option("Reactor 1", 0, "off;on"),
        reactor1Target: option("Reactor 1 target", 0, "size;opacity;velocity;color"),
        reactor1Strength: number("Reactor 1 strength", 100, { step: 0.1, decimals: 1 }),
        reactor2Enabled: option("Reactor 2", 0, "off;on"),
        reactor2Target: option("Reactor 2 target", 0, "size;opacity;velocity;color"),
        reactor2Strength: number("Reactor 2 strength", 100, { step: 0.1, decimals: 1 }),
        reactor3Enabled: option("Reactor 3", 0, "off;on"),
        reactor3Target: option("Reactor 3 target", 0, "size;opacity;velocity;color"),
        reactor3Strength: number("Reactor 3 strength", 100, { step: 0.1, decimals: 1 }),
        reactor4Enabled: option("Reactor 4", 0, "off;on"),
        reactor4Target: option("Reactor 4 target", 0, "size;opacity;velocity;color"),
        reactor4Strength: number("Reactor 4 strength", 100, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.lightingDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Lighting" },
        enabled: option("Shading", 0, "off;on"),
        lightFalloff: option("Light falloff", 0, "natural (lux);inverse square;inverse cube;none"),
        ambient: number("Ambient", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        diffuse: number("Diffuse", 80, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularAmount: number("Specular amount", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularSharpness: number("Specular sharpness", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        reflectionStrength: number("Reflection strength", 100, { min: 0, step: 0.1, decimals: 1 }),
    };

    if (PZ.ui && PZ.ui.objectTypes) {
        PZ.ui.objectTypes.set(PZ.object3d.particular.system, [
            { name: "System", desc: "A particle emitting system.", type: 0 },
        ]);
    }

    var BLOCKS = [
        { key: "emitter", name: "Emitter" },
        { key: "particle", name: "Particle" },
        { key: "physics", name: "Physics" },
        { key: "environment", name: "Environment" },
        { key: "displace", name: "Displace" },
        { key: "spherical", name: "Spherical" },
        { key: "kaleidospace", name: "Kaleido" },
        { key: "transform", name: "Transform" },
        { key: "layerMaps", name: "Layer Maps" },
        { key: "audio", name: "Audio" },
        { key: "lighting", name: "Lighting" },
    ];

    var PRESETS = [
        { name: "Default burst", preset: "burst" },
        { name: "Fountain", preset: "fountain" },
        { name: "Snow", preset: "snow" },
    ];

    if (PZ.trapcode && PZ.trapcode.designer) {
        PZ.trapcode.designer.registerConfig(PZ.object3d.particular, {
            title: "Trapcode Particular Designer",
            targets: function (root) {
                return root.systems;
            },
            targetName: function (system, index) {
                if (index === 0) return "Primary System";
                return "System " + (index + 1);
            },
            addKinds: [
                {
                    name: "Add a System",
                    create: function (root) {
                        var system = new PZ.object3d.particular.system();
                        root.systems.push(system);
                        system.loading = system.load(null, root);
                        system.update(0);
                        return system;
                    },
                },
            ],
            blocks: function () {
                return BLOCKS;
            },
            groupFor: function (target, key) {
                return target.properties ? target.properties[key] : null;
            },
            presets: PRESETS,
            applyPreset: function (root, target, preset) {
                if (target && target.applyPreset) target.applyPreset(preset.preset);
            },
        });
    }
})();

