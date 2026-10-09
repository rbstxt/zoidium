// OpenZoid Magic Looks — full-chain color grading effect.
//
// One native effect hosting all 29 Looks tools in a fixed chain: lens
// distortion first, then the color tools, curves/S-curve channel LUTs,
// the LUT tool, light tools, and lens tools. Property definitions are
// generated from the looks-tools.js catalog (single source of truth,
// loaded from the plugin bundle), and the fragment shader mirrors the
// Looks.grade JS reference pipeline op-for-op.
//
// UI-first note: every tool renders when enabled; defaults are neutral
// except Color Contrast, whose fixed 0.37 amount is the tool character.

var looksSelf = this;

this.defaultName = "Magic Looks";
this.shaderfile = "fx_looks";
this.shaderUrl = "/assets/shaders/fragment/" + this.shaderfile + ".glsl";

// The catalog (looks-color.js + looks-tools.js) loads from the plugin
// bundle so properties, setup and tests share one schema. The manager
// sets _zoidiumGetAsset before evaluating; without it the effect cannot
// know its own surface.
var Looks = {};
(function looksLoadCatalog() {
    var getAsset = (typeof looksSelf._zoidiumGetAsset === "function")
        ? looksSelf._zoidiumGetAsset
        : null;
    if (!getAsset) {
        throw new Error("Magic Looks needs the plugin bundle asset resolver.");
    }
    var files = ["looks-color.js", "looks-tools.js"];
    for (var i = 0; i < files.length; i++) {
        var source = getAsset("text", "./plugins/magic-looks/" + files[i]);
        if (typeof source !== "string") {
            throw new Error("Magic Looks is missing its bundled source: " + files[i]);
        }
        new Function("Looks", source)(Looks);
    }
    if (!Looks.color || !Looks.tools || !Looks.grade) {
        throw new Error("Magic Looks sources did not define their namespaces.");
    }
})();

this.propertyDefinitions = Looks.tools.buildPropertyDefinitions(PZ);

this.properties.addAll(this.propertyDefinitions, this);

// Uniform records mirror the catalog prop map: enables + numbers are
// floats, wheel triples are vec3, the curves LUT is a 256x1 RGB texture.
function looksUniformName(prop) {
    return "u_" + prop;
}

// Wheel triples share their base with zone-position numbers in one tool
// (color-ranges highlight/midtone/shadow), so vec3 tints take a Tint
// suffix while the numbers keep the bare prop key.
function looksTintName(triple) {
    return "u_" + triple[0].slice(0, -1) + "Tint";
}

function looksBuildUniforms(propMap) {
    var uniforms = {
        tDiffuse: { type: "t", value: null },
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
        uCurvesLUT: { type: "t", value: null },
    };
    Object.keys(propMap).forEach(function (toolId) {
        var e = propMap[toolId];
        uniforms[looksUniformName(e.enable)] = { type: "f", value: 1 };
        Object.keys(e.params).forEach(function (k) {
            uniforms[looksUniformName(e.params[k])] = { type: "f", value: 0 };
        });
        Object.keys(e.wheels).forEach(function (k) {
            uniforms[looksTintName(e.wheels[k])] = {
                type: "v3", value: new THREE.Vector3(1, 1, 1),
            };
        });
        if (e.custom.hsl) {
            e.custom.hsl.sat.forEach(function (key) {
                uniforms[looksUniformName(key)] = { type: "f", value: 0 };
            });
            e.custom.hsl.light.forEach(function (key) {
                uniforms[looksUniformName(key)] = { type: "f", value: 0 };
            });
        }
        if (e.custom.fourway) {
            uniforms[looksUniformName(e.custom.fourwayPreview)] = { type: "f", value: 0 };
            Object.keys(e.custom.fourway).forEach(function (slot) {
                var triple = e.custom.fourway[slot];
                uniforms[looksTintName(triple)] = {
                    type: "v3", value: new THREE.Vector3(1, 1, 1),
                };
            });
        }
        if (e.custom.angle) {
            uniforms[looksUniformName(e.custom.angle)] = { type: "f", value: 45 };
        }
        if (e.custom.lutName) {
            uniforms[looksUniformName(e.custom.lutName.replace(/Name$/, "Mode"))] = { type: "f", value: 0 };
            uniforms[looksUniformName(e.custom.lutStrength)] = { type: "f", value: 1 };
            uniforms[looksUniformName(e.custom.lutGamma)] = { type: "f", value: 0 };
        }
    });
    return uniforms;
}

this._looksPropMap = Looks.tools.propMap();

