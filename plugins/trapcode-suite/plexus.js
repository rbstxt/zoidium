// OpenZoid Trapcode Suite — Plexus.
/*
 * plexus.js
 *
 * A Trapcode/Plexus style object3d: one or more geometry sources generate a
 * point cloud, effectors deform it, and renderers connect the points as
 * points, lines, facets, triangulation or beams. Lives inside a normal 3D
 * Scene layer and uses the shared property system.
 *
 * Data flow per frame (all buffers are reused between frames):
 *   geometry sources  -> cached Float32Array per source (keyed by its inputs)
 *   gather            -> one work buffer of positions and colors
 *   effectors         -> in-place edits of the work buffer
 *   renderers         -> points, or links found with a spatial hash
 *
 * Link renderers only consider the first MAX_LINK_POINTS (lines) or
 * MAX_MESH_POINTS (facets, triangulation) points; the cap keeps the cost of
 * a frame bounded for very large sources.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

    var MAX_LINK_POINTS = 12000;
    var MAX_MESH_POINTS = 4000;
    var MAX_TRIANGLES = 20000;
    var MAX_NEAR = 64;

    var POINT_VERTEX = [
        "uniform vec2 resolution;",
        "uniform float size;",
        "uniform vec4 color;",
        "#ifdef USE_VCOLOR",
        "attribute vec3 vcolor;",
        "varying vec3 vVColor;",
        "#endif",
        "void main()",
        "{",
        "vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
        "gl_PointSize = max(size * resolution.y * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 1.0), 1.0);",
        "gl_Position = projectionMatrix * mvPosition;",
        "#ifdef USE_VCOLOR",
        "vVColor = vcolor;",
        "#endif",
        "}",
    ].join("\n");

    var POINT_FRAGMENT = [
        "uniform vec4 color;",
        "#ifdef USE_VCOLOR",
        "varying vec3 vVColor;",
        "#endif",
        "void main()",
        "{",
        "float d = length(gl_PointCoord - vec2(0.5));",
        "float a = smoothstep(0.5, 0.1, d);",
        "#ifdef USE_VCOLOR",
        "vec3 rgb = color.rgb * vVColor;",
        "#else",
        "vec3 rgb = color.rgb;",
        "#endif",
        "gl_FragColor = vec4(rgb, color.a * a);",
        "}",
    ].join("\n");

    var LINE_VERTEX = [
        "#ifdef USE_VCOLOR",
        "attribute vec3 vcolor;",
        "varying vec3 vVColor;",
        "#endif",
        "void main()",
        "{",
        "gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "#ifdef USE_VCOLOR",
        "vVColor = vcolor;",
        "#endif",
        "}",
    ].join("\n");

    var LINE_FRAGMENT = [
        "uniform vec4 color;",
        "#ifdef USE_VCOLOR",
        "varying vec3 vVColor;",
        "#endif",
        "void main()",
        "{",
        "#ifdef USE_VCOLOR",
        "vec3 rgb = color.rgb * vVColor;",
        "#else",
        "vec3 rgb = color.rgb;",
        "#endif",
        "gl_FragColor = vec4(rgb, color.a);",
        "}",
    ].join("\n");

    var MESH_VERTEX = [
        "varying vec3 vNormal;",
        "varying vec3 vPosition;",
        "void main()",
        "{",
        "vNormal = normalize(normalMatrix * normal);",
        "vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "vPosition = mv.xyz;",
        "gl_Position = projectionMatrix * mv;",
        "}",
    ].join("\n");

    var MESH_FRAGMENT = [
        "uniform vec4 color;",
        "uniform float ambient;",
        "uniform float diffuse;",
        "uniform float specular;",
        "varying vec3 vNormal;",
        "varying vec3 vPosition;",
        "void main()",
        "{",
        "vec3 normal = normalize(vNormal);",
        "vec3 lightDir = normalize(vec3(0.4, 0.8, 0.6));",
        "float dp = max(dot(normal, lightDir), 0.0);",
        "vec3 viewDir = normalize(-vPosition);",
        "vec3 halfDir = normalize(lightDir + viewDir);",
        "float spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * specular;",
        "vec3 rgb = color.rgb * (ambient + diffuse * dp) + vec3(spec);",
        "gl_FragColor = vec4(rgb, color.a);",
        "}",
    ].join("\n");

    function rand(seed) {
        return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    }

    // Numeric property value at a time, or the fallback when it is missing.
    function numberOr(property, time, fallback) {
        var value = property ? Number(property.get(time)) : NaN;
        return Number.isFinite(value) ? value : fallback;
    }

    function clamp(v, a, b) {
        return v < a ? a : v > b ? b : v;
    }

    function hash2(x, y, seed) {
        var n = Math.sin(x * 127.1 + y * 311.7 + seed * 13.37) * 43758.5453;
        return n - Math.floor(n);
    }

    function smoothNoise2(x, y, seed) {
        var xi = Math.floor(x);
        var yi = Math.floor(y);
        var xf = x - xi;
        var yf = y - yi;
        var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
        var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
        var c00 = hash2(xi, yi, seed);
        var c10 = hash2(xi + 1, yi, seed);
        var c01 = hash2(xi, yi + 1, seed);
        var c11 = hash2(xi + 1, yi + 1, seed);
        var a = c00 + (c10 - c00) * u;
        var b = c01 + (c11 - c01) * u;
        return (a + (b - a) * v) * 2 - 1;
    }

    function fbm2(x, y, seed) {
        var sum = 0;
        var amp = 1;
        var freq = 1;
        var norm = 0;
        for (var o = 0; o < 3; o++) {
            sum += smoothNoise2(x * freq, y * freq, seed + o * 17.3) * amp;
            norm += amp;
            amp *= 0.45;
            freq *= 2;
        }
        return norm > 0 ? sum / norm : 0;
    }

    // Spatial hash over a flat xyz buffer. Cells are cell-sized cubes; the
    // table is a power-of-two list of buckets with chained point indices, so
    // a rebuild allocates nothing once the arrays have grown.
    function SpatialGrid() {
        this.head = new Int32Array(16);
        this.next = new Int32Array(16);
        this.mask = 15;
        this.cell = 1;
        this.points = null;
        this.count = 0;
    }

    SpatialGrid.prototype.bucket = function (cx, cy, cz) {
        return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) & this.mask;
    };

    SpatialGrid.prototype.build = function (points, count, cell) {
        var size = 16;
        while (size < count * 2) size <<= 1;
        if (this.head.length < size) this.head = new Int32Array(size);
        this.head.fill(-1, 0, size);
        this.mask = size - 1;
        if (this.next.length < count) this.next = new Int32Array(Math.max(count, this.next.length * 2));
        this.points = points;
        this.count = count;
        this.cell = cell;
        for (var i = 0; i < count; i++) {
            var b = this.bucket(
                Math.floor(points[i * 3] / cell),
                Math.floor(points[i * 3 + 1] / cell),
                Math.floor(points[i * 3 + 2] / cell)
            );
            this.next[i] = this.head[b];
            this.head[b] = i;
        }
    };

    // Collects the points in the 27 cells around point i (optionally only the
    // ones with a higher index) that lie within maxDistance. Writes indices to
    // out and returns how many were written, at most `limit`.
    SpatialGrid.prototype.near = function (i, maxDistance, above, out, limit) {
        var points = this.points;
        var cell = this.cell;
        var ax = points[i * 3];
        var ay = points[i * 3 + 1];
        var az = points[i * 3 + 2];
        var cx = Math.floor(ax / cell);
        var cy = Math.floor(ay / cell);
        var cz = Math.floor(az / cell);
        var maxSq = maxDistance * maxDistance;
        var found = 0;
        for (var ox = -1; ox <= 1; ox++) {
            for (var oy = -1; oy <= 1; oy++) {
                for (var oz = -1; oz <= 1; oz++) {
                    var j = this.head[this.bucket(cx + ox, cy + oy, cz + oz)];
                    while (j >= 0 && found < limit) {
                        if (j !== i && (!above || j > i)) {
                            var px = points[j * 3];
                            var py = points[j * 3 + 1];
                            var pz = points[j * 3 + 2];
                            if (Math.floor(px / cell) === cx + ox && Math.floor(py / cell) === cy + oy &&
                                Math.floor(pz / cell) === cz + oz) {
                                var dx = px - ax;
                                var dy = py - ay;
                                var dz = pz - az;
                                if (dx * dx + dy * dy + dz * dz < maxSq) out[found++] = j;
                            }
                        }
                        j = this.next[j];
                    }
                }
            }
        }
        return found;
    };

    PZ.object3d.plexus = class extends PZ.object3d {
        constructor() {
            super();
            this.threeObj = new THREE.Object3D();
            this.objects = new PZ.objectList(this, PZ.object3d.plexus.object);
            this.objects.name = "Plexus Objects";
            this.children.push(this.objects);
            this._work = new Float32Array(0);
            this._colors = new Float32Array(0);
            this._count = 0;
            this._time = undefined;
            this._renderedRevision = -1;
            this._grid = new SpatialGrid();
            this._candidates = new Int32Array(0);
            this._sourceIds = new Int32Array(0);
            this._near = new Int32Array(MAX_NEAR);
            this._seen = new Set();
            this._segments = null;
            this.pointCloud = null;
            this.lineMesh = null;
            this.mesh = null;
        }
        load(e) {
            this.properties.load(e && e.properties);
            if (e && "object" == typeof e && e.objects && e.objects.length) {
                for (var i = 0; i < e.objects.length; i++) {
                    var object = new PZ.object3d.plexus.object();
                    this.objects.push(object);
                    object.loading = object.load(e.objects[i], this);
                }
            } else {
                var geometry = new PZ.object3d.plexus.object();
                this.objects.push(geometry);
                geometry.loading = geometry.load(null, this);
                geometry.applyPreset("primitives");
                var lines = new PZ.object3d.plexus.object();
                this.objects.push(lines);
                lines.loading = lines.load(null, this);
                lines.applyPreset("lines");
            }
            this.rebuildRenderers();
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, properties: this.properties, objects: this.objects };
        }
        unload() {
            for (var i = 0; i < this.objects.length; i++) this.objects[i].unload();
            this.disposeRenderers();
        }
        assetRevision() {
            var total = 0;
            for (var i = 0; i < this.objects.length; i++) total += this.objects[i]._assets.revision;
            return total;
        }
        // An asset settled after the last rendered frame: re-run that frame.
        assetSettled() {
            if (this._time !== undefined && this.pointCloud) this.update(this._time);
        }
        rebuildRenderers() {
            this.disposeRenderers();
            this.pointsMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    resolution: { type: "v2", value: new THREE.Vector2(1920, 1080) },
                    size: { type: "f", value: 3 },
                    color: { type: "v4", value: new THREE.Vector4(1, 1, 1, 1) },
                },
                defines: {},
                vertexShader: POINT_VERTEX,
                fragmentShader: POINT_FRAGMENT,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.pointCloud = new THREE.Points(new THREE.BufferGeometry(), this.pointsMaterial);
            this.pointCloud.frustumCulled = false;
            this.pointCloud.onBeforeRender = function (renderer) {
                if (!this.material || !this.material.uniforms || !this.material.uniforms.resolution) return;
                var size = renderer.getSize();
                this.material.uniforms.resolution.value.set(size.width, size.height);
            };
            this.threeObj.add(this.pointCloud);

            this.lineMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    color: { type: "v4", value: new THREE.Vector4(1, 1, 1, 0.8) },
                },
                defines: {},
                vertexShader: LINE_VERTEX,
                fragmentShader: LINE_FRAGMENT,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.lineMesh = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
            this.lineMesh.frustumCulled = false;
            this.threeObj.add(this.lineMesh);

            this.meshMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    color: { type: "v4", value: new THREE.Vector4(1, 1, 1, 0.35) },
                    ambient: { type: "f", value: 0.25 },
                    diffuse: { type: "f", value: 0.75 },
                    specular: { type: "f", value: 0.0 },
                },
                vertexShader: MESH_VERTEX,
                fragmentShader: MESH_FRAGMENT,
                transparent: true,
                depthTest: true,
                depthWrite: true,
                side: THREE.DoubleSide,
                blending: THREE.NormalBlending,
            });
            this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.meshMaterial);
            this.mesh.frustumCulled = false;
            this.mesh.visible = false;
            this.threeObj.add(this.mesh);
        }
        disposeRenderers() {
            var dispose = function (holder, object) {
                if (!object) return;
                holder.threeObj.remove(object);
                if (object.geometry) object.geometry.dispose();
                if (object.material) object.material.dispose();
            };
            dispose(this, this.pointCloud);
            dispose(this, this.lineMesh);
            dispose(this, this.mesh);
            this.pointCloud = null;
            this.lineMesh = null;
            this.mesh = null;
            this.pointsMaterial = null;
            this.lineMaterial = null;
            this.meshMaterial = null;
        }
        // Concatenates the enabled geometry sources into the work buffer.
        // _sourceIds[i] is the work-buffer order index of the source that
        // produced point i, so the shape line mode can stay within objects.
        gatherPoints() {
            var t = PZ.trapcode.currentTime;
            var sources = [];
            var total = 0;
            for (var i = 0; i < this.objects.length; i++) {
                var object = this.objects[i];
                if (!object.isGeometry() || object.properties.common.enabled.get(t) !== 1) continue;
                var points = object.sourcePoints();
                sources.push(points);
                total += points.length / 3;
            }
            if (this._work.length < total * 3) {
                var capacity = Math.max(total * 3, Math.ceil(this._work.length * 1.5));
                this._work = new Float32Array(capacity);
                this._colors = new Float32Array(capacity);
            }
            if (this._sourceIds.length < total) {
                this._sourceIds = new Int32Array(Math.max(total, this._sourceIds.length * 2, 64));
            }
            var offset = 0;
            for (var s = 0; s < sources.length; s++) {
                this._work.set(sources[s], offset);
                var begin = offset / 3;
                var end = begin + sources[s].length / 3;
                for (var k = begin; k < end; k++) this._sourceIds[k] = s;
                offset += sources[s].length;
            }
            this._colors.fill(1, 0, total * 3);
            this._count = total;
            return total;
        }
        applyEffectors(count) {
            var t = PZ.trapcode.currentTime;
            for (var i = 0; i < this.objects.length; i++) {
                var object = this.objects[i];
                if (object.isEffector() && object.properties.common.enabled.get(t) === 1) {
                    object.applyTo(this._work, this._colors, count);
                }
            }
        }
        rendererState() {
            var state = {
                points: false,
                lines: false,
                mesh: false,
                triangulation: false,
                beams: false,
                lineType: 0,
                size: 3,
                color: [1, 1, 1],
                opacity: 0.8,
                maxDistance: 200,
                maxConnections: 5,
                ambient: 0.25,
                diffuse: 0.75,
                specular: 0,
            };
            var t = PZ.trapcode.currentTime;
            for (var i = 0; i < this.objects.length; i++) {
                var object = this.objects[i];
                if (object.isRenderer() && object.properties.common.enabled.get(t) === 1) {
                    object.applyToState(state);
                }
            }
            return state;
        }
        update(e) {
            PZ.trapcode.setTime(e);
            this._time = e;
            if (!this.pointCloud) this.rebuildRenderers();
            for (var o = 0; o < this.objects.length; o++) this.objects[o].requestAssets();
            var count = this.gatherPoints();
            this.applyEffectors(count);
            var state = this.rendererState();
            this.pointCloud.visible = state.points;
            this.lineMesh.visible = state.lines || state.beams;
            this.mesh.visible = state.mesh || state.triangulation;
            // Opacity UI is 0..100, shaders expect 0..1.
            var alpha = Math.max(0, Math.min(1, state.opacity / 100));
            // Geometry Size is the volume scale; renderer Point Size (0..10)
            // is the point sprite scale. Keep them independent.
            this.pointsMaterial.uniforms.size.value = Math.max(0, state.size);
            this.pointsMaterial.uniforms.color.value.set(state.color[0], state.color[1], state.color[2], alpha);
            this.lineMaterial.uniforms.color.value.set(state.color[0], state.color[1], state.color[2], alpha);
            this.meshMaterial.uniforms.color.value.set(state.color[0], state.color[1], state.color[2], alpha);
            this.meshMaterial.uniforms.ambient.value = state.ambient;
            this.meshMaterial.uniforms.diffuse.value = state.diffuse;
            this.meshMaterial.uniforms.specular.value = state.specular;

            this.updateBuffer(this.pointCloud, count);
            if (state.lines || state.beams) this.buildLines(count, state);
            if (state.mesh || state.triangulation) this.buildMesh(count, state);
            this._renderedRevision = this.assetRevision();
        }
        // Copies the work buffer into a point geometry, growing it when needed.
        updateBuffer(target, count) {
            var geometry = target.geometry;
            var position = geometry.attributes.position;
            if (!position || position.array.length < count * 3) {
                if (geometry.dispose) geometry.dispose();
                var capacity = Math.max(count, 64);
                geometry = new THREE.BufferGeometry();
                geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
                geometry.addAttribute("vcolor", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
                target.geometry = geometry;
            }
            geometry.attributes.position.array.set(this._work.subarray(0, count * 3));
            geometry.attributes.vcolor.array.set(this._colors.subarray(0, count * 3));
            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.vcolor.needsUpdate = true;
            geometry.setDrawRange(0, count);
            // Setting needsUpdate recompiles the shader; only do it when the
            // define actually changes.
            if (!target.material.defines.USE_VCOLOR) {
                target.material.defines.USE_VCOLOR = 1;
                target.material.needsUpdate = true;
            }
        }
        // Points used for links are the first `limit` points of the work buffer.
        linkCount(limit) {
            return Math.min(this._count, limit);
        }
        ensureLineGeometry(vertexCount) {
            var geometry = this.lineMesh.geometry;
            if (!geometry.attributes.position || geometry.attributes.position.array.length < vertexCount * 3) {
                if (geometry.dispose) geometry.dispose();
                var capacity = Math.max(vertexCount, 1024);
                geometry = new THREE.BufferGeometry();
                geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
                geometry.addAttribute("vcolor", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
                this.lineMesh.geometry = geometry;
            }
            return geometry;
        }
        buildLines(count, state) {
            var maxDistance = Math.max(0, state.maxDistance);
            var maxConnections = Math.max(0, Math.min(10, Math.round(state.maxConnections)));
            var lineType = Math.max(0, Math.min(2, Math.round(state.lineType || 0)));
            var n = this.linkCount(MAX_LINK_POINTS);
            var beams = state.beams;
            var geometry = this.ensureLineGeometry(Math.max(n * Math.max(maxConnections, 1) * 2, 2));
            var positions = geometry.attributes.position.array;
            var colors = geometry.attributes.vcolor.array;
            var verts = 0;
            var emit = function (i, j, work, colorsIn) {
                var v = verts * 3;
                positions[v] = work[i * 3];
                positions[v + 1] = work[i * 3 + 1];
                positions[v + 2] = work[i * 3 + 2];
                positions[v + 3] = work[j * 3];
                positions[v + 4] = work[j * 3 + 1];
                positions[v + 5] = work[j * 3 + 2];
                colors[v] = colorsIn[i * 3];
                colors[v + 1] = colorsIn[i * 3 + 1];
                colors[v + 2] = colorsIn[i * 3 + 2];
                colors[v + 3] = colorsIn[j * 3];
                colors[v + 4] = colorsIn[j * 3 + 1];
                colors[v + 5] = colorsIn[j * 3 + 2];
                verts += 2;
            };
            if (n > 0 && maxConnections > 0) {
                if (lineType === 1) {
                    verts = this.buildLinesAdjacency(n, maxConnections, positions, colors, emit, verts);
                } else if (maxDistance > 0) {
                    verts = this.buildLinesDistance(n, maxDistance, maxConnections, positions, colors, emit, verts, lineType === 2);
                }
            }
            geometry.setDrawRange(0, verts);
            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.vcolor.needsUpdate = true;
            var wantVColor = !beams;
            var hasVColor = !!this.lineMaterial.defines.USE_VCOLOR;
            if (wantVColor !== hasVColor) {
                if (wantVColor) this.lineMaterial.defines.USE_VCOLOR = 1;
                else delete this.lineMaterial.defines.USE_VCOLOR;
                this.lineMaterial.needsUpdate = true;
            }
        }
        // Adjacency mode: each point links to its next maxConnections points
        // in creation order, regardless of distance (Plexus Adjacency).
        buildLinesAdjacency(n, maxConnections, positions, colors, emit, verts) {
            var work = this._work;
            var colorsIn = this._colors;
            for (var i = 0; i < n; i++) {
                var take = Math.min(maxConnections, n - 1 - i);
                for (var k = 1; k <= take; k++) {
                    var v = verts * 3;
                    positions[v] = work[i * 3];
                    positions[v + 1] = work[i * 3 + 1];
                    positions[v + 2] = work[i * 3 + 2];
                    positions[v + 3] = work[(i + k) * 3];
                    positions[v + 4] = work[(i + k) * 3 + 1];
                    positions[v + 5] = work[(i + k) * 3 + 2];
                    colors[v] = colorsIn[i * 3];
                    colors[v + 1] = colorsIn[i * 3 + 1];
                    colors[v + 2] = colorsIn[i * 3 + 2];
                    colors[v + 3] = colorsIn[(i + k) * 3];
                    colors[v + 4] = colorsIn[(i + k) * 3 + 1];
                    colors[v + 5] = colorsIn[(i + k) * 3 + 2];
                    verts += 2;
                }
            }
            return verts;
        }
        // Distance mode, optionally restricted to pairs from the same source
        // object (shape mode). Unchanged for lineType distance.
        buildLinesDistance(n, maxDistance, maxConnections, positions, colors, emit, verts, sameSource) {
            var work = this._work;
            var colorsIn = this._colors;
            var sourceIds = sameSource ? this._sourceIds : null;
            var grid = this._grid;
            grid.build(work, n, Math.max(maxDistance, 0.0001));
            var cell = grid.cell;
            var maxSq = maxDistance * maxDistance;
            for (var i = 0; i < n; i++) {
                var ax = work[i * 3];
                var ay = work[i * 3 + 1];
                var az = work[i * 3 + 2];
                var acx = Math.floor(ax / cell);
                var acy = Math.floor(ay / cell);
                var acz = Math.floor(az / cell);
                var connections = 0;
                for (var ox = -1; ox <= 1 && connections < maxConnections; ox++) {
                    for (var oy = -1; oy <= 1 && connections < maxConnections; oy++) {
                        for (var oz = -1; oz <= 1 && connections < maxConnections; oz++) {
                            var j = grid.head[grid.bucket(acx + ox, acy + oy, acz + oz)];
                            while (j >= 0 && connections < maxConnections) {
                                if (j > i && (!sourceIds || sourceIds[j] === sourceIds[i])) {
                                    var bx = work[j * 3];
                                    var by = work[j * 3 + 1];
                                    var bz = work[j * 3 + 2];
                                    var dx = ax - bx;
                                    var dy = ay - by;
                                    var dz = az - bz;
                                    if (dx * dx + dy * dy + dz * dz < maxSq &&
                                        Math.floor(bx / cell) === acx + ox &&
                                        Math.floor(by / cell) === acy + oy &&
                                        Math.floor(bz / cell) === acz + oz) {
                                        emit(i, j, work, colorsIn);
                                        verts += 2;
                                        connections++;
                                    }
                                }
                                j = grid.next[j];
                            }
                        }
                    }
                }
            }
            return verts;
        }
        buildMesh(count, state) {
            var n = this.linkCount(MAX_MESH_POINTS);
            var maxDistance = Math.max(0, state.maxDistance);
            var indices;
            if (state.triangulation && !state.mesh) {
                indices = this.triangulate(n, maxDistance);
            } else {
                indices = this.facets(n, maxDistance, state.maxConnections);
            }
            var geometry = this.mesh.geometry;
            if (!geometry.attributes.position || geometry.attributes.position.array.length < n * 3) {
                if (geometry.dispose) geometry.dispose();
                geometry = new THREE.BufferGeometry();
                geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(n, 64) * 3), 3));
                this.mesh.geometry = geometry;
            }
            geometry.attributes.position.array.set(this._work.subarray(0, n * 3));
            geometry.attributes.position.needsUpdate = true;
            geometry.setIndex(indices.length ? indices : []);
            geometry.setDrawRange(0, indices.length);
            if (n >= 3 && indices.length >= 3) {
                geometry.computeVertexNormals();
            }
            // Keep mesh visible even when triangulation yields few tris so the
            // renderer does not look dead; empty geometry simply draws nothing.
            this.mesh.visible = true;
        }
        // Connects each point to up to maxConnections higher-index neighbours,
        // emitting one triangle per consecutive pair.
        facets(n, maxDistance, maxConnections) {
            var indices = [];
            maxConnections = Math.max(0, Math.min(10, Math.round(maxConnections)));
            if (n < 1 || !maxDistance || !maxConnections) return indices;
            var grid = this._grid;
            grid.build(this._work, n, maxDistance);
            this.ensureCandidates(n);
            var found = this._candidates;
            for (var i = 0; i < n; i++) {
                var m = grid.near(i, maxDistance, true, found, n);
                if (m < 2) continue;
                var sorted = found.subarray(0, m).sort();
                var take = Math.min(m, maxConnections);
                for (var k = 0; k < take - 1; k += 2) {
                    indices.push(i, sorted[k], sorted[k + 1]);
                }
            }
            return indices;
        }
        ensureCandidates(n) {
            if (this._candidates.length < n) this._candidates = new Int32Array(Math.max(n, this._candidates.length * 2));
        }
        triangulate(n, maxDistance) {
            var indices = [];
            if (n < 3) return indices;
            maxDistance = Math.max(maxDistance, 0.0001);
            var work = this._work;
            var grid = this._grid;
            grid.build(work, n, maxDistance);
            var near = this._near;
            var seen = this._seen;
            seen.clear();
            var maxSq = maxDistance * maxDistance;
            for (var a = 0; a < n && indices.length < MAX_TRIANGLES * 3; a++) {
                var found = grid.near(a, maxDistance, false, near, MAX_NEAR);
                if (found < 2) continue;
                // Insertion sort by distance to a (at most MAX_NEAR entries).
                for (var s = 1; s < found; s++) {
                    var item = near[s];
                    var key = pointDistSq(work, item, a);
                    var p = s - 1;
                    while (p >= 0 && pointDistSq(work, near[p], a) > key) {
                        near[p + 1] = near[p];
                        p--;
                    }
                    near[p + 1] = item;
                }
                var candidates = Math.min(found, 10);
                for (var mi = 0; mi < candidates && indices.length < MAX_TRIANGLES * 3; mi++) {
                    for (var ni = mi + 1; ni < candidates && indices.length < MAX_TRIANGLES * 3; ni++) {
                        var b = near[mi];
                        var c = near[ni];
                        if (b === a || c === a || b === c) continue;
                        if (pointDistSq(work, b, c) > maxSq) continue;
                        // Skip degenerate (zero-area) triangles.
                        if (triangleAreaSq(work, a, b, c) < 1e-8) continue;
                        var t = [a, b, c].sort(function (x, y) { return x - y; });
                        var tkey = (t[0] * n + t[1]) * n + t[2];
                        if (seen.has(tkey)) continue;
                        seen.add(tkey);
                        indices.push(t[0], t[1], t[2]);
                        // One fan triangle per neighbor pair is enough; cap fan-out
                        // so dense clouds do not explode into overlapping sheets.
                        if (ni - mi > 4) break;
                    }
                }
            }
            return indices;
        }
        async prepare(e) {
            PZ.trapcode.setTime(e);
            var waits = [];
            for (var i = 0; i < this.objects.length; i++) {
                this.objects[i].requestAssets().forEach(function (entry) { waits.push(entry.promise); });
            }
            await Promise.all(waits);
            if (!this.pointCloud || this._time !== e || this._renderedRevision !== this.assetRevision()) {
                this.update(e);
            }
        }
    };

    PZ.object3d.plexus.prototype.defaultName = "Plexus";
    PZ.object3d.plexus.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Plexus" },
    };

    var KIND_GEOMETRY = 0;
    var KIND_EFFECTOR = 1;
    var KIND_RENDERER = 2;

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

    // Requests the vertices of an OBJ (or JSON BufferGeometry) asset. Resolves
    // to a flat xyz array or null.
    function loadMeshVertices(project, value) {
        if (!project || !value) return Promise.resolve(null);
        var asset = project.assets.load(value);
        if (!asset) return Promise.resolve(null);
        var finish = function (result) {
            try { project.assets.unload(asset); } catch (_error) { /* best effort */ }
            return result;
        };
        var geometryAsset;
        try {
            geometryAsset = new PZ.asset.geometry(asset);
        } catch (_error) {
            return Promise.resolve(finish(null));
        }
        var fromJson = function () {
            return geometryAsset.getGeometry().then(function (geometry) {
                var position = geometry && geometry.attributes && geometry.attributes.position;
                return position ? Array.prototype.slice.call(position.array) : null;
            });
        };
        var readText = null;
        try {
            readText = geometryAsset.readFile();
        } catch (_error) {
            readText = null;
        }
        if (readText && typeof readText.then === "function") {
            return readText
                .then(function (text) {
                    var positions = parseGeometryText(text);
                    return positions || fromJson();
                })
                .then(finish, function () { return finish(null); });
        }
        return fromJson().then(finish, function () { return finish(null); });
    }

    function computeBounds(source) {
        var minX = Infinity, minY = Infinity, minZ = Infinity;
        var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (var i = 0; i < source.length; i += 3) {
            var x = source[i], y = source[i + 1], z = source[i + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }
        if (minX === Infinity) {
            minX = minY = minZ = -0.5;
            maxX = maxY = maxZ = 0.5;
        }
        return { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ };
    }

    function parseGeometryText(text) {
        if (!text || typeof text !== "string") return null;
        var trimmed = text.trim();
        // Legacy three.js BufferGeometry JSON?
        if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
            try {
                var json = JSON.parse(text);
                var loader = new THREE.BufferGeometryLoader();
                var geo = loader.parse(json);
                if (geo && geo.attributes && geo.attributes.position) {
                    return Array.prototype.slice.call(geo.attributes.position.array);
                }
            } catch (err) { /* not a geometry */ }
            return null;
        }
        // Real .obj: prefer THREE.OBJLoader (returns Group of Meshes).
        try {
            if (THREE.OBJLoader) {
                var objLoader = new THREE.OBJLoader();
                var group = objLoader.parse(text);
                var collected = [];
                if (group && group.traverse) {
                    group.traverse(function (child) {
                        var pos = child && child.geometry && child.geometry.attributes && child.geometry.attributes.position;
                        if (pos) {
                            for (var i = 0; i < pos.array.length; i++) collected.push(pos.array[i]);
                        }
                    });
                }
                if (collected.length >= 3) return collected;
            }
        } catch (err) { /* fall through to the minimal parser */ }
        // Minimal `v x y z` fallback when OBJLoader is unavailable/strict.
        try {
            var verts = [];
            var lines = text.split("\n");
            for (var l = 0; l < lines.length; l++) {
                var line = lines[l].trim();
                if (line.charAt(0) !== "v" || line.charAt(1) !== " ") continue;
                var parts = line.split(/\s+/);
                if (parts.length >= 4) {
                    verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
                }
            }
            if (verts.length >= 3) return verts;
        } catch (err) { /* no vertices */ }
        return null;
    }

    function pointDistSq(points, i, j) {
        var dx = points[i * 3] - points[j * 3];
        var dy = points[i * 3 + 1] - points[j * 3 + 1];
        var dz = points[i * 3 + 2] - points[j * 3 + 2];
        return dx * dx + dy * dy + dz * dz;
    }

    function triangleAreaSq(points, i, j, k) {
        var ax = points[j * 3] - points[i * 3];
        var ay = points[j * 3 + 1] - points[i * 3 + 1];
        var az = points[j * 3 + 2] - points[i * 3 + 2];
        var bx = points[k * 3] - points[i * 3];
        var by = points[k * 3 + 1] - points[i * 3 + 1];
        var bz = points[k * 3 + 2] - points[i * 3 + 2];
        var cx = ay * bz - az * by;
        var cy = az * bx - ax * bz;
        var cz = ax * by - ay * bx;
        return cx * cx + cy * cy + cz * cz;
    }

    T.registerObjectTypes(PZ.object3d.plexus.object, [
        {
            name: "Add Geometry",
            desc: "Add a geometry source.",
            type: 0,
            list: [
                { name: "Layers", type: 0, data: { objectKind: 0, subType: 0, name: "Layers" } },
                { name: "Paths", type: 0, data: { objectKind: 0, subType: 1, name: "Paths" } },
                { name: "OBJ", type: 0, data: { objectKind: 0, subType: 2, name: "OBJ" } },
                { name: "Primitives", type: 0, data: { objectKind: 0, subType: 3, name: "Primitives" } },
                { name: "Instances", type: 0, data: { objectKind: 0, subType: 4, name: "Instances" } },
                { name: "Slicer", type: 0, data: { objectKind: 0, subType: 5, name: "Slicer" } },
            ],
        },
        {
            name: "Add Effector",
            desc: "Add an effector.",
            type: 0,
            list: [
                { name: "Noise", type: 0, data: { objectKind: 1, subType: 0, name: "Noise" } },
                { name: "Spherical Field", type: 0, data: { objectKind: 1, subType: 1, name: "Spherical Field" } },
                { name: "Container", type: 0, data: { objectKind: 1, subType: 2, name: "Container" } },
                { name: "Transform", type: 0, data: { objectKind: 1, subType: 3, name: "Transform" } },
                { name: "Color Map", type: 0, data: { objectKind: 1, subType: 4, name: "Color Map" } },
                { name: "Shade Effector", type: 0, data: { objectKind: 1, subType: 5, name: "Shade Effector" } },
                { name: "Sound Effector", type: 0, data: { objectKind: 1, subType: 6, name: "Sound Effector" } },
            ],
        },
        {
            name: "Add Renderer",
            desc: "Add a renderer.",
            type: 0,
            list: [
                { name: "Points", type: 0, data: { objectKind: 2, subType: 0, name: "Points" } },
                { name: "Lines", type: 0, data: { objectKind: 2, subType: 1, name: "Lines" } },
                { name: "Facets", type: 0, data: { objectKind: 2, subType: 2, name: "Facets" } },
                { name: "Triangulation", type: 0, data: { objectKind: 2, subType: 3, name: "Triangulation" } },
                { name: "Beams", type: 0, data: { objectKind: 2, subType: 4, name: "Beams" } },
            ],
        },
    ]);

    if (T.designer) {
        T.designer.registerConfig(PZ.object3d.plexus, {
            title: "Plexus Designer",
            targets: function (root) {
                return root.objects;
            },
            targetName: function (object, index) {
                var name = object.properties.common.name.get(PZ.trapcode.currentTime);
                if (!name || name === "Object") {
                    if (object.isRenderer()) name = ["Points", "Lines", "Facets", "Triangulation", "Beams"][object.subType];
                    else if (object.isEffector()) name = "Effector";
                    else name = "Geometry";
                }
                return name || "Object";
            },
            addKinds: [
                { name: "Add Geometry", create: function (root) { return addPlexusObject(root, 0, 3, "Primitives"); } },
                { name: "Add Effector", create: function (root) { return addPlexusObject(root, 1, 0, "Noise"); } },
                { name: "Add Renderer", create: function (root) { return addPlexusObject(root, 2, 1, "Lines"); } },
            ],
            blocks: function (target) {
                if (target && target.isEffector && target.isEffector()) {
                    return [{ key: "effector", name: "Effector" }, { key: "common", name: "Object" }];
                }
                if (target && target.isRenderer && target.isRenderer()) {
                    return [{ key: "renderer", name: "Renderer" }, { key: "common", name: "Object" }];
                }
                return [{ key: "geometry", name: "Geometry" }, { key: "common", name: "Object" }];
            },
            groupFor: function (target, key) {
                return target.properties ? target.properties[key] : null;
            },
            presets: [
                { name: "Points cloud", preset: "points" },
                { name: "Lines web", preset: "lines" },
                { name: "Facets", preset: "facets" },
                { name: "Triangulation", preset: "triangulation" },
                { name: "Beams", preset: "beams" },
                { name: "Terrain", preset: "terrain" },
            ],
            applyPreset: function (root, target, preset) {
                if (!root || !root.objects) return;
                if (preset.preset === "terrain") {
                    setupTerrain(root);
                    return;
                }
                for (var i = 0; i < root.objects.length; i++) {
                    var object = root.objects[i];
                    if (object.isRenderer && object.isRenderer()) object.applyPreset(preset.preset);
                }
                root.update(0);
            },
        });
    }

    function setupTerrain(root) {
        var geo = null,
            lines = null,
            points = null,
            noise = null;
        var t = PZ.trapcode.currentTime;
        for (var i = 0; i < root.objects.length; i++) {
            var o = root.objects[i];
            if (o.isGeometry()) {
                if (!geo) geo = o;
            } else if (o.isEffector()) {
                if (!noise) noise = o;
            } else if (o.isRenderer()) {
                var type = o.properties.renderer.rendererType.get(t);
                if (type === 1 && !lines) lines = o;
                else if (type === 0 && !points) points = o;
            }
        }
        if (!geo) geo = addPlexusObject(root, 0, 3, "Terrain Grid");
        geo.properties.common.enabled.set(1);
        geo.properties.geometry.geometryType.set(3);
        geo.properties.geometry.primitiveShape.set(3);
        geo.properties.geometry.primitiveCount.set(10000);
        geo.properties.geometry.primitiveSize.set([2400, 100, 2400]);
        geo.properties.geometry.position.set([0, -300, 0]);
        if (!noise) noise = addPlexusObject(root, 1, 0, "Terrain Noise");
        noise.subType = 0;
        noise.properties.common.enabled.set(1);
        noise.properties.effector.effectorType.set(0);
        noise.properties.effector.noiseAmount.set(140);
        noise.properties.effector.noiseScale.set(2.5);
        if (!lines) lines = addPlexusObject(root, 2, 1, "Terrain Lines");
        lines.properties.common.enabled.set(1);
        lines.properties.renderer.rendererType.set(1);
        lines.properties.renderer.maxDistance.set(42);
        lines.properties.renderer.maxConnections.set(6);
        lines.properties.renderer.opacity.set(35);
        lines.properties.renderer.color.set([0.45, 0.25, 1.0]);
        if (!points) points = addPlexusObject(root, 2, 0, "Terrain Points");
        points.properties.common.enabled.set(1);
        points.properties.renderer.rendererType.set(0);
        points.properties.renderer.size.set(3.5);
        points.properties.renderer.color.set([0.55, 0.35, 1.0]);
        root.update(0);
    }

    function addPlexusObject(root, kind, subType, name) {
        var object = new PZ.object3d.plexus.object();
        root.objects.push(object);
        object.loading = object.load({ objectKind: kind, subType: subType, name: name, properties: {} });
        if (kind === 0) {
            object.subType = subType;
            object.properties.geometry.geometryType.set(subType);
        }
        if (kind === 2 && subType === 1) {
            object.properties.renderer.lineType.set(0);
            object.properties.renderer.maxDistance.set(200);
        }
        root.update(0);
        return object;
    }
})();
