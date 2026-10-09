// OpenZoid Trapcode Suite — Form.
/*
 * form.js
 *
 * A Trapcode Form style object3d: a static lattice of particles whose base
 * form (box grid, sphere, cylinder, ...) can be deformed by disperse, twist,
 * spherical fields, a fractal field, fluid motion and kaleidospace mirrors.
 * Layer maps and a 3D model or mask image drive the base shape. Strings
 * connect neighbouring points.
 *
 * Determinism: the output of update(e) is a pure function of the property
 * values at time e and of the decoded asset data. Base geometry is rebuilt
 * when its signature (grid counts, base type, size, model/mask status)
 * changes, never because of frame history. Assets load through prepare(e),
 * which the host awaits before rendering, and update(e) runs again after the
 * data settles, so a frame never mixes fallback and loaded data.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

    var VERTEX_SHADER = [
        "uniform vec2 resolution;",
        "uniform float size;",
        "uniform float sizeRandom;",
        "uniform float opacity;",
        "uniform vec4 colorTint;",
        "uniform sampler2D colorOver;",
        "uniform sampler2D sizeOver;",
        "uniform sampler2D opacityOver;",
        "attribute float fraction;",
        "attribute float pid;",
        "attribute float aSizeM;",
        "attribute float aAlphaM;",
        "#ifdef USE_VCOLOR",
        "attribute vec3 vcolor;",
        "varying vec3 vVColor;",
        "#endif",
        "varying vec4 vColor;",
        "float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }",
        "void main()",
        "{",
        "vec4 c = texture2D(colorOver, vec2(fraction, 0.0));",
        "float s = texture2D(sizeOver, vec2(fraction, 0.0)).r;",
        "float o = texture2D(opacityOver, vec2(fraction, 0.0)).r;",
        "vColor = vec4(c.rgb * colorTint.rgb, c.a * colorTint.a * o * opacity * aAlphaM);",
        "#ifdef USE_VCOLOR",
        "vVColor = vcolor;",
        "#endif",
        "vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
        "float pointSize = size * s * aSizeM * (1.0 + (rand(vec2(pid, 4.0)) - 0.5) * sizeRandom);",
        "gl_PointSize = max(pointSize * resolution.y * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 1.0), 1.0);",
        "gl_Position = projectionMatrix * mvPosition;",
        "}",
    ].join("\n");

    var FRAGMENT_SHADER = [
        "uniform sampler2D image;",
        "varying vec4 vColor;",
        "#ifdef USE_VCOLOR",
        "varying vec3 vVColor;",
        "#endif",
        "void main()",
        "{",
        "vec4 tcolor = texture2D(image, gl_PointCoord);",
        "#ifdef USE_VCOLOR",
        "vec3 rgb = tcolor.rgb * vColor.rgb * vVColor;",
        "#else",
        "vec3 rgb = tcolor.rgb * vColor.rgb;",
        "#endif",
        "gl_FragColor = vec4(rgb, tcolor.a * vColor.a);",
        "}",
    ].join("\n");

    // Layer maps: [enabled property, layer property, role].
    var LAYER_MAPS = [
        ["colorAlphaEnabled", "colorAlphaLayer"],
        ["displacementEnabled", "displacementLayer"],
        ["sizeEnabled", "sizeLayer"],
        ["fractalStrengthEnabled", "fractalStrengthLayer"],
        ["disperseEnabled", "disperseLayer"],
        ["rotateEnabled", "rotateLayer"],
    ];

    // Scratch buffers reused by every frame (single-threaded render path).
    var MAP_RGBA = new Float64Array(4);
    var SPHERE_OUT = new Float64Array(3);

    PZ.object3d.form = class extends PZ.object3d {
        constructor() {
            super();
            this.threeObj = new THREE.Object3D();
            this.forms = new PZ.objectList(this, PZ.object3d.form.instance);
            this.forms.name = "Forms";
            this.children.push(this.forms);
        }
        load(e) {
            this.properties.load(e && e.properties);
            if (e && "object" == typeof e && e.forms && e.forms.length) {
                for (var i = 0; i < e.forms.length; i++) {
                    var instance = new PZ.object3d.form.instance();
                    this.forms.push(instance);
                    instance.loading = instance.load(e.forms[i], this);
                }
            } else {
                var form = new PZ.object3d.form.instance();
                this.forms.push(form);
                form.loading = form.load(null, this);
            }
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, properties: this.properties, forms: this.forms };
        }
        unload() {
            for (var i = 0; i < this.forms.length; i++) this.forms[i].unload();
        }
        update(e) {
            for (var i = 0; i < this.forms.length; i++) this.forms[i].update(e);
        }
        async prepare(e) {
            PZ.trapcode.setTime(e);
            for (var i = 0; i < this.forms.length; i++) await this.forms[i].prepare(e);
        }
    };

    PZ.object3d.form.prototype.defaultName = "Form";
    PZ.object3d.form.presetTexturesList = PZ.object3d.particular.presetTexturesList;
    PZ.object3d.form.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Form" },
    };

    PZ.object3d.form.instance = class extends PZ.object {
        static create() {
            return new PZ.object3d.form.instance();
        }
        constructor() {
            super();
            this.form = null;
            this.threeObj = new THREE.Object3D();
            this.points = null;
            this.material = null;
            this.texture = null;
            this.strings = null;
            this.stringMaterial = null;
            this.basePositions = null;
            this.outPositions = null;
            this.sizeModArray = null;
            this.alphaModArray = null;
            this.colorArray = null;
            this.colorAttribute = null;
            this._baseSig = null;
            this._stringKey = null;
            this._useVColor = false;
            this._time = undefined;
            this._renderedRevision = -1;
            this._assets = new T.AssetCache(this.assetSettled.bind(this));
            this.palettes = {
                colorOver: T.createPalette(),
                sizeOver: T.createPalette(),
                opacityOver: T.createPalette(),
            };
            this.properties = new PZ.propertyList(
                {
                    name: PZ.property.create(PZ.object3d.form.instance.propertyDefinitions.name),
                    base: new PZ.propertyList(PZ.object3d.form.instance.baseDefinitions),
                    particle: new PZ.propertyList(PZ.object3d.form.instance.particleDefinitions),
                    disperse: new PZ.propertyList(PZ.object3d.form.instance.disperseDefinitions),
                    fluid: new PZ.propertyList(PZ.object3d.form.instance.fluidDefinitions),
                    fractal: new PZ.propertyList(PZ.object3d.form.instance.fractalDefinitions),
                    spherical: new PZ.propertyList(PZ.object3d.form.instance.sphericalDefinitions),
                    kaleidospace: new PZ.propertyList(PZ.object3d.form.instance.kaleidoDefinitions),
                    layerMaps: new PZ.propertyList(PZ.object3d.form.instance.layerMapDefinitions),
                    transform: new PZ.propertyList(PZ.object3d.form.instance.transformDefinitions),
                },
                this
            );
            var groups = {
                base: "Base Form",
                particle: "Particle",
                disperse: "Disperse and Twist",
                fluid: "Fluid",
                fractal: "Fractal Field",
                spherical: "Spherical Field",
                kaleidospace: "Kaleidospace",
                layerMaps: "Layer Maps",
                transform: "Transform",
            };
            for (var g in groups) {
                Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
            }
            Object.defineProperty(this.properties, "toJSON", {
                value: function () {
                    var result = {};
                    var keys = Object.keys(this);
                    for (var k = 0; k < keys.length; k++) result[keys[k]] = this[keys[k]];
                    return result;
                },
                writable: true,
            });
            this.children = [this.properties];
            this.onParentChanged.watch(function () {
                if (!this.threeObj) return;
                if (this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
                if (!this.parent) return;
                var parent = T.findParent(this, PZ.object3d);
                if (parent && parent.threeObj) parent.threeObj.add(this.threeObj);
            }.bind(this));
        }
        get formObject() {
            return T.findParent(this, PZ.object3d.form);
        }
        load(e, parent) {
            this.form = parent || this.form;
            this.properties.load(e && e.properties);
            if (!this.material) this.rebuildMaterial();
            var parentForm = this.form || this.formObject;
            if (this.threeObj && parentForm && parentForm.threeObj) {
                if (this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
                parentForm.threeObj.add(this.threeObj);
            }
            this.redrawTexture();
            this._baseSig = null;
            this._stringKey = null;
        }
        toJSON() {
            return { type: this.type, properties: this.properties };
        }
        unload() {
            if (this.threeObj && this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
            if (this.points && this.points.geometry) this.points.geometry.dispose();
            if (this.strings && this.strings.geometry) this.strings.geometry.dispose();
            T.disposeImageUniform(this.material, "image");
            if (this.material) this.material.dispose();
            if (this.stringMaterial) this.stringMaterial.dispose();
            if (this.palettes) {
                this.palettes.colorOver.dispose();
                this.palettes.sizeOver.dispose();
                this.palettes.opacityOver.dispose();
                this.palettes = null;
            }
            this._assets.clear();
            if (this.texture) {
                var project = T.findParent(this, PZ.project);
                project && project.assets.unload(this.texture);
                this.texture = null;
            }
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
        rebuildMaterial() {
            this.material = new THREE.ShaderMaterial({
                uniforms: {
                    resolution: { type: "v2", value: new THREE.Vector2(1920, 1080) },
                    image: { type: "t", value: this.texture ? this.texture.getTexture(true) : null },
                    colorOver: { type: "t", value: this.palettes.colorOver },
                    sizeOver: { type: "t", value: this.palettes.sizeOver },
                    opacityOver: { type: "t", value: this.palettes.opacityOver },
                    size: { type: "f", value: 2 },
                    sizeRandom: { type: "f", value: 0 },
                    opacity: { type: "f", value: 1 },
                    colorTint: { type: "v4", value: new THREE.Vector4(1, 1, 1, 1) },
                },
                defines: {},
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });
            this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
            this.points.frustumCulled = false;
            this.points.onBeforeRender = function (renderer) {
                if (!this.material || !this.material.uniforms) return;
                var size = renderer.getSize();
                this.material.uniforms.resolution.value.set(size.width, size.height);
            };
            this.threeObj.add(this.points);
            this.stringMaterial = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.5,
                depthWrite: false,
                vertexColors: true,
            });
            this.strings = new THREE.LineSegments(new THREE.BufferGeometry(), this.stringMaterial);
            this.strings.frustumCulled = false;
            this.strings.visible = false;
            this.threeObj.add(this.strings);
        }
        gridCounts() {
            var base = this.properties.base;
            var t = PZ.trapcode.currentTime;
            var cx = Math.max(1, Math.round(base.particlesX.get(t)));
            var cy = Math.max(1, Math.round(base.particlesY.get(t)));
            var cz = Math.max(1, Math.round(base.particlesZ.get(t)));
            var total = cx * cy * cz;
            if (total > PZ.object3d.form.instance.maxPoints) {
                var factor = Math.cbrt(PZ.object3d.form.instance.maxPoints / total);
                cx = Math.max(1, Math.round(cx * factor));
                cy = Math.max(1, Math.round(cy * factor));
                cz = Math.max(1, Math.round(cz * factor));
                while (cx * cy * cz > PZ.object3d.form.instance.maxPoints) {
                    if (cx >= cy && cx >= cz && cx > 1) cx--;
                    else if (cy >= cz && cy > 1) cy--;
                    else if (cz > 1) cz--;
                    else break;
                }
            }
            return [cx, cy, cz];
        }
        // Everything that shapes the base lattice. Asset status is part of the
        // signature, so the lattice rebuilds once a model or mask settles.
        baseSignature(counts) {
            var t = PZ.trapcode.currentTime;
            var base = this.properties.base;
            var modelValue = base.modelAsset.get(t);
            var maskValue = base.maskAsset.get(t);
            return [
                counts.join(","),
                base.baseFormType.get(t),
                base.baseFormSize.get(t).join(","),
                base.modelScale.get(t),
                modelValue, this._assets.status("model", modelValue),
                maskValue, this._assets.status("mask", maskValue),
            ].join("|");
        }
        // Asset requests for the current frame. Loads start here; the entries
        // are returned so prepare() can wait on them.
        requestAssets() {
            var t = PZ.trapcode.currentTime;
            var base = this.properties.base;
            var maps = this.properties.layerMaps;
            var project = T.findParent(this, PZ.project);
            var entries = [];
            var type = base.baseFormType.get(t);
            if (type === 6) {
                entries.push(this._assets.request("model", base.modelAsset.get(t), function (value) {
                    return T.loadGeometryPositions(project, value);
                }));
            }
            if (type === 7) {
                entries.push(this._assets.request("mask", base.maskAsset.get(t), function (value) {
                    return T.sampleImageAsset(project, value, 256);
                }));
            }
            for (var i = 0; i < LAYER_MAPS.length; i++) {
                if (maps[LAYER_MAPS[i][0]].get(t) !== 1) continue;
                var layer = maps[LAYER_MAPS[i][1]].get(t);
                entries.push(this._assets.request("layer", layer, function (value) {
                    return T.sampleImageAsset(project, value, 128);
                }));
            }
            return entries.filter(Boolean);
        }
        // Called when any asset settles: re-run the frame that was last shown.
        assetSettled() {
            if (this._time !== undefined && this.material) this.update(this._time);
        }
        // Rebuilds the particle attributes for a new grid size.
        ensureGeometry(count) {
            if (!this.points) this.rebuildMaterial();
            var geometry = this.points.geometry;
            if (geometry.attributes.position && geometry.attributes.position.count === count) return;
            if (geometry.dispose) geometry.dispose();
            var fractions = new Float32Array(count);
            var pid = new Float32Array(count);
            for (var i = 0; i < count; i++) {
                fractions[i] = count > 1 ? i / (count - 1) : 0;
                pid[i] = i;
            }
            this.outPositions = new Float32Array(count * 3);
            this.sizeModArray = new Float32Array(count).fill(1);
            this.alphaModArray = new Float32Array(count).fill(1);
            this.colorArray = new Float32Array(count * 3).fill(1);
            geometry = new THREE.BufferGeometry();
            geometry.addAttribute("position", new THREE.BufferAttribute(this.outPositions, 3));
            geometry.addAttribute("fraction", new THREE.BufferAttribute(fractions, 1));
            geometry.addAttribute("pid", new THREE.BufferAttribute(pid, 1));
            geometry.addAttribute("aSizeM", new THREE.BufferAttribute(this.sizeModArray, 1));
            geometry.addAttribute("aAlphaM", new THREE.BufferAttribute(this.alphaModArray, 1));
            this.colorAttribute = new THREE.BufferAttribute(this.colorArray, 3);
            geometry.addAttribute("vcolor", this.colorAttribute);
            this.points.geometry = geometry;
            this._stringKey = null;
        }
        // Fills basePositions for the current grid and base type.
        fillBase(counts) {
            var t = PZ.trapcode.currentTime;
            var base = this.properties.base;
            var count = counts[0] * counts[1] * counts[2];
            var size = base.baseFormSize.get(t);
            var type = base.baseFormType.get(t);
            if (!this.basePositions || this.basePositions.length !== count * 3) {
                this.basePositions = new Float32Array(count * 3);
            }
            var positions = this.basePositions;
            var index = 0;
            var write = function (p) {
                positions[index * 3] = p[0];
                positions[index * 3 + 1] = p[1];
                positions[index * 3 + 2] = p[2];
                index++;
            };
            if (type === 6 || type === 7) {
                var sampled = type === 6
                    ? this.sampleModel(count, size, this._assets.ready("model", base.modelAsset.get(t)))
                    : this.sampleMask(count, size, this._assets.ready("mask", base.maskAsset.get(t)));
                for (var m = 0; m < count; m++) write(sampled[m] || [0, 0, 0]);
                return;
            }
            var totalX = counts[0] - 1;
            var totalY = counts[1] - 1;
            var totalZ = counts[2] - 1;
            for (var z = 0; z < counts[2]; z++) {
                for (var y = 0; y < counts[1]; y++) {
                    for (var x = 0; x < counts[0]; x++) {
                        var p;
                        if (type === 1) p = spherePoint(x, y, z, counts, size);
                        else if (type === 2) p = sphereGridPoint(x, y, z, counts, size);
                        else if (type === 3) p = cylinderPoint(x, y, z, counts, size);
                        else if (type === 4) p = circlePoint(x, y, z, counts, size);
                        else if (type === 5) p = planePoint(x, y, z, counts, size);
                        else p = boxPoint(x, y, z, totalX, totalY, totalZ, size);
                        write(p);
                    }
                }
            }
        }
        rebuildBase(counts, signature) {
            this.ensureGeometry(counts[0] * counts[1] * counts[2]);
            this.fillBase(counts);
            this._baseSig = signature;
        }
        sampleModel(count, size, vertices) {
            var base = this.properties.base;
            var t = PZ.trapcode.currentTime;
            var points = [];
            if (!vertices || !vertices.length) {
                for (var f = 0; f < count; f++) {
                    points.push([
                        (rand(f * 3) - 0.5) * size[0],
                        (rand(f * 3 + 1) - 0.5) * size[1],
                        (rand(f * 3 + 2) - 0.5) * size[2],
                    ]);
                }
                return points;
            }
            var vertexCount = vertices.length / 3;
            var scale = (base.modelScale ? base.modelScale.get(t) : 100) / 100;
            for (var i = 0; i < count; i++) {
                var vi = (i * 7) % vertexCount;
                points.push([vertices[vi * 3] * scale, vertices[vi * 3 + 1] * scale, vertices[vi * 3 + 2] * scale]);
            }
            return points;
        }
        sampleMask(count, size, sample) {
            var points = [];
            if (!sample) {
                for (var f = 0; f < count; f++) {
                    points.push([(rand(f * 3) - 0.5) * size[0], (rand(f * 3 + 1) - 0.5) * size[1], 0]);
                }
                return points;
            }
            var attempts = 0;
            while (points.length < count && attempts < count * 20) {
                attempts++;
                var x = Math.floor(rand(points.length * 3 + attempts) * sample.width);
                var y = Math.floor(rand(points.length * 7 + attempts) * sample.height);
                var idx = (y * sample.width + x) * 4;
                if (sample.data[idx + 3] > 20) {
                    var depth = sample.data[idx] / 255;
                    points.push([
                        (x / sample.width - 0.5) * size[0],
                        (0.5 - y / sample.height) * size[1],
                        (depth - 0.5) * size[2],
                    ]);
                }
            }
            return points;
        }
        layerSample(property) {
            var value = property ? property.get(PZ.trapcode.currentTime) : null;
            return this._assets.ready("layer", value);
        }
        rebuildStrings(counts, on) {
            this._stringKey = counts.join(",") + "|" + on;
            this.strings.visible = on;
            if (!on) return;
            var nx = counts[0];
            var ny = counts[1];
            var nz = counts[2];
            var count = nx * ny * nz;
            var indices = [];
            function id(x, y, z) {
                return z * nx * ny + y * nx + x;
            }
            function srand(i) {
                var v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
                return v - Math.floor(v);
            }
            for (var z = 0; z < nz; z++) {
                for (var y = 0; y < ny; y++) {
                    for (var x = 0; x < nx; x++) {
                        var a = id(x, y, z);
                        if (x + 1 < nx && srand(a * 3 + x) < 0.98) indices.push(a, id(x + 1, y, z));
                        if (y + 1 < ny && srand(a * 3 + y + 1) < 0.98) indices.push(a, id(x, y + 1, z));
                        if (z + 1 < nz && srand(a * 3 + z + 2) < 0.5) indices.push(a, id(x, y, z + 1));
                    }
                }
            }
            if (this.strings.geometry) this.strings.geometry.dispose();
            var geometry = new THREE.BufferGeometry();
            geometry.setIndex(indices);
            geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            geometry.addAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            this.strings.geometry = geometry;
        }
        updatePalettes() {
            var t = PZ.trapcode.currentTime;
            var particle = this.properties.particle;
            var colorOver = particle.colorOver.get(t);
            if (this._colorSig !== T.signature(colorOver)) {
                this._colorSig = T.signature(colorOver);
                T.fillGradient(this.palettes.colorOver, colorOver);
            }
            var sizeCurve = particle.sizeCurve.get(t);
            var sizeEnabled = particle.sizeOverEnabled.get(t);
            if (this._sizeSig !== sizeEnabled + "|" + T.signature(sizeCurve)) {
                this._sizeSig = sizeEnabled + "|" + T.signature(sizeCurve);
                T.fillCurve(this.palettes.sizeOver, sizeCurve, sizeEnabled);
            }
            var opacityCurve = particle.opacityCurve.get(t);
            var opacityEnabled = particle.opacityOverEnabled.get(t);
            if (this._opacitySig !== opacityEnabled + "|" + T.signature(opacityCurve)) {
                this._opacitySig = opacityEnabled + "|" + T.signature(opacityCurve);
                T.fillCurve(this.palettes.opacityOver, opacityCurve, opacityEnabled);
            }
        }
        applyDeformations(count) {
            var out = this.outPositions;
            out.set(this.basePositions);
            var t = PZ.trapcode.currentTime;
            var base = this.properties.base;
            var disperse = this.properties.disperse;
            var spherical = this.properties.spherical;
            var fractal = this.properties.fractal;
            var seed = fractal.randomSeed.get(t);

            var rotation = base.rotation.get(t);
            var basePosition = base.position.get(t);
            var cosX = Math.cos((rotation[0] * Math.PI) / 180);
            var sinX = Math.sin((rotation[0] * Math.PI) / 180);
            var cosY = Math.cos((rotation[1] * Math.PI) / 180);
            var sinY = Math.sin((rotation[1] * Math.PI) / 180);
            var cosZ = Math.cos((rotation[2] * Math.PI) / 180);
            var sinZ = Math.sin((rotation[2] * Math.PI) / 180);

            var disperseAmount = disperse.disperse.get(t);
            var twist = disperse.twist.get(t);
            var sphereStrength = spherical.strength.get(t) / 100;
            var sphereCenterRaw = spherical.position.get(t);
            var sphereRadius = spherical.radius.get(t);
            var sphereFeather = Math.max(spherical.feather.get(t) / 100, 0.001);
            var sphereScale = [
                Math.max(spherical.scaleX.get(t) / 100, 0.001),
                Math.max(spherical.scaleY.get(t) / 100, 0.001),
                Math.max(spherical.scaleZ.get(t) / 100, 0.001),
            ];
            var sphereRot = [
                (spherical.rotationX.get(t) * Math.PI) / 180,
                (spherical.rotationY.get(t) * Math.PI) / 180,
                (spherical.rotationZ.get(t) * Math.PI) / 180,
            ];
            var sphere2On = spherical.sphereEnabled.get(t) === 1;
            var sphere2Strength = spherical.sphere2Strength.get(t) / 100;
            var sphere2CenterRaw = spherical.sphere2Position.get(t);
            var sphere2Radius = spherical.sphere2Radius.get(t);
            var fractalAmount = fractal.displace.get(t);
            var fractalY = fractal.yDisplace.get(t);
            var fractalZ = fractal.zDisplace.get(t);
            var dispMode = fractal.displacementMode.get(t);
            var affectSize = fractal.affectSize.get(t);
            var affectOpacity = fractal.affectOpacity.get(t);
            var fScale = fractal.fScale.get(t);
            var fTime = t / 30;
            var fluid = this.properties.fluid;
            var kaleido = this.properties.kaleidospace;
            var fluidOn = fluid.fluidMotion.get(t) === 1;
            var buoyancy = fluidOn ? fluid.buoyancy.get(t) : 0;
            var swirlOn = fluidOn && fluid.randomSwirl.get(t) === 1;
            var swirlScale = fluidOn ? fluid.swirlScale.get(t) : 10;
            var fluidSeed = fluidOn ? fluid.randomSeed.get(t) : 0;
            var vortexStrength = fluidOn ? fluid.vortexStrength.get(t) / 100 : 0;
            var vortexCore = fluidOn ? fluid.vortexCoreSize.get(t) : 50;
            var vortexTilt = fluidOn ? (fluid.vortexTilt.get(t) * Math.PI) / 180 : 0;
            var vortexRotate = fluidOn ? (fluid.vortexRotate.get(t) * Math.PI) / 180 : 0;
            var mirrorX = kaleido.mirrorX.get(t) === 1;
            var mirrorY = kaleido.mirrorY.get(t) === 1;
            var mirrorZ = kaleido.mirrorZ.get(t) === 1;
            var kaleidoBehaviour = kaleido.behaviour.get(t);
            var kaleidoCenterRaw = kaleido.center.get(t);
            // Sphere / kaleido positions are authored in comp pixels (default 720,540).
            // Form particles live around local origin, so map comp coords -> local.
            var compToLocal = function (c) {
                if (!c) return [0, 0, 0];
                var looksLikeComp = Math.abs(c[0]) > 400 || Math.abs(c[1]) > 400;
                if (looksLikeComp) return [c[0] - 720, -(c[1] - 540), c[2] || 0];
                return [c[0], c[1], c[2] || 0];
            };
            var sphereCenter = compToLocal(sphereCenterRaw);
            var sphere2Center = compToLocal(sphere2CenterRaw);
            var kaleidoCenter = compToLocal(kaleidoCenterRaw);
            var fractalParams = {
                complexity: fractal.complexity.get(t),
                octaveMultiplier: fractal.octaveMultiplier.get(t),
                octaveScale: fractal.octaveScale.get(t),
                flowX: fractal.flowX.get(t),
                flowY: fractal.flowY.get(t),
                flowZ: fractal.flowZ.get(t),
                flowEvolution: fractal.flowEvolution.get(t) * 0.01,
                fractalSum: fractal.fractalSum.get(t),
                gamma: fractal.gamma.get(t),
                addSubtract: fractal.addSubtract.get(t),
                min: fractal.min.get(t),
                max: fractal.max.get(t),
                seed: seed,
                sum: fractal.fractalSum.get(t),
            };
            var fractalScale = Math.max(fScale, 0.01) * 0.0005;
            var useFractal = fractalAmount !== 0 || fractalY !== 0 || fractalZ !== 0 || affectSize !== 0 || affectOpacity !== 0;
            var maps = this.properties.layerMaps;
            var fractalStrengthSample = maps.fractalStrengthEnabled.get(t) === 1 ? this.layerSample(maps.fractalStrengthLayer) : null;
            var displacementSample = maps.displacementEnabled.get(t) === 1 ? this.layerSample(maps.displacementLayer) : null;
            var rotateSample = maps.rotateEnabled.get(t) === 1 ? this.layerSample(maps.rotateLayer) : null;
            var colorMapSample = maps.colorAlphaEnabled.get(t) === 1 ? this.layerSample(maps.colorAlphaLayer) : null;
            var sizeMapSample = maps.sizeEnabled.get(t) === 1 ? this.layerSample(maps.sizeLayer) : null;
            var disperseMapSample = maps.disperseEnabled.get(t) === 1 ? this.layerSample(maps.disperseLayer) : null;
            var useColors = !!colorMapSample;
            this.setVertexColors(useColors);

            var sizeMod = this.sizeModArray;
            var alphaMod = this.alphaModArray;
            var colors = this.colorArray;
            for (var zz = 0; zz < count; zz++) {
                sizeMod[zz] = 1;
                alphaMod[zz] = 1;
            }

            var cosSX = Math.cos(-sphereRot[0]);
            var sinSX = Math.sin(-sphereRot[0]);
            var cosSY = Math.cos(-sphereRot[1]);
            var sinSY = Math.sin(-sphereRot[1]);
            var cosSZ = Math.cos(-sphereRot[2]);
            var sinSZ = Math.sin(-sphereRot[2]);
            // Writes the displaced point to SPHERE_OUT.
            var applySphere = function (px, py, pz, cx, cy, cz, strength, radius, featherAmt) {
                var dx = px - cx;
                var dy = py - cy;
                var dz = pz - cz;
                // inverse rotate into ellipsoid space
                var ry = dy * cosSX - dz * sinSX;
                var rz = dy * sinSX + dz * cosSX;
                dy = ry;
                dz = rz;
                var rx = dx * cosSY + dz * sinSY;
                rz = -dx * sinSY + dz * cosSY;
                dx = rx;
                dz = rz;
                rx = dx * cosSZ - dy * sinSZ;
                ry = dx * sinSZ + dy * cosSZ;
                dx = rx;
                dy = ry;
                // inverse scale
                var ex = dx / sphereScale[0];
                var ey = dy / sphereScale[1];
                var ez = dz / sphereScale[2];
                var dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
                var sr = Math.max(radius, 0.0001);
                var feather = Math.max(featherAmt, 0.001);
                var influence;
                if (dist <= sr) influence = 1;
                else influence = Math.max(0, 1 - (dist - sr) / Math.max(sr * feather, 0.0001));
                SPHERE_OUT[0] = px;
                SPHERE_OUT[1] = py;
                SPHERE_OUT[2] = pz;
                if (influence <= 0 || strength === 0) return;
                var ox = px - cx;
                var oy = py - cy;
                var oz = pz - cz;
                var olen = Math.sqrt(ox * ox + oy * oy + oz * oz);
                if (olen < 0.0001) {
                    ox = 0;
                    oy = 1;
                    oz = 0;
                    olen = 1;
                }
                var push = strength * influence * sr;
                SPHERE_OUT[0] = px + (ox / olen) * push;
                SPHERE_OUT[1] = py + (oy / olen) * push;
                SPHERE_OUT[2] = pz + (oz / olen) * push;
            };
            var swirlFreq = Math.max(swirlScale, 0.01) * 0.002;
            var buoyOffset = buoyancy * (t / 30) * 4.0;
            var vortexCorePx = 20 + (Math.max(0, Math.min(100, vortexCore)) / 100) * 220;
            var tSec = t / 30;

            for (var i = 0; i < count; i++) {
                var x = out[i * 3];
                var y = out[i * 3 + 1];
                var z = out[i * 3 + 2];

                var u = 0.5 + x * 0.001;
                var v = 0.5 + y * 0.001;

                // deterministic per-particle random offsets (seeded, decorrelated per axis)
                var r1 = hash3(i, 0, fluidSeed, seed) - 0.5;
                var r2 = hash3(i, 1, fluidSeed, seed) - 0.5;
                var r3 = hash3(i, 2, fluidSeed, seed) - 0.5;

                var dispMod = 1;
                var fracMod = 1;
                if (disperseMapSample && sampleMap(disperseMapSample, u, v)) {
                    dispMod = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
                }
                if (fractalStrengthSample && sampleMap(fractalStrengthSample, u, v)) {
                    fracMod = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
                }

                if (disperseAmount !== 0) {
                    x += r1 * disperseAmount * dispMod;
                    y += r2 * disperseAmount * dispMod;
                    z += r3 * disperseAmount * dispMod;
                }

                if (useFractal) {
                    var nx0 = x * fractalScale;
                    var ny0 = y * fractalScale;
                    var nz0 = z * fractalScale;
                    var nMain = 0;
                    var nX = 0;
                    var nY = 0;
                    var nZ = 0;
                    if (dispMode === 1) {
                        nX = fbm(nx0, ny0, nz0, fractalParams, fTime);
                        nY = fbm(nx0 + 31.7, ny0 + 17.3, nz0 + 11.1, fractalParams, fTime);
                        nZ = fbm(nx0 + 57.3, ny0 + 43.7, nz0 + 23.9, fractalParams, fTime);
                        nMain = (nX + nY + nZ) / 3;
                    } else {
                        nMain = fbm(nx0, ny0, nz0, fractalParams, fTime);
                        nX = nMain;
                        nY = nMain;
                        nZ = nMain;
                    }
                    var fAmt = fractalAmount * fracMod;
                    var fYAmt = fractalY * fracMod;
                    var fZAmt = fractalZ * fracMod;
                    if (dispMode === 3) {
                        // SCALE mode: uniform scale around origin driven by noise.
                        // Displace acts as % scale (100 = +/-100% at full noise).
                        var sAmt = (fAmt !== 0 ? fAmt : fYAmt !== 0 ? fYAmt : fZAmt) / 100;
                        var sF = 1 + nMain * 0.5 * sAmt;
                        if (sF < 0.01) sF = 0.01;
                        x *= sF;
                        y *= sF;
                        z *= sF;
                    } else if (dispMode === 2) {
                        // SPHERICAL: push along radial direction
                        var rl = Math.sqrt(x * x + y * y + z * z);
                        if (rl < 0.0001) {
                            x += nMain * fAmt;
                        } else {
                            var ux = x / rl;
                            var uy = y / rl;
                            var uz = z / rl;
                            var avg = (fAmt + fYAmt + fZAmt) / 3;
                            var pushS = nMain * avg;
                            x += ux * pushS;
                            y += uy * pushS;
                            z += uz * pushS;
                        }
                    } else {
                        // 0 = XYZ linked (single noise), 1 = independent XYZ
                        x += nX * fAmt;
                        y += nY * fYAmt;
                        z += nZ * fZAmt;
                    }
                    // Affect size / opacity driven by same fractal value
                    if (affectSize !== 0) {
                        var sm = 1 + nMain * 0.5 * (affectSize / 100);
                        if (sm < 0.05) sm = 0.05;
                        sizeMod[i] = sm;
                    }
                    if (affectOpacity !== 0) {
                        var am = 1 + nMain * 0.5 * (affectOpacity / 100);
                        if (am < 0) am = 0;
                        if (am > 1) am = 1;
                        alphaMod[i] = am;
                    }
                    // Layer-map size modulation
                    if (sizeMapSample && sampleMap(sizeMapSample, u, v)) {
                        var lum = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
                        sizeMod[i] *= 0.2 + lum * 1.6;
                        alphaMod[i] *= 0.25 + MAP_RGBA[3] * 0.75;
                    }
                } else if (sizeMapSample && sampleMap(sizeMapSample, u, v)) {
                    var lum2 = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
                    sizeMod[i] = 0.2 + lum2 * 1.6;
                    alphaMod[i] = 0.25 + MAP_RGBA[3] * 0.75;
                }

                // Layer-map displacement (along normal-ish Z + slight XY)
                if (displacementSample && sampleMap(displacementSample, u, v)) {
                    var dlum = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3 - 0.5;
                    x += dlum * 60;
                    y += dlum * 60;
                    z += (MAP_RGBA[3] - 0.5) * 120;
                }

                // Fluid: buoyancy + random swirl + vortex
                if (fluidOn) {
                    if (buoyancy !== 0) y += buoyOffset;
                    if (swirlOn) {
                        var sxn = smoothNoise(y * swirlFreq + fluidSeed, z * swirlFreq, fTime * 0.7 + i * 0.0001, fluidSeed);
                        var syn = smoothNoise(z * swirlFreq, x * swirlFreq + fluidSeed, fTime * 0.7, fluidSeed + 5.2);
                        var szn = smoothNoise(x * swirlFreq, y * swirlFreq, fTime * 0.7, fluidSeed + 9.1);
                        var swAmt = Math.max(swirlScale, 0) * 3.0;
                        x += sxn * swAmt;
                        y += syn * swAmt;
                        z += szn * swAmt;
                    }
                    if (vortexStrength !== 0) {
                        var cT = Math.cos(vortexTilt);
                        var sT = Math.sin(vortexTilt);
                        var vy2 = y * cT - z * sT;
                        var vz2 = y * sT + z * cT;
                        var rad = Math.sqrt(x * x + vz2 * vz2);
                        var fall = Math.exp(-(rad * rad) / Math.max(vortexCorePx * vortexCorePx, 1));
                        var vang = vortexStrength * fall * (1.0 + tSec * 0.6) + vortexRotate;
                        var cv = Math.cos(vang);
                        var sv = Math.sin(vang);
                        var nxv = x * cv - vz2 * sv;
                        var nzv = x * sv + vz2 * cv;
                        x = nxv;
                        y = vy2 * cT + nzv * sT;
                        z = -vy2 * sT + nzv * cT;
                    }
                }

                if (twist !== 0) {
                    var rotExtra = 0;
                    if (rotateSample && sampleMap(rotateSample, u, v)) {
                        rotExtra = ((MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3 - 0.5) * 180;
                    }
                    var angle = (y * 0.01) * ((twist + rotExtra) * Math.PI) / 180;
                    var ca = Math.cos(angle);
                    var sa = Math.sin(angle);
                    var nx = x * ca - z * sa;
                    var nz = x * sa + z * ca;
                    x = nx;
                    z = nz;
                }

                if (sphereStrength !== 0) {
                    applySphere(x, y, z, sphereCenter[0], sphereCenter[1], sphereCenter[2], sphereStrength, sphereRadius, sphereFeather);
                    x = SPHERE_OUT[0];
                    y = SPHERE_OUT[1];
                    z = SPHERE_OUT[2];
                }
                if (sphere2On && sphere2Strength !== 0) {
                    applySphere(x, y, z, sphere2Center[0], sphere2Center[1], sphere2Center[2], sphere2Strength, sphere2Radius, sphereFeather);
                    x = SPHERE_OUT[0];
                    y = SPHERE_OUT[1];
                    z = SPHERE_OUT[2];
                }

                // Kaleidospace
                if (mirrorX || mirrorY || mirrorZ) {
                    if (kaleidoBehaviour === 1) {
                        // mirror and keep: distribute folded copies on both sides
                        var keep = (i % 2 === 0) ? 1 : -1;
                        if (mirrorX) x = kaleidoCenter[0] + Math.abs(x - kaleidoCenter[0]) * keep;
                        if (mirrorY) y = kaleidoCenter[1] + Math.abs(y - kaleidoCenter[1]) * keep;
                        if (mirrorZ) z = kaleidoCenter[2] + Math.abs(z - kaleidoCenter[2]) * keep;
                    } else {
                        if (mirrorX) x = kaleidoCenter[0] + Math.abs(x - kaleidoCenter[0]);
                        if (mirrorY) y = kaleidoCenter[1] + Math.abs(y - kaleidoCenter[1]);
                        if (mirrorZ) z = kaleidoCenter[2] + Math.abs(z - kaleidoCenter[2]);
                    }
                }

                var ty = y * cosX - z * sinX;
                var tz = y * sinX + z * cosX;
                y = ty;
                z = tz;
                var tx = x * cosY + z * sinY;
                tz = -x * sinY + z * cosY;
                x = tx;
                z = tz;
                tx = x * cosZ - y * sinZ;
                ty = x * sinZ + y * cosZ;
                x = tx;
                y = ty;

                out[i * 3] = x + basePosition[0];
                out[i * 3 + 1] = y + basePosition[1];
                out[i * 3 + 2] = z + basePosition[2];

                if (useColors) {
                    if (sampleMap(colorMapSample, u, v)) {
                        colors[i * 3] = MAP_RGBA[0];
                        colors[i * 3 + 1] = MAP_RGBA[1];
                        colors[i * 3 + 2] = MAP_RGBA[2];
                    } else {
                        colors[i * 3] = 1;
                        colors[i * 3 + 1] = 1;
                        colors[i * 3 + 2] = 1;
                    }
                }
            }

            var geometry = this.points.geometry;
            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.aSizeM.needsUpdate = true;
            geometry.attributes.aAlphaM.needsUpdate = true;
            if (useColors) {
                this.colorAttribute.needsUpdate = true;
            }
            if (this.strings && this.strings.visible) {
                this.updateStrings(count);
            }
        }
        // Copies the displaced lattice into the string geometry and colors each
        // point from the color-over ramp (sampled from the palette texture).
        updateStrings(count) {
            var geometry = this.strings.geometry;
            geometry.attributes.position.array.set(this.outPositions);
            geometry.attributes.position.needsUpdate = true;
            var ramp = this.palettes.colorOver.image.data;
            var cols = geometry.attributes.color.array;
            for (var s = 0; s < count; s++) {
                var ri = Math.round((count > 1 ? s / (count - 1) : 0) * 255) * 4;
                cols[s * 3] = ramp[ri] / 255;
                cols[s * 3 + 1] = ramp[ri + 1] / 255;
                cols[s * 3 + 2] = ramp[ri + 2] / 255;
            }
            geometry.attributes.color.needsUpdate = true;
        }
        setVertexColors(on) {
            if (on === this._useVColor) return;
            this._useVColor = on;
            if (on) this.material.defines.USE_VCOLOR = 1;
            else delete this.material.defines.USE_VCOLOR;
            this.material.needsUpdate = true;
        }
        update(e) {
            PZ.trapcode.setTime(e);
            this._time = e;
            if (!this.material) this.rebuildMaterial();
            var t = PZ.trapcode.currentTime;
            var base = this.properties.base;
            var counts = this.gridCounts();
            var count = counts[0] * counts[1] * counts[2];
            this.requestAssets();
            var signature = this.baseSignature(counts);
            if (signature !== this._baseSig) this.rebuildBase(counts, signature);
            var stringsOn = base.stringEnabled.get(t) === 1;
            if (this._stringKey !== counts.join(",") + "|" + stringsOn) this.rebuildStrings(counts, stringsOn);
            this.updatePalettes();
            this.applyDeformations(count);

            var particle = this.properties.particle;
            var u = this.material.uniforms;
            u.size.value = particle.size.get(t);
            u.sizeRandom.value = particle.sizeRandom.get(t) / 100;
            u.opacity.value = particle.opacity.get(t) / 100;
            var tint = particle.color.get(t);
            u.colorTint.value.set(tint[0], tint[1], tint[2], 1);
            var additive = particle.blending.get(t) === 1;
            this.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
            if (this.stringMaterial) {
                this.stringMaterial.opacity = stringsOn ? particle.opacity.get(t) / 100 : 0.5;
                this.stringMaterial.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
            }
            var transform = this.properties.transform;
            this.threeObj.position.set(transform.offsetX.get(t), transform.offsetY.get(t), transform.offsetZ.get(t));
            var scale = transform.scale.get(t) / 100;
            this.threeObj.scale.set(scale, scale, scale);
            this._renderedRevision = this._assets.revision;
        }
        // Waits for every asset this frame needs, then makes sure the frame was
        // computed with the settled data.
        async prepare(e) {
            PZ.trapcode.setTime(e);
            var waits = this.requestAssets().map(function (entry) { return entry.promise; });
            if (this.texture && this.texture.loading) waits.push(this.texture.loading);
            await Promise.all(waits);
            if (!this.material || this._time !== e || this._renderedRevision !== this._assets.revision) {
                this.update(e);
            }
        }
    };

    PZ.object3d.form.instance.prototype.defaultName = "Form";
    PZ.object3d.form.instance.maxPoints = 200000;

    function hash3(x, y, z, seed) {
        var n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.37) * 43758.5453;
        return n - Math.floor(n);
    }

    function smoothNoise(x, y, z, seed) {
        var xi = Math.floor(x);
        var yi = Math.floor(y);
        var zi = Math.floor(z);
        var xf = x - xi;
        var yf = y - yi;
        var zf = z - zi;
        var u = xf * xf * (3 - 2 * xf);
        var v = yf * yf * (3 - 2 * yf);
        var w = zf * zf * (3 - 2 * zf);
        function lerp(a, b, t) {
            return a + (b - a) * t;
        }
        var c000 = hash3(xi, yi, zi, seed);
        var c100 = hash3(xi + 1, yi, zi, seed);
        var c010 = hash3(xi, yi + 1, zi, seed);
        var c110 = hash3(xi + 1, yi + 1, zi, seed);
        var c001 = hash3(xi, yi, zi + 1, seed);
        var c101 = hash3(xi + 1, yi, zi + 1, seed);
        var c011 = hash3(xi, yi + 1, zi + 1, seed);
        var c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
        var x00 = lerp(c000, c100, u);
        var x10 = lerp(c010, c110, u);
        var x01 = lerp(c001, c101, u);
        var x11 = lerp(c011, c111, u);
        var y0 = lerp(x00, x10, v);
        var y1 = lerp(x01, x11, v);
        return lerp(y0, y1, w) * 2 - 1;
    }

    function fbm(x, y, z, params, time) {
        var complexity = Math.max(1, Math.round(params.complexity));
        var octaveMultiplier = params.octaveMultiplier;
        var octaveScale = params.octaveScale;
        var evolution = params.flowEvolution * time;
        var amp = 1;
        var freq = 1;
        var sum = 0;
        var norm = 0;
        var seed = params.seed || 0;
        for (var o = 0; o < complexity; o++) {
            var n = smoothNoise(
                x * freq + params.flowX * evolution,
                y * freq + params.flowY * evolution,
                z * freq + params.flowZ * evolution,
                seed + o * 17.3
            );
            if (params.sum === 1) n = Math.abs(n) * 2 - 1;
            else if (params.sum === 2) n = Math.sin(n * Math.PI);
            else if (params.sum === 3) n = Math.cos(n * Math.PI);
            sum += n * amp;
            norm += amp;
            amp *= octaveMultiplier;
            freq *= octaveScale;
        }
        var value = norm > 0 ? sum / norm : 0;
        value = value - params.addSubtract;
        if (params.gamma !== 1) {
            var sign = value < 0 ? -1 : 1;
            value = sign * Math.pow(Math.abs(value), params.gamma);
        }
        var range = params.max - params.min;
        if (range !== 0) value = value * range * 0.5 + (params.max + params.min) * 0.5;
        return value;
    }

    // Samples a decoded layer map at (u, v) into MAP_RGBA. Returns false when
    // the map has no data.
    function sampleMap(sample, u, v) {
        if (!sample || !sample.data) return false;
        var x = Math.floor(clamp01(u) * (sample.width - 1));
        var y = Math.floor((1 - clamp01(v)) * (sample.height - 1));
        var index = (y * sample.width + x) * 4;
        MAP_RGBA[0] = sample.data[index] / 255;
        MAP_RGBA[1] = sample.data[index + 1] / 255;
        MAP_RGBA[2] = sample.data[index + 2] / 255;
        MAP_RGBA[3] = sample.data[index + 3] / 255;
        return true;
    }

    function rand(seed) {
        return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    }

    function clamp01(v) {
        return v < 0 ? 0 : v > 1 ? 1 : v;
    }

    function boxPoint(x, y, z, totalX, totalY, totalZ, size) {
        var sx = size[0];
        var sy = size[1];
        var sz = size[2];
        return [
            (totalX > 0 ? x / totalX - 0.5 : 0) * sx,
            (totalY > 0 ? y / totalY - 0.5 : 0) * sy,
            (totalZ > 0 ? z / totalZ - 0.5 : 0) * sz,
        ];
    }

    function spherePoint(x, y, z, counts, size) {
        var i = z * counts[0] * counts[1] + y * counts[0] + x;
        var total = counts[0] * counts[1] * counts[2];
        var phi = Math.acos(1 - (2 * (i + 0.5)) / total);
        var theta = Math.PI * (1 + Math.sqrt(5)) * i;
        var r = (size[0] + size[1] + size[2]) / 6;
        return [Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r];
    }

    function sphereGridPoint(x, y, z, counts, size) {
        var u = counts[0] > 1 ? x / (counts[0] - 1) : 0.5;
        var v = counts[1] > 1 ? y / (counts[1] - 1) : 0.5;
        var w = counts[2] > 1 ? z / (counts[2] - 1) : 0.5;
        var phi = v * Math.PI;
        var theta = u * Math.PI * 2;
        var r = ((size[0] + size[1] + size[2]) / 6) * (0.6 + 0.4 * w);
        return [Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r];
    }

    function cylinderPoint(x, y, z, counts, size) {
        var angle = (x / counts[0]) * Math.PI * 2;
        var radius = (size[0] + size[2]) / 4;
        var height = (counts[1] > 1 ? y / (counts[1] - 1) - 0.5 : 0) * size[1];
        return [Math.cos(angle) * radius, height, Math.sin(angle) * radius];
    }

    function circlePoint(x, y, z, counts, size) {
        var angle = (y / counts[1]) * Math.PI * 2;
        var ring = counts[0] > 1 ? x / (counts[0] - 1) : 0;
        var radius = ((size[0] + size[1]) / 4) * ring;
        var depth = (counts[2] > 1 ? z / (counts[2] - 1) - 0.5 : 0) * size[2];
        return [Math.cos(angle) * radius, Math.sin(angle) * radius, depth];
    }

    function planePoint(x, y, z, counts, size) {
        var p = boxPoint(x, y, 0, counts[0] - 1, counts[1] - 1, 0, size);
        return [p[0], p[1], 0];
    }

    var number = T.number;
    var vector3 = T.vector3;
    var option = T.option;
    var imageAsset = T.imageAsset;
    var curveProperty = T.curveProperty;
    var gradientProperty = T.gradientProperty;

    PZ.object3d.form.instance.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Form" },
    };

    PZ.object3d.form.instance.baseDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Base Form", visible: false },
        baseFormType: option("Base Form", 0, "box-grid;sphere;sphere-grid;cylinder;circle;plane;3D model;text/mask", true),
        baseFormSize: vector3("Base Form Size", [500, 500, 500], { min: 0, step: 1 }),
        particlesX: number("Particles in X", 70, { min: 1, step: 1, decimals: 0 }),
        particlesY: number("Particles in Y", 70, { min: 1, step: 1, decimals: 0 }),
        particlesZ: number("Particles in Z", 3, { min: 1, step: 1, decimals: 0 }),
        position: vector3("Position", [0, 0, 0], { step: 1 }),
        rotation: vector3("Rotation", [0, 0, 0], { step: 1 }),
        stringEnabled: option("Strings", 0, "off;on"),
        modelAsset: {
            name: "3D model",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.GEOMETRY,
            accept: ".json,application/json",
            value: null,
        },
        modelScale: number("Model scale", 100, { min: 0, step: 1 }),
        maskAsset: {
            name: "Text/mask image",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: null,
        },
    };

    PZ.object3d.form.instance.particleDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Particle", visible: false },
        texture: {
            name: "Texture",
            type: PZ.property.type.ASSET,
            items: PZ.object3d.form.presetTexturesList,
            baseUrl: "/assets/textures/particles/",
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: "/assets/textures/particles/circle_soft.png",
            changed: function () {
                this.parentObject.redrawTexture();
            },
        },
        size: number("Size", 2, { min: 0, step: 0.1, decimals: 2 }),
        sizeRandom: number("Size Random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeOverEnabled: option("Size Over", 0, "off;on"),
        sizeCurve: curveProperty("Size Curve"),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityOverEnabled: option("Opacity Over", 0, "off;on"),
        opacityCurve: curveProperty("Opacity Curve"),
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
        colorOver: gradientProperty("Color Over"),
        blending: option("Blend Mode", 0, "normal;add", true),
    };

    PZ.object3d.form.instance.disperseDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Disperse", visible: false },
        disperse: number("Disperse", 0, { step: 1 }),
        twist: number("Twist", 0, { step: 1 }),
    };

    PZ.object3d.form.instance.fluidDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Fluid", visible: false },
        fluidMotion: option("Fluid Motion", 0, "off;on", true),
        buoyancy: number("Buoyancy", 5, { step: 0.01, decimals: 2 }),
        randomSwirl: option("Random Swirl", 0, "off;on", false),
        swirlScale: number("Swirl Scale", 10, { step: 0.01, decimals: 2 }),
        randomSeed: number("Random Seed", 0, { step: 1, decimals: 0 }),
        vortexStrength: number("Vortex Strength", 100, { step: 1 }),
        vortexCoreSize: number("Vortex Core Size", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        vortexTilt: number("Vortex Tilt", 0, { step: 1 }),
        vortexRotate: number("Vortex Rotate", 0, { step: 1 }),
    };

    PZ.object3d.form.instance.fractalDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Fractal Field", visible: false },
        affectSize: number("Affect Size", 0, { min: 0, step: 1 }),
        affectOpacity: number("Affect Opacity", 0, { min: 0, step: 1 }),
        displacementMode: option("Displacement Mode", 0, "XYZ linked;independent XYZ;spherical;scale", false),
        displace: number("Displace", 0, { step: 1 }),
        yDisplace: number("Y Displace", 0, { step: 1 }),
        zDisplace: number("Z Displace", 0, { step: 1 }),
        flowX: number("Flow X", 0, { step: 0.01, decimals: 2 }),
        flowY: number("Flow Y", 0, { step: 0.01, decimals: 2 }),
        flowZ: number("Flow Z", 0, { step: 0.01, decimals: 2 }),
        flowEvolution: number("Flow Evolution", 50, { step: 0.1, decimals: 1 }),
        fractalSum: option("Fractal Sum", 0, "noise;abs;sin;cos", false),
        gamma: number("Gamma", 1, { step: 0.01, decimals: 2 }),
        addSubtract: number("Add/Subtract", 0, { step: 0.01, decimals: 2 }),
        min: number("Min", -1, { step: 0.01, decimals: 2 }),
        max: number("Max", 1, { step: 0.01, decimals: 2 }),
        fScale: number("F Scale", 10, { step: 0.1, decimals: 1 }),
        complexity: number("Complexity", 3, { min: 1, max: 8, step: 1, decimals: 0 }),
        octaveMultiplier: number("Octave Multiplier", 0.5, { step: 0.01, decimals: 2 }),
        octaveScale: number("Octave Scale", 1.5, { step: 0.01, decimals: 2 }),
        randomSeed: number("Random Seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.form.instance.sphericalDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Spherical Field", visible: false },
        strength: number("Strength[%]", 0, { step: 1 }),
        position: vector3("Sphere Position", [720, 540, 0], { step: 1 }),
        radius: number("Radius", 100, { min: 0, step: 1 }),
        scaleX: number("Scale X", 100, { step: 1 }),
        scaleY: number("Scale Y", 100, { step: 1 }),
        scaleZ: number("Scale Z", 100, { step: 1 }),
        rotationX: number("X Rotation", 0, { step: 1 }),
        rotationY: number("Y Rotation", 0, { step: 1 }),
        rotationZ: number("Z Rotation", 0, { step: 1 }),
        feather: number("Feather", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sphereEnabled: option("Sphere 2", 0, "off;on", false),
        sphere2Strength: number("Sphere 2 Strength[%]", 0, { step: 1 }),
        sphere2Position: vector3("Sphere 2 Position", [720, 540, 0], { step: 1 }),
        sphere2Radius: number("Sphere 2 Radius", 100, { min: 0, step: 1 }),
    };

    PZ.object3d.form.instance.kaleidoDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Kaleidospace", visible: false },
        mirrorX: option("Mirror On X", 0, "off;on", true),
        mirrorY: option("Mirror On Y", 0, "off;on", true),
        mirrorZ: option("Mirror On Z", 0, "off;on", true),
        behaviour: option("Behaviour", 0, "mirror and remove;mirror and keep", false),
        center: vector3("Center Position", [720, 540, 0], { step: 1 }),
    };

    PZ.object3d.form.instance.layerMapDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Layer Maps", visible: false },
        colorAlphaEnabled: option("Color and Alpha", 0, "off;on", true),
        colorAlphaLayer: imageAsset("Color and Alpha Layer"),
        displacementEnabled: option("Displacement", 0, "off;on", true),
        displacementLayer: imageAsset("Displacement Layer"),
        sizeEnabled: option("Size", 0, "off;on", true),
        sizeLayer: imageAsset("Size Layer"),
        fractalStrengthEnabled: option("Fractal Strength", 0, "off;on", true),
        fractalStrengthLayer: imageAsset("Fractal Strength Layer"),
        disperseEnabled: option("Disperse", 0, "off;on", true),
        disperseLayer: imageAsset("Disperse Layer"),
        rotateEnabled: option("Rotate", 0, "off;on", true),
        rotateLayer: imageAsset("Rotate Layer"),
    };

    PZ.object3d.form.instance.transformDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Transform", visible: false },
        scale: number("Scale", 100, { min: 0, step: 1 }),
        offsetX: number("X Offset", 0, { step: 1 }),
        offsetY: number("Y Offset", 0, { step: 1 }),
        offsetZ: number("Z Offset", 0, { step: 1 }),
    };

    T.registerObjectTypes(PZ.object3d.form.instance, [
        { name: "Form", desc: "A static particle lattice.", type: 0 },
    ]);

    if (T.designer) {
        T.designer.registerConfig(PZ.object3d.form, {
            title: "Trapcode Form Designer",
            targets: function (root) {
                return root.forms;
            },
            targetName: function (form, index) {
                if (index === 0) return "Primary Form";
                return "Form " + (index + 1);
            },
            addKinds: [
                {
                    name: "Add a Form",
                    create: function (root) {
                        var form = new PZ.object3d.form.instance();
                        root.forms.push(form);
                        form.loading = form.load(null, root);
                        form.update(0);
                        return form;
                    },
                },
            ],
            blocks: function () {
                return [
                    { key: "base", name: "Type" },
                    { key: "particle", name: "Particle" },
                    { key: "disperse", name: "Disperse" },
                    { key: "fluid", name: "Fluid" },
                    { key: "fractal", name: "Fractal" },
                    { key: "spherical", name: "Spherical" },
                    { key: "kaleidospace", name: "Kaleido" },
                    { key: "layerMaps", name: "Layer Maps" },
                    { key: "transform", name: "Transform" },
                ];
            },
            groupFor: function (target, key) {
                return target.properties ? target.properties[key] : null;
            },
            presets: [
                { name: "Default grid" },
                { name: "Sphere shell" },
                { name: "Scattered field" },
            ],
            applyPreset: function (root, target, preset) {
                if (!target) return;
                var base = target.properties.base;
                var particle = target.properties.particle;
                var fractal = target.properties.fractal;
                var disperse = target.properties.disperse;
                if (preset.name === "Default grid") {
                    base.baseFormType.set(0);
                    base.particlesX.set(70);
                    base.particlesY.set(70);
                    base.particlesZ.set(3);
                    base.baseFormSize.set([500, 500, 500]);
                    fractal.displace.set(0);
                    disperse.disperse.set(0);
                    disperse.twist.set(0);
                } else if (preset.name === "Sphere shell") {
                    base.baseFormType.set(1);
                    base.particlesX.set(60);
                    base.particlesY.set(60);
                    base.particlesZ.set(1);
                    base.baseFormSize.set([500, 500, 500]);
                    particle.size.set(3);
                    fractal.displace.set(0);
                } else if (preset.name === "Scattered field") {
                    base.baseFormType.set(0);
                    base.particlesX.set(50);
                    base.particlesY.set(50);
                    base.particlesZ.set(50);
                    fractal.displace.set(60);
                    disperse.disperse.set(20);
                    disperse.twist.set(30);
                }
                target._baseSig = null;
                target.update(0);
            },
        });
    }
})();