// Exposed for unit tests and debugging (the file otherwise only installs
// per-instance members when evaluated as an effect module).
this.looksTest = {
    propMap: this._looksPropMap,
    uniformName: looksUniformName,
    tintName: looksTintName,
    buildUniforms: looksBuildUniforms,
    refreshLUT: looksRefreshLUT,
    Looks: Looks,
};

function looksNumOr(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
}

function looksClamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

this.load = async function (e) {
    var zoidiumGetAsset = (typeof this._zoidiumGetAsset === "function")
        ? this._zoidiumGetAsset.bind(this)
        : null;
    var zoidiumBundledVert = zoidiumGetAsset
        ? zoidiumGetAsset("text", "./plugins/magic-looks/looks-vert.glsl")
        : undefined;
    var zoidiumBundledFrag = zoidiumGetAsset
        ? zoidiumGetAsset("text", "./plugins/magic-looks/looks-grade.glsl")
        : undefined;
    this._zoidiumBundledShaders = {
        vert: typeof zoidiumBundledVert === "string",
        frag: typeof zoidiumBundledFrag === "string",
    };
    var vertSource = this._zoidiumBundledShaders.vert
        ? zoidiumBundledVert
        : await this.parentProject.assets.load(
            this.parentProject.assets.createFromPreset(PZ.asset.type.SHADER, "/assets/shaders/vertex/common.glsl")
        ).getShader();
    var fragSource = this._zoidiumBundledShaders.frag
        ? zoidiumBundledFrag
        : await this.parentProject.assets.load(this.shaderUrl).getShader();
    var uniforms = looksBuildUniforms(this._looksPropMap);
    var lutBytes = new Uint8Array(256 * 3);
    for (var i = 0; i < 256; i++) {
        lutBytes[i * 3] = i;
        lutBytes[i * 3 + 1] = i;
        lutBytes[i * 3 + 2] = i;
    }
    var lutTexture = new THREE.DataTexture(lutBytes, 256, 1, THREE.RGBFormat);
    lutTexture.magFilter = THREE.LinearFilter;
    lutTexture.minFilter = THREE.LinearFilter;
    lutTexture.wrapS = THREE.ClampToEdgeWrapping;
    lutTexture.wrapT = THREE.ClampToEdgeWrapping;
    lutTexture.needsUpdate = true;
    uniforms.uCurvesLUT.value = lutTexture;
    this._looksLutTexture = lutTexture;
    this._looksLutBytes = lutBytes;
    this._looksLutKeys = { curves: "", scurve: "" };
    var material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertSource,
        fragmentShader: fragSource,
    });
    this.pass = new THREE.ShaderPass(material);
    this.properties.load(e && e.properties);
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function (e) {
    if (!this._zoidiumBundledShaders || !this._zoidiumBundledShaders.vert) {
        this.parentProject.assets.unload(this.vertShader);
    }
    if (!this._zoidiumBundledShaders || !this._zoidiumBundledShaders.frag) {
        this.parentProject.assets.unload(this.fragShader);
    }
};

function looksReadNum(instance, e, key, fallback) {
    var p = instance.properties[key];
    if (!p) return fallback;
    return looksNumOr(p.get(e), fallback);
}

function looksReadOpt(instance, e, key, fallback) {
    var p = instance.properties[key];
    if (!p) return fallback;
    var v = Math.round(looksNumOr(p.get(e), fallback));
    return v ? 1 : 0;
}

function looksReadText(instance, e, key, fallback) {
    var p = instance.properties[key];
    if (!p) return fallback;
    var v = p.get(e);
    return typeof v === "string" ? v : fallback;
}

// Rebuild the 256x1 channel LUT texture from the Curves + S-curve JSON
// props (cached on the parsed text; diagonal fallback on bad input).
function looksRefreshLUT(instance, e) {
    var curvesJson = looksReadText(instance, e, "curvCurvesJson", "");
    var scurveJson = looksReadText(instance, e, "scvScurveJson", "");
    if (curvesJson === instance._looksLutKeys.curves && scurveJson === instance._looksLutKeys.scurve) {
        return;
    }
    instance._looksLutKeys.curves = curvesJson;
    instance._looksLutKeys.scurve = scurveJson;
    var channels = null;
    var scurve = null;
    try {
        var parsed = JSON.parse(curvesJson);
        if (parsed && parsed.Red && parsed.Green && parsed.Blue) channels = parsed;
    } catch (_err) { /* diagonal fallback below */ }
    try {
        var parsedS = JSON.parse(scurveJson);
        if (parsedS && parsedS.p0 && parsedS.c1 && parsedS.c2 && parsedS.p3) scurve = parsedS;
    } catch (_err2) { /* diagonal fallback below */ }
    if (!channels) {
        channels = {
            Red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            Green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            Blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        };
    }
    var luts = Looks.grade.buildChannelLUTs({ channels: channels }, scurve);
    var bytes = instance._looksLutBytes;
    for (var i = 0; i < 256; i++) {
        bytes[i * 3] = Math.round(Looks.color.clamp(luts.Red[i], 0, 1) * 255);
        bytes[i * 3 + 1] = Math.round(Looks.color.clamp(luts.Green[i], 0, 1) * 255);
        bytes[i * 3 + 2] = Math.round(Looks.color.clamp(luts.Blue[i], 0, 1) * 255);
    }
    if (instance._looksLutTexture) instance._looksLutTexture.needsUpdate = true;
}

