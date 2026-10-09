// OpenZoid Optical Flares — shared helpers (same copy as the Trapcode Suite
// pack; bundled here so this pack works with or without Trapcode Suite).
/*
 * trapcode-common.js
 *
 * Shared helpers for the Trapcode-style object3d types (Particular, Form,
 * Plexus). Loaded before particular.js / form.js / plexus.js.
 */

var PZ = PZ || {};

(function () {
    PZ.trapcode = PZ.trapcode || {};
    var T = PZ.trapcode;

    T.currentTime = 0;

    T.setTime = function (time) {
        T.currentTime = time;
    };

    T.clamp = function (value, min, max) {
        return value < min ? min : value > max ? max : value;
    };

    T.rand = function (seed) {
        return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    };

    T.parseColor = function (color) {
        if (typeof color !== "string") return [1, 1, 1, 1];
        if (color.indexOf("rgb") === 0) {
            var parts = color
                .slice(color.indexOf("(") + 1, -1)
                .split(",")
                .map(function (e) {
                    return parseFloat(e);
                });
            return [
                (parts[0] || 0) / 255,
                (parts[1] || 0) / 255,
                (parts[2] || 0) / 255,
                parts.length > 3 ? parts[3] : 1,
            ];
        }
        return [1, 1, 1, 1];
    };

    T.colorBrightness = function (color) {
        var c = T.parseColor(color);
        return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    };

    T.gradientColor = function (value, position) {
        if (!value || !value.length) return [1, 1, 1, 1];
        if (value.length === 1) return T.parseColor(value[0].color);
        if (position <= value[0].position) return T.parseColor(value[0].color);
        var last = value[value.length - 1];
        if (position >= last.position) return T.parseColor(last.color);
        var a = value[0];
        var b = last;
        for (var i = 0; i < value.length - 1; i++) {
            if (position >= value[i].position && position <= value[i + 1].position) {
                a = value[i];
                b = value[i + 1];
                break;
            }
        }
        var span = b.position - a.position;
        var ratio = span > 0 ? (position - a.position) / span : 0;
        var ca = T.parseColor(a.color);
        var cb = T.parseColor(b.color);
        return [
            ca[0] + (cb[0] - ca[0]) * ratio,
            ca[1] + (cb[1] - ca[1]) * ratio,
            ca[2] + (cb[2] - ca[2]) * ratio,
            ca[3] + (cb[3] - ca[3]) * ratio,
        ];
    };

    T.curveValue = function (keys, position) {
        if (!keys || !keys.length) return 1;
        var alphaOf = function (color) {
            var c = T.parseColor(color);
            return typeof c[3] === "number" && c[3] >= 0 ? c[3] : T.colorBrightness(color);
        };
        if (keys.length === 1) return alphaOf(keys[0].color);
        if (position <= keys[0].position) return alphaOf(keys[0].color);
        var last = keys[keys.length - 1];
        if (position >= last.position) return alphaOf(last.color);
        var a = keys[0];
        var b = last;
        for (var i = 0; i < keys.length - 1; i++) {
            if (position >= keys[i].position && position <= keys[i + 1].position) {
                a = keys[i];
                b = keys[i + 1];
                break;
            }
        }
        var span = b.position - a.position;
        var ratio = span > 0 ? (position - a.position) / span : 0;
        var va = alphaOf(a.color);
        var vb = alphaOf(b.color);
        return va + (vb - va) * ratio;
    };

    T.fillGradient = function (texture, value) {
        var data = texture.image.data;
        for (var i = 0; i < 256; i++) {
            var c = T.gradientColor(value, i / 255);
            data[i * 4 + 0] = Math.round(T.clamp(c[0], 0, 1) * 255);
            data[i * 4 + 1] = Math.round(T.clamp(c[1], 0, 1) * 255);
            data[i * 4 + 2] = Math.round(T.clamp(c[2], 0, 1) * 255);
            data[i * 4 + 3] = Math.round(T.clamp(c[3], 0, 1) * 255);
        }
        texture.needsUpdate = true;
    };

    T.fillCurve = function (texture, keys, enabled) {
        var data = texture.image.data;
        for (var i = 0; i < 256; i++) {
            var v = enabled ? T.curveValue(keys, i / 255) : 1;
            var b = Math.round(T.clamp(v, 0, 1) * 255);
            data[i * 4 + 0] = b;
            data[i * 4 + 1] = b;
            data[i * 4 + 2] = b;
            data[i * 4 + 3] = 255;
        }
        texture.needsUpdate = true;
    };

    T.signature = function (value) {
        try {
            return JSON.stringify(value || null);
        } catch (e) {
            return String(value);
        }
    };

    T.createPalette = function () {
        var texture = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
        texture.minFilter = texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        return texture;
    };

    T.number = function (name, value, extra) {
        var def = { dynamic: true, name: name, type: PZ.property.type.NUMBER, value: value };
        if (extra) for (var k in extra) def[k] = extra[k];
        return def;
    };

    T.vector3 = function (name, value, extra) {
        var def = {
            dynamic: true,
            group: true,
            objects: [
                { dynamic: true, name: name + ".X", type: PZ.property.type.NUMBER, value: value[0] },
                { dynamic: true, name: name + ".Y", type: PZ.property.type.NUMBER, value: value[1] },
                { dynamic: true, name: name + ".Z", type: PZ.property.type.NUMBER, value: value[2] },
            ],
            name: name,
            type: PZ.property.type.VECTOR3,
        };
        if (extra) for (var k in extra) def[k] = extra[k];
        return def;
    };

    T.option = function (name, value, items, dynamic) {
        return { dynamic: !!dynamic, name: name, type: PZ.property.type.OPTION, value: value, items: items };
    };

    T.imageAsset = function (name) {
        return {
            name: name,
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: null,
        };
    };

    T.curveProperty = function (name) {
        return {
            dynamic: true,
            name: name,
            type: PZ.property.type.CURVE,
            value: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 1, color: "rgba(255,255,255,1)" },
            ],
        };
    };

    T.gradientProperty = function (name, value) {
        return {
            name: name,
            type: PZ.property.type.GRADIENT,
            value: value || [{ position: 0, color: "rgba(255,255,255,1)" }],
        };
    };

    T.registerObjectTypes = function (cls, list) {
        if (PZ.ui && PZ.ui.objectTypes) PZ.ui.objectTypes.set(cls, list);
    };

    T.designerRoot = function (object) {
        if (!object) return null;
        var types = [
            PZ.object3d.particular,
            PZ.object3d.form,
            PZ.object3d.plexus,
            PZ.object3d.optflares,
        ];
        for (var i = 0; i < types.length; i++) {
            if (!types[i]) continue;
            if (object instanceof types[i]) return object;
            if (typeof object.tryGetParentOfType === "function") {
                var root = object.tryGetParentOfType(types[i]);
                if (root) return root;
            }
        }
        return object.constructor && object.constructor.designer ? object : null;
    };

    T.attachToParent = function (object) {
        if (!object.threeObj) return;
        if (object.threeObj.parent) object.threeObj.parent.remove(object.threeObj);
        if (!object.parent) return;
        var parent = object.tryGetParentOfType(PZ.object3d);
        if (parent && parent.threeObj) parent.threeObj.add(object.threeObj);
    };
})();
