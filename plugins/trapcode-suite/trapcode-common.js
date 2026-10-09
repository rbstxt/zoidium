// OpenZoid Trapcode Suite — shared helpers (ported verbatim from trapcode-common.js).
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

    /* ------------------------------------------------------------------ */
    /* Offline audio analysis                                             */
    /* ------------------------------------------------------------------ */
    // Audio reactors read decoded PCM at an explicit media time instead of a
    // live AnalyserNode, so a value depends only on the file and the time.
    // A sample is the mean of a Hann-windowed FFT of AUDIO_FFT_SIZE mono samples
    // centred on the requested time (quantized to 1 ms). Bin magnitudes are
    // mapped to dB with the AnalyserNode range (-100..-30 dB) and averaged to
    // 0..1. Silence is 0. Samples are memoized per source and time bucket.
    var AUDIO_FFT_SIZE = 2048;
    var AUDIO_MIN_DB = -100;
    var AUDIO_MAX_DB = -30;
    var AUDIO_MEMO_LIMIT = 4096;
    var AUDIO_SOURCE_LIMIT = 8;
    var audioSources = new Map();
    var audioPending = new Map();

    function audioFft(re, im) {
        var n = re.length;
        for (var i = 1, j = 0; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var tr0 = re[i]; re[i] = re[j]; re[j] = tr0;
                var ti0 = im[i]; im[i] = im[j]; im[j] = ti0;
            }
        }
        for (var len = 2; len <= n; len <<= 1) {
            var ang = (-2 * Math.PI) / len;
            var wr = Math.cos(ang);
            var wi = Math.sin(ang);
            var half = len >> 1;
            for (var s = 0; s < n; s += len) {
                var cr = 1;
                var ci = 0;
                for (var k = 0; k < half; k++) {
                    var a = s + k;
                    var b = a + half;
                    var tr = re[b] * cr - im[b] * ci;
                    var ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                    var nr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = nr;
                }
            }
        }
    }

    function audioFrameLevel(samples) {
        var n = AUDIO_FFT_SIZE;
        var re = new Float64Array(n);
        var im = new Float64Array(n);
        var windowSum = 0;
        for (var i = 0; i < n; i++) {
            var w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
            re[i] = samples[i] * w;
            windowSum += w;
        }
        audioFft(re, im);
        var total = 0;
        for (var k = 0; k < n / 2; k++) {
            var mag = (Math.sqrt(re[k] * re[k] + im[k] * im[k]) * 2) / windowSum;
            var db = 20 * Math.log(mag + 1e-12) / Math.LN10;
            total += T.clamp((db - AUDIO_MIN_DB) / (AUDIO_MAX_DB - AUDIO_MIN_DB), 0, 1);
        }
        return total / (n / 2);
    }

    // Mono mix of AUDIO_FFT_SIZE samples centred on a sample index (zero outside the buffer).
    function audioReadWindow(buffer, centre, out) {
        var channels = buffer.numberOfChannels || 1;
        var length = buffer.length;
        var start = centre - (out.length >> 1);
        out.fill(0);
        for (var c = 0; c < channels; c++) {
            var data = buffer.getChannelData(c);
            for (var i = 0; i < out.length; i++) {
                var index = start + i;
                if (index >= 0 && index < length) out[i] += data[index] / channels;
            }
        }
    }

    function audioDecodeSource(project, source) {
        var asset = project && project.assets ? project.assets.load(source) : null;
        var bytes;
        if (asset && asset.file && typeof asset.file.arrayBuffer === "function") {
            bytes = asset.file.arrayBuffer();
        } else {
            var url = asset && asset.url ? asset.url : String(source);
            bytes = fetch(url).then(function (response) {
                if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
                return response.arrayBuffer();
            });
        }
        return Promise.resolve(bytes).then(function (data) {
            var Ctor = typeof window !== "undefined"
                ? window.OfflineAudioContext || window.webkitOfflineAudioContext
                : null;
            if (!Ctor) throw new Error("Web Audio is not available");
            var context = new Ctor(1, 1, 48000);
            return new Promise(function (resolve, reject) {
                context.decodeAudioData(data, resolve, reject);
            });
        });
    }

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

    T.audioClipTime = function (object, source, frame, fps) {
        var sequence = T.findParent(object, PZ.sequence);
        var sceneClip = T.findParent(object, PZ.clip);
        var projectFrame = frame + (sceneClip ? sceneClip.start : 0);
        var tracks = sequence && sequence.audioTracks;
        if (tracks) {
            var first = null;
            for (var i = 0; i < tracks.length; i++) {
                var clips = tracks[i].clips || [];
                for (var j = 0; j < clips.length; j++) {
                    var clip = clips[j];
                    if (!clip.properties.media || clip.properties.media.get(projectFrame) !== source) continue;
                    if (!first) first = clip;
                    if (projectFrame < clip.start || projectFrame >= clip.start + clip.length) continue;
                    return clip.properties.time ? clip.properties.time.get(projectFrame - clip.start) : (projectFrame - clip.start) / fps;
                }
            }
            if (first) return -1;
        }
        return frame / fps;
    };

    T.audioAnalysis = {
        fftSize: AUDIO_FFT_SIZE,
        has: function (source) {
            return audioSources.has(source);
        },
        // Registers decoded PCM (an AudioBuffer-like object) under a source key.
        register: function (source, buffer) {
            audioSources.delete(source);
            audioSources.set(source, { buffer: buffer, memo: new Map() });
            while (audioSources.size > AUDIO_SOURCE_LIMIT) {
                audioSources.delete(audioSources.keys().next().value);
            }
        },
        // Level 0..1 at a media time in seconds, or null when the source is not decoded.
        levelAt: function (source, seconds) {
            var entry = audioSources.get(source);
            if (!entry || !isFinite(seconds)) return entry ? 0 : null;
            var bucket = Math.round(seconds * 1000);
            if (entry.memo.has(bucket)) return entry.memo.get(bucket);
            var frame = new Float32Array(AUDIO_FFT_SIZE);
            var centre = Math.round((bucket / 1000) * entry.buffer.sampleRate);
            audioReadWindow(entry.buffer, centre, frame);
            var level = audioFrameLevel(frame);
            if (entry.memo.size >= AUDIO_MEMO_LIMIT) entry.memo.clear();
            entry.memo.set(bucket, level);
            return level;
        },
        // Decodes the asset once; concurrent callers share one promise.
        load: function (project, source) {
            if (audioSources.has(source)) return Promise.resolve(true);
            if (audioPending.has(source)) return audioPending.get(source);
            var promise = audioDecodeSource(project, source).then(
                function (buffer) {
                    audioPending.delete(source);
                    T.audioAnalysis.register(source, buffer);
                    return true;
                },
                function (error) {
                    audioPending.delete(source);
                    throw error;
                }
            );
            audioPending.set(source, promise);
            return promise;
        },
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
                return finish(position ? new Float32Array(position.array) : null);
            }, function () {
                return finish(null);
            });
    };

    // Shared color palettes for the Rowbyte & Red Giant Suite designer.
    // Each scheme carries gradient stops (Particular colorGradient, Form
    // colorOver) plus two flat colors in 0..1 (Particular/Form base color,
    // Plexus effector color/color2 and renderer color).
    T.palettes = [
        {
            name: "Fire",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.45, color: "rgba(255,190,90,1)" },
                { position: 0.8, color: "rgba(255,90,10,0.85)" },
                { position: 1, color: "rgba(180,20,0,0)" },
            ],
            colors: [[1, 0.72, 0.35], [1, 0.25, 0.05]],
        },
        {
            name: "Sunset",
            stops: [
                { position: 0, color: "rgba(255,240,200,1)" },
                { position: 0.5, color: "rgba(255,120,90,1)" },
                { position: 1, color: "rgba(120,40,140,0)" },
            ],
            colors: [[1, 0.62, 0.4], [0.55, 0.2, 0.6]],
        },
        {
            name: "Ocean",
            stops: [
                { position: 0, color: "rgba(220,255,255,1)" },
                { position: 0.5, color: "rgba(60,180,255,1)" },
                { position: 1, color: "rgba(10,60,180,0)" },
            ],
            colors: [[0.4, 0.8, 1], [0.05, 0.3, 0.8]],
        },
        {
            name: "Ice",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.55, color: "rgba(170,230,255,1)" },
                { position: 1, color: "rgba(80,150,255,0)" },
            ],
            colors: [[0.75, 0.92, 1], [0.35, 0.6, 1]],
        },
        {
            name: "Forest",
            stops: [
                { position: 0, color: "rgba(240,255,210,1)" },
                { position: 0.5, color: "rgba(120,220,90,1)" },
                { position: 1, color: "rgba(20,90,40,0)" },
            ],
            colors: [[0.6, 0.9, 0.4], [0.1, 0.4, 0.2]],
        },
        {
            name: "Neon",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.45, color: "rgba(255,0,220,1)" },
                { position: 1, color: "rgba(0,240,255,0)" },
            ],
            colors: [[1, 0.2, 0.9], [0, 0.9, 1]],
        },
        {
            name: "Candy",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.5, color: "rgba(255,130,200,1)" },
                { position: 1, color: "rgba(200,40,140,0)" },
            ],
            colors: [[1, 0.6, 0.8], [0.8, 0.15, 0.55]],
        },
        {
            name: "Royal",
            stops: [
                { position: 0, color: "rgba(255,250,230,1)" },
                { position: 0.5, color: "rgba(255,200,60,1)" },
                { position: 1, color: "rgba(120,40,160,0)" },
            ],
            colors: [[1, 0.82, 0.35], [0.5, 0.18, 0.65]],
        },
        {
            name: "Toxic",
            stops: [
                { position: 0, color: "rgba(240,255,200,1)" },
                { position: 0.5, color: "rgba(170,255,40,1)" },
                { position: 1, color: "rgba(30,140,40,0)" },
            ],
            colors: [[0.75, 1, 0.25], [0.12, 0.55, 0.15]],
        },
        {
            name: "Smoke",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.6, color: "rgba(200,200,200,0.7)" },
                { position: 1, color: "rgba(120,120,120,0)" },
            ],
            colors: [[0.9, 0.9, 0.9], [0.5, 0.5, 0.5]],
        },
    ];

    T.supportsPalette = function (target) {
        if (!target || !target.properties) return false;
        var p = target.properties;
        if (p.particle && (p.particle.colorGradient || p.particle.colorOver)) return true;
        if (p.effector && (p.effector.color || p.effector.color2)) return true;
        if (p.renderer && p.renderer.color) return true;
        return false;
    };

    // Applies a shared palette scheme to a Particular system, Form
    // instance, or Plexus object. Returns true when anything was set.
    // Direct property writes, like the built-in behavior presets.
    T.applyPalette = function (target, palette) {
        if (!target || !palette) return false;
        var done = false;
        try {
            var p = target.properties;
            if (!p) return false;
            var stops = palette.stops || [];
            var colors = palette.colors || [];
            var base = colors[0] || [1, 1, 1];
            var second = colors[1] || base;
            if (p.particle && p.particle.colorGradient && stops.length) {
                p.particle.colorGradient.set(stops);
                done = true;
            }
            if (p.particle && p.particle.colorOver && stops.length) {
                p.particle.colorOver.set(stops);
                done = true;
            }
            if (p.particle && p.particle.color) {
                p.particle.color.set([base[0], base[1], base[2]]);
                done = true;
            }
            if (p.effector) {
                if (p.effector.color) {
                    p.effector.color.set([base[0], base[1], base[2]]);
                    done = true;
                }
                if (p.effector.color2) {
                    p.effector.color2.set([second[0], second[1], second[2]]);
                    done = true;
                }
            }
            if (p.renderer && p.renderer.color) {
                p.renderer.color.set([base[0], base[1], base[2]]);
                done = true;
            }
            if (done && typeof target.updatePalettes === "function") {
                target.updatePalettes();
            }
        } catch (err) {
            return done;
        }
        return done;
    };

    // CSS gradient bar preview for a palette scheme.
    T.paletteCSS = function (palette) {
        var stops = (palette && palette.stops) || [];
        if (!stops.length) return "linear-gradient(90deg,#fff,#fff)";
        var parts = [];
        for (var i = 0; i < stops.length; i++) {
            var pos = Math.round((stops[i].position || 0) * 100);
            parts.push(stops[i].color + " " + pos + "%");
        }
        return "linear-gradient(90deg," + parts.join(",") + ")";
    };

    // OpenZoid expression methods missing from stock CM3, transcribed
    // verbatim. Installed onto PZ.expression.methods (missing keys only)
    // by the suite runtime so wiggle() and friends work on any property,
    // including Trapcode Particular parameters.
    T.expressionMethods = {
        valueAtTime: function (e, t) {
            if (!e || !e.getBaseValue) {
                return e;
            }
            var r = Object.create(Object.getPrototypeOf(e));
            Object.assign(r, e);
            r.expression = null;
            return r.getBaseValue(t);
        },
        property: function (e) {
            return e;
        },
        wiggle: function (e, t, r, i, a) {
            return this._wiggle(e, t, r, i, a, false);
        },
        _wiggle: function (e, t, r, i, a, s) {
            var n = e === undefined ? 1 : e;
            var o = t === undefined ? 1 : t;
            var oct = r === undefined ? 2 : Math.max(1, Math.round(r));
            var ampMult = i === undefined ? 0.45 : i;
            var c = a === undefined ? (this.currentFrame === undefined ? 0 : this.currentFrame) : a;
            var seed = this._propertySeed(this.currentProperty);
            var s0 = seed * 0.001,
                s1 = seed * 0.003,
                s2 = seed * 0.007;
            var ax = 0,
                ay = 0,
                az = 0,
                norm = 0;
            for (var k = 0; k < oct; k++) {
                var amp = Math.pow(ampMult, k);
                var fm = 1 + k * 0.61 + 0.23 * this.random(seed * 0.01 + k);
                var f = n * fm;
                var ph0 = this.random(s0 + k * 1.7) * 6.2831853;
                var ph1 = this.random(s1 + k * 2.9) * 6.2831853;
                var ph2 = this.random(s2 + k * 4.3) * 6.2831853;
                ax += amp * Math.sin(c * f + ph0);
                ay += amp * Math.sin(c * f * 1.17 + ph1);
                az += amp * Math.sin(c * f * 1.41 + ph2);
                norm += amp;
            }
            var nx = ax / norm,
                ny = ay / norm,
                nz = az / norm;
            var g = this.currentValue;
            if (Array.isArray(o)) {
                var b = new Array(o.length);
                for (var x = 0; x < o.length; x++) {
                    var v = [nx, ny, nz][x];
                    var w = (v === undefined ? 0 : v) * o[x];
                    var kk = Array.isArray(g) ? (g[x] === undefined ? 0 : g[x]) : g === undefined ? 0 : g;
                    b[x] = kk + w;
                }
                return b;
            }
            var w2 = nx * o;
            var x2 = Array.isArray(g) ? g[0] || 0 : g === undefined ? 0 : g;
            return x2 + w2;
        },
        _propertySeed: function (e) {
            var i = e && e.getAddress ? e.getAddress().join(".") : "0";
            var a = 0;
            for (var s = 0; s < i.length; s++) {
                a = (a * 31 + i.charCodeAt(s)) | 0;
            }
            return Math.abs(a);
        },
        _wiggleVector: function (e, t, r) {
            var i = e && e.getAddress ? e.getAddress().join(".") : "0";
            var a = 0;
            for (var s = 0; s < i.length; s++) {
                a = (a * 31 + i.charCodeAt(s)) | 0;
            }
            var n = 1000 + (a % 9000) + (r === undefined ? 0 : r) * 7919;
            var o = [1, 3];
            return [
                this.random((n * 12.9898 + t * 78.233) * o[0]) * 2 - 1,
                this.random((n * 26.651 + t * 51.777) * o[1]) * 2 - 1,
                this.random((n * 39.346 + t * 11.135) * o[0] * o[1]) * 2 - 1,
            ];
        },
        loopIn: function (e, t, r, i) {
            return e;
        },
        loopOut: function (e, t, r, i) {
            return e;
        },
        pingPong: function (e, t, r, i) {
            return e;
        },
        toFixed: function (e, t) {
            return Number(e).toFixed(t === undefined ? 0 : t);
        },
        radiansToDegrees: function (e) {
            return (e * 180) / Math.PI;
        },
        degreesToRadians: function (e) {
            return (e * Math.PI) / 180;
        },
        easeIn: function (e, t, r) {
            return PZ.tween.easing.Quadratic.In(e);
        },
        easeOut: function (e, t, r) {
            return PZ.tween.easing.Quadratic.Out(e);
        },
        easeInOut: function (e, t, r) {
            return PZ.tween.easing.Quadratic.InOut(e);
        },
    };


    // OpenZoid getBaseValue implementations, transcribed verbatim: the
    // expression-free value of a property, backing currentValue and
    // valueAtTime(). Installed missing-only onto the dynamic property
    // prototypes alongside the expression methods.
    T.getBaseValueImpls = {
        dynamic: function (e) {
            return undefined;
        },
        group: function (e) {
            for (var t = 0; t < this.objects.length; t++) {
                this.value[t] = this.objects[t].getBaseValue(e);
            }
            return this.value;
        },
        keyframes: function (e) {
            var t,
                r = this.getClosestKeyframeIndex(e),
                i = this.keyframes[r];
            if (i.frame > e && r > 0) (t = i), (i = this.keyframes[--r]);
            else {
                if (!(i.frame < e)) return i.value;
                t = this.keyframes[r + 1];
            }
            if (!t || null === PZ.tween.easingList[255 & t.tween].fn) return i.value;
            var a = Math.max((e - i.frame) / (t.frame - i.frame), 0),
                s = PZ.tween.easingList[255 & t.tween].fn(a);
            if (t.tween >> 8 == 1) {
                var r2,
                    a2 = PZ.property.dynamic.keyframes.o,
                    s2 = PZ.tween.correctCurve(i, t);
                return (r2 = PZ.tween.findZero(
                    e,
                    i.frame,
                    i.controlPoints[1][0] * s2 + i.frame,
                    t.controlPoints[0][0] * s2 + t.frame,
                    t.frame,
                    a2
                )
                    ? PZ.tween.bezier(
                          i.value,
                          i.controlPoints[1][1] * s2 + i.value,
                          t.controlPoints[0][1] * s2 + t.value,
                          t.value,
                          a2[0]
                      )
                    : i.value);
            }
            return PZ.tween.linear(i.value, t.value, s);
        },
    };
    T._expressionWiring = null;

    // Installs the OpenZoid expression upgrade into a live PZ runtime:
    // missing expression methods plus the evaluation context and the
    // property passthrough it depends on. Methods install missing-only;
    // evaluate/getters chain with revive and restore on uninstall.
    T.installExpressionSupport = function (PZ) {
        var methods = PZ.expression && PZ.expression.methods;
        if (!methods) {
            throw new Error("Trapcode Suite needs PZ.expression.methods from the CM3 runtime.");
        }
        var wiring = { keys: [], evaluate: null, getters: [] };
        var table = T.expressionMethods || {};
        var key;
        for (key in table) {
            if (!Object.prototype.hasOwnProperty.call(table, key)) continue;
            try {
                if (typeof methods[key] !== "function") {
                    methods[key] = table[key];
                    wiring.keys.push(key);
                }
            } catch (err) { /* best effort per key */ }
        }
        var proto = PZ.expression && PZ.expression.prototype;
        if (!proto || typeof proto.evaluate !== "function") {
            throw new Error("Trapcode Suite needs PZ.expression.prototype.evaluate from the CM3 runtime.");
        }
        if (proto.evaluate.__trapcodeSuite) {
            proto.evaluate.__trapcodeSuiteAlive = true;
            wiring.evaluate = proto.evaluate;
        } else {
            var originalEvaluate = proto.evaluate;
            var patchedEvaluate = function (e, t, r) {
                if (patchedEvaluate.__trapcodeSuiteAlive === false) {
                    return originalEvaluate.apply(this, arguments);
                }
                try {
                    var live = PZ.expression.methods;
                    var n;
                    try {
                        n = r && typeof r.getBaseValue === "function" ? r.getBaseValue(e) : undefined;
                    } catch (_e) {
                        n = undefined;
                    }
                    if (live) {
                        try {
                            live.currentFrame = e;
                            live.currentProperty = r || null;
                            live.currentValue = n;
                        } catch (_e) { /* context is best effort */ }
                    }
                    // OpenZoid call shape (frame, time, methods, custom,
                    // parentObject, property, baseValue). Functions compiled
                    // by the stock parser only declare the first four
                    // parameters and ignore the rest.
                    var time = 0;
                    try {
                        var clip = t && t.tryGetParentOfType && PZ.clip
                            ? T.findParent(t, PZ.clip)
                            : null;
                        time = clip ? clip.properties.time.get(e) : 0;
                    } catch (_e) { /* keep default */ }
                    var custom = {};
                    try {
                        custom = this.getCustomProperties(e, t);
                    } catch (_e) { /* keep default */ }
                    var parentObject = null;
                    try {
                        parentObject = t ? t.parentObject : null;
                    } catch (_e) { /* keep default */ }
                    return this.fn(e, time, live, custom, parentObject, r, n);
                } catch (_err) { /* fall through to stock */ }
                return originalEvaluate.apply(this, arguments);
            };
            patchedEvaluate.__trapcodeSuite = true;
            patchedEvaluate.__trapcodeSuiteAlive = true;
            patchedEvaluate.__trapcodeSuiteOriginal = originalEvaluate;
            proto.evaluate = patchedEvaluate;
            wiring.evaluate = patchedEvaluate;
        }
        var getterProtos = [];
        var baseProtos = [];
        try {
            if (PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype &&
                typeof PZ.property.dynamic.prototype.get === "function") {
                getterProtos.push(PZ.property.dynamic.prototype);
            }
            if (PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                PZ.property.dynamic.group.prototype &&
                typeof PZ.property.dynamic.group.prototype.get === "function") {
                getterProtos.push(PZ.property.dynamic.group.prototype);
            }
            if (PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                PZ.property.dynamic.keyframes.prototype &&
                typeof PZ.property.dynamic.keyframes.prototype.get === "function") {
                getterProtos.push(PZ.property.dynamic.keyframes.prototype);
            }
        } catch (_err) { /* ignore */ }
        if (!getterProtos.length) {
            throw new Error("Trapcode Suite needs dynamic property getters from the CM3 runtime.");
        }
        for (var g = 0; g < getterProtos.length; g++) {
            (function (target) {
                try {
                    if (target.get.__trapcodeSuite) {
                        target.get.__trapcodeSuiteAlive = true;
                        wiring.getters.push(target.get);
                        return;
                    }
                    var originalGet = target.get;
                    var patchedGet = function (e) {
                        if (patchedGet.__trapcodeSuiteAlive !== false &&
                            this.expression !== null && this.expression) {
                            try {
                                return this.expression.evaluate(e, this.parentObject, this);
                            } catch (_err) { /* fall through to stock */ }
                        }
                        return originalGet.call(this, e);
                    };
                    patchedGet.__trapcodeSuite = true;
                    patchedGet.__trapcodeSuiteAlive = true;
                    patchedGet.__trapcodeSuiteOriginal = originalGet;
                    target.get = patchedGet;
                    wiring.getters.push(patchedGet);
                } catch (_err) { /* best effort per getter */ }
            })(getterProtos[g]);
        }
        // Expression-free base values backing currentValue/valueAtTime.
        var baseImpls = T.getBaseValueImpls || {};
        var baseKinds = ["dynamic", "group", "keyframes"];
        var baseHolders = [
            PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype,
            PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                PZ.property.dynamic.group.prototype,
            PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                PZ.property.dynamic.keyframes.prototype,
        ];
        wiring.baseValues = [];
        for (var b = 0; b < baseHolders.length; b++) {
            try {
                // Own-property check: subclasses inherit the base
                // implementation, which must not shadow their own.
                if (baseHolders[b] && !Object.prototype.hasOwnProperty.call(baseHolders[b], "getBaseValue") &&
                    typeof baseImpls[baseKinds[b]] === "function") {
                    baseHolders[b].getBaseValue = baseImpls[baseKinds[b]];
                    wiring.baseValues.push(baseKinds[b]);
                }
            } catch (_err) { /* best effort per prototype */ }
        }
        T._expressionWiring = wiring;
    };

    T.uninstallExpressionSupport = function (PZ) {
        var wiring = T._expressionWiring;
        T._expressionWiring = null;
        if (!wiring) return;
        var i, ref;
        var refs = [wiring.evaluate].concat(wiring.getters || []);
        for (i = 0; i < refs.length; i++) {
            try {
                if (refs[i]) refs[i].__trapcodeSuiteAlive = false;
            } catch (_error) { /* best effort */ }
        }
        try {
            if (PZ && PZ.expression && PZ.expression.prototype &&
                wiring.evaluate && PZ.expression.prototype.evaluate === wiring.evaluate &&
                wiring.evaluate.__trapcodeSuiteOriginal) {
                PZ.expression.prototype.evaluate = wiring.evaluate.__trapcodeSuiteOriginal;
            }
        } catch (_error) { /* best effort */ }
        var protos = [];
        try {
            if (PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype) {
                protos.push(PZ.property.dynamic.prototype);
            }
            if (PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                PZ.property.dynamic.group.prototype) {
                protos.push(PZ.property.dynamic.group.prototype);
            }
            if (PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                PZ.property.dynamic.keyframes.prototype) {
                protos.push(PZ.property.dynamic.keyframes.prototype);
            }
        } catch (_error) { /* best effort */ }
        for (i = 0; i < protos.length; i++) {
            try {
                for (var g = 0; g < (wiring.getters || []).length; g++) {
                    ref = wiring.getters[g];
                    if (protos[i].get === ref && ref.__trapcodeSuiteOriginal) {
                        protos[i].get = ref.__trapcodeSuiteOriginal;
                        break;
                    }
                }
            } catch (_error) { /* best effort */ }
        }
        try {
            var methods = PZ && PZ.expression && PZ.expression.methods;
            var table = T.expressionMethods || {};
            for (i = 0; i < (wiring.keys || []).length; i++) {
                try {
                    if (methods && methods[wiring.keys[i]] === table[wiring.keys[i]]) {
                        delete methods[wiring.keys[i]];
                    }
                } catch (_error) { /* best effort per key */ }
            }
        } catch (_error) { /* best effort */ }
        try {
            var impls = T.getBaseValueImpls || {};
            var kinds = ["dynamic", "group", "keyframes"];
            var holders = [
                PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype,
                PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                    PZ.property.dynamic.group.prototype,
                PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                    PZ.property.dynamic.keyframes.prototype,
            ];
            for (i = 0; i < kinds.length; i++) {
                try {
                    if ((wiring.baseValues || []).indexOf(kinds[i]) >= 0 &&
                        holders[i] && holders[i].getBaseValue === impls[kinds[i]]) {
                        delete holders[i].getBaseValue;
                    }
                } catch (_error) { /* best effort per prototype */ }
            }
        } catch (_error) { /* best effort */ }
    };
})();
