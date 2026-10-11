// OpenZoid Trapcode Suite — Trapcode shared core helpers.
/*
 * trapcode-common.js
 *
 * Shared core for the Trapcode-style object3d types: the render
 * clock, small math helpers, property-definition factories, the
 * object-type registry, the asset cache, and the image/geometry
 * asset readers. Loaded first; audio, color, shading, and
 * expression support follow in trapcode-audio.js,
 * trapcode-color.js, trapcode-shading.js, and
 * trapcode-expressions.js.
 */

var PZ = PZ || {};

(function () {
    PZ.trapcode = PZ.trapcode || {};
    var T = PZ.trapcode;

    T.currentTime = 0;

    T.setTime = function (time) {
        T.currentTime = time;
    };

    // getTexture() creates a THREE texture owned by the consumer, independently
    // of the decoded image asset's reference count.
    T.disposeImageUniform = function (material, name) {
        var uniform = material && material.uniforms && material.uniforms[name];
        if (!uniform || !uniform.value) return;
        if (typeof uniform.value.dispose === "function") uniform.value.dispose();
        uniform.value = null;
    };

    T.clamp = function (value, min, max) {
        return value < min ? min : value > max ? max : value;
    };

    T.rand = function (seed) {
        return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    };
    // Walk raw parents, including detached object lists, without host getters.
    T.findParent = function (object, Type) {
        var current = object && object.parent;
        var seen = new Set();
        while (current && !seen.has(current)) {
            if (typeof Type === "function" && current instanceof Type) return current;
            seen.add(current);
            current = current.parent;
        }
        return null;
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

    // Keyed cache for asset data that is loaded off the render path. Entries
    // are requested while an object prepares or updates a frame and are read
    // only once they settle. `revision` changes whenever an entry settles, so
    // an owner can tell whether its last render used the data it sees now.
    // Keys combine the asset kind with the asset value (a content hash for
    // uploaded files, a path for presets), so a replaced file is a new key.
    T.AssetCache = function (onSettled) {
        this.entries = {};
        this.revision = 0;
        this.onSettled = onSettled || null;
    };

    T.AssetCache.prototype.request = function (kind, value, loader) {
        if (!value) return null;
        var key = kind + "|" + value;
        var entry = this.entries[key];
        if (entry) return entry;
        var self = this;
        entry = { status: "loading", data: null, promise: null };
        this.entries[key] = entry;
        entry.promise = Promise.resolve()
            .then(function () { return loader(value); })
            .then(function (data) {
                entry.status = data ? "ready" : "failed";
                entry.data = data || null;
            }, function () {
                entry.status = "failed";
                entry.data = null;
            })
            .then(function () {
                self.revision += 1;
                if (self.onSettled) self.onSettled();
            });
        return entry;
    };

    T.AssetCache.prototype.status = function (kind, value) {
        var entry = value ? this.entries[kind + "|" + value] : null;
        return entry ? entry.status : "none";
    };

    T.AssetCache.prototype.ready = function (kind, value) {
        var entry = value ? this.entries[kind + "|" + value] : null;
        return entry && entry.status === "ready" ? entry.data : null;
    };

    T.AssetCache.prototype.clear = function () {
        this.entries = {};
        this.revision += 1;
    };

    // Decodes an image asset and samples it onto a small RGBA grid. Resolves
    // to { data, width, height } or null. PZ.asset.image only starts decoding
    // when getImage()/getTexture() runs, so decoding is started explicitly.
    // The asset reference taken by load() is released once the pixels are
    // copied.
    T.sampleImageAsset = function (project, value, maxSize) {
        if (!project || !value || typeof document === "undefined") return Promise.resolve(null);
        var asset = project.assets.load(value);
        if (!asset) return Promise.resolve(null);
        var finish = function (result) {
            try { project.assets.unload(asset); } catch (_error) { /* best effort */ }
            return result;
        };
        var image;
        try {
            image = new PZ.asset.image(asset);
            image.getImage(true);
        } catch (_error) {
            console.warn("[Zoidium] trapcode-suite: image asset could not be decoded; using no image.", _error);
            return Promise.resolve(finish(null));
        }
        return Promise.resolve(image.loading).then(function () {
            var source = image.data && image.data.image;
            if (!source || !(source.width > 0) || !(source.height > 0)) return finish(null);
            var width = Math.min(source.width, maxSize);
            var height = Math.min(source.height, maxSize);
            var canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            var context = canvas.getContext("2d");
            context.drawImage(source, 0, 0, width, height);
            var pixels = context.getImageData(0, 0, width, height).data;
            return finish({ data: pixels, width: width, height: height });
        }, function () {
            return finish(null);
        });
    };

    // Reads the POSITION attribute of a JSON BufferGeometry asset into a copy.
    // SEC-05 follow-up: the decoded mesh is bounded by the same ingestion
    // caps as Plexus (T.plexusGeometry.MAX_GEOMETRY_VERTICES). An oversized
    // model resolves to null, which Form treats as "no mesh" and falls back
    // to a random scatter (sampleModel), instead of exhausting memory. The
    // limit is read from T.plexusGeometry when that file has loaded, with the
    // same value as a fallback so this file also works standalone.
    T.loadGeometryPositions = function (project, value) {
        if (!project || !value) return Promise.resolve(null);
        var asset = project.assets.load(value);
        if (!asset) return Promise.resolve(null);
        var finish = function (result) {
            try { project.assets.unload(asset); } catch (_error) { /* best effort */ }
            return result;
        };
        return Promise.resolve()
            .then(function () { return new PZ.asset.geometry(asset).getGeometry(); })
            .then(function (geometry) {
                var position = geometry && geometry.attributes && geometry.attributes.position;
                if (!position || !position.array) return finish(null);
                var limits = T.plexusGeometry || {};
                var maxVertices = limits.MAX_GEOMETRY_VERTICES || 500000;
                if (position.array.length / 3 > maxVertices) {
                    try {
                        console.warn("Trapcode Form: the model file was skipped (the decoded mesh has " +
                            Math.floor(position.array.length / 3) + " vertices (limit " + maxVertices + ")); using a scatter instead.");
                    } catch (_warnError) { /* logging is best effort */ }
                    return finish(null);
                }
                return finish(position ? new Float32Array(position.array) : null);
            }, function () {
                return finish(null);
            });
    };
})();
