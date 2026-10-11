// OpenZoid Trapcode Suite — Plexus object class and property schema.
/*
 * plexus-object.js
 *
 * One Plexus object: a geometry source (layers, paths, OBJ
 * mesh, primitives, instances, slicer), an effector, or a
 * renderer, with its property schema.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var KIND_GEOMETRY = 0;
    var KIND_EFFECTOR = 1;
    var KIND_RENDERER = 2;
    var rand = T.plexusUtil.rand;
    var numberOr = T.plexusUtil.numberOr;
    var clamp = T.plexusUtil.clamp;
    var fbm2 = T.plexusUtil.fbm2;
    var computeBounds = T.plexusGeometry.computeBounds;
    var loadMeshVertices = T.plexusGeometry.loadMeshVertices;

    PZ.object3d.plexus.object = class extends PZ.object {
        static create() {
            return new PZ.object3d.plexus.object();
        }
        constructor() {
            super();
            this.plexus = null;
            this.objectKind = KIND_GEOMETRY;
            this.subType = 0;
            this._assets = new T.AssetCache(this.assetSettled.bind(this));
            this._sourceKey = null;
            this._sourcePoints = null;
            this.properties = new PZ.propertyList(
                {
                    name: PZ.property.create(PZ.object3d.plexus.object.propertyDefinitions.name),
                    common: new PZ.propertyList(PZ.object3d.plexus.object.commonDefinitions),
                    geometry: new PZ.propertyList(PZ.object3d.plexus.object.geometryDefinitions),
                    effector: new PZ.propertyList(PZ.object3d.plexus.object.effectorDefinitions),
                    renderer: new PZ.propertyList(PZ.object3d.plexus.object.rendererDefinitions),
                },
                this
            );
            var groups = {
                common: "Object",
                geometry: "Geometry",
                effector: "Effector",
                renderer: "Renderer",
            };
            for (var g in groups) {
                Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
            }
            this.children = [this.properties];
        }
        assetSettled() {
            if (this.plexus) this.plexus.assetSettled();
        }
        isGeometry() {
            return this.objectKind === KIND_GEOMETRY;
        }
        isEffector() {
            return this.objectKind === KIND_EFFECTOR;
        }
        isRenderer() {
            return this.objectKind === KIND_RENDERER;
        }
        applyPreset(name) {
            var c = this.properties.common;
            var g = this.properties.geometry;
            var r = this.properties.renderer;
            if (name === "primitives") {
                this.objectKind = KIND_GEOMETRY;
                this.subType = 3;
                g.geometryType.set(3);
                g.primitiveShape.set(0);
                g.primitiveCount.set(200);
                g.primitiveSize.set([500, 500, 500]);
                c.name.set("Primitives");
            } else if (name === "lines") {
                this.objectKind = KIND_RENDERER;
                this.subType = 1;
                r.rendererType.set(1);
                r.lineType.set(0);
                r.maxDistance.set(200);
                r.maxConnections.set(5);
                c.name.set("Lines");
            } else if (name === "points") {
                this.objectKind = KIND_RENDERER;
                this.subType = 0;
                r.rendererType.set(0);
                r.size.set(4);
                c.name.set("Points");
            } else if (name === "facets") {
                this.objectKind = KIND_RENDERER;
                this.subType = 2;
                r.rendererType.set(2);
                c.name.set("Facets");
            } else if (name === "triangulation") {
                this.objectKind = KIND_RENDERER;
                this.subType = 3;
                r.rendererType.set(3);
                r.opacity.set(35);
                r.maxDistance.set(100);
                c.name.set("Triangulation");
            } else if (name === "beams") {
                this.objectKind = KIND_RENDERER;
                this.subType = 4;
                r.rendererType.set(4);
                c.name.set("Beams");
            } else if (name === "noise") {
                this.objectKind = KIND_EFFECTOR;
                this.subType = 0;
                this.properties.effector.effectorType.set(0);
                this.properties.effector.noiseAmount.set(40);
                this.properties.effector.noiseScale.set(1);
                c.name.set("Noise");
            } else if (name === "spherical") {
                this.objectKind = KIND_EFFECTOR;
                this.subType = 1;
                this.properties.effector.effectorType.set(1);
                this.properties.effector.strength.set(50);
                this.properties.effector.radius.set(300);
                c.name.set("Spherical Field");
            }
            c.enabled.set(1);
        }
        // Asset requests for the current frame: a layer image or OBJ mesh for
        // geometry sources, an audio layer for the sound effector.
        requestAssets() {
            var out = [];
            var t = PZ.trapcode.currentTime;
            if (this.properties.common.enabled.get(t) !== 1) return out;
            if (this.isEffector()) {
                if (Math.round(this.properties.effector.effectorType.get(t)) !== 6) return out;
                var audioValue = this.properties.effector.audioLayer.get(t);
                var audioProject = T.findParent(this, PZ.project);
                var audioEntry = this._assets.request("audio", audioValue, function (value) {
                    return T.audioAnalysis.load(audioProject, value).then(function () { return true; }, function () { return null; });
                });
                if (audioEntry) out.push(audioEntry);
                return out;
            }
            if (!this.isGeometry()) return out;
            var g = this.properties.geometry;
            var type = g.geometryType.get(t);
            var project = T.findParent(this, PZ.project);
            var entry = null;
            if (type === 0) {
                entry = this._assets.request("layer", g.imageLayer.get(t), function (value) {
                    return T.sampleImageAsset(project, value, 256);
                });
            } else if (type === 2) {
                entry = this._assets.request("obj", g.objFile.get(t), function (value) {
                    return loadMeshVertices(project, value);
                });
            }
            if (entry) out.push(entry);
            return out;
        }
        // Source points as a flat xyz Float32Array, cached until the inputs
        // (properties at this time and asset status) change. Callers must not
        // modify the returned array.
        sourcePoints() {
            var t = PZ.trapcode.currentTime;
            var g = this.properties.geometry;
            var type = g.geometryType.get(t);
            var key = this.sourceKey(type);
            if (this._sourcePoints && this._sourceKey === key) return this._sourcePoints;
            var points = this.generatePoints(type);
            var flat = new Float32Array(points.length * 3);
            for (var i = 0; i < points.length; i++) {
                flat[i * 3] = points[i][0];
                flat[i * 3 + 1] = points[i][1];
                flat[i * 3 + 2] = points[i][2];
            }
            this._sourceKey = key;
            this._sourcePoints = flat;
            return flat;
        }
        sourceKey(type) {
            var t = PZ.trapcode.currentTime;
            var g = this.properties.geometry;
            var parts = [
                type,
                g.primitiveCount.get(t),
                g.randomSeed.get(t),
                g.primitiveShape.get(t),
                g.primitiveSize.get(t).join(","),
                g.position.get(t).join(","),
                g.pathTurns.get(t),
            ];
            if (type === 0) {
                var layer = g.imageLayer.get(t);
                parts.push(layer, this._assets.status("layer", layer));
            } else if (type === 2) {
                var mesh = g.objFile.get(t);
                parts.push(mesh, this._assets.status("obj", mesh));
            }
            return parts.join("|");
        }
        generatePoints(type) {
            var t = PZ.trapcode.currentTime;
            var g = this.properties.geometry;
            var count = clamp(Math.max(0, Math.round(g.primitiveCount.get(t))), 0, 60000);
            if (!count) return [];
            var seed = g.randomSeed.get(t);
            var size = g.primitiveSize.get(t);
            var offset = g.position.get(t);
            var points;
            if (type === 0) {
                points = this.sampleImage(count, size, seed);
            } else if (type === 1) {
                points = this.generatePath(count, size, g);
            } else if (type === 2) {
                points = this.sampleOBJ(count, size, seed);
            } else if (type === 4) {
                points = this.generateInstances(count, size);
            } else if (type === 5) {
                points = this.generateSlicer(count, size);
            } else {
                points = this.generatePrimitive(count, seed, size, g.primitiveShape.get(t));
            }
            for (var i = 0; i < points.length; i++) {
                points[i][0] += offset[0];
                points[i][1] += offset[1];
                points[i][2] += offset[2];
            }
            return points;
        }
        generatePrimitive(count, seed, size, shape) {
            var points = [];
            var i;
            if (!count || count <= 0) return points;
            if (shape === 0) {
                // box: structured 3D lattice filling the full Size volume.
                // Size is the volume scale, Count is density (independent).
                var perAxis = Math.max(1, Math.round(Math.cbrt(count)));
                var total = perAxis * perAxis * perAxis;
                for (i = 0; i < total && points.length < count; i++) {
                    var ix = i % perAxis;
                    var iy = Math.floor(i / perAxis) % perAxis;
                    var iz = Math.floor(i / (perAxis * perAxis));
                    points.push([
                        perAxis > 1 ? (ix / (perAxis - 1) - 0.5) * size[0] : 0,
                        perAxis > 1 ? (iy / (perAxis - 1) - 0.5) * size[1] : 0,
                        perAxis > 1 ? (iz / (perAxis - 1) - 0.5) * size[2] : 0,
                    ]);
                }
            } else if (shape === 1) {
                // sphere: fibonacci shell
                var radius = (size[0] + size[1] + size[2]) / 6;
                var golden = Math.PI * (1 + Math.sqrt(5));
                for (i = 0; i < count; i++) {
                    var phi = Math.acos(1 - (2 * (i + 0.5)) / count);
                    var theta = golden * i;
                    points.push([
                        Math.sin(phi) * Math.cos(theta) * radius,
                        Math.cos(phi) * radius,
                        Math.sin(phi) * Math.sin(theta) * radius,
                    ]);
                }
            } else if (shape === 2) {
                // cylinder: stacked rings around the Y axis
                var cRadius = size[0] / 2;
                var height = size[1];
                var rings = Math.max(1, Math.round(Math.sqrt(count / 3)));
                var perRing = Math.max(1, Math.ceil(count / rings));
                for (i = 0; i < count; i++) {
                    var ring = Math.floor(i / perRing);
                    var seg = i % perRing;
                    var angle = (seg / perRing) * Math.PI * 2;
                    var y = rings > 1 ? (ring / (rings - 1) - 0.5) * height : 0;
                    points.push([Math.cos(angle) * cRadius, y, Math.sin(angle) * cRadius]);
                }
            } else if (shape === 3) {
                // plane: grid on the X/Z plane (horizontal, good for terrain)
                var cols = Math.max(1, Math.round(Math.sqrt(count)));
                var rows = Math.max(1, Math.ceil(count / cols));
                for (i = 0; i < count; i++) {
                    var cx = i % cols;
                    var cy = Math.floor(i / cols);
                    points.push([
                        cols > 1 ? (cx / (cols - 1) - 0.5) * size[0] : 0,
                        0,
                        rows > 1 ? (cy / (rows - 1) - 0.5) * size[2] : 0,
                    ]);
                }
            } else {
                // ring: concentric circles in the X/Z plane
                var outer = size[0] / 2;
                var inner = outer * 0.65;
                var spokes = Math.max(3, Math.round(Math.sqrt(count * 2)));
                var circles = Math.max(1, Math.ceil(count / spokes));
                for (i = 0; i < count; i++) {
                    var ci = Math.floor(i / spokes);
                    var si = i % spokes;
                    var r = circles > 1 ? inner + (outer - inner) * (ci / (circles - 1)) : outer;
                    var ang = (si / spokes) * Math.PI * 2;
                    points.push([Math.cos(ang) * r, 0, Math.sin(ang) * r]);
                }
            }
            return points;
        }
        generatePath(count, size, g) {
            var points = [];
            if (!count || count <= 0) return points;
            var rawTurns = 3;
            try {
                if (g && g.pathTurns) rawTurns = g.pathTurns.get(PZ.trapcode.currentTime);
            } catch (err) { /* keep default */ }
            // 0 turns is a straight radial line.
            var turns = Math.max(0, Math.round(rawTurns));
            var sx = (size && size[0] !== undefined) ? Math.abs(size[0]) : 500;
            var sy = (size && size[1] !== undefined) ? size[1] : 500;
            var sz = (size && size[2] !== undefined) ? Math.abs(size[2]) : 500;
            var radius = (sx + sz) / 4;
            if (!(radius > 0.001)) radius = 100;
            for (var i = 0; i < count; i++) {
                var t = count > 1 ? i / (count - 1) : 0;
                var angle = t * Math.PI * 2 * turns;
                var r = radius * (0.4 + 0.6 * t);
                points.push([Math.cos(angle) * r, (t - 0.5) * sy, Math.sin(angle) * r]);
            }
            return points;
        }
        generateInstances(count, size) {
            var points = [];
            if (!count || count <= 0) return points;
            var perAxis = Math.max(1, Math.round(Math.cbrt(count)));
            for (var i = 0; i < count; i++) {
                var ix = i % perAxis;
                var iy = Math.floor(i / perAxis) % perAxis;
                var iz = Math.floor(i / (perAxis * perAxis));
                points.push([
                    perAxis > 1 ? (ix / (perAxis - 1) - 0.5) * size[0] : 0,
                    perAxis > 1 ? (iy / (perAxis - 1) - 0.5) * size[1] : 0,
                    perAxis > 1 ? (iz / (perAxis - 1) - 0.5) * size[2] : 0,
                ]);
            }
            return points;
        }
        generateSlicer(count, size) {
            var points = [];
            var bands = Math.max(1, Math.round(Math.sqrt(count)));
            var perBand = Math.max(1, Math.floor(count / bands));
            for (var i = 0; i < bands; i++) {
                var y = (i / (bands - 1 || 1) - 0.5) * size[1];
                for (var j = 0; j < perBand; j++) {
                    var x = (j / (perBand - 1 || 1) - 0.5) * size[0];
                    points.push([x, y, (rand(i * 31 + j) - 0.5) * size[2]]);
                }
            }
            return points;
        }
        sampleImage(count, size, seed) {
            var t = PZ.trapcode.currentTime;
            var sample = this._assets.ready("layer", this.properties.geometry.imageLayer.get(t));
            if (!sample) return this.generatePrimitive(count, seed, size, 1);
            var points = [];
            var attempts = 0;
            while (points.length < count && attempts < count * 20) {
                attempts++;
                var x = Math.floor(rand(points.length * 3 + attempts) * sample.width);
                var y = Math.floor(rand(points.length * 7 + attempts) * sample.height);
                var index = (y * sample.width + x) * 4;
                if (sample.data[index + 3] > 20) {
                    points.push([
                        (x / sample.width - 0.5) * size[0],
                        (0.5 - y / sample.height) * size[1],
                        (sample.data[index] / 255 - 0.5) * size[2],
                    ]);
                }
            }
            return points;
        }
        sampleOBJ(count, size, seed) {
            var t = PZ.trapcode.currentTime;
            var source = this._assets.ready("obj", this.properties.geometry.objFile.get(t));
            if (!source || source.length < 3) return this.generatePrimitive(count, seed, size, 1);
            var vertexCount = source.length / 3;
            // Normalize OBJ bounds to [-0.5, 0.5] so Size maps predictably
            // regardless of the .obj authoring scale.
            var bounds = computeBounds(source);
            var spanX = Math.max(bounds.maxX - bounds.minX, 0.0001);
            var spanY = Math.max(bounds.maxY - bounds.minY, 0.0001);
            var spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.0001);
            var cx = (bounds.minX + bounds.maxX) / 2;
            var cy = (bounds.minY + bounds.maxY) / 2;
            var cz = (bounds.minZ + bounds.maxZ) / 2;
            var sx = size[0] !== undefined ? size[0] : 500;
            var sy = size[1] !== undefined ? size[1] : 500;
            var sz = size[2] !== undefined ? size[2] : 500;
            var points = [];
            for (var i = 0; i < count; i++) {
                // Prime stride spreads samples evenly even for small counts.
                var vi = (i * 7919) % vertexCount;
                points.push([
                    ((source[vi * 3] - cx) / spanX) * sx,
                    ((source[vi * 3 + 1] - cy) / spanY) * sy,
                    ((source[vi * 3 + 2] - cz) / spanZ) * sz,
                ]);
            }
            return points;
        }
        // Effector pass over the flat work buffer (positions and colors).
        // Amount is the overall master strength (donor intent): 100 leaves
        // every effector exactly as its own strength control says.
        applyTo(pos, col, count) {
            var t = PZ.trapcode.currentTime;
            var e = this.properties.effector;
            var effType = Math.max(0, Math.round(e.effectorType.get(t)));
            var amt = numberOr(e.amount, t, 100) / 100;
            if (!(amt > 0)) amt = 0;
            if (effType === 0) {
                this.applyNoise(pos, count, e, amt);
            } else if (effType === 1) {
                this.applySpherical(pos, count, e.strength.get(t) / 100 * amt, e.position.get(t), e.radius.get(t));
            } else if (effType === 2) {
                this.applyContainer(pos, count, e);
            } else if (effType === 3) {
                this.applyTransform(pos, count, e, amt);
            } else if (effType === 4) {
                this.applyColorMap(pos, col, count, e);
            } else if (effType === 5) {
                this.applyShade(pos, col, count, e);
            } else if (effType === 6) {
                this.applySound(pos, count, e, amt);
            }
        }
        applyNoise(pos, count, e, amt) {
            var t = PZ.trapcode.currentTime;
            var amount = e.noiseAmount.get(t) * (amt === undefined ? 1 : amt);
            var scale = Math.max(e.noiseScale.get(t), 0.0001);
            var flow = t * 0.05;
            for (var i = 0; i < count; i++) {
                var n = fbm2(pos[i * 3] * 0.01 / scale, pos[i * 3 + 2] * 0.01 / scale + flow, 0);
                pos[i * 3 + 1] += n * amount;
            }
        }
        applySpherical(pos, count, strength, center, radius) {
            radius = Math.max(radius, 0.0001);
            strength = Math.max(-4, Math.min(4, strength));
            for (var i = 0; i < count; i++) {
                var dx = pos[i * 3] - center[0];
                var dy = pos[i * 3 + 1] - center[1];
                var dz = pos[i * 3 + 2] - center[2];
                var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist < 0.0001) {
                    // Push degenerate points out along X so strength is visible.
                    pos[i * 3] = center[0] + radius * 0.05 * (strength >= 0 ? 1 : -1);
                    continue;
                }
                // Visible falloff: full strength at center, zero at radius.
                var falloff = Math.max(0, 1 - dist / radius);
                var f = 1 + strength * falloff;
                // Outside the radius keep a gentle push so large clouds still move.
                if (falloff <= 0) f = 1 + strength * (radius / dist) * 0.1;
                pos[i * 3] = center[0] + dx * f;
                pos[i * 3 + 1] = center[1] + dy * f;
                pos[i * 3 + 2] = center[2] + dz * f;
            }
        }
        applyContainer(pos, count, e) {
            var t = PZ.trapcode.currentTime;
            var center = e.position.get(t);
            var half = e.containerSize.get(t);
            for (var i = 0; i < count; i++) {
                for (var axis = 0; axis < 3; axis++) {
                    var halfSize = Math.max(half[axis] / 2, 0.0001);
                    var min = center[axis] - halfSize;
                    var max = center[axis] + halfSize;
                    var k = i * 3 + axis;
                    if (pos[k] < min) pos[k] = min;
                    else if (pos[k] > max) pos[k] = max;
                }
            }
        }
        applyTransform(pos, count, e, amt) {
            var t = PZ.trapcode.currentTime;
            if (amt === undefined) amt = 1;
            var scale = 1 + (e.transformScale.get(t) / 100 - 1) * amt;
            var rotation = e.transformRotation.get(t);
            var rx = (rotation[0] * amt * Math.PI) / 180;
            var ry = (rotation[1] * amt * Math.PI) / 180;
            var rz = (rotation[2] * amt * Math.PI) / 180;
            var cx = Math.cos(rx);
            var sx = Math.sin(rx);
            var cy = Math.cos(ry);
            var sy = Math.sin(ry);
            var cz = Math.cos(rz);
            var sz = Math.sin(rz);
            var offset = e.position.get(t);
            for (var i = 0; i < count; i++) {
                var x = pos[i * 3] * scale;
                var y = pos[i * 3 + 1] * scale;
                var z = pos[i * 3 + 2] * scale;
                var t1 = y * cx - z * sx;
                var t2 = y * sx + z * cx;
                y = t1;
                z = t2;
                t1 = x * cy + z * sy;
                t2 = -x * sy + z * cy;
                x = t1;
                z = t2;
                t1 = x * cz - y * sz;
                t2 = x * sz + y * cz;
                x = t1;
                y = t2;
                pos[i * 3] = x + offset[0] * amt;
                pos[i * 3 + 1] = y + offset[1] * amt;
                pos[i * 3 + 2] = z + offset[2] * amt;
            }
        }
        applyColorMap(pos, col, count, e) {
            var t = PZ.trapcode.currentTime;
            var mode = e.colorMapMode.get(t);
            var a = e.color.get(t);
            var b = e.color2 ? e.color2.get(t) : [1, 1, 1];
            for (var i = 0; i < count; i++) {
                var value;
                if (mode === 0) value = i / Math.max(count - 1, 1);
                else if (mode === 1) value = pos[i * 3 + 1] * 0.001 + 0.5;
                else value = Math.sqrt(pos[i * 3] * pos[i * 3] + pos[i * 3 + 1] * pos[i * 3 + 1] + pos[i * 3 + 2] * pos[i * 3 + 2]) * 0.001;
                value = clamp(value, 0, 1);
                col[i * 3] = a[0] + (b[0] - a[0]) * value;
                col[i * 3 + 1] = a[1] + (b[1] - a[1]) * value;
                col[i * 3 + 2] = a[2] + (b[2] - a[2]) * value;
            }
        }
        applyShade(pos, col, count, e) {
            var a = e.color.get(PZ.trapcode.currentTime);
            for (var i = 0; i < count; i++) {
                var dist = Math.sqrt(pos[i * 3] * pos[i * 3] + pos[i * 3 + 1] * pos[i * 3 + 1] + pos[i * 3 + 2] * pos[i * 3 + 2]);
                var shade = clamp(1 - dist / 800, 0.1, 1);
                col[i * 3] = a[0] * shade;
                col[i * 3 + 1] = a[1] * shade;
                col[i * 3 + 2] = a[2] * shade;
            }
        }
        // Without an audio layer the level is a time-based wave. With one, it is
        // the offline analysis at the media time (T.audioAnalysis, decoded in
        // prepare()); 0.5 while the source is not decoded yet, as in Particular.
        applySound(pos, count, e, amt) {
            var t = PZ.trapcode.currentTime;
            if (amt === undefined) amt = 1;
            var audioValue = e.audioLayer ? e.audioLayer.get(t) : null;
            var level = 0.5 + Math.sin(t * 0.1) * 0.5;
            if (audioValue) {
                // Same clip mapping as Particular: offset shifts the clip start,
                // trim in/out select the media range; silence outside it.
                var local = t / this.sceneRate() - numberOr(e.audioOffset, t, 0);
                var trimIn = Math.max(numberOr(e.audioTrimIn, t, 0), 0);
                var trimOut = Math.max(numberOr(e.audioTrimOut, t, 0), 0);
                var media = trimIn + local;
                if (local < 0 || (trimOut > 0 && media >= trimOut)) {
                    level = 0;
                } else {
                    var analysed = T.audioAnalysis.levelAt(audioValue, Math.max(0, media));
                    level = analysed === null ? 0.5 : analysed;
                }
            }
            var strength = e.soundStrength ? e.soundStrength.get(t) : 100;
            var scale = 1 + clamp(level, 0, 1) * (strength / 100) * amt;
            for (var i = 0; i < count * 3; i++) pos[i] *= scale;
        }
        sceneRate() {
            var sequence = T.findParent(this, PZ.sequence);
            return sequence ? sequence.properties.rate.get(PZ.trapcode.currentTime) || 1 : 1;
        }
        applyToState(state) {
            var t = PZ.trapcode.currentTime;
            var r = this.properties.renderer;
            var color = r.color.get(t);
            state.color = [color[0], color[1], color[2]];
            state.opacity = r.opacity.get(t);
            var type = r.rendererType.get(t);
            if (type === 0) {
                state.points = true;
                state.size = Math.max(0, Math.min(10, r.size.get(t)));
            } else if (type === 1) {
                state.lines = true;
                state.lineType = Math.max(0, Math.min(2, Math.round(r.lineType.get(t))));
                state.maxDistance = Math.max(0, r.maxDistance.get(t));
                state.maxConnections = Math.max(0, Math.min(10, Math.round(r.maxConnections.get(t))));
            } else if (type === 2) {
                state.mesh = true;
                state.maxDistance = Math.max(0, r.maxDistance.get(t));
                state.maxConnections = Math.max(0, Math.min(10, Math.round(r.maxConnections.get(t))));
                state.ambient = r.ambient.get(t) / 100;
                state.diffuse = r.diffuse.get(t) / 100;
                state.specular = r.specular.get(t) / 100;
            } else if (type === 3) {
                state.triangulation = true;
                state.maxDistance = Math.max(0, r.maxDistance.get(t));
                state.ambient = r.ambient.get(t) / 100;
                state.diffuse = r.diffuse.get(t) / 100;
                state.specular = r.specular.get(t) / 100;
            } else if (type === 4) {
                state.beams = true;
                state.lineType = Math.max(0, Math.min(2, Math.round(r.lineType.get(t))));
                state.maxDistance = Math.max(0, r.maxDistance.get(t));
                state.maxConnections = Math.max(0, Math.min(10, Math.round(r.maxConnections.get(t))));
            }
        }
        load(e, parent) {
            this.plexus = parent || this.plexus;
            var oldSub = 0;
            var hasSavedType = false;
            if (e) {
                this.objectKind = e.objectKind !== undefined ? e.objectKind : KIND_GEOMETRY;
                this.subType = e.subType || 0;
                oldSub = e.subType || 0;
                hasSavedType = !!(e.properties && e.properties.geometry && e.properties.geometry.geometryType !== undefined);
            }
            this.properties.load(e && e.properties);
            var t = PZ.trapcode.currentTime;
            if (this.objectKind === KIND_GEOMETRY) {
                var type;
                if (hasSavedType) {
                    type = this.properties.geometry.geometryType.get(t);
                } else if (oldSub >= 0 && oldSub <= 5) {
                    // Fresh "Add Geometry" items already use 0..5 == geometryType.
                    type = oldSub;
                } else if (oldSub === 6) {
                    // Very old projects: 4=primitives,5=instances,6=slicer.
                    type = 5;
                } else {
                    var legacy = { 0: 0, 1: 1, 2: 2, 4: 3, 5: 4, 6: 5 };
                    type = legacy[oldSub];
                }
                if (type === undefined || type === null) type = 3;
                type = Math.max(0, Math.min(5, Math.round(type)));
                this.subType = type;
                this.properties.geometry.geometryType.set(type);
            } else if (this.objectKind === KIND_EFFECTOR) {
                var et = this.properties.effector.effectorType.get(t);
                if (et !== undefined && et !== null) this.subType = Math.max(0, Math.min(6, Math.round(et)));
            } else if (this.objectKind === KIND_RENDERER) {
                var rt = this.properties.renderer.rendererType.get(t);
                if (rt !== undefined && rt !== null) this.subType = Math.max(0, Math.min(4, Math.round(rt)));
            }
            if (!this.properties.common.name.get(t)) {
                this.properties.common.name.set(this.properties.name.get(t) || "Object");
            }
        }
        toJSON() {
            return {
                type: this.type,
                objectKind: this.objectKind,
                subType: this.subType,
                properties: this.properties,
            };
        }
        unload() {
            this._assets.clear();
            this._sourceKey = null;
            this._sourcePoints = null;
        }
    };
    PZ.object3d.plexus.object.prototype.defaultName = "Plexus Object";

    var number = T.number;
    var vector3 = T.vector3;
    var option = T.option;
    var imageAsset = T.imageAsset;

    PZ.object3d.plexus.object.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Plexus Object" },
    };

    PZ.object3d.plexus.object.commonDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Object" },
        enabled: option("Enabled", 1, "off;on", true),
    };

    PZ.object3d.plexus.object.geometryDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Geometry", visible: false },
        geometryType: option("Geometry type", 4, "layers;paths;obj;primitives;instances;slicer", true),
        primitiveShape: option("Primitive", 0, "box;sphere;cylinder;plane;ring", true),
        primitiveCount: number("Count", 200, { min: 0, max: 60000, step: 1, decimals: 0 }),
        primitiveSize: vector3("Size", [500, 500, 500], { min: 0, step: 1 }),
        position: vector3("Position", [0, 0, 0], { step: 1 }),
        pathTurns: number("Path turns", 3, { min: 0, max: 10, step: 1, decimals: 0 }),
        imageLayer: imageAsset("Layer"),
        objFile: {
            name: "OBJ file",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.GEOMETRY,
            accept: ".obj",
            value: null,
        },
        randomSeed: number("Random seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.plexus.object.effectorDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Effector", visible: false },
        effectorType: option("Effector type", 0, "noise;spherical field;container;transform;color map;shade;sound", true),
        // Overall effector amount: master strength scaling every effector
        // with a strength semantic (noise, spherical, transform, sound).
        amount: number("Amount", 100, { step: 1 }),
        noiseAmount: number("Noise amount", 40, { step: 0.1, decimals: 1 }),
        noiseScale: number("Noise scale", 1, { min: 0.0001, step: 0.01, decimals: 2 }),
        strength: number("Strength[%]", 50, { step: 1 }),
        radius: number("Radius", 300, { min: 0, step: 1 }),
        position: vector3("Position", [0, 0, 0], { step: 1 }),
        containerSize: vector3("Container size", [500, 500, 500], { min: 0, step: 1 }),
        transformScale: number("Transform scale", 100, { step: 1 }),
        transformRotation: vector3("Transform rotation", [0, 0, 0], { step: 1 }),
        colorMapMode: option("Color map by", 0, "index;height;distance", true),
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
        color2: {
            dynamic: true,
            group: true,
            objects: [
                { dynamic: true, name: "Color 2.R", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
                { dynamic: true, name: "Color 2.G", type: PZ.property.type.NUMBER, value: 0.3, min: 0, max: 1 },
                { dynamic: true, name: "Color 2.B", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            ],
            name: "Color 2",
            type: PZ.property.type.COLOR,
        },
        audioLayer: {
            name: "Audio layer",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.AV,
            accept: "audio/*,video/*",
            value: null,
        },
        audioOffset: number("Audio offset (seconds)", 0, { min: 0, step: 0.01, decimals: 3 }),
        audioTrimIn: number("Audio trim in (seconds)", 0, { min: 0, step: 0.01, decimals: 3 }),
        audioTrimOut: number("Audio trim out (seconds)", 0, { min: 0, step: 0.01, decimals: 3 }),
        soundStrength: number("Sound strength", 100, { min: 0, step: 1 }),
    };

    PZ.object3d.plexus.object.rendererDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Renderer", visible: false },
        rendererType: option("Renderer type", 1, "points;lines;facets;triangulation;beams", true),
        size: number("Point size", 4, { min: 0, max: 10, step: 0.1, decimals: 2 }),
        // Line type selects the connection mode: distance links nearby
        // points, adjacency links each point to its next points in creation
        // order, shape links nearby points only within the same source
        // object. Max connections caps the per-point count and opacity the
        // line alpha in every mode.
        lineType: option("Line type", 0, "distance;adjacency;shape", true),
        maxDistance: number("Max distance", 200, { min: 0, step: 1 }),
        maxConnections: number("Max connections", 5, { min: 0, max: 10, step: 1, decimals: 0 }),
        opacity: number("Opacity", 80, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        ambient: number("Ambient", 25, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        diffuse: number("Diffuse", 75, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specular: number("Specular", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
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
    };

})();
