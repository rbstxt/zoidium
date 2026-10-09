// OpenZoid Trapcode Suite — Plexus (ported verbatim from plexus.js).
/*
 * plexus.js
 *
 * A Trapcode/Plexus style object3d: one or more geometry sources generate a
 * point cloud, effectors deform it, and renderers connect the points as
 * points, lines, facets, triangulation or beams. Lives inside a normal 3D
 * Scene layer and uses the shared property system.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

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

    PZ.object3d.plexus = class extends PZ.object3d {
        constructor() {
            super();
            this.threeObj = new THREE.Object3D();
            this.objects = new PZ.objectList(this, PZ.object3d.plexus.object);
            this.objects.name = "Plexus Objects";
            this.children.push(this.objects);
            this._points = [];
            this._colors = [];
            this.pointCloud = null;
            this.lineMesh = null;
            this.mesh = null;
            this._cache = {};
        }
        load(e) {
            this.properties.load(e && e.properties);
            if ("object" == typeof e && e.objects && e.objects.length) {
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
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
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
        collectPoints() {
            var points = [];
            var colors = [];
            for (var i = 0; i < this.objects.length; i++) {
                var object = this.objects[i];
                if (object.isGeometry() && object.properties.common.enabled.get(PZ.trapcode.currentTime) === 1) {
                    var generated = object.generatePoints(this);
                    for (var p = 0; p < generated.length; p++) {
                        points.push(generated[p]);
                        colors.push([1, 1, 1]);
                    }
                }
            }
            this._colors = colors;
            return points;
        }
        applyEffectors(points, colors, time) {
            for (var i = 0; i < this.objects.length; i++) {
                var object = this.objects[i];
                if (object.isEffector() && object.properties.common.enabled.get(PZ.trapcode.currentTime) === 1) {
                    object.applyTo(points, colors, time, this);
                }
            }
            return points;
        }
        rendererState() {
            var state = {
                points: false,
                lines: false,
                mesh: false,
                triangulation: false,
                beams: false,
                size: 3,
                color: [1, 1, 1],
                opacity: 0.8,
                maxDistance: 200,
                maxConnections: 5,
                ambient: 0.25,
                diffuse: 0.75,
                specular: 0,
            };
            for (var i = 0; i < this.objects.length; i++) {
                var object = this.objects[i];
                if (object.isRenderer() && object.properties.common.enabled.get(PZ.trapcode.currentTime) === 1) {
                    object.applyToState(state);
                }
            }
            return state;
        }
        update(e) {
            PZ.trapcode.setTime(e);
            if (!this.pointCloud) this.rebuildRenderers();
            var points = this.collectPoints();
            var colors = this._colors;
            this.applyEffectors(points, colors, e);
            this._points = points;
            var state = this.rendererState();
            this.pointCloud.visible = state.points;
            this.lineMesh.visible = state.lines || state.beams;
            this.mesh.visible = state.mesh || state.triangulation;
            // Opacity UI is 0..100, shaders expect 0..1 (old code passed 80
            // straight through, so everything looked fully opaque).
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

            var count = points.length;
            this.updateBuffer(this.pointCloud, points, colors, count);
            if (state.lines || state.beams) this.buildLines(points, colors, state);
            if (state.mesh || state.triangulation) this.buildMesh(points, colors, state);
        }
        updateBuffer(target, points, colors, count) {
            var positionAttribute = target.geometry.attributes.position;
            if (!positionAttribute || positionAttribute.count !== count) {
                target.geometry.dispose();
                var geometry = new THREE.BufferGeometry();
                geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
                geometry.addAttribute("vcolor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
                geometry.setDrawRange(0, count);
                target.geometry = geometry;
            } else {
                target.geometry.setDrawRange(0, count);
            }
            var positions = target.geometry.attributes.position.array;
            var vertexColors = target.geometry.attributes.vcolor.array;
            for (var i = 0; i < count; i++) {
                positions[i * 3] = points[i][0];
                positions[i * 3 + 1] = points[i][1];
                positions[i * 3 + 2] = points[i][2];
                var c = colors[i] || [1, 1, 1];
                vertexColors[i * 3] = c[0];
                vertexColors[i * 3 + 1] = c[1];
                vertexColors[i * 3 + 2] = c[2];
            }
            target.geometry.attributes.position.needsUpdate = true;
            target.geometry.attributes.vcolor.needsUpdate = true;
            // Setting needsUpdate recompiles the shader every frame; only do
            // it when the define actually changes.
            if (!target.material.defines.USE_VCOLOR) {
                target.material.defines.USE_VCOLOR = 1;
                target.material.needsUpdate = true;
            }
        }
        buildLines(points, colors, state) {
            var segments = [];
            var segmentColors = [];
            var limit = points.length;
            var maxDistance = Math.max(0, state.maxDistance);
            var maxConnections = Math.max(0, Math.min(10, Math.round(state.maxConnections)));
            if (!limit || !maxDistance || !maxConnections) {
                if (this.lineMesh.geometry) this.lineMesh.geometry.dispose();
                var empty = new THREE.BufferGeometry();
                empty.addAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
                empty.addAttribute("vcolor", new THREE.BufferAttribute(new Float32Array(3), 3));
                empty.setDrawRange(0, 0);
                this.lineMesh.geometry = empty;
                return;
            }
            var beams = state.beams;
            var cell = Math.max(maxDistance, 0.0001);
            var maxDistSq = maxDistance * maxDistance;
            var grid = {};
            var i;
            for (i = 0; i < limit; i++) {
                var key = Math.floor(points[i][0] / cell) + "," + Math.floor(points[i][1] / cell) + "," + Math.floor(points[i][2] / cell);
                (grid[key] || (grid[key] = [])).push(i);
            }
            for (i = 0; i < limit; i++) {
                var ax = points[i][0];
                var ay = points[i][1];
                var az = points[i][2];
                var acx = Math.floor(ax / cell);
                var acy = Math.floor(ay / cell);
                var acz = Math.floor(az / cell);
                var connections = 0;
                for (var ox = -1; ox <= 1 && connections < maxConnections; ox++) {
                    for (var oy = -1; oy <= 1 && connections < maxConnections; oy++) {
                        for (var oz = -1; oz <= 1 && connections < maxConnections; oz++) {
                            var bucket = grid[acx + ox + "," + (acy + oy) + "," + (acz + oz)];
                            if (!bucket) continue;
                            for (var bi = 0; bi < bucket.length && connections < maxConnections; bi++) {
                                var j = bucket[bi];
                                if (j <= i) continue;
                                var dx = ax - points[j][0];
                                var dy = ay - points[j][1];
                                var dz = az - points[j][2];
                                if (dx * dx + dy * dy + dz * dz >= maxDistSq) continue;
                                segments.push(ax, ay, az);
                                segments.push(points[j][0], points[j][1], points[j][2]);
                                var ci = colors[i] || [1, 1, 1];
                                var cj = colors[j] || [1, 1, 1];
                                segmentColors.push(ci[0], ci[1], ci[2], cj[0], cj[1], cj[2]);
                                connections++;
                            }
                        }
                    }
                }
            }
            if (this.lineMesh.geometry) this.lineMesh.geometry.dispose();
            var geometry = new THREE.BufferGeometry();
            geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(segments.length ? segments : [0, 0, 0]), 3));
            geometry.addAttribute("vcolor", new THREE.BufferAttribute(new Float32Array(segmentColors.length ? segmentColors : [1, 1, 1]), 3));
            if (!segments.length) geometry.setDrawRange(0, 0);
            this.lineMesh.geometry = geometry;
            var wantVColor = !beams;
            var hasVColor = !!this.lineMaterial.defines.USE_VCOLOR;
            if (wantVColor !== hasVColor) {
                if (wantVColor) this.lineMaterial.defines.USE_VCOLOR = 1;
                else delete this.lineMaterial.defines.USE_VCOLOR;
                this.lineMaterial.needsUpdate = true;
            }
        }
        buildMesh(points, colors, state) {
            var indices;
            if (state.triangulation && !state.mesh) {
                indices = triangulate(points, state.maxDistance);
            } else {
                indices = facets(points, state.maxDistance, state.maxConnections);
            }
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            var geometry = new THREE.BufferGeometry();
            var positions = new Float32Array(points.length * 3);
            for (var i = 0; i < points.length; i++) {
                positions[i * 3] = points[i][0];
                positions[i * 3 + 1] = points[i][1];
                positions[i * 3 + 2] = points[i][2];
            }
            geometry.addAttribute("position", new THREE.BufferAttribute(positions, 3));
            geometry.setIndex(indices && indices.length ? indices : []);
            if (points.length >= 3 && indices && indices.length >= 3) {
                geometry.computeVertexNormals();
            }
            this.mesh.geometry = geometry;
            // Keep mesh visible even when triangulation yields few tris so the
            // renderer does not look dead; empty geometry simply draws nothing.
            this.mesh.visible = true;
        }
        async prepare(e) {}
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
            this._imageSample = null;
            this._imageLoading = false;
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
                this.properties.renderer.rendererType.set(1);
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
        generatePoints(plexus) {
            var g = this.properties.geometry;
            var rawCount = 200;
            try {
                rawCount = g.primitiveCount.get(PZ.trapcode.currentTime);
            } catch (err) {}
            var count = Math.max(0, Math.round(rawCount));
            count = clamp(count, 0, 60000);
            if (!count) return [];
            var seed = g.randomSeed.get(PZ.trapcode.currentTime);
            var size = g.primitiveSize.get(PZ.trapcode.currentTime);
            var offset = g.position.get(PZ.trapcode.currentTime);
            var type = g.geometryType.get(PZ.trapcode.currentTime);
            var points;
            if (type === 0) {
                points = this.sampleImage(plexus, count, size);
            } else if (type === 1) {
                points = this.generatePath(count, size, g);
            } else if (type === 2) {
                points = this.sampleOBJ(plexus, count, size);
            } else if (type === 4) {
                points = this.generateInstances(count, size, g);
            } else if (type === 5) {
                points = this.generateSlicer(count, size, g);
            } else {
                points = this.generatePrimitive(count, seed, size, g.primitiveShape.get(PZ.trapcode.currentTime));
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
                // Old code used (ix+0.5)*size/perAxis-size/2, which shrinks the
                // cloud for small counts (e.g. Count 8 filled only the middle
                // half), making Size look like it depends on Count.
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
            } catch (err) {}
            // Allow 0 turns (straight radial line); was clamped to >=1 so 0 did nothing.
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
                points.push([
                    Math.cos(angle) * r,
                    (t - 0.5) * sy,
                    Math.sin(angle) * r,
                ]);
            }
            return points;
        }
        generateInstances(count, size, g) {
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
        generateSlicer(count, size, g) {
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
        sampleImage(plexus, count, size) {
            if (!this._imageSample && !this._imageLoading) this.loadImageSample(plexus);
            if (!this._imageSample) return this.generatePrimitive(count, this.properties.geometry.randomSeed.get(PZ.trapcode.currentTime), size, 1);
            var points = [];
            var sample = this._imageSample;
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
        loadImageSample(plexus) {
            this._imageLoading = true;
            var self = this;
            var value = this.properties.geometry.imageLayer.get(PZ.trapcode.currentTime);
            var project = this.tryGetParentOfType(PZ.project);
            if (!value || !project) {
                this._imageLoading = false;
                return;
            }
            var asset = new PZ.asset.image(project.assets.load(value));
            asset.loading
                .then(function () {
                    var image = asset.data.image;
                    var canvas = document.createElement("canvas");
                    var width = Math.min(image.width || 256, 256);
                    var height = Math.min(image.height || 256, 256);
                    canvas.width = width;
                    canvas.height = height;
                    var context = canvas.getContext("2d");
                    context.drawImage(image, 0, 0, width, height);
                    self._imageSample = {
                        data: context.getImageData(0, 0, width, height).data,
                        width: width,
                        height: height,
                    };
                    self._imageLoading = false;
                })
                .catch(function () {
                    self._imageLoading = false;
                });
        }
        sampleOBJ(plexus, count, size) {
            if (!count || count <= 0) return [];
            var objValue = null;
            try {
                objValue = this.properties.geometry.objFile.get(PZ.trapcode.currentTime);
            } catch (err) {}
            // Reload when the picked file changes (otherwise a stale mesh sticks).
            if (objValue !== this._objFileKey && !this._objLoading) {
                this._meshVertices = null;
                this._meshBounds = null;
                this.loadOBJ(plexus);
            } else if (!this._meshVertices && !this._objLoading) {
                this.loadOBJ(plexus);
            }
            if (!this._meshVertices || !this._meshVertices.length) {
                var seed = 0;
                try {
                    seed = this.properties.geometry.randomSeed.get(PZ.trapcode.currentTime);
                } catch (err) {}
                return this.generatePrimitive(count, seed, size, 1);
            }
            var source = this._meshVertices;
            var vertexCount = source.length / 3;
            // Normalize OBJ bounds to [-0.5, 0.5] so Size maps predictably
            // regardless of the .obj authoring scale (old code did raw*size*0.01).
            if (!this._meshBounds) this._meshBounds = computeBounds(source);
            var bounds = this._meshBounds;
            var spanX = Math.max(bounds.maxX - bounds.minX, 0.0001);
            var spanY = Math.max(bounds.maxY - bounds.minY, 0.0001);
            var spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.0001);
            var cx = (bounds.minX + bounds.maxX) / 2;
            var cy = (bounds.minY + bounds.maxY) / 2;
            var cz = (bounds.minZ + bounds.maxZ) / 2;
            var sx = (size && size[0] !== undefined) ? size[0] : 500;
            var sy = (size && size[1] !== undefined) ? size[1] : 500;
            var sz = (size && size[2] !== undefined) ? size[2] : 500;
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
        loadOBJ(plexus) {
            var self = this;
            var value = null;
            try {
                value = this.properties.geometry.objFile.get(PZ.trapcode.currentTime);
            } catch (err) {}
            var project = this.tryGetParentOfType(PZ.project);
            if (!value || !project) return;
            this._objFileKey = value;
            this._objLoading = true;
            var asset = null;
            try {
                asset = new PZ.asset.geometry(project.assets.load(value));
            } catch (err) {
                self._objLoading = false;
                return;
            }
            var done = function (positions) {
                if (positions && positions.length >= 3) {
                    self._meshVertices = positions;
                    self._meshBounds = null;
                }
                self._objLoading = false;
            };
            // PZ.asset.geometry.getGeometry() only understands JSON
            // (BufferGeometry JSON). For real .obj files read the raw text and
            // parse with THREE.OBJLoader (or a minimal `v ` fallback).
            var readText = null;
            try {
                readText = asset.readFile();
            } catch (err) {
                readText = null;
            }
            if (readText && typeof readText.then === "function") {
                readText
                    .then(function (text) {
                        var positions = parseGeometryText(text);
                        if (positions) {
                            done(positions);
                            return;
                        }
                        // Fall back to the JSON loader for legacy .json models.
                        asset.getGeometry().then(function (geometry) {
                            if (geometry && geometry.attributes && geometry.attributes.position) {
                                done(Array.prototype.slice.call(geometry.attributes.position.array));
                            } else {
                                self._objLoading = false;
                            }
                        }).catch(function () {
                            self._objLoading = false;
                        });
                    })
                    .catch(function () {
                        self._objLoading = false;
                    });
            } else {
                asset.getGeometry()
                    .then(function (geometry) {
                        if (geometry && geometry.attributes && geometry.attributes.position) {
                            self._meshVertices = Array.prototype.slice.call(geometry.attributes.position.array);
                            self._meshBounds = null;
                        }
                        self._objLoading = false;
                    })
                    .catch(function () {
                        self._objLoading = false;
                    });
            }
        }
        applyTo(points, colors, time, plexus) {
            var e = this.properties.effector;
            // NOTE: subType is only the creation-time hint. The live dropdown
            // is effectorType, so dispatch on the property (fixes all effectors
            // except noise appearing dead after switching the dropdown).
            var effType = this.subType;
            try {
                if (e && e.effectorType) effType = e.effectorType.get(PZ.trapcode.currentTime);
            } catch (err) {}
            effType = Math.max(0, Math.round(effType));
            this.subType = effType;
            if (effType === 0) {
                var nAmount = e.noiseAmount.get(PZ.trapcode.currentTime);
                var scale = Math.max(e.noiseScale.get(PZ.trapcode.currentTime), 0.0001);
                var flow = time * 0.05;
                for (var i = 0; i < points.length; i++) {
                    var n = fbm2(points[i][0] * 0.01 / scale, points[i][2] * 0.01 / scale + flow, 0);
                    points[i][1] += n * nAmount;
                }
            } else if (effType === 1) {
                this.applySpherical(points, e.strength.get(PZ.trapcode.currentTime) / 100, e.position.get(PZ.trapcode.currentTime), e.radius.get(PZ.trapcode.currentTime));
            } else if (effType === 2) {
                this.applyContainer(points, e);
            } else if (effType === 3) {
                this.applyTransform(points, e);
            } else if (effType === 4) {
                this.applyColorMap(points, colors, e);
            } else if (effType === 5) {
                this.applyShade(points, colors, e);
            } else if (effType === 6) {
                this.applySound(points, time, e);
            }
        }
        applySpherical(points, strength, center, radius) {
            radius = Math.max(radius, 0.0001);
            strength = Math.max(-4, Math.min(4, strength));
            for (var i = 0; i < points.length; i++) {
                var dx = points[i][0] - center[0];
                var dy = points[i][1] - center[1];
                var dz = points[i][2] - center[2];
                var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist < 0.0001) {
                    // Push degenerate points out along +X so strength is visible.
                    points[i][0] = center[0] + radius * 0.05 * (strength >= 0 ? 1 : -1);
                    continue;
                }
                // Visible falloff: full strength at center, zero at radius.
                // Old formula (radius/dist)*0.05 was ~2% at dist==radius.
                var falloff = Math.max(0, 1 - dist / radius);
                var f = 1 + strength * falloff;
                // Outside the radius keep a gentle push so large clouds still move.
                if (falloff <= 0) f = 1 + strength * (radius / dist) * 0.1;
                points[i][0] = center[0] + dx * f;
                points[i][1] = center[1] + dy * f;
                points[i][2] = center[2] + dz * f;
            }
        }
        applyContainer(points, e) {
            var center = e.position.get(PZ.trapcode.currentTime);
            var half = e.containerSize.get(PZ.trapcode.currentTime);
            for (var i = 0; i < points.length; i++) {
                for (var axis = 0; axis < 3; axis++) {
                    var halfSize = Math.max(half[axis] / 2, 0.0001);
                    var min = center[axis] - halfSize;
                    var max = center[axis] + halfSize;
                    if (points[i][axis] < min) points[i][axis] = min;
                    else if (points[i][axis] > max) points[i][axis] = max;
                }
            }
        }
        applyTransform(points, e) {
            var scale = e.transformScale.get(PZ.trapcode.currentTime) / 100;
            var rotation = e.transformRotation.get(PZ.trapcode.currentTime);
            var rx = (rotation[0] * Math.PI) / 180;
            var ry = (rotation[1] * Math.PI) / 180;
            var rz = (rotation[2] * Math.PI) / 180;
            var cx = Math.cos(rx);
            var sx = Math.sin(rx);
            var cy = Math.cos(ry);
            var sy = Math.sin(ry);
            var cz = Math.cos(rz);
            var sz = Math.sin(rz);
            var offset = e.position.get(PZ.trapcode.currentTime);
            for (var i = 0; i < points.length; i++) {
                var x = points[i][0] * scale;
                var y = points[i][1] * scale;
                var z = points[i][2] * scale;
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
                points[i][0] = x + offset[0];
                points[i][1] = y + offset[1];
                points[i][2] = z + offset[2];
            }
        }
        applyColorMap(points, colors, e) {
            if (!colors) return;
            var mode = e.colorMapMode ? e.colorMapMode.get(PZ.trapcode.currentTime) : 0;
            var a = e.color.get(PZ.trapcode.currentTime);
            var b = e.color2 ? e.color2.get(PZ.trapcode.currentTime) : [1, 1, 1];
            var min = 0;
            var max = 1;
            for (var i = 0; i < points.length; i++) {
                var value;
                if (mode === 0) value = i / Math.max(points.length - 1, 1);
                else if (mode === 1) value = points[i][1] * 0.001 + 0.5;
                else value = Math.sqrt(points[i][0] * points[i][0] + points[i][1] * points[i][1] + points[i][2] * points[i][2]) * 0.001;
                value = clamp(value, min, max);
                colors[i] = [
                    a[0] + (b[0] - a[0]) * value,
                    a[1] + (b[1] - a[1]) * value,
                    a[2] + (b[2] - a[2]) * value,
                ];
            }
        }
        applyShade(points, colors, e) {
            if (!colors) return;
            var a = e.color.get(PZ.trapcode.currentTime);
            for (var i = 0; i < points.length; i++) {
                var dist = Math.sqrt(points[i][0] * points[i][0] + points[i][1] * points[i][1] + points[i][2] * points[i][2]);
                var shade = clamp(1 - dist / 800, 0.1, 1);
                colors[i] = [a[0] * shade, a[1] * shade, a[2] * shade];
            }
        }
        applySound(points, time, e) {
            var amplitude = 0.5;
            if (typeof CM !== "undefined" && CM.playback && CM.playback.audioDst) {
                try {
                    var analyser = CM.playback.audioDst;
                    var buffer = new Uint8Array(analyser.frequencyBinCount);
                    analyser.getByteFrequencyData(buffer);
                    var sum = 0;
                    for (var i = 0; i < buffer.length; i++) sum += buffer[i];
                    amplitude = sum / buffer.length / 255;
                } catch (err) {
                    amplitude = 0.5 + Math.sin(time * 0.1) * 0.5;
                }
            } else {
                amplitude = 0.5 + Math.sin(time * 0.1) * 0.5;
            }
            var strength = e.soundStrength ? e.soundStrength.get(PZ.trapcode.currentTime) : 100;
            var scale = 1 + amplitude * (strength / 100);
            for (var j = 0; j < points.length; j++) {
                points[j][0] *= scale;
                points[j][1] *= scale;
                points[j][2] *= scale;
            }
        }
        applyToState(state) {
            var r = this.properties.renderer;
            var color = r.color.get(PZ.trapcode.currentTime);
            state.color = [color[0], color[1], color[2]];
            state.opacity = r.opacity.get(PZ.trapcode.currentTime);
            var type = r.rendererType.get(PZ.trapcode.currentTime);
            // Keep subType in sync so designer labels stay correct.
            this.subType = Math.max(0, Math.round(type));
            if (type === 0) {
                state.points = true;
                var sz = r.size.get(PZ.trapcode.currentTime);
                state.size = Math.max(0, Math.min(10, sz));
            } else if (type === 1) {
                state.lines = true;
                state.maxDistance = Math.max(0, r.maxDistance.get(PZ.trapcode.currentTime));
                state.maxConnections = Math.max(0, Math.min(10, Math.round(r.maxConnections.get(PZ.trapcode.currentTime))));
            } else if (type === 2) {
                state.mesh = true;
                state.maxDistance = Math.max(0, r.maxDistance.get(PZ.trapcode.currentTime));
                state.maxConnections = Math.max(0, Math.min(10, Math.round(r.maxConnections.get(PZ.trapcode.currentTime))));
                state.ambient = r.ambient.get(PZ.trapcode.currentTime) / 100;
                state.diffuse = r.diffuse.get(PZ.trapcode.currentTime) / 100;
                state.specular = r.specular.get(PZ.trapcode.currentTime) / 100;
            } else if (type === 3) {
                state.triangulation = true;
                state.maxDistance = Math.max(0, r.maxDistance.get(PZ.trapcode.currentTime));
                state.ambient = r.ambient.get(PZ.trapcode.currentTime) / 100;
                state.diffuse = r.diffuse.get(PZ.trapcode.currentTime) / 100;
                state.specular = r.specular.get(PZ.trapcode.currentTime) / 100;
            } else if (type === 4) {
                state.beams = true;
                state.maxDistance = Math.max(0, r.maxDistance.get(PZ.trapcode.currentTime));
                state.maxConnections = Math.max(0, Math.min(10, Math.round(r.maxConnections.get(PZ.trapcode.currentTime))));
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
            if (this.objectKind === KIND_GEOMETRY) {
                var type;
                if (hasSavedType) {
                    type = this.properties.geometry.geometryType.get(PZ.trapcode.currentTime);
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
                // Keep creation hint in sync with the live dropdown.
                try {
                    var et = this.properties.effector.effectorType.get(PZ.trapcode.currentTime);
                    if (et !== undefined && et !== null) this.subType = Math.max(0, Math.min(6, Math.round(et)));
                } catch (err) {}
            } else if (this.objectKind === KIND_RENDERER) {
                try {
                    var rt = this.properties.renderer.rendererType.get(PZ.trapcode.currentTime);
                    if (rt !== undefined && rt !== null) this.subType = Math.max(0, Math.min(4, Math.round(rt)));
                } catch (err) {}
            }
            if (!this.properties.common.name.get(PZ.trapcode.currentTime)) {
                this.properties.common.name.set(this.properties.name.get(PZ.trapcode.currentTime) || "Object");
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
            this._imageSample = null;
            this._imageLoading = false;
            this._meshVertices = null;
            this._meshBounds = null;
            this._objLoading = false;
            this._objFileKey = null;
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
            changed: function () {
                // Drop cached vertices so a newly picked .obj reloads.
                if (this.parentObject) {
                    this.parentObject._meshVertices = null;
                    this.parentObject._objLoading = false;
                }
            },
        },
        randomSeed: number("Random seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.plexus.object.effectorDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Effector", visible: false },
        effectorType: option("Effector type", 0, "noise;spherical field;container;transform;color map;shade;sound", true),
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
        soundStrength: number("Sound strength", 100, { min: 0, step: 1 }),
    };

    PZ.object3d.plexus.object.rendererDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Renderer", visible: false },
        rendererType: option("Renderer type", 1, "points;lines;facets;triangulation;beams", true),
        size: number("Point size", 4, { min: 0, max: 10, step: 0.1, decimals: 2 }),
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
            } catch (err) {}
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
                        if (child && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
                            var arr = child.geometry.attributes.position.array;
                            for (var i = 0; i < arr.length; i++) collected.push(arr[i]);
                        } else if (child && child.isMesh && child.geometry) {
                            var pos = child.geometry.attributes && child.geometry.attributes.position;
                            if (pos) {
                                for (var j = 0; j < pos.array.length; j++) collected.push(pos.array[j]);
                            }
                        }
                    });
                }
                if (collected.length >= 3) return collected;
            }
        } catch (err) {}
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
        } catch (err) {}
        return null;
    }

    function facets(points, maxDistance, maxConnections) {
        var indices = [];
        var limit = Math.min(points.length, 4000);
        var maxConnections = Math.max(0, Math.min(10, Math.round(maxConnections)));
        if (!limit || !maxDistance || !maxConnections) return indices;
        for (var i = 0; i < limit; i++) {
            var connections = [];
            for (var j = i + 1; j < limit && connections.length < maxConnections; j++) {
                var dx = points[i][0] - points[j][0];
                var dy = points[i][1] - points[j][1];
                var dz = points[i][2] - points[j][2];
                if (dx * dx + dy * dy + dz * dz < maxDistance * maxDistance) connections.push(j);
            }
            for (var k = 0; k < connections.length - 1; k += 2) {
                indices.push(i, connections[k], connections[k + 1]);
            }
        }
        return indices;
    }

    function triangulate(points, maxDistance) {
        var limit = Math.min(points.length, 4000);
        if (limit < 3) return [];
        maxDistance = Math.max(maxDistance, 0.0001);
        var cell = maxDistance;
        var grid = {};
        function key(cx, cy, cz) {
            return cx + "," + cy + "," + cz;
        }
        for (var i = 0; i < limit; i++) {
            var cx = Math.floor(points[i][0] / cell);
            var cy = Math.floor(points[i][1] / cell);
            var cz = Math.floor(points[i][2] / cell);
            var k = key(cx, cy, cz);
            (grid[k] || (grid[k] = [])).push(i);
        }
        var indices = [];
        var seen = {};
        var maxDistSq = maxDistance * maxDistance;
        var maxTriangles = 20000;
        for (var a = 0; a < limit && indices.length < maxTriangles * 3; a++) {
            var ax = points[a][0];
            var ay = points[a][1];
            var az = points[a][2];
            var acx = Math.floor(ax / cell);
            var acy = Math.floor(ay / cell);
            var acz = Math.floor(az / cell);
            var near = [];
            for (var ox = -1; ox <= 1; ox++) {
                for (var oy = -1; oy <= 1; oy++) {
                    for (var oz = -1; oz <= 1; oz++) {
                        var bucket = grid[key(acx + ox, acy + oy, acz + oz)];
                        if (bucket) {
                            for (var bi = 0; bi < bucket.length; bi++) {
                                var idx = bucket[bi];
                                if (idx === a) continue;
                                var ddx = points[idx][0] - ax;
                                var ddy = points[idx][1] - ay;
                                var ddz = points[idx][2] - az;
                                if (ddx * ddx + ddy * ddy + ddz * ddz <= maxDistSq) near.push(idx);
                            }
                        }
                        if (near.length > 64) break;
                    }
                    if (near.length > 64) break;
                }
                if (near.length > 64) break;
            }
            if (near.length < 2) continue;
            near.sort(function (p, q) {
                var pdx = points[p][0] - ax;
                var pdy = points[p][1] - ay;
                var pdz = points[p][2] - az;
                var qdx = points[q][0] - ax;
                var qdy = points[q][1] - ay;
                var qdz = points[q][2] - az;
                return pdx * pdx + pdy * pdy + pdz * pdz - (qdx * qdx + qdy * qdy + qdz * qdz);
            });
            var candidates = near.slice(0, 10);
            for (var m = 0; m < candidates.length && indices.length < maxTriangles * 3; m++) {
                for (var n = m + 1; n < candidates.length && indices.length < maxTriangles * 3; n++) {
                    var b = candidates[m];
                    var c = candidates[n];
                    if (b === a || c === a || b === c) continue;
                    if (pointDistSq(points, b, c) > maxDistSq) continue;
                    // Skip degenerate (zero-area) triangles.
                    if (triangleAreaSq(points, a, b, c) < 1e-8) continue;
                    // Normalize key so each triangle is emitted once.
                    var t = [a, b, c].sort(function (x, y) { return x - y; });
                    var tkey = t[0] + "_" + t[1] + "_" + t[2];
                    if (seen[tkey]) continue;
                    seen[tkey] = 1;
                    indices.push(t[0], t[1], t[2]);
                    // One fan triangle per neighbor pair is enough; cap fan-out
                    // so dense clouds do not explode into overlapping sheets.
                    if ((n - m) > 4) break;
                }
            }
        }
        // Fallback: if maxDistance was tiny relative to spacing, connect
        // k-nearest anyway so Triangulation never renders completely empty.
        if (!indices.length && limit >= 3) {
            for (var f = 0; f + 2 < limit && indices.length < maxTriangles * 3; f += 3) {
                if (triangleAreaSq(points, f, f + 1, f + 2) >= 1e-8) {
                    indices.push(f, f + 1, f + 2);
                }
            }
        }
        return indices;
    }

    function triangleAreaSq(points, i, j, k) {
        var ax = points[j][0] - points[i][0];
        var ay = points[j][1] - points[i][1];
        var az = points[j][2] - points[i][2];
        var bx = points[k][0] - points[i][0];
        var by = points[k][1] - points[i][1];
        var bz = points[k][2] - points[i][2];
        var cx = ay * bz - az * by;
        var cy = az * bx - ax * bz;
        var cz = ax * by - ay * bx;
        return cx * cx + cy * cy + cz * cz;
    }

    function pointDistSq(points, i, j) {
        var dx = points[i][0] - points[j][0];
        var dy = points[i][1] - points[j][1];
        var dz = points[i][2] - points[j][2];
        return dx * dx + dy * dy + dz * dz;
    }

    function hasPointInside(points, limit, i, j, k) {
        var ax = points[i][0];
        var ay = points[i][1];
        var bx = points[j][0];
        var by = points[j][1];
        var cx = points[k][0];
        var cy = points[k][1];
        var d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 0.00001) return true;
        var checks = Math.min(limit, 40);
        for (var p = 0; p < checks; p++) {
            if (p === i || p === j || p === k) continue;
            var px = points[p][0];
            var py = points[p][1];
            var l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
            var l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
            var l3 = 1 - l1 - l2;
            if (l1 > 0 && l2 > 0 && l3 > 0) return true;
        }
        return false;
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
                return (object.properties.common.name.get(PZ.trapcode.currentTime) || "Object") + " (" + index + ")";
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
        for (var i = 0; i < root.objects.length; i++) {
            var o = root.objects[i];
            if (o.isGeometry && o.isGeometry()) {
                if (!geo) geo = o;
            } else if (o.isEffector && o.isEffector()) {
                if (!noise) noise = o;
            } else if (o.isRenderer && o.isRenderer()) {
                var type = o.properties.renderer.rendererType.get(PZ.trapcode.currentTime);
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
