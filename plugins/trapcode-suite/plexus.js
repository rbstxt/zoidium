// OpenZoid Trapcode Suite — Plexus container, renderers, and connection search.
/*
 * plexus.js
 *
 * A Trapcode/Plexus style object3d: geometry sources generate a
 * point cloud, effectors deform it, and renderers connect the
 * points. This file holds the constants, shaders, sampling and
 * connection-search utilities, and the Plexus container class
 * (rendering points, lines, facets, triangulation and beams).
 * Geometry ingestion lives in plexus-geometry.js, the object
 * class in plexus-object.js, and the catalog registration in
 * plexus-config.js.
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

    // Shared Plexus spatial hash and value noise (zoidium/shared/random.js).
    // Pinned bit-for-bit by test/migrate-shared-pins.test.js.
    function rand(seed) {
        return ZoidiumPluginApis.random.plexusRand(seed);
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
        return ZoidiumPluginApis.random.plexusHash2(x, y, seed);
    }

    function smoothNoise2(x, y, seed) {
        return ZoidiumPluginApis.random.plexusSmoothNoise2(x, y, seed);
    }

    function fbm2(x, y, seed) {
        return ZoidiumPluginApis.random.plexusFbm2(x, y, seed);
    }

    // Spatial hash over a flat xyz buffer. Cells are cell-sized cubes; the
    // table is a power-of-two list of buckets with chained point indices, so
    // a rebuild allocates nothing once the arrays have grown.
    function SpatialGrid() {
        this.head = new Int32Array(16);
        this.next = new Int32Array(16);
        this.cells = new Float64Array(16 * 3);
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
        if (this.cells.length < count * 3) this.cells = new Float64Array(this.next.length * 3);
        this.points = points;
        this.count = count;
        this.cell = cell;
        for (var i = 0; i < count; i++) {
            // Keep full double cell coordinates, including values outside
            // int32 range. Hash collisions still traverse the same chains.
            var at = i * 3;
            var cx = this.cells[at] = Math.floor(points[at] / cell);
            var cy = this.cells[at + 1] = Math.floor(points[at + 1] / cell);
            var cz = this.cells[at + 2] = Math.floor(points[at + 2] / cell);
            var b = this.bucket(cx, cy, cz);
            this.next[i] = this.head[b];
            this.head[b] = i;
        }
    };

    // Collects the points in the 27 cells around point i (optionally only the
    // ones with a higher index) that lie within maxDistance. Writes indices to
    // out and returns how many were written, at most `limit`.
    SpatialGrid.prototype.near = function (i, maxDistance, above, out, limit) {
        var points = this.points;
        var ax = points[i * 3];
        var ay = points[i * 3 + 1];
        var az = points[i * 3 + 2];
        var cells = this.cells;
        var cx = cells[i * 3];
        var cy = cells[i * 3 + 1];
        var cz = cells[i * 3 + 2];
        var maxSq = maxDistance * maxDistance;
        var found = 0;
        for (var ox = -1; ox <= 1; ox++) {
            for (var oy = -1; oy <= 1; oy++) {
                for (var oz = -1; oz <= 1; oz++) {
                    var j = this.head[this.bucket(cx + ox, cy + oy, cz + oz)];
                    // Buckets are in descending index order. No later entry can
                    // pass an above-only query once this index is too small.
                    while (j >= 0 && found < limit && (!above || j > i)) {
                        if (j !== i && (!above || j > i)) {
                            var px = points[j * 3];
                            var py = points[j * 3 + 1];
                            var pz = points[j * 3 + 2];
                            if (cells[j * 3] === cx + ox && cells[j * 3 + 1] === cy + oy &&
                                cells[j * 3 + 2] === cz + oz) {
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
            this._nearDistances = new Float64Array(MAX_NEAR);
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
            var cells = grid.cells;
            var maxSq = maxDistance * maxDistance;
            for (var i = 0; i < n; i++) {
                var ax = work[i * 3];
                var ay = work[i * 3 + 1];
                var az = work[i * 3 + 2];
                var acx = cells[i * 3];
                var acy = cells[i * 3 + 1];
                var acz = cells[i * 3 + 2];
                var connections = 0;
                for (var ox = -1; ox <= 1 && connections < maxConnections; ox++) {
                    for (var oy = -1; oy <= 1 && connections < maxConnections; oy++) {
                        for (var oz = -1; oz <= 1 && connections < maxConnections; oz++) {
                            var j = grid.head[grid.bucket(acx + ox, acy + oy, acz + oz)];
                            // Remaining indices are lower still, so they cannot link to i.
                            while (j > i && connections < maxConnections) {
                                if (j > i && (!sourceIds || sourceIds[j] === sourceIds[i])) {
                                    var bx = work[j * 3];
                                    var by = work[j * 3 + 1];
                                    var bz = work[j * 3 + 2];
                                    var dx = ax - bx;
                                    var dy = ay - by;
                                    var dz = az - bz;
                                    if (dx * dx + dy * dy + dz * dz < maxSq &&
                                        cells[j * 3] === acx + ox &&
                                        cells[j * 3 + 1] === acy + oy &&
                                        cells[j * 3 + 2] === acz + oz) {
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
            var distances = this._nearDistances;
            var seen = this._seen;
            seen.clear();
            var maxSq = maxDistance * maxDistance;
            for (var a = 0; a < n && indices.length < MAX_TRIANGLES * 3; a++) {
                var found = grid.near(a, maxDistance, false, near, MAX_NEAR);
                if (found < 2) continue;
                // Compute each double distance once, then retain the original
                // stable insertion order, including equal-distance neighbors.
                distances[0] = pointDistSq(work, near[0], a);
                for (var s = 1; s < found; s++) {
                    var item = near[s];
                    var key = pointDistSq(work, item, a);
                    var p = s - 1;
                    while (p >= 0 && distances[p] > key) {
                        near[p + 1] = near[p];
                        distances[p + 1] = distances[p];
                        p--;
                    }
                    near[p + 1] = item;
                    distances[p + 1] = key;
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
        // Preview frame cache probe: drawn with settled assets, none loading.
        zoidiumFrameReady() {
            for (var i = 0; i < this.objects.length; i++) {
                if (this.objects[i].requestAssets().some(function (entry) { return entry.status === "loading"; })) return false;
            }
            return !!this.pointCloud && this._renderedRevision === this.assetRevision();
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

    // Shared with plexus-object.js, which loads after this file.
    T.plexusUtil = {
        rand: rand,
        numberOr: numberOr,
        clamp: clamp,
        hash2: hash2,
        smoothNoise2: smoothNoise2,
        fbm2: fbm2,
    };
})();
