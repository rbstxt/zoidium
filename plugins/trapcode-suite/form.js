// OpenZoid Trapcode Suite — Form (ported verbatim from form.js).
/*
 * form.js
 *
 * A Trapcode Form style object3d: a static lattice of particles whose base
 * form (box grid, sphere, cylinder, ...) can be deformed by disperse, twist,
 * spherical field and fractal field. Strings connect neighbouring points.
 * Lives inside a normal 3D Scene layer and uses the shared property system.
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
            if ("object" == typeof e && e.forms && e.forms.length) {
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
            this.fractions = null;
            this._count = -1;
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
                    shading: new PZ.propertyList(PZ.object3d.form.instance.shadingDefinitions),
                    disperse: new PZ.propertyList(PZ.object3d.form.instance.disperseDefinitions),
                    fluid: new PZ.propertyList(PZ.object3d.form.instance.fluidDefinitions),
                    fractal: new PZ.propertyList(PZ.object3d.form.instance.fractalDefinitions),
                    spherical: new PZ.propertyList(PZ.object3d.form.instance.sphericalDefinitions),
                    kaleidospace: new PZ.propertyList(PZ.object3d.form.instance.kaleidoDefinitions),
                    layerMaps: new PZ.propertyList(PZ.object3d.form.instance.layerMapDefinitions),
                    audio: new PZ.propertyList(PZ.object3d.form.instance.audioDefinitions),
                    transform: new PZ.propertyList(PZ.object3d.form.instance.transformDefinitions),
                },
                this
            );
            var groups = {
                base: "Base Form",
                particle: "Particle",
                shading: "Shading",
                disperse: "Disperse and Twist",
                fluid: "Fluid",
                fractal: "Fractal Field",
                spherical: "Spherical Field",
                kaleidospace: "Kaleidospace",
                layerMaps: "Layer Maps",
                audio: "Audio React",
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
                var parent = this.tryGetParentOfType(PZ.object3d);
                if (parent && parent.threeObj) parent.threeObj.add(this.threeObj);
            }.bind(this));
        }
        get formObject() {
            return this.getParentOfType(PZ.object3d.form);
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
            this._count = -1;
        }
        toJSON() {
            return { type: this.type, properties: this.properties };
        }
        unload() {
            if (this.threeObj && this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
            if (this.points && this.points.geometry) this.points.geometry.dispose();
            if (this.strings && this.strings.geometry) this.strings.geometry.dispose();
            if (this.material) this.material.dispose();
            if (this.stringMaterial) this.stringMaterial.dispose();
            if (this.palettes) {
                this.palettes.colorOver.dispose();
                this.palettes.sizeOver.dispose();
                this.palettes.opacityOver.dispose();
                this.palettes = null;
            }
            if (this.texture) {
                var project = this.tryGetParentOfType(PZ.project);
                project && project.assets.unload(this.texture);
                this.texture = null;
            }
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
            var cx = Math.max(1, Math.round(base.particlesX.get(PZ.trapcode.currentTime)));
            var cy = Math.max(1, Math.round(base.particlesY.get(PZ.trapcode.currentTime)));
            var cz = Math.max(1, Math.round(base.particlesZ.get(PZ.trapcode.currentTime)));
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
        basePointCount() {
            var counts = this.gridCounts();
            return counts[0] * counts[1] * counts[2];
        }
        rebuildPoints() {
            if (!this.points) this.rebuildMaterial();
            var base = this.properties.base;
            var counts = this.gridCounts();
            var count = counts[0] * counts[1] * counts[2];
            this._count = count;
            var size = base.baseFormSize.get(PZ.trapcode.currentTime);
            var positions = new Float32Array(count * 3);
            var fractions = new Float32Array(count);
            var pid = new Float32Array(count);
            var index = 0;
            var totalX = counts[0] - 1;
            var totalY = counts[1] - 1;
            var totalZ = counts[2] - 1;
            var type = base.baseFormType.get(PZ.trapcode.currentTime);

            if (type === 6) {
                var meshPoints = this.sampleModel(count, size);
                for (var m = 0; m < count; m++) {
                    var mp = meshPoints[m] || [0, 0, 0];
                    positions[index * 3] = mp[0];
                    positions[index * 3 + 1] = mp[1];
                    positions[index * 3 + 2] = mp[2];
                    fractions[index] = count > 1 ? index / (count - 1) : 0;
                    pid[index] = index;
                    index++;
                }
            } else if (type === 7) {
                var maskPoints = this.sampleMask(count, size);
                for (var n = 0; n < count; n++) {
                    var np = maskPoints[n] || [0, 0, 0];
                    positions[index * 3] = np[0];
                    positions[index * 3 + 1] = np[1];
                    positions[index * 3 + 2] = np[2];
                    fractions[index] = count > 1 ? index / (count - 1) : 0;
                    pid[index] = index;
                    index++;
                }
            } else {
                for (var z = 0; z < counts[2]; z++) {
                    for (var y = 0; y < counts[1]; y++) {
                        for (var x = 0; x < counts[0]; x++) {
                            var p;
                            if (type === 1) {
                                p = spherePoint(x, y, z, counts, size);
                            } else if (type === 2) {
                                p = sphereGridPoint(x, y, z, counts, size);
                            } else if (type === 3) {
                                p = cylinderPoint(x, y, z, counts, size);
                            } else if (type === 4) {
                                p = circlePoint(x, y, z, counts, size);
                            } else if (type === 5) {
                                p = planePoint(x, y, z, counts, size);
                            } else {
                                p = boxPoint(x, y, z, totalX, totalY, totalZ, size);
                            }
                            positions[index * 3] = p[0];
                            positions[index * 3 + 1] = p[1];
                            positions[index * 3 + 2] = p[2];
                            fractions[index] = count > 1 ? index / (count - 1) : 0;
                            pid[index] = index;
                            index++;
                        }
                    }
                }
            }
            this.basePositions = positions;
            this.fractions = fractions;
            if (this.points.geometry) this.points.geometry.dispose();
            var geometry = new THREE.BufferGeometry();
            geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
            geometry.addAttribute("fraction", new THREE.BufferAttribute(fractions, 1));
            geometry.addAttribute("pid", new THREE.BufferAttribute(pid, 1));
            var ones = new Float32Array(count);
            for (var q = 0; q < count; q++) ones[q] = 1;
            geometry.addAttribute("aSizeM", new THREE.BufferAttribute(new Float32Array(ones), 1));
            geometry.addAttribute("aAlphaM", new THREE.BufferAttribute(new Float32Array(ones), 1));
            this.points.geometry = geometry;
            this.rebuildStrings(counts);
        }
        sampleModel(count, size) {
            var base = this.properties.base;
            if (!this._modelVertices) this.loadModel();
            if (!this._modelVertices || !this._modelVertices.length) {
                var fallback = [];
                for (var f = 0; f < count; f++) {
                    fallback.push([
                        (rand(f * 3) - 0.5) * size[0],
                        (rand(f * 3 + 1) - 0.5) * size[1],
                        (rand(f * 3 + 2) - 0.5) * size[2],
                    ]);
                }
                return fallback;
            }
            var source = this._modelVertices;
            var vertexCount = source.length / 3;
            var points = [];
            var scaleX = (base.modelScale ? base.modelScale.get(PZ.trapcode.currentTime) : 100) / 100;
            for (var i = 0; i < count; i++) {
                var vi = (i * 7) % vertexCount;
                points.push([
                    source[vi * 3] * scaleX,
                    source[vi * 3 + 1] * scaleX,
                    source[vi * 3 + 2] * scaleX,
                ]);
            }
            return points;
        }
        loadModel() {
            var self = this;
            var base = this.properties.base;
            var value = base.modelAsset ? base.modelAsset.get(PZ.trapcode.currentTime) : null;
            var project = this.tryGetParentOfType(PZ.project);
            if (!value || !project || this._modelLoading) return;
            this._modelLoading = true;
            var asset = new PZ.asset.geometry(project.assets.load(value));
            asset.getGeometry()
                .then(function (geometry) {
                    if (geometry && geometry.attributes && geometry.attributes.position) {
                        self._modelVertices = geometry.attributes.position.array;
                        self._count = -1;
                    }
                    self._modelLoading = false;
                })
                .catch(function () {
                    self._modelLoading = false;
                });
        }
        sampleMask(count, size) {
            if (!this._maskSample && !this._maskLoading) this.loadMask();
            if (!this._maskSample) {
                var fallback = [];
                for (var f = 0; f < count; f++) {
                    fallback.push([
                        (rand(f * 3) - 0.5) * size[0],
                        (rand(f * 3 + 1) - 0.5) * size[1],
                        0,
                    ]);
                }
                return fallback;
            }
            var sample = this._maskSample;
            var points = [];
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
        loadMask() {
            var self = this;
            var base = this.properties.base;
            var value = base.maskAsset ? base.maskAsset.get(PZ.trapcode.currentTime) : null;
            var project = this.tryGetParentOfType(PZ.project);
            if (!value || !project) return;
            this._maskLoading = true;
            var asset = new PZ.asset.image(project.assets.load(value));
            asset.loading
                .then(function () {
                    var image = asset.data.image;
                    var canvas = document.createElement("canvas");
                    var width = Math.min(image.width || 256, 256);
                    var height = Math.min(image.height || 256, 256);
                    canvas.width = width;
                    canvas.height = height;
                    var context = canvas.getContext("2d");
                    context.drawImage(image, 0, 0, width, height);
                    self._maskSample = {
                        data: context.getImageData(0, 0, width, height).data,
                        width: width,
                        height: height,
                    };
                    self._count = -1;
                    self._maskLoading = false;
                })
                .catch(function () {
                    self._maskLoading = false;
                });
        }
        sampleLayerMap(property) {
            var project = this.tryGetParentOfType(PZ.project);
            var value = property ? property.get(PZ.trapcode.currentTime) : null;
            if (!value || !project) return null;
            var cacheKey = value;
            var cached = this._layerCache && this._layerCache[cacheKey];
            if (cached) return cached;
            var asset = new PZ.asset.image(project.assets.load(value));
            var placeholder = { data: null, width: 0, height: 0, ready: false };
            if (!this._layerCache) this._layerCache = {};
            this._layerCache[cacheKey] = placeholder;
            asset.loading
                .then(function () {
                    var image = asset.data.image;
                    var canvas = document.createElement("canvas");
                    var width = Math.min(image.width || 128, 128);
                    var height = Math.min(image.height || 128, 128);
                    canvas.width = width;
                    canvas.height = height;
                    var context = canvas.getContext("2d");
                    context.drawImage(image, 0, 0, width, height);
                    placeholder.data = context.getImageData(0, 0, width, height).data;
                    placeholder.width = width;
                    placeholder.height = height;
                    placeholder.ready = true;
                })
                .catch(function () {});
            return placeholder;
        }
        layerMapValue(sample, u, v) {
            if (!sample || !sample.ready || !sample.data) return null;
            var x = Math.floor(clamp01(u) * (sample.width - 1));
            var y = Math.floor((1 - clamp01(v)) * (sample.height - 1));
            var index = (y * sample.width + x) * 4;
            return [
                sample.data[index] / 255,
                sample.data[index + 1] / 255,
                sample.data[index + 2] / 255,
                sample.data[index + 3] / 255,
            ];
        }
        rebuildStrings(counts) {
            var strings = this.properties.base.stringEnabled.get(PZ.trapcode.currentTime);
            this.strings.visible = strings === 1;
            if (strings !== 1) return;
            var nx = counts[0];
            var ny = counts[1];
            var nz = counts[2];
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
            geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(this.basePositions.length), 3));
            this.strings.geometry = geometry;
        }
        updatePalettes() {
            var particle = this.properties.particle;
            var colorOver = particle.colorOver.get(PZ.trapcode.currentTime);
            if (this._colorSig !== T.signature(colorOver)) {
                this._colorSig = T.signature(colorOver);
                T.fillGradient(this.palettes.colorOver, colorOver);
            }
            var sizeCurve = particle.sizeCurve.get(PZ.trapcode.currentTime);
            var sizeEnabled = particle.sizeOverEnabled.get(PZ.trapcode.currentTime);
            if (this._sizeSig !== sizeEnabled + "|" + T.signature(sizeCurve)) {
                this._sizeSig = sizeEnabled + "|" + T.signature(sizeCurve);
                T.fillCurve(this.palettes.sizeOver, sizeCurve, sizeEnabled);
            }
            var opacityCurve = particle.opacityCurve.get(PZ.trapcode.currentTime);
            var opacityEnabled = particle.opacityOverEnabled.get(PZ.trapcode.currentTime);
            if (this._opacitySig !== opacityEnabled + "|" + T.signature(opacityCurve)) {
                this._opacitySig = opacityEnabled + "|" + T.signature(opacityCurve);
                T.fillCurve(this.palettes.opacityOver, opacityCurve, opacityEnabled);
            }
        }
        applyDeformations() {
            if (!this.basePositions) return;
            var count = this.basePositions.length / 3;
            var out = new Float32Array(this.basePositions);
            var base = this.properties.base;
            var disperse = this.properties.disperse;
            var spherical = this.properties.spherical;
            var fractal = this.properties.fractal;
            var seed = fractal.randomSeed ? fractal.randomSeed.get(PZ.trapcode.currentTime) : 0;

            var rotation = base.rotation.get(PZ.trapcode.currentTime);
            var basePosition = base.position.get(PZ.trapcode.currentTime);
            var cosX = Math.cos((rotation[0] * Math.PI) / 180);
            var sinX = Math.sin((rotation[0] * Math.PI) / 180);
            var cosY = Math.cos((rotation[1] * Math.PI) / 180);
            var sinY = Math.sin((rotation[1] * Math.PI) / 180);
            var cosZ = Math.cos((rotation[2] * Math.PI) / 180);
            var sinZ = Math.sin((rotation[2] * Math.PI) / 180);

            var disperseAmount = disperse.disperse.get(PZ.trapcode.currentTime);
            var twist = disperse.twist.get(PZ.trapcode.currentTime);
            var sphereStrength = spherical.strength.get(PZ.trapcode.currentTime) / 100;
            var sphereCenterRaw = spherical.position.get(PZ.trapcode.currentTime);
            var sphereRadius = spherical.radius.get(PZ.trapcode.currentTime);
            var sphereFeather = Math.max(spherical.feather.get(PZ.trapcode.currentTime) / 100, 0.001);
            var sphereScale = [
                Math.max(spherical.scaleX.get(PZ.trapcode.currentTime) / 100, 0.001),
                Math.max(spherical.scaleY.get(PZ.trapcode.currentTime) / 100, 0.001),
                Math.max(spherical.scaleZ.get(PZ.trapcode.currentTime) / 100, 0.001),
            ];
            var sphereRot = [
                (spherical.rotationX.get(PZ.trapcode.currentTime) * Math.PI) / 180,
                (spherical.rotationY.get(PZ.trapcode.currentTime) * Math.PI) / 180,
                (spherical.rotationZ.get(PZ.trapcode.currentTime) * Math.PI) / 180,
            ];
            var sphere2On = spherical.sphereEnabled.get(PZ.trapcode.currentTime) === 1;
            var sphere2Strength = spherical.sphere2Strength.get(PZ.trapcode.currentTime) / 100;
            var sphere2CenterRaw = spherical.sphere2Position.get(PZ.trapcode.currentTime);
            var sphere2Radius = spherical.sphere2Radius.get(PZ.trapcode.currentTime);
            var fractalAmount = fractal.displace.get(PZ.trapcode.currentTime);
            var fractalY = fractal.yDisplace.get(PZ.trapcode.currentTime);
            var fractalZ = fractal.zDisplace.get(PZ.trapcode.currentTime);
            var dispMode = fractal.displacementMode ? fractal.displacementMode.get(PZ.trapcode.currentTime) : 0;
            var affectSize = fractal.affectSize ? fractal.affectSize.get(PZ.trapcode.currentTime) : 0;
            var affectOpacity = fractal.affectOpacity ? fractal.affectOpacity.get(PZ.trapcode.currentTime) : 0;
            var fScale = fractal.fScale.get(PZ.trapcode.currentTime);
            var fTime = PZ.trapcode.currentTime / 30;
            var fluid = this.properties.fluid;
            var kaleido = this.properties.kaleidospace;
            var fluidOn = fluid && fluid.fluidMotion.get(PZ.trapcode.currentTime) === 1;
            var buoyancy = fluidOn ? fluid.buoyancy.get(PZ.trapcode.currentTime) : 0;
            var swirlOn = fluidOn && fluid.randomSwirl.get(PZ.trapcode.currentTime) === 1;
            var swirlScale = fluidOn ? fluid.swirlScale.get(PZ.trapcode.currentTime) : 10;
            var fluidSeed = fluidOn ? fluid.randomSeed.get(PZ.trapcode.currentTime) : 0;
            var vortexStrength = fluidOn ? fluid.vortexStrength.get(PZ.trapcode.currentTime) / 100 : 0;
            var vortexCore = fluidOn ? fluid.vortexCoreSize.get(PZ.trapcode.currentTime) : 50;
            var vortexTilt = fluidOn ? (fluid.vortexTilt.get(PZ.trapcode.currentTime) * Math.PI) / 180 : 0;
            var vortexRotate = fluidOn ? (fluid.vortexRotate.get(PZ.trapcode.currentTime) * Math.PI) / 180 : 0;
            var mirrorX = kaleido.mirrorX.get(PZ.trapcode.currentTime) === 1;
            var mirrorY = kaleido.mirrorY.get(PZ.trapcode.currentTime) === 1;
            var mirrorZ = kaleido.mirrorZ.get(PZ.trapcode.currentTime) === 1;
            var kaleidoBehaviour = kaleido.behaviour.get(PZ.trapcode.currentTime);
            var kaleidoCenterRaw = kaleido.center.get(PZ.trapcode.currentTime);
            // Sphere / kaleido positions are authored in comp pixels (default 720,540).
            // Form particles live around local origin, so map comp coords -> local.
            function compToLocal(c) {
                if (!c) return [0, 0, 0];
                var looksLikeComp = Math.abs(c[0]) > 400 || Math.abs(c[1]) > 400;
                if (looksLikeComp) return [c[0] - 720, -(c[1] - 540), c[2] || 0];
                return [c[0], c[1], c[2] || 0];
            }
            var sphereCenter = compToLocal(sphereCenterRaw);
            var sphere2Center = compToLocal(sphere2CenterRaw);
            var kaleidoCenter = compToLocal(kaleidoCenterRaw);
            var fractalParams = {
                complexity: fractal.complexity.get(PZ.trapcode.currentTime),
                octaveMultiplier: fractal.octaveMultiplier.get(PZ.trapcode.currentTime),
                octaveScale: fractal.octaveScale.get(PZ.trapcode.currentTime),
                flowX: fractal.flowX.get(PZ.trapcode.currentTime),
                flowY: fractal.flowY.get(PZ.trapcode.currentTime),
                flowZ: fractal.flowZ.get(PZ.trapcode.currentTime),
                flowEvolution: fractal.flowEvolution.get(PZ.trapcode.currentTime) * 0.01,
                fractalSum: fractal.fractalSum.get(PZ.trapcode.currentTime),
                gamma: fractal.gamma.get(PZ.trapcode.currentTime),
                addSubtract: fractal.addSubtract.get(PZ.trapcode.currentTime),
                min: fractal.min.get(PZ.trapcode.currentTime),
                max: fractal.max.get(PZ.trapcode.currentTime),
                seed: fractal.randomSeed.get(PZ.trapcode.currentTime),
            };
            fractalParams.sum = fractal.fractalSum.get(PZ.trapcode.currentTime);
            var fractalScale = Math.max(fScale, 0.01) * 0.0005;
            var useFractal = fractalAmount !== 0 || fractalY !== 0 || fractalZ !== 0 || affectSize !== 0 || affectOpacity !== 0;
            var maps = this.properties.layerMaps;
            var fractalStrengthMapOn = maps.fractalStrengthEnabled.get(PZ.trapcode.currentTime) === 1;
            var fractalStrengthSample = fractalStrengthMapOn ? this.sampleLayerMap(maps.fractalStrengthLayer) : null;
            var displacementMapOn = maps.displacementEnabled.get(PZ.trapcode.currentTime) === 1;
            var displacementSample = displacementMapOn ? this.sampleLayerMap(maps.displacementLayer) : null;
            var rotateMapOn = maps.rotateEnabled.get(PZ.trapcode.currentTime) === 1;
            var rotateSample = rotateMapOn ? this.sampleLayerMap(maps.rotateLayer) : null;
            var colorMapSample = maps.colorAlphaEnabled.get(PZ.trapcode.currentTime) === 1 ? this.sampleLayerMap(maps.colorAlphaLayer) : null;
            var sizeMapSample = maps.sizeEnabled.get(PZ.trapcode.currentTime) === 1 ? this.sampleLayerMap(maps.sizeLayer) : null;
            var disperseMapSample = maps.disperseEnabled.get(PZ.trapcode.currentTime) === 1 ? this.sampleLayerMap(maps.disperseLayer) : null;
            var useColors = !!colorMapSample;
            if (useColors && !this.colorArray) this.colorArray = new Float32Array(count * 3);
            if (useColors && this.colorArray.length !== count * 3) this.colorArray = new Float32Array(count * 3);
            if (!this.sizeModArray || this.sizeModArray.length !== count) this.sizeModArray = new Float32Array(count);
            if (!this.alphaModArray || this.alphaModArray.length !== count) this.alphaModArray = new Float32Array(count);
            for (var zz = 0; zz < count; zz++) {
                this.sizeModArray[zz] = 1;
                this.alphaModArray[zz] = 1;
            }

            var cosSX = Math.cos(-sphereRot[0]);
            var sinSX = Math.sin(-sphereRot[0]);
            var cosSY = Math.cos(-sphereRot[1]);
            var sinSY = Math.sin(-sphereRot[1]);
            var cosSZ = Math.cos(-sphereRot[2]);
            var sinSZ = Math.sin(-sphereRot[2]);
            function applySphere(px, py, pz, cx, cy, cz, strength, radius, featherAmt) {
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
                if (influence <= 0 || strength === 0) return [px, py, pz];
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
                return [px + (ox / olen) * push, py + (oy / olen) * push, pz + (oz / olen) * push];
            }
            var swirlFreq = Math.max(swirlScale, 0.01) * 0.002;
            var buoyOffset = buoyancy * (PZ.trapcode.currentTime / 30) * 4.0;
            var vortexCorePx = 20 + (Math.max(0, Math.min(100, vortexCore)) / 100) * 220;
            var tSec = PZ.trapcode.currentTime / 30;

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
                if (disperseMapSample) {
                    var dm0 = this.layerMapValue(disperseMapSample, u, v);
                    if (dm0) dispMod = (dm0[0] + dm0[1] + dm0[2]) / 3;
                }
                if (fractalStrengthSample) {
                    var fm0 = this.layerMapValue(fractalStrengthSample, u, v);
                    if (fm0) fracMod = (fm0[0] + fm0[1] + fm0[2]) / 3;
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
                        this.sizeModArray[i] = sm;
                    }
                    if (affectOpacity !== 0) {
                        var am = 1 + nMain * 0.5 * (affectOpacity / 100);
                        if (am < 0) am = 0;
                        if (am > 1) am = 1;
                        this.alphaModArray[i] = am;
                    }
                    // Layer-map size modulation
                    if (sizeMapSample) {
                        var smv = this.layerMapValue(sizeMapSample, u, v);
                        if (smv) {
                            var lum = (smv[0] + smv[1] + smv[2]) / 3;
                            this.sizeModArray[i] *= 0.2 + lum * 1.6;
                            this.alphaModArray[i] *= 0.25 + smv[3] * 0.75;
                        }
                    }
                } else if (sizeMapSample) {
                    var smv2 = this.layerMapValue(sizeMapSample, u, v);
                    if (smv2) {
                        var lum2 = (smv2[0] + smv2[1] + smv2[2]) / 3;
                        this.sizeModArray[i] = 0.2 + lum2 * 1.6;
                        this.alphaModArray[i] = 0.25 + smv2[3] * 0.75;
                    }
                }

                // Layer-map displacement (along normal-ish Z + slight XY)
                if (displacementSample) {
                    var dpm = this.layerMapValue(displacementSample, u, v);
                    if (dpm) {
                        var dlum = (dpm[0] + dpm[1] + dpm[2]) / 3 - 0.5;
                        x += dlum * 60;
                        y += dlum * 60;
                        z += (dpm[3] - 0.5) * 120;
                    }
                }

                // Fluid: buoyancy + random swirl + vortex (previously no-ops)
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
                    if (rotateSample) {
                        var rm = this.layerMapValue(rotateSample, u, v);
                        if (rm) rotExtra = ((rm[0] + rm[1] + rm[2]) / 3 - 0.5) * 180;
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
                    var res = applySphere(x, y, z, sphereCenter[0], sphereCenter[1], sphereCenter[2], sphereStrength, sphereRadius, sphereFeather);
                    x = res[0];
                    y = res[1];
                    z = res[2];
                }
                if (sphere2On && sphere2Strength !== 0) {
                    var res2 = applySphere(x, y, z, sphere2Center[0], sphere2Center[1], sphere2Center[2], sphere2Strength, sphere2Radius, sphereFeather);
                    x = res2[0];
                    y = res2[1];
                    z = res2[2];
                }

                // Kaleidospace (previously no-op)
                if (mirrorX || mirrorY || mirrorZ) {
                    if (kaleidoBehaviour === 1) {
                        // mirror and keep: distribute folded copies on both sides
                        var keep = (i % 2 === 0) ? 1 : -1;
                        if (mirrorX) {
                            var kdx = x - kaleidoCenter[0];
                            x = kaleidoCenter[0] + Math.abs(kdx) * keep;
                        }
                        if (mirrorY) {
                            var kdy = y - kaleidoCenter[1];
                            y = kaleidoCenter[1] + Math.abs(kdy) * keep;
                        }
                        if (mirrorZ) {
                            var kdz = z - kaleidoCenter[2];
                            z = kaleidoCenter[2] + Math.abs(kdz) * keep;
                        }
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
                    var cm = this.layerMapValue(colorMapSample, u, v);
                    if (cm) {
                        this.colorArray[i * 3] = cm[0];
                        this.colorArray[i * 3 + 1] = cm[1];
                        this.colorArray[i * 3 + 2] = cm[2];
                    } else {
                        this.colorArray[i * 3] = 1;
                        this.colorArray[i * 3 + 1] = 1;
                        this.colorArray[i * 3 + 2] = 1;
                    }
                }
            }

            var attribute = this.points.geometry.attributes.position;
            attribute.array.set(out);
            attribute.needsUpdate = true;
            if (this.points.geometry.attributes.aSizeM) {
                if (this.points.geometry.attributes.aSizeM.count !== count) {
                    this.points.geometry.addAttribute("aSizeM", new THREE.BufferAttribute(new Float32Array(count), 1));
                    this.points.geometry.addAttribute("aAlphaM", new THREE.BufferAttribute(new Float32Array(count), 1));
                }
                this.points.geometry.attributes.aSizeM.array.set(this.sizeModArray);
                this.points.geometry.attributes.aSizeM.needsUpdate = true;
                this.points.geometry.attributes.aAlphaM.array.set(this.alphaModArray);
                this.points.geometry.attributes.aAlphaM.needsUpdate = true;
            }
            if (useColors) {
                if (!this.points.geometry.attributes.vcolor) {
                    this.points.geometry.addAttribute(
                        "vcolor",
                        new THREE.BufferAttribute(new Float32Array(count * 3), 3)
                    );
                }
                if (this.points.geometry.attributes.vcolor.count !== count) {
                    this.points.geometry.addAttribute(
                        "vcolor",
                        new THREE.BufferAttribute(new Float32Array(count * 3), 3)
                    );
                }
                this.points.geometry.attributes.vcolor.array.set(this.colorArray);
                this.points.geometry.attributes.vcolor.needsUpdate = true;
                this.material.defines.USE_VCOLOR = 1;
                this.material.needsUpdate = true;
            } else if (this.points.geometry.attributes.vcolor) {
                this.points.geometry.removeAttribute("vcolor");
                delete this.material.defines.USE_VCOLOR;
                this.material.needsUpdate = true;
            }
            if (this.strings && this.strings.visible) {
                var stringAttribute = this.strings.geometry.attributes.position;
                stringAttribute.array.set(out);
                stringAttribute.needsUpdate = true;
                if (!this.strings.geometry.attributes.color) {
                    this.strings.geometry.addAttribute(
                        "color",
                        new THREE.BufferAttribute(new Float32Array(count * 3), 3)
                    );
                }
                var grad = this.properties.particle.colorOver.get(PZ.trapcode.currentTime);
                var cols = this.strings.geometry.attributes.color.array;
                for (var s = 0; s < count; s++) {
                    var fr = count > 1 ? s / (count - 1) : 0;
                    var gc = T.gradientColor(grad, fr);
                    cols[s * 3] = gc[0];
                    cols[s * 3 + 1] = gc[1];
                    cols[s * 3 + 2] = gc[2];
                }
                this.strings.geometry.attributes.color.needsUpdate = true;
            }
        }
        update(e) {
            PZ.trapcode.setTime(e);
            if (!this.material) this.rebuildMaterial();
            var base = this.properties.base;
            var counts = this.gridCounts();
            var count = counts[0] * counts[1] * counts[2];
            if (this._count !== count) this.rebuildPoints();
            else if (this.strings.visible !== (base.stringEnabled.get(PZ.trapcode.currentTime) === 1)) this.rebuildStrings(counts);
            this.updatePalettes();
            if (this.stringMaterial) {
                var sOn = this.properties.base.stringEnabled.get(PZ.trapcode.currentTime) === 1;
                this.stringMaterial.opacity = sOn ? this.properties.particle.opacity.get(PZ.trapcode.currentTime) / 100 : 0.5;
                this.stringMaterial.blending = this.properties.particle.blending.get(PZ.trapcode.currentTime) === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
                this.stringMaterial.needsUpdate = true;
            }
            this.applyDeformations();
            var u = this.material.uniforms;
            u.size.value = this.properties.particle.size.get(PZ.trapcode.currentTime);
            u.sizeRandom.value = this.properties.particle.sizeRandom.get(PZ.trapcode.currentTime) / 100;
            u.opacity.value = this.properties.particle.opacity.get(PZ.trapcode.currentTime) / 100;
            var tint = this.properties.particle.color.get(PZ.trapcode.currentTime);
            u.colorTint.value.set(tint[0], tint[1], tint[2], 1);
            this.material.blending = this.properties.particle.blending.get(PZ.trapcode.currentTime) === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
            this.material.needsUpdate = true;
            var transform = this.properties.transform;
            this.threeObj.position.set(transform.offsetX.get(PZ.trapcode.currentTime), transform.offsetY.get(PZ.trapcode.currentTime), transform.offsetZ.get(PZ.trapcode.currentTime));
            var scale = transform.scale.get(PZ.trapcode.currentTime) / 100;
            this.threeObj.scale.set(scale, scale, scale);
        }
        async prepare(e) {
            if (this.texture) await this.texture.loading;
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
        value = (value - params.addSubtract);
        if (params.gamma !== 1) {
            var sign = value < 0 ? -1 : 1;
            value = sign * Math.pow(Math.abs(value), params.gamma);
        }
        var range = (params.max - params.min);
        if (range !== 0) value = value * range * 0.5 + (params.max + params.min) * 0.5;
        return value;
    }

    function noise3(x, y, z) {
        var n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
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
        stringSize: number("String size", 0, { min: 0, step: 0.01, decimals: 2 }),
        stringDensity: number("String density", 15, { min: 0, step: 1 }),
        stringSizeRandom: number("String size random", 0, { min: 0, step: 0.01, decimals: 2 }),
        stringPosition: number("String position distribution", 0, { min: 0, step: 0.01, decimals: 2 }),
        modelAsset: {
            name: "3D model",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.GEOMETRY,
            accept: ".json,application/json",
            value: null,
            changed: function () {
                this.parentObject._modelVertices = null;
                this.parentObject._count = -1;
                this.parentObject.loadModel();
            },
        },
        modelScale: number("Model scale", 100, { min: 0, step: 1 }),
        maskAsset: {
            name: "Text/mask image",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: null,
            changed: function () {
                this.parentObject._maskSample = null;
                this.parentObject._count = -1;
                this.parentObject.loadMask();
            },
        },
    };

    PZ.object3d.form.instance.particleDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Particle", visible: false },
        particleType: option("Particle Type", 0, "sphere;box;plane;sprite;text", true),
        sphereFeather: number("Sphere Feather", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
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
        rotation: number("Rotation", 0, { step: 1 }),
        size: number("Size", 2, { min: 0, step: 0.1, decimals: 2 }),
        sizeRandom: number("Size Random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeOverEnabled: option("Size Over", 0, "off;on"),
        sizeCurve: curveProperty("Size Curve"),
        sizeCurveOffset: number("Size Curve Offset", 100, { step: 0.1, decimals: 1 }),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityRandom: number("Opacity Random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityOverEnabled: option("Opacity Over", 0, "off;on"),
        opacityCurve: curveProperty("Opacity Curve"),
        opacityCurveOffset: number("Opacity Curve Offset", 100, { step: 0.1, decimals: 1 }),
        setColor: option("Set Color", 0, "solid color;over;random", true),
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
        colorRandom: number("Color Random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        colorOver: gradientProperty("Color Over"),
        blending: option("Blend Mode", 0, "normal;add;screen;multiply", true),
        unmult: option("Unmult", 0, "off;on", false),
        streaklet: option("Streaklet", 0, "off;on", true),
        randomSeed: number("Random Seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.form.instance.shadingDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Shading", visible: false },
        shading: option("Shading", 0, "off;on", true),
        lightFalloff: option("Light Falloff", 0, "natural (lux);inverse square;inverse cube;none", false),
        nominalDistance: number("Nominal Distance", 250, { step: 1 }),
        ambient: number("Ambient", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        diffuse: number("Diffuse", 80, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularAmount: number("Specular Amount", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularSharpness: number("Specular Sharpness", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        reflectionStrength: number("Reflection Strength", 100, { min: 0, step: 0.1, decimals: 1 }),
        shadowlet: option("Shadowlet", 0, "off;on", false),
    };

    PZ.object3d.form.instance.disperseDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Disperse", visible: false },
        disperse: number("Disperse", 0, { step: 1 }),
        disperseStrengthOver: option("Disperse Strength Over", 0, "off;life;velocity;position", false),
        disperseStrengthCurve: curveProperty("Disperse Strength Curve"),
        disperseStrengthOffset: number("Disperse Strength Offset", 100, { step: 0.1, decimals: 1 }),
        twist: number("Twist", 0, { step: 1 }),
    };

    PZ.object3d.form.instance.fluidDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Fluid", visible: false },
        fluidMotion: option("Fluid Motion", 0, "off;on", true),
        fluidForce: option("Fluid Force", 0, "buoyancy & swirl only;position;direction;vortex", false),
        applyForce: option("Apply Force", 0, "continuously;once", false),
        forceLifetime: number("Force Lifetime", 15, { step: 0.1, decimals: 1 }),
        forceRegionScale: number("Force Region Scale", 100, { step: 0.1, decimals: 1 }),
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
        fractalStrengthOver: option("Fractal Strength Over", 0, "off;life;velocity;position", false),
        fractalStrengthCurve: curveProperty("Fractal Strength Curve"),
        fractalStrengthOffset: number("Fractal Strength Offset", 100, { step: 0.1, decimals: 1 }),
        flowX: number("Flow X", 0, { step: 0.01, decimals: 2 }),
        flowY: number("Flow Y", 0, { step: 0.01, decimals: 2 }),
        flowZ: number("Flow Z", 0, { step: 0.01, decimals: 2 }),
        flowEvolution: number("Flow Evolution", 50, { step: 0.1, decimals: 1 }),
        offsetEvolution: number("Offset Evolution", 0, { step: 0.1, decimals: 1 }),
        flowLoop: option("Flow Loop", 0, "off;on", false),
        loopTime: number("Loop Time [sec]", 5, { step: 0.1, decimals: 1 }),
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

    PZ.object3d.form.instance.audioDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Audio React", visible: false },
        audioLayer: {
            name: "Audio Layer",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.AV,
            accept: "audio/*,video/*",
            value: null,
        },
        reactor1: option("Reactor 1", 0, "off;on", true),
        reactor2: option("Reactor 2", 0, "off;on", true),
        reactor3: option("Reactor 3", 0, "off;on", true),
        reactor4: option("Reactor 4", 0, "off;on", true),
        reactor5: option("Reactor 5", 0, "off;on", true),
    };

    PZ.object3d.form.instance.transformDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Transform", visible: false },
        rotationW: number("Rotation W", 0, { step: 1 }),
        rotationX: number("Rotation X", 0, { step: 1 }),
        rotationY: number("Rotation Y", 0, { step: 1 }),
        rotationZ: number("Rotation Z", 0, { step: 1 }),
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
                    { key: "shading", name: "Shading" },
                    { key: "disperse", name: "Disperse" },
                    { key: "fluid", name: "Fluid" },
                    { key: "fractal", name: "Fractal" },
                    { key: "spherical", name: "Spherical" },
                    { key: "kaleidospace", name: "Kaleido" },
                    { key: "layerMaps", name: "Layer Maps" },
                    { key: "audio", name: "Audio" },
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
                target._count = -1;
                target.update(0);
            },
        });
    }
})();

