// OpenZoid Magic Looks — full-chain color grading effect.
//
// One native effect hosting the 29 Looks tools. Property definitions come from
// the looks-tools.js catalog (single source of truth, loaded from the plugin
// bundle). The shader is compiled once in load(); per frame only uniforms are
// written, and the chain order and the curve tables are rebuilt only when their
// stored text changes.
//
// Defaults are identity. While every property holds its default value the
// pass is disabled and the layer passes through untouched.

var looksSelf = this;

this.defaultName = "Magic Looks";

// The catalog (looks-color.js + looks-tools.js) loads from the plugin bundle.
// The manager sets _zoidiumGetAsset before evaluating this file.
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

// Default values per property key: a value equal to its default is identity.
this._looksDefaults = {};
Object.keys(this.propertyDefinitions).forEach(function (key) {
    var def = looksSelf.propertyDefinitions[key];
    looksSelf._looksDefaults[key] = def ? def.value : undefined;
});

var LOOKS_CHAIN_KEY = Looks.tools.CHAIN_KEY;
var LOOKS_CURVES_KEY = "curvCurvesJson";
var LOOKS_SCURVE_KEY = "scvScurveJson";
var LOOKS_LUT_SIZE = 256;

function looksUniformName(prop) {
    return "u_" + prop;
}

// Wheel triples share their base with zone-position numbers in one tool
// (color-ranges highlight/midtone/shadow), so vec3 tints take a Tint suffix.
function looksTintName(triple) {
    return "u_" + triple[0].slice(0, -1) + "Tint";
}

function looksBuildUniforms(propMap) {
    var uniforms = {
        tDiffuse: { type: "t", value: null },
        resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
        // Set by the CM3 compositor: the layer occupies uv * uvScale of the
        // shared render buffer, which may be larger than this layer.
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        uCurvesLUT: { type: "t", value: null },
        uSCurveLUT: { type: "t", value: null },
        u_chain: { type: "fv1", value: new Array(Looks.tools.MAX_CHAIN).fill(-1) },
        u_chainCount: { type: "f", value: 0 },
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
        if (e.custom.lutName) {
            uniforms[looksUniformName(e.custom.lutName.replace(/Name$/, "Mode"))] = { type: "f", value: 0 };
            uniforms[looksUniformName(e.custom.lutStrength)] = { type: "f", value: 1 };
            uniforms[looksUniformName(e.custom.lutGamma)] = { type: "f", value: 0 };
        }
    });
    return uniforms;
}

this._looksPropMap = Looks.tools.propMap();
this._looksToolIds = Object.keys(this._looksPropMap);

// Exposed for unit tests and debugging.
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
    var getAsset = (typeof this._zoidiumGetAsset === "function")
        ? this._zoidiumGetAsset.bind(this)
        : null;
    var vertSource = getAsset ? getAsset("text", "./plugins/magic-looks/looks-vert.glsl") : undefined;
    var fragSource = getAsset ? getAsset("text", "./plugins/magic-looks/looks-grade.glsl") : undefined;
    if (typeof vertSource !== "string" || typeof fragSource !== "string") {
        throw new Error("Magic Looks shaders are missing from the plugin bundle.");
    }
    var uniforms = looksBuildUniforms(this._looksPropMap);
    this._looksCurvesBytes = new Uint8Array(LOOKS_LUT_SIZE * 3);
    this._looksScurveBytes = new Uint8Array(LOOKS_LUT_SIZE * 3);
    this._looksCurvesTexture = looksLutTexture(this._looksCurvesBytes);
    this._looksScurveTexture = looksLutTexture(this._looksScurveBytes);
    this._looksLutKeys = { curves: null, scurve: null };
    this._looksCurvesIdentity = true;
    this._looksScurveIdentity = true;
    this._looksChainText = null;
    this._looksChainCount = 0;
    this._looksActiveTools = {};
    uniforms.uCurvesLUT.value = this._looksCurvesTexture;
    uniforms.uSCurveLUT.value = this._looksScurveTexture;
    var material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertSource,
        fragmentShader: fragSource,
    });
    material.premultipliedAlpha = true;
    this.pass = new THREE.ShaderPass(material);
    this.properties.load(e && e.properties);
};