this.update = function (e) {
    if (!this.pass) {
        return;
    }
    var u = this.pass.uniforms;
    var map = this._looksPropMap;
    var self = this;
    var anyOn = false;
    Object.keys(map).forEach(function (toolId) {
        var rec = map[toolId];
        var enabled = looksReadOpt(self, e, rec.enable, 1);
        if (u[looksUniformName(rec.enable)]) u[looksUniformName(rec.enable)].value = enabled;
        if (enabled) anyOn = true;
        Object.keys(rec.params).forEach(function (k) {
            var key = rec.params[k];
            if (u[looksUniformName(key)]) {
                u[looksUniformName(key)].value = looksReadNum(self, e, key, 0);
            }
        });
        Object.keys(rec.wheels).forEach(function (k) {
            var triple = rec.wheels[k];
            var base = looksTintName(triple);
            if (u[base] && u[base].value && typeof u[base].value.set === "function") {
                u[base].value.set(
                    Math.max(0, looksReadNum(self, e, triple[0], 1)),
                    Math.max(0, looksReadNum(self, e, triple[1], 1)),
                    Math.max(0, looksReadNum(self, e, triple[2], 1))
                );
            }
        });
        if (rec.custom.hsl) {
            rec.custom.hsl.sat.forEach(function (key) {
                if (u[looksUniformName(key)]) {
                    u[looksUniformName(key)].value = looksReadNum(self, e, key, 0);
                }
            });
            rec.custom.hsl.light.forEach(function (key) {
                if (u[looksUniformName(key)]) {
                    u[looksUniformName(key)].value = looksReadNum(self, e, key, 0);
                }
            });
        }
        if (rec.custom.fourway) {
            if (u[looksUniformName(rec.custom.fourwayPreview)]) {
                u[looksUniformName(rec.custom.fourwayPreview)].value =
                    looksReadOpt(self, e, rec.custom.fourwayPreview, 0);
            }
            Object.keys(rec.custom.fourway).forEach(function (slot) {
                var st = rec.custom.fourway[slot];
                var b = looksTintName(st);
                if (u[b] && u[b].value && typeof u[b].value.set === "function") {
                    u[b].value.set(
                        Math.max(0, looksReadNum(self, e, st[0], 1)),
                        Math.max(0, looksReadNum(self, e, st[1], 1)),
                        Math.max(0, looksReadNum(self, e, st[2], 1))
                    );
                }
            });
        }
        if (rec.custom.angle) {
            if (u[looksUniformName(rec.custom.angle)]) {
                u[looksUniformName(rec.custom.angle)].value = looksReadNum(self, e, rec.custom.angle, 45);
            }
        }
        if (rec.custom.lutName) {
            var lutName = looksReadText(self, e, rec.custom.lutName, "None");
            var mode = lutName === "Hot" ? 1 : lutName === "Cold" ? 2 : lutName === "Noir" ? 3 : 0;
            var modeKey = looksUniformName(rec.custom.lutName.replace(/Name$/, "Mode"));
            if (u[modeKey]) u[modeKey].value = mode;
            if (u[looksUniformName(rec.custom.lutStrength)]) {
                u[looksUniformName(rec.custom.lutStrength)].value =
                    looksClamp01(looksReadNum(self, e, rec.custom.lutStrength, 1));
            }
            if (u[looksUniformName(rec.custom.lutGamma)]) {
                u[looksUniformName(rec.custom.lutGamma)].value =
                    Math.round(looksReadNum(self, e, rec.custom.lutGamma, 0));
            }
        }
    });
    looksRefreshLUT(this, e);
    this.pass.enabled = this.properties.enabled.get(e) === 1 && anyOn;
};

this.resize = function () {
    if (!this.pass || !this.parentLayer) {
        return;
    }
    let resolution = this.parentLayer.properties.resolution.get();
    this.pass.uniforms.resolution.value.set(resolution[0], resolution[1]);
};
