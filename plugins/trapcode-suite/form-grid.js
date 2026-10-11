// OpenZoid Trapcode Suite — Form base lattice and asset sampling.
/*
 * form-grid.js
 *
 * The Form base lattice: grid counts, base signatures, asset
 * requests, lattice samplers (box, sphere, cylinder, circle,
 * plane), model/mask sampling, and the shared sampling math
 * (noise, layer-map sampling, scratch buffers) exposed through
 * T.formSampling for form-fields.js. The methods extend
 * PZ.object3d.form.instance, defined in form.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

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
    // Shared Form 3D value noise (zoidium/shared/random.js). Pinned
    // bit-for-bit by test/migrate-shared-pins.test.js.
    function hash3(x, y, z, seed) {
        return ZoidiumPluginApis.random.formHash3(x, y, z, seed);
    }

    function smoothNoise(x, y, z, seed) {
        return ZoidiumPluginApis.random.formSmoothNoise(x, y, z, seed);
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


    // Shared with form-fields.js, which loads after this file.
    T.formSampling = {
        rand: rand,
        clamp01: clamp01,
        hash3: hash3,
        smoothNoise: smoothNoise,
        fbm: fbm,
        sampleMap: sampleMap,
        MAP_RGBA: MAP_RGBA,
        SPHERE_OUT: SPHERE_OUT,
    };

    PZ.object3d.form.instance.prototype.gridCounts = function () {
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
    };
    // Everything that shapes the base lattice. Asset status is part of the
    // signature, so the lattice rebuilds once a model or mask settles.
    PZ.object3d.form.instance.prototype.baseSignature = function (counts) {
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
    };
    // Asset requests for the current frame. Loads start here; the entries
    // are returned so prepare() can wait on them.
    PZ.object3d.form.instance.prototype.requestAssets = function () {
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
        // Decoded audio for the reactors (offline analysis, never live).
        // Requested only while at least one reactor is on.
        var formAudio = this.properties.audio;
        if (formAudio && this.audioReactorsOn(t)) {
            var audioProject = T.findParent(this, PZ.project);
            entries.push(this._assets.request("audio", formAudio.audioLayer.get(t), function (value) {
                return T.audioAnalysis.load(audioProject, value).then(function () { return true; }, function () { return null; });
            }));
        }
        return entries.filter(Boolean);
    };
    // Called when any asset settles: re-run the frame that was last shown.
    PZ.object3d.form.instance.prototype.assetSettled = function () {
        if (this._time !== undefined && this.material) this.update(this._time);
    };
    // True while at least one audio reactor is switched on.
    PZ.object3d.form.instance.prototype.audioReactorsOn = function (t) {
        var audio = this.properties.audio;
        if (!audio) return false;
        for (var i = 1; i <= 5; i++) {
            if (audio["reactor" + i] && audio["reactor" + i].get(t) === 1) return true;
        }
        return false;
    };
    PZ.object3d.form.instance.prototype.sceneRate = function () {
        var sequence = T.findParent(this, PZ.sequence);
        return sequence ? sequence.properties.rate.get(PZ.trapcode.currentTime) || 1 : 1;
    };
    // Deterministic audio level 0..1 for project frame e from the offline
    // analysis (T.audioAnalysis, decoded in prepare()). Neutral 0 while no
    // reactor is on, while no layer is picked, while the clip time falls
    // outside the media, or while the source is not decoded yet. A pure
    // function of the decoded samples and the media time: shuffled frame
    // order, scrub direction and repeated redraws all read the same level.
    PZ.object3d.form.instance.prototype.audioLevel = function (e) {
        var t = PZ.trapcode.currentTime;
        var audio = this.properties.audio;
        if (!audio || !this.audioReactorsOn(t)) return 0;
        var source = audio.audioLayer.get(t);
        if (!source) return 0;
        var media = T.audioClipTime(this, source, e, this.sceneRate());
        if (!(media >= 0)) return 0;
        var level = T.audioAnalysis.levelAt(source, media);
        if (level === null || !(level >= 0)) return 0;
        return Math.min(1, level);
    };
    // Rebuilds the particle attributes for a new grid size.
    PZ.object3d.form.instance.prototype.ensureGeometry = function (count) {
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
    };
    // Fills basePositions for the current grid and base type.
    PZ.object3d.form.instance.prototype.fillBase = function (counts) {
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
    };
    PZ.object3d.form.instance.prototype.rebuildBase = function (counts, signature) {
        this.ensureGeometry(counts[0] * counts[1] * counts[2]);
        this.fillBase(counts);
        this._baseSig = signature;
    };
    PZ.object3d.form.instance.prototype.sampleModel = function (count, size, vertices) {
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
    };
    PZ.object3d.form.instance.prototype.sampleMask = function (count, size, sample) {
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
    };
})();