// 256x1 RGB table; entry k is the output for input k/255.
function looksLutTexture(bytes) {
    var texture = new THREE.DataTexture(bytes, LOOKS_LUT_SIZE, 1, THREE.RGBFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
}

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function () {
    [this._looksCurvesTexture, this._looksScurveTexture].forEach(function (texture) {
        if (texture && typeof texture.dispose === "function") texture.dispose();
    });
    if (this.pass && this.pass.material && typeof this.pass.material.dispose === "function") {
        this.pass.material.dispose();
    }
    this.pass = null;
};

function looksReadText(instance, e, key) {
    var p = instance.properties[key];
    if (!p) return "";
    var v = p.get(e);
    return typeof v === "string" ? v : "";
}

// Per-channel curves table: entries are bytes of the composed channel curves.
function looksFillBytes(bytes, luts, sc) {
    for (var i = 0; i < LOOKS_LUT_SIZE; i++) {
        if (luts) {
            bytes[i * 3] = Math.round(Looks.color.clamp(luts.Red[i], 0, 1) * 255);
            bytes[i * 3 + 1] = Math.round(Looks.color.clamp(luts.Green[i], 0, 1) * 255);
            bytes[i * 3 + 2] = Math.round(Looks.color.clamp(luts.Blue[i], 0, 1) * 255);
        } else {
            var v = Math.round(Looks.color.clamp(sc[i], 0, 1) * 255);
            bytes[i * 3] = v;
            bytes[i * 3 + 1] = v;
            bytes[i * 3 + 2] = v;
        }
    }
}

// Identity tables (entry k == k) skip their pass entirely.
function looksIsIdentity(bytes) {
    for (var i = 0; i < LOOKS_LUT_SIZE; i++) {
        if (bytes[i * 3] !== i || bytes[i * 3 + 1] !== i || bytes[i * 3 + 2] !== i) return false;
    }
    return true;
}

// Rebuild the curve and S-curve tables when their stored JSON changes. Bad
// input falls back to identity.
function looksRefreshLUT(instance, e) {
    var curvesJson = looksReadText(instance, e, LOOKS_CURVES_KEY);
    var scurveJson = looksReadText(instance, e, LOOKS_SCURVE_KEY);
    if (curvesJson !== instance._looksLutKeys.curves) {
        instance._looksLutKeys.curves = curvesJson;
        var channels = null;
        try {
            var parsed = JSON.parse(curvesJson);
            if (parsed && parsed.Red && parsed.Green && parsed.Blue) channels = parsed;
        } catch (_err) { /* identity below */ }
        var curves = { channels: channels || Looks.tools.defaultToolState(Looks.tools.byId("curves")).x.curves.channels };
        looksFillBytes(instance._looksCurvesBytes, Looks.grade.buildCurveLUTs(curves), null);
        instance._looksCurvesIdentity = looksIsIdentity(instance._looksCurvesBytes);
        if (instance._looksCurvesTexture) instance._looksCurvesTexture.needsUpdate = true;
    }
    if (scurveJson !== instance._looksLutKeys.scurve) {
        instance._looksLutKeys.scurve = scurveJson;
        var shape = null;
        try {
            var parsedS = JSON.parse(scurveJson);
            if (parsedS && parsedS.p0 && parsedS.c1 && parsedS.c2 && parsedS.p3) shape = parsedS;
        } catch (_err2) { /* identity below */ }
        var scurve = Looks.tools.defaultScurve();
        if (shape) {
            scurve.black = looksNumOr(shape.black, 0);
            scurve.white = looksNumOr(shape.white, 1);
            scurve.p0 = shape.p0;
            scurve.c1 = shape.c1;
            scurve.c2 = shape.c2;
            scurve.p3 = shape.p3;
        }
        looksFillBytes(instance._looksScurveBytes, null, Looks.grade.buildScurveLUT(scurve));
        instance._looksScurveIdentity = looksIsIdentity(instance._looksScurveBytes);
        if (instance._looksScurveTexture) instance._looksScurveTexture.needsUpdate = true;
    }
}

// Chain order: a 29-slot float array plus a count. Rebuilt only when the
// stored text changes; unknown or missing text falls back to the default.
function looksRefreshChain(instance, e) {
    var text = looksReadText(instance, e, LOOKS_CHAIN_KEY);
    if (text === instance._looksChainText) return;
    instance._looksChainText = text;
    var order = Looks.tools.parseChain(text);
    var slots = instance.pass.uniforms.u_chain.value;
    for (var i = 0; i < slots.length; i++) slots[i] = -1;
    for (var k = 0; k < order.length && k < slots.length; k++) {
        slots[k] = Looks.tools.indexOf(order[k]);
    }
    instance._looksChainOrder = order;
    instance._looksChainCount = Math.min(order.length, slots.length);
    instance._looksChainIsDefault = order.join(",") === Looks.tools.defaultChain().join(",");
    instance.pass.uniforms.u_chainCount.value = instance._looksChainCount;
}

// Writes a numeric uniform and records whether the value differs from its
// property default.
function looksSetNum(instance, u, uniform, prop, e, fallback) {
    var p = instance.properties[prop];
    var v = p ? p.get(e) : fallback;
    var n = looksNumOr(v, fallback);
    if (u[uniform]) u[uniform].value = n;
    if (p && n !== instance._looksDefaults[prop]) instance._looksDirty = true;
    return n;
}

function looksSetOpt(instance, u, uniform, prop, e, fallback) {
    var p = instance.properties[prop];
    var raw = p ? p.get(e) : fallback;
    var n = Math.round(looksNumOr(raw, fallback)) ? 1 : 0;
    if (u[uniform]) u[uniform].value = n;
    var def = Math.round(looksNumOr(instance._looksDefaults[prop], 0)) ? 1 : 0;
    if (p && n !== def) instance._looksDirty = true;
    return n;
}

function looksSetTint(instance, u, triple, e) {
    var uniform = u[looksTintName(triple)];
    if (!uniform || !uniform.value || typeof uniform.value.set !== "function") return;
    var r = looksSetNum(instance, u, null, triple[0], e, 1);
    var g = looksSetNum(instance, u, null, triple[1], e, 1);
    var b = looksSetNum(instance, u, null, triple[2], e, 1);
    uniform.value.set(Math.max(0, r), Math.max(0, g), Math.max(0, b));
}

this.update = function (e) {
    if (!this.pass) {
        return;
    }
    var u = this.pass.uniforms;
    var map = this._looksPropMap;
    var ids = this._looksToolIds;
    var self = this;
    this._looksDirty = false;
    looksRefreshChain(this, e);
    looksRefreshLUT(this, e);
    if (!this._looksChainIsDefault) this._looksDirty = true;
    for (var t = 0; t < ids.length; t++) {
        var rec = map[ids[t]];
        this._looksDirty = false;
        var toolOn = looksSetOpt(this, u, looksUniformName(rec.enable), rec.enable, e, 1);
        var enableChanged = this._looksDirty;
        // A disabled tool and an unchanged identity tool need no shader stage.
        this._looksDirty = false;
        var keys = Object.keys(rec.params);
        for (var k = 0; k < keys.length; k++) {
            var key = rec.params[keys[k]];
            looksSetNum(this, u, looksUniformName(key), key, e, 0);
        }
        var wkeys = Object.keys(rec.wheels);
        for (var w = 0; w < wkeys.length; w++) {
            looksSetTint(this, u, rec.wheels[wkeys[w]], e);
        }
        if (rec.custom.hsl) {
            for (var h = 0; h < 8; h++) {
                looksSetNum(this, u, looksUniformName(rec.custom.hsl.sat[h]), rec.custom.hsl.sat[h], e, 0);
                looksSetNum(this, u, looksUniformName(rec.custom.hsl.light[h]), rec.custom.hsl.light[h], e, 0);
            }
        }
        if (rec.custom.fourway) {
            looksSetOpt(this, u, looksUniformName(rec.custom.fourwayPreview), rec.custom.fourwayPreview, e, 0);
            var slots = Object.keys(rec.custom.fourway);
            for (var s = 0; s < slots.length; s++) {
                looksSetTint(this, u, rec.custom.fourway[slots[s]], e);
            }
        }
        if (rec.custom.lutName) {
            var nameProp = this.properties[rec.custom.lutName];
            var lutName = nameProp ? looksReadText(this, e, rec.custom.lutName) : "None";
            var mode = lutName === "Hot" ? 1 : lutName === "Cold" ? 2 : lutName === "Noir" ? 3 : 0;
            var modeKey = looksUniformName(rec.custom.lutName.replace(/Name$/, "Mode"));
            if (u[modeKey]) u[modeKey].value = mode;
            if (mode !== 0) this._looksDirty = true;
            looksSetNum(this, u, looksUniformName(rec.custom.lutStrength), rec.custom.lutStrength, e, 1);
            var gi = Math.round(looksNumOr(this.properties[rec.custom.lutGamma] ? this.properties[rec.custom.lutGamma].get(e) : 0, 0));
            if (u[looksUniformName(rec.custom.lutGamma)]) u[looksUniformName(rec.custom.lutGamma)].value = gi;
            if (gi !== 0) this._looksDirty = true;
        }
        var changed = this._looksDirty || enableChanged;
        if (ids[t] === "curves") changed = changed || !this._looksCurvesIdentity;
        if (ids[t] === "s-curve") changed = changed || !this._looksScurveIdentity;
        this._looksActiveTools[ids[t]] = toolOn === 1 && changed;
    }
    // Enable flags of the two LUT stages also depend on their table content.
    u.u_curvEnable.value *= this._looksCurvesIdentity ? 0 : 1;
    u.u_scvEnable.value *= this._looksScurveIdentity ? 0 : 1;
    // Compact the stored chain without changing its order. Running all 29
    // identity stages for one edited tool is especially costly on software GL.
    var slots = u.u_chain.value;
    var count = 0;
    var order = this._looksChainOrder || [];
    for (var c = 0; c < order.length; c++) {
        if (this._looksActiveTools[order[c]]) slots[count++] = Looks.tools.indexOf(order[c]);
    }
    for (var unused = count; unused < slots.length; unused++) slots[unused] = -1;
    u.u_chainCount.value = count;
    this._looksChainCount = count;
    var masterOn = this.properties.enabled.get(e) === 1;
    this.pass.enabled = masterOn && count > 0;
};

this.resize = function () {
    if (!this.pass || !this.parentLayer) {
        return;
    }
    let resolution = this.parentLayer.properties.resolution.get();
    this.pass.uniforms.resolution.value.set(resolution[0], resolution[1]);
};
