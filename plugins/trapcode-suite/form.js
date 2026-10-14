// OpenZoid Trapcode Suite — Form.
/*
 * form.js
 *
 * A Trapcode Form style object3d: a static lattice of particles
 * deformed by fields. This file holds the shaders, the Form
 * container class, and the instance class core (construction,
 * materials, loading). The base lattice and asset sampling live
 * in form-grid.js, the deformations in form-fields.js, and the
 * property schema with the designer registration in form-defs.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var ROTATION_ORDERS = ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"];
    // Shared with form-grid.js / form-fields.js / form-defs.js.
    T.formShared = { rotationOrders: ROTATION_ORDERS };
    // T.shading.VERTEX_LINES declares the shared light uniforms and the
    // shadeSurface() helper ahead of main(); the call site inside main is
    // gated by USE_SHADING so the legacy path is untouched while off.
    var VERTEX_MAIN = [
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
        "#ifdef USE_SHADING",
        "vec3 shadeSpecTmp;",
        "vColor.rgb = vColor.rgb * shadeSurface(position, shadeSpecTmp) + shadeSpecTmp;",
        "#endif",
        "float pointSize = size * s * aSizeM * (1.0 + (rand(vec2(pid, 4.0)) - 0.5) * sizeRandom);",
        "gl_PointSize = max(pointSize * resolution.y * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 1.0), 1.0);",
        "gl_Position = projectionMatrix * mvPosition;",
        "}",
    ];

    var VERTEX_SHADER = T.shading.VERTEX_LINES.concat(VERTEX_MAIN).join("\n");

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
        zoidiumFrameReady(e) {
            for (var i = 0; i < this.forms.length; i++) {
                if (!this.forms[i].zoidiumFrameReady(e)) return false;
            }
            return true;
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
            // Saved Forms without a size mode retain their original round bases.
            // New Forms use independent axes; the property list persists the mode.
            if (!e || !e.properties || !e.properties.base || e.properties.base.baseSizeMode === undefined) {
                this.properties.base.baseSizeMode.set(e ? 1 : 0);
            }
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
            var shadeUniforms = T.shading.newUniforms();
            var uniforms = {
                    resolution: { type: "v2", value: new THREE.Vector2(1920, 1080) },
                    image: { type: "t", value: this.texture ? this.texture.getTexture(true) : null },
                    colorOver: { type: "t", value: this.palettes.colorOver },
                    sizeOver: { type: "t", value: this.palettes.sizeOver },
                    opacityOver: { type: "t", value: this.palettes.opacityOver },
                    size: { type: "f", value: 2 },
                    sizeRandom: { type: "f", value: 0 },
                    opacity: { type: "f", value: 1 },
                    colorTint: { type: "v4", value: new THREE.Vector4(1, 1, 1, 1) },
                };
            for (var shadeKey in shadeUniforms) uniforms[shadeKey] = shadeUniforms[shadeKey];
            this.material = new THREE.ShaderMaterial({
                uniforms: uniforms,
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
    };

    PZ.object3d.form.instance.prototype.defaultName = "Form";
    PZ.object3d.form.instance.maxPoints = 200000;
})();
