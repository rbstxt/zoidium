// Effector+ — deformer base class plus Twist, Warp, and Voronoi Fracture
// (extracted verbatim from the OpenZoid core).
    (PZ.object3d.deformer = class extends PZ.object3d {
        constructor() {
            super(),
                (this.threeObj = null),
                this.properties.addAll(PZ.object3d.deformer.propertyDefinitions),
                (this.objects = new PZ.objectList(this, PZ.object3d)),
                this.children.push(this.objects);
        }
        load(e) {
            this.threeObj = new THREE.Object3D();
            this.properties.load(e && e.properties);
            this.properties.name.set(PZ.object3d.getName(this));
            if (e && "object" == typeof e && e.objects)
                for (let t = 0; t < e.objects.length; t++) {
                    let r = PZ.object3d.create(e.objects[t].type);
                    this.objects.push(r), (r.loading = r.load(e.objects[t]));
                }
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, properties: this.properties, objects: this.objects };
        }
        unload() {
            PZ.object3d.deform.restore(this);
            for (let e = 0; e < this.objects.length; e++) this.objects[e].unload();
        }
        update(e) {
            for (let t = 0; t < this.objects.length; t++) this.objects[t].update(e);
        }
        async prepare(e) {
            for (let t = 0; t < this.objects.length; t++) await this.objects[t].loading, await this.objects[t].prepare(e);
        }
    }),
    (PZ.object3d.deformer.propertyDefinitions = {
        enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    }),
    (PZ.object3d.twist = class extends PZ.object3d.deformer {
        constructor() {
            super(), this.properties.addAll(PZ.object3d.twist.propertyDefinitions);
        }
        deformPositions(positions, time, data, mesh) {
            let angle = this.properties.angle.get(time);
            if (!angle) return positions;
            let axis = this.properties.axis.get(time) | 0;
            let min = data.min[axis];
            let max = data.max[axis];
            let size = max - min;
            if (!(size > 0)) return positions;
            let pivot = 0.5 * (min + max) + this.properties.offset.get(time);
            let pair = PZ.object3d.twist.axes[axis];
            let a = pair[0];
            let b = pair[1];
            for (let i = 0; i + 2 < positions.length; i += 3) {
                let theta = angle * ((positions[i + axis] - pivot) / size);
                let cos = Math.cos(theta);
                let sin = Math.sin(theta);
                let valueA = positions[i + a];
                let valueB = positions[i + b];
                positions[i + a] = valueA * cos - valueB * sin;
                positions[i + b] = valueA * sin + valueB * cos;
            }
            return positions;
        }
    }),
    (PZ.object3d.twist.propertyDefinitions = {
        axis: { name: "Axis", type: PZ.property.type.OPTION, value: 1, items: "X;Y;Z" },
        angle: {
            dynamic: true,
            name: "Angle",
            type: PZ.property.type.NUMBER,
            value: 0,
            max: 1440,
            min: -1440,
            step: 1,
            decimals: 1,
            scaleFactor: Math.PI / 180,
        },
        offset: { dynamic: true, name: "Offset", type: PZ.property.type.NUMBER, value: 0, step: 1, decimals: 2 },
    }),
    (PZ.object3d.twist.axes = [
        [1, 2],
        [2, 0],
        [0, 1],
    ]),
    (PZ.object3d.twist.prototype.defaultName = "Twist"),
    (PZ.object3d.warp = class extends PZ.object3d.deformer {
        constructor() {
            super(), this.properties.addAll(PZ.object3d.warp.propertyDefinitions);
        }
        deformPositions(positions, time, data, mesh) {
            let strength = this.properties.amount.get(time);
            if (!strength) return positions;
            let pair = PZ.object3d.warp.axes[this.properties.axis.get(time) | 0];
            let u = pair[0];
            let v = pair[1];
            let min = data.min[u];
            let max = data.max[u];
            let size = max - min;
            if (!(size > 0)) return positions;
            let pivot = 0.5 * (min + max) + this.properties.offset.get(time);
            let k = strength / size;
            let fieldType = this.properties.field.get(time) | 0;
            let fieldPosition = fieldType ? this.properties.fieldPosition.get(time) : null;
            let fieldScale = fieldType ? this.properties.fieldScale.get(time) : null;
            for (let i = 0; i + 2 < positions.length; i += 3) {
                let weight = 1;
                if (fieldType) {
                    weight = PZ.object3d.deform.fieldWeight(
                        positions[i],
                        positions[i + 1],
                        positions[i + 2],
                        fieldType,
                        fieldPosition,
                        fieldScale
                    );
                    if (weight <= 0) continue;
                }
                let kEff = k * weight;
                if (!kEff) continue;
                let radius = 1 / kEff;
                let along = positions[i + u] - pivot;
                let theta = along * kEff;
                positions[i + u] = pivot + radius * Math.sin(theta);
                positions[i + v] += radius * (1 - Math.cos(theta));
            }
            return positions;
        }
    }),
    (PZ.object3d.warp.propertyDefinitions = Object.assign(
        {
            axis: { name: "Axis", type: PZ.property.type.OPTION, value: 0, items: "X;Z" },
            amount: {
                dynamic: true,
                name: "Strength",
                type: PZ.property.type.NUMBER,
                value: 0,
                max: 720,
                min: -720,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
            offset: { dynamic: true, name: "Offset", type: PZ.property.type.NUMBER, value: 0, step: 1, decimals: 2 },
        },
        PZ.object3d.deform.fieldPropertyDefinitions
    )),
    (PZ.object3d.warp.axes = [
        [0, 1],
        [0, 2],
    ]),
    (PZ.object3d.warp.prototype.defaultName = "Warp"),
    (PZ.object3d.voronoi = class extends PZ.object3d.deformer {
        constructor() {
            super(), (this.cache = new Map()), this.properties.addAll(PZ.object3d.voronoi.propertyDefinitions);
        }
        buildCells(data, cellCount, seed, closed, inputPositions) {
            let positions = data.positions;
            let index = data.index;
            let sourceTriangleCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
            let sizeX = data.max[0] - data.min[0] || 1;
            let sizeY = data.max[1] - data.min[1] || 1;
            let sizeZ = data.max[2] - data.min[2] || 1;
            let maxSize = Math.max(sizeX, sizeY, sizeZ) || 1;
            let inverseMax = 1 / maxSize;
            let rng = PZ.object3d.deform.rng(seed);
            let targetEdge = Math.sqrt(sizeX * sizeX + sizeY * sizeY + sizeZ * sizeZ) / (Math.sqrt(cellCount) * 4) || 1;
            let targetSquared = targetEdge * targetEdge;
            let maxDepth = 5;
            let maxTriangles = 98304;
            let tessPositions = [];
            let tessNormals = data.normals ? [] : null;
            let tessUvs = data.uvs ? [] : null;
            let emitTriangle = function (a, b, c, depth) {
                let abx = b[0] - a[0];
                let aby = b[1] - a[1];
                let abz = b[2] - a[2];
                let bcx = c[0] - b[0];
                let bcy = c[1] - b[1];
                let bcz = c[2] - b[2];
                let cax = a[0] - c[0];
                let cay = a[1] - c[1];
                let caz = a[2] - c[2];
                let ab = abx * abx + aby * aby + abz * abz;
                let bc = bcx * bcx + bcy * bcy + bcz * bcz;
                let ca = cax * cax + cay * cay + caz * caz;
                let maxSquared = Math.max(ab, bc, ca);
                if (depth < maxDepth && maxSquared > targetSquared && tessPositions.length / 9 < maxTriangles) {
                    let abMid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2, (a[4] + b[4]) / 2, (a[5] + b[5]) / 2, (a[6] + b[6]) / 2, (a[7] + b[7]) / 2];
                    let bcMid = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2, (b[3] + c[3]) / 2, (b[4] + c[4]) / 2, (b[5] + c[5]) / 2, (b[6] + c[6]) / 2, (b[7] + c[7]) / 2];
                    let caMid = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2, (c[3] + a[3]) / 2, (c[4] + a[4]) / 2, (c[5] + a[5]) / 2, (c[6] + a[6]) / 2, (c[7] + a[7]) / 2];
                    emitTriangle(a, abMid, caMid, depth + 1);
                    emitTriangle(abMid, b, bcMid, depth + 1);
                    emitTriangle(caMid, bcMid, c, depth + 1);
                    emitTriangle(abMid, bcMid, caMid, depth + 1);
                    return;
                }
                tessPositions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
                if (tessNormals) {
                    let an = Math.sqrt(a[3] * a[3] + a[4] * a[4] + a[5] * a[5]) || 1;
                    let bn = Math.sqrt(b[3] * b[3] + b[4] * b[4] + b[5] * b[5]) || 1;
                    let cn = Math.sqrt(c[3] * c[3] + c[4] * c[4] + c[5] * c[5]) || 1;
                    tessNormals.push(
                        a[3] / an,
                        a[4] / an,
                        a[5] / an,
                        b[3] / bn,
                        b[4] / bn,
                        b[5] / bn,
                        c[3] / cn,
                        c[4] / cn,
                        c[5] / cn
                    );
                }
                if (tessUvs) tessUvs.push(a[6], a[7], b[6], b[7], c[6], c[7]);
            };
            for (let t = 0; t < sourceTriangleCount; t++) {
                let i0 = index ? index[t * 3] : t * 3;
                let i1 = index ? index[t * 3 + 1] : t * 3 + 1;
                let i2 = index ? index[t * 3 + 2] : t * 3 + 2;
                let a = [
                    inputPositions[i0 * 3],
                    inputPositions[i0 * 3 + 1],
                    inputPositions[i0 * 3 + 2],
                    data.normals ? data.normals[i0 * 3] : 0,
                    data.normals ? data.normals[i0 * 3 + 1] : 0,
                    data.normals ? data.normals[i0 * 3 + 2] : 1,
                    data.uvs ? data.uvs[i0 * 2] : 0,
                    data.uvs ? data.uvs[i0 * 2 + 1] : 0,
                ];
                let b = [
                    inputPositions[i1 * 3],
                    inputPositions[i1 * 3 + 1],
                    inputPositions[i1 * 3 + 2],
                    data.normals ? data.normals[i1 * 3] : 0,
                    data.normals ? data.normals[i1 * 3 + 1] : 0,
                    data.normals ? data.normals[i1 * 3 + 2] : 1,
                    data.uvs ? data.uvs[i1 * 2] : 0,
                    data.uvs ? data.uvs[i1 * 2 + 1] : 0,
                ];
                let c = [
                    inputPositions[i2 * 3],
                    inputPositions[i2 * 3 + 1],
                    inputPositions[i2 * 3 + 2],
                    data.normals ? data.normals[i2 * 3] : 0,
                    data.normals ? data.normals[i2 * 3 + 1] : 0,
                    data.normals ? data.normals[i2 * 3 + 2] : 1,
                    data.uvs ? data.uvs[i2 * 2] : 0,
                    data.uvs ? data.uvs[i2 * 2 + 1] : 0,
                ];
                emitTriangle(a, b, c, 0);
            }
            let surfacePositions = new Float32Array(tessPositions);
            let surfaceNormals = tessNormals ? new Float32Array(tessNormals) : null;
            let surfaceUvs = tessUvs ? new Float32Array(tessUvs) : null;
            let triangleCount = Math.floor(surfacePositions.length / 9);
            let vertexCount = triangleCount * 3;
            let seeds = new Float32Array(cellCount * 3);
            for (let c = 0; c < cellCount; c++) {
                seeds[c * 3] = data.min[0] + rng() * sizeX;
                seeds[c * 3 + 1] = data.min[1] + rng() * sizeY;
                seeds[c * 3 + 2] = data.min[2] + rng() * sizeZ;
            }
            let triangleCell = new Uint16Array(triangleCount);
            let cellSums = new Float64Array(cellCount * 3);
            let cellCounts = new Uint32Array(cellCount);
            for (let t = 0; t < triangleCount; t++) {
                let o = t * 9;
                let x = (surfacePositions[o] + surfacePositions[o + 3] + surfacePositions[o + 6]) / 3;
                let y = (surfacePositions[o + 1] + surfacePositions[o + 4] + surfacePositions[o + 7]) / 3;
                let z = (surfacePositions[o + 2] + surfacePositions[o + 5] + surfacePositions[o + 8]) / 3;
                let best = 0;
                let bestDistance = Number.POSITIVE_INFINITY;
                for (let c = 0; c < cellCount; c++) {
                    let dx = (x - seeds[c * 3]) * inverseMax;
                    let dy = (y - seeds[c * 3 + 1]) * inverseMax;
                    let dz = (z - seeds[c * 3 + 2]) * inverseMax;
                    let distance = dx * dx + dy * dy + dz * dz;
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = c;
                    }
                }
                triangleCell[t] = best;
                cellSums[best * 3] += x;
                cellSums[best * 3 + 1] += y;
                cellSums[best * 3 + 2] += z;
                cellCounts[best]++;
            }
            let centerX = 0.5 * (data.min[0] + data.max[0]);
            let centerY = 0.5 * (data.min[1] + data.max[1]);
            let centerZ = 0.5 * (data.min[2] + data.max[2]);
            let centers = new Float32Array(cellCount * 3);
            let directions = new Float32Array(cellCount * 3);
            let axes = new Float32Array(cellCount * 3);
            let spins = new Float32Array(cellCount);
            let scatters = new Float32Array(cellCount * 3);
            let cellColors = new Float32Array(cellCount * 3);
            let colorRng = PZ.object3d.deform.rng((seed || 0) + 1);
            for (let c = 0; c < cellCount; c++) {
                let count = cellCounts[c];
                let cx = count > 0 ? cellSums[c * 3] / count : seeds[c * 3];
                let cy = count > 0 ? cellSums[c * 3 + 1] / count : seeds[c * 3 + 1];
                let cz = count > 0 ? cellSums[c * 3 + 2] / count : seeds[c * 3 + 2];
                centers[c * 3] = cx;
                centers[c * 3 + 1] = cy;
                centers[c * 3 + 2] = cz;
                let dx = cx - centerX;
                let dy = cy - centerY;
                let dz = cz - centerZ;
                let length = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (length < 1e-6) {
                    dx = rng() * 2 - 1;
                    dy = rng() * 2 - 1;
                    dz = rng() * 2 - 1;
                    length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                }
                directions[c * 3] = dx / length;
                directions[c * 3 + 1] = dy / length;
                directions[c * 3 + 2] = dz / length;
                let ax = rng() * 2 - 1;
                let ay = rng() * 2 - 1;
                let az = rng() * 2 - 1;
                let axisLength = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
                axes[c * 3] = ax / axisLength;
                axes[c * 3 + 1] = ay / axisLength;
                axes[c * 3 + 2] = az / axisLength;
                spins[c] = rng() * 2 - 1;
                let sx = rng() * 2 - 1;
                let sy = rng() * 2 - 1;
                let sz = rng() * 2 - 1;
                let scatterLength = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                let scatterMagnitude = 0.5 + rng();
                scatters[c * 3] = (sx / scatterLength) * scatterMagnitude;
                scatters[c * 3 + 1] = (sy / scatterLength) * scatterMagnitude;
                scatters[c * 3 + 2] = (sz / scatterLength) * scatterMagnitude;
                let color = new THREE.Color().setHSL(colorRng(), 0.45 + 0.2 * colorRng(), 0.55 + 0.15 * colorRng());
                cellColors[c * 3] = color.r;
                cellColors[c * 3 + 1] = color.g;
                cellColors[c * 3 + 2] = color.b;
            }
            let innerCount = 0;
            let innerCells = [];
            let innerA = [];
            let innerB = [];
            let innerC = [];
            let loopCenters = [];
            let triangulateLoop = function (loop) {
                let count = loop.length;
                if (count < 3) return null;
                if (count > 512) return null;
                if (count === 3) return [loop[0], loop[1], loop[2]];
                let nx = 0;
                let ny = 0;
                let nz = 0;
                for (let i = 0; i < count; i++) {
                    let a = loop[i];
                    let b = loop[(i + 1) % count];
                    let ax = surfacePositions[a * 3];
                    let ay = surfacePositions[a * 3 + 1];
                    let az = surfacePositions[a * 3 + 2];
                    let bx = surfacePositions[b * 3];
                    let by = surfacePositions[b * 3 + 1];
                    let bz = surfacePositions[b * 3 + 2];
                    nx += (ay - by) * (az + bz);
                    ny += (az - bz) * (ax + bx);
                    nz += (ax - bx) * (ay + by);
                }
                let normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (!(normalLength > 0)) return null;
                nx /= normalLength;
                ny /= normalLength;
                nz /= normalLength;
                let upX = 0;
                let upY = 0;
                let upZ = 0;
                if (Math.abs(nx) < 0.9) upX = 1;
                else upY = 1;
                let ux = ny * upZ - nz * upY;
                let uy = nz * upX - nx * upZ;
                let uz = nx * upY - ny * upX;
                let uLength = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
                ux /= uLength;
                uy /= uLength;
                uz /= uLength;
                let vx = ny * uz - nz * uy;
                let vy = nz * ux - nx * uz;
                let vz = nx * uy - ny * ux;
                let px = new Float32Array(count);
                let py = new Float32Array(count);
                for (let i = 0; i < count; i++) {
                    let a = loop[i];
                    let ax = surfacePositions[a * 3];
                    let ay = surfacePositions[a * 3 + 1];
                    let az = surfacePositions[a * 3 + 2];
                    px[i] = ax * ux + ay * uy + az * uz;
                    py[i] = ax * vx + ay * vy + az * vz;
                }
                let order = [];
                for (let i = 0; i < count; i++) order.push(i);
                let area = 0;
                for (let i = 0; i < count; i++) {
                    let j = (i + 1) % count;
                    area += px[i] * py[j] - px[j] * py[i];
                }
                if (area < 0) order.reverse();
                let inside = function (ax, ay, bx, by, cx, cy, tx, ty) {
                    let d1 = (bx - ax) * (ty - ay) - (by - ay) * (tx - ax);
                    let d2 = (cx - bx) * (ty - by) - (cy - by) * (tx - bx);
                    let d3 = (ax - cx) * (ty - cy) - (ay - cy) * (tx - cx);
                    return d1 >= 0 && d2 >= 0 && d3 >= 0;
                };
                let triangles = [];
                let guard = 0;
                while (order.length > 3 && guard++ < count * count) {
                    let earFound = false;
                    for (let i = 0; i < order.length; i++) {
                        let i0 = order[(i + order.length - 1) % order.length];
                        let i1 = order[i];
                        let i2 = order[(i + 1) % order.length];
                        let ax = px[i0];
                        let ay = py[i0];
                        let bx = px[i1];
                        let by = py[i1];
                        let cx = px[i2];
                        let cy = py[i2];
                        if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0) continue;
                        let blocked = false;
                        for (let j = 0; j < order.length; j++) {
                            let ij = order[j];
                            if (ij === i0 || ij === i1 || ij === i2) continue;
                            if (inside(ax, ay, bx, by, cx, cy, px[ij], py[ij])) {
                                blocked = true;
                                break;
                            }
                        }
                        if (blocked) continue;
                        triangles.push(loop[i0], loop[i1], loop[i2]);
                        order.splice(i, 1);
                        earFound = true;
                        break;
                    }
                    if (!earFound) return null;
                }
                if (order.length !== 3) return null;
                triangles.push(loop[order[0]], loop[order[1]], loop[order[2]]);
                return triangles;
            };
            if (closed) {
                let cellTriangles = new Array(cellCount);
                for (let c = 0; c < cellCount; c++) cellTriangles[c] = [];
                for (let t = 0; t < triangleCount; t++) cellTriangles[triangleCell[t]].push(t);
                let weldMap = new Map();
                let welded = new Int32Array(vertexCount);
                let weldEpsilon = maxSize * 1e-5 || 1e-5;
                for (let v = 0; v < vertexCount; v++) {
                    let key =
                        Math.round(surfacePositions[v * 3] / weldEpsilon) +
                        "_" +
                        Math.round(surfacePositions[v * 3 + 1] / weldEpsilon) +
                        "_" +
                        Math.round(surfacePositions[v * 3 + 2] / weldEpsilon);
                    let canonical = weldMap.get(key);
                    if (canonical === undefined) {
                        weldMap.set(key, v);
                        canonical = v;
                    }
                    welded[v] = canonical;
                }
                let edgeKey = function (a, b) {
                    return a < b ? a + "_" + b : b + "_" + a;
                };
                for (let c = 0; c < cellCount; c++) {
                    let triangles = cellTriangles[c];
                    if (!triangles.length) continue;
                    let edgeMap = new Map();
                    let addEdge = function (a, b) {
                        let key = edgeKey(a, b);
                        let edge = edgeMap.get(key);
                        if (edge) edge.count++;
                        else edgeMap.set(key, { a: a, b: b, count: 1 });
                    };
                    for (let n = 0; n < triangles.length; n++) {
                        let t = triangles[n];
                        let i0 = t * 3;
                        let i1 = t * 3 + 1;
                        let i2 = t * 3 + 2;
                        addEdge(welded[i0], welded[i1]);
                        addEdge(welded[i1], welded[i2]);
                        addEdge(welded[i2], welded[i0]);
                    }
                    let boundary = [];
                    edgeMap.forEach(function (edge) {
                        if (edge.count === 1) boundary.push(edge);
                    });
                    if (!boundary.length) continue;
                    let adjacency = new Map();
                    let addAdjacency = function (a, b) {
                        let list = adjacency.get(a);
                        if (!list) adjacency.set(a, (list = []));
                        list.push(b);
                    };
                    for (let n = 0; n < boundary.length; n++) {
                        addAdjacency(boundary[n].a, boundary[n].b);
                        addAdjacency(boundary[n].b, boundary[n].a);
                    }
                    let used = new Set();
                    for (let n = 0; n < boundary.length; n++) {
                        let start = boundary[n];
                        let startKey = edgeKey(start.a, start.b);
                        if (used.has(startKey)) continue;
                        let loop = [start.a];
                        let prev = start.a;
                        let cur = start.b;
                        let guard = 0;
                        while (guard++ < boundary.length + 1) {
                            used.add(edgeKey(prev, cur));
                            if (cur === start.a) break;
                            loop.push(cur);
                            let neighbors = adjacency.get(cur);
                            if (!neighbors) break;
                            let next = -1;
                            for (let m = 0; m < neighbors.length; m++) {
                                if (neighbors[m] === prev) continue;
                                if (!used.has(edgeKey(cur, neighbors[m]))) {
                                    next = neighbors[m];
                                    break;
                                }
                            }
                            if (next < 0) break;
                            prev = cur;
                            cur = next;
                        }
                        if (loop.length < 3) continue;
                        let triangles = triangulateLoop(loop);
                        if (triangles) {
                            for (let m = 0; m + 2 < triangles.length; m += 3) {
                                innerCells.push(c);
                                innerA.push(triangles[m]);
                                innerB.push(triangles[m + 1]);
                                innerC.push(triangles[m + 2]);
                            }
                        } else {
                            let lx = 0;
                            let ly = 0;
                            let lz = 0;
                            for (let m = 0; m < loop.length; m++) {
                                lx += surfacePositions[loop[m] * 3];
                                ly += surfacePositions[loop[m] * 3 + 1];
                                lz += surfacePositions[loop[m] * 3 + 2];
                            }
                            let centerIndex = loopCenters.length / 3;
                            loopCenters.push(lx / loop.length, ly / loop.length, lz / loop.length);
                            for (let m = 0; m < loop.length; m++) {
                                innerCells.push(c);
                                innerA.push(loop[m]);
                                innerB.push(loop[(m + 1) % loop.length]);
                                innerC.push(-2 - centerIndex);
                            }
                        }
                    }
                }
                innerCount = innerCells.length;
            }
            let loopCentersArray = new Float32Array(loopCenters);
            let totalTriangles = triangleCount + innerCount;
            let outputPositions = new Float32Array(totalTriangles * 9);
            let outputNormals = surfaceNormals ? new Float32Array(totalTriangles * 9) : null;
            let outputUvs = surfaceUvs ? new Float32Array(totalTriangles * 6) : null;
            let outputColors = new Float32Array(totalTriangles * 9);
            let triangleCellOut = new Uint16Array(totalTriangles);
            let triangleSource = new Int32Array(totalTriangles * 3);
            for (let vertex = 0; vertex < triangleCount * 3; vertex++) {
                let triangle = Math.floor(vertex / 3);
                triangleCellOut[triangle] = triangleCell[triangle];
                triangleSource[vertex] = vertex;
                outputPositions[vertex * 3] = surfacePositions[vertex * 3];
                outputPositions[vertex * 3 + 1] = surfacePositions[vertex * 3 + 1];
                outputPositions[vertex * 3 + 2] = surfacePositions[vertex * 3 + 2];
                if (outputNormals && surfaceNormals) {
                    outputNormals[vertex * 3] = surfaceNormals[vertex * 3];
                    outputNormals[vertex * 3 + 1] = surfaceNormals[vertex * 3 + 1];
                    outputNormals[vertex * 3 + 2] = surfaceNormals[vertex * 3 + 2];
                }
                if (outputUvs && surfaceUvs) {
                    outputUvs[vertex * 2] = surfaceUvs[vertex * 2];
                    outputUvs[vertex * 2 + 1] = surfaceUvs[vertex * 2 + 1];
                }
            }
            for (let n = 0; n < innerCount; n++) {
                let triangle = triangleCount + n;
                let cell = innerCells[n];
                let a = innerA[n];
                let b = innerB[n];
                let c = innerC[n];
                triangleCellOut[triangle] = cell;
                triangleSource[triangle * 3] = a;
                triangleSource[triangle * 3 + 1] = b;
                triangleSource[triangle * 3 + 2] = c;
                let sources = [a, b, c];
                let outIndex = triangle * 9;
                for (let k = 0; k < 3; k++) {
                    let source = sources[k];
                    if (source < 0) {
                        let loopIndex = -2 - source;
                        outputPositions[outIndex + k * 3] = loopCentersArray[loopIndex * 3];
                        outputPositions[outIndex + k * 3 + 1] = loopCentersArray[loopIndex * 3 + 1];
                        outputPositions[outIndex + k * 3 + 2] = loopCentersArray[loopIndex * 3 + 2];
                    } else {
                        outputPositions[outIndex + k * 3] = surfacePositions[source * 3];
                        outputPositions[outIndex + k * 3 + 1] = surfacePositions[source * 3 + 1];
                        outputPositions[outIndex + k * 3 + 2] = surfacePositions[source * 3 + 2];
                    }
                }
                if (outputUvs && surfaceUvs) {
                    let uvSource = a >= 0 ? a : b;
                    outputUvs[triangle * 6] = surfaceUvs[uvSource * 2];
                    outputUvs[triangle * 6 + 1] = surfaceUvs[uvSource * 2 + 1];
                    outputUvs[triangle * 6 + 2] = surfaceUvs[uvSource * 2];
                    outputUvs[triangle * 6 + 3] = surfaceUvs[uvSource * 2 + 1];
                    outputUvs[triangle * 6 + 4] = surfaceUvs[uvSource * 2];
                    outputUvs[triangle * 6 + 5] = surfaceUvs[uvSource * 2 + 1];
                }
            }
            let fractured = new THREE.BufferGeometry();
            fractured.addAttribute("position", new THREE.BufferAttribute(outputPositions, 3));
            if (outputNormals) fractured.addAttribute("normal", new THREE.BufferAttribute(outputNormals, 3));
            if (outputUvs) fractured.addAttribute("uv", new THREE.BufferAttribute(outputUvs, 2));
            for (let triangle = 0; triangle < totalTriangles; triangle++) {
                let colorCell = triangleCellOut[triangle];
                let colorR = cellColors[colorCell * 3];
                let colorG = cellColors[colorCell * 3 + 1];
                let colorB = cellColors[colorCell * 3 + 2];
                for (let k = 0; k < 3; k++) {
                    let colorIndex = (triangle * 3 + k) * 3;
                    outputColors[colorIndex] = colorR;
                    outputColors[colorIndex + 1] = colorG;
                    outputColors[colorIndex + 2] = colorB;
                }
            }
            fractured.addAttribute("color", new THREE.BufferAttribute(outputColors, 3));
            return {
                geometry: null,
                cellCount: cellCount,
                seed: seed,
                closed: closed,
                triangleCount: totalTriangles,
                outerTriangleCount: triangleCount,
                triangleCell: triangleCellOut,
                triangleSource: triangleSource,
                loopCenters: loopCentersArray,
                surfacePositions: surfacePositions,
                surfaceNormals: surfaceNormals,
                bakedPositions: null,
                centers: centers,
                directions: directions,
                axes: axes,
                spins: spins,
                scatters: scatters,
                cos: new Float32Array(cellCount),
                sin: new Float32Array(cellCount),
                weights: new Float32Array(cellCount),
                cellScales: new Float32Array(cellCount),
                cellOffsets: new Float32Array(cellCount * 3),
                fractured: fractured,
            };
        }
        fractureGeometry(mesh, data, positions, time) {
            let cellCount = Math.max(1, Math.round(this.properties.cells.get(time)));
            let seed = this.properties.seed.get(time);
            let closed = this.properties.closed.get(time) | 0;
            let entry = this.cache.get(mesh);
            let rebuild =
                !entry || entry.geometry !== data.geometry || entry.cellCount !== cellCount || entry.seed !== seed || entry.closed !== closed;
            if (!rebuild) {
                if (entry.bakedPositions.length !== positions.length) {
                    rebuild = true;
                } else {
                    for (let i = 0; i < positions.length; i++) {
                        if (entry.bakedPositions[i] !== positions[i]) {
                            rebuild = true;
                            break;
                        }
                    }
                }
            }
            if (rebuild) {
                if (entry && entry.fractured) entry.fractured.dispose();
                entry = this.buildCells(data, cellCount, seed, closed, positions);
                entry.geometry = data.geometry;
                entry.bakedPositions = new Float32Array(positions);
                this.cache.set(mesh, entry);
            }
            if (mesh.geometry !== entry.fractured) {
                mesh.geometry = entry.fractured;
                mesh.frustumCulled = false;
            }
            data.fractured = entry.fractured;
            let randomColors = this.properties.colors.get(time) === 1;
            if (mesh.material && !Array.isArray(mesh.material)) {
                if (!data.materialClone || mesh.material !== data.materialClone) {
                    if (data.materialClone) data.materialClone.dispose();
                    data.materialOriginal = mesh.material;
                    data.materialClone = mesh.material.clone();
                    data.materialClone.side = THREE.DoubleSide;
                    data.materialClone.vertexColors = randomColors;
                    data.materialClone.needsUpdate = true;
                    mesh.material = data.materialClone;
                } else if (data.materialClone.vertexColors !== randomColors) {
                    data.materialClone.vertexColors = randomColors;
                    data.materialClone.needsUpdate = true;
                }
            } else if (data.materialClone) {
                mesh.material === data.materialClone && (mesh.material = data.materialOriginal);
                data.materialClone.dispose();
                data.materialClone = null;
            }
            let distance = this.properties.distance.get(time);
            let scatter = this.properties.scatter.get(time);
            let spin = this.properties.spin.get(time);
            let offset = this.properties.offset.get(time);
            let fieldType = this.properties.field.get(time) | 0;
            let fieldPosition = fieldType ? this.properties.fieldPosition.get(time) : null;
            let fieldScale = fieldType ? this.properties.fieldScale.get(time) : null;
            let positionAttribute = entry.fractured.attributes.position;
            let normalAttribute = entry.fractured.attributes.normal;
            let output = positionAttribute.array;
            let normals = normalAttribute ? normalAttribute.array : null;
            let baseNormals = entry.surfaceNormals;
            let surfacePositions = entry.surfacePositions;
            let triangleCount = entry.triangleCount;
            let outerTriangleCount = entry.outerTriangleCount;
            let triangleCell = entry.triangleCell;
            let triangleSource = entry.triangleSource;
            let loopCenters = entry.loopCenters;
            let centers = entry.centers;
            let directions = entry.directions;
            let axes = entry.axes;
            let spins = entry.spins;
            let scatters = entry.scatters;
            let weights = entry.weights;
            let cellOffsets = entry.cellOffsets;
            for (let c = 0; c < cellCount; c++) {
                let weight = fieldType
                    ? PZ.object3d.deform.fieldWeight(centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2], fieldType, fieldPosition, fieldScale)
                    : 1;
                weights[c] = weight;
                entry.cellScales[c] = Math.max(0, 1 - (offset / 100) * weight);
                entry.cos[c] = Math.cos(spin * spins[c] * weight);
                entry.sin[c] = Math.sin(spin * spins[c] * weight);
                cellOffsets[c * 3] = (directions[c * 3] * distance + scatters[c * 3] * scatter) * weight;
                cellOffsets[c * 3 + 1] = (directions[c * 3 + 1] * distance + scatters[c * 3 + 1] * scatter) * weight;
                cellOffsets[c * 3 + 2] = (directions[c * 3 + 2] * distance + scatters[c * 3 + 2] * scatter) * weight;
            }
            for (let triangle = 0; triangle < triangleCount; triangle++) {
                let cell = triangleCell[triangle];
                let centerX = centers[cell * 3];
                let centerY = centers[cell * 3 + 1];
                let centerZ = centers[cell * 3 + 2];
                let cosine = entry.cos[cell];
                let sine = entry.sin[cell];
                let oneMinusCosine = 1 - cosine;
                let axisX = axes[cell * 3];
                let axisY = axes[cell * 3 + 1];
                let axisZ = axes[cell * 3 + 2];
                let offsetX = cellOffsets[cell * 3];
                let offsetY = cellOffsets[cell * 3 + 1];
                let offsetZ = cellOffsets[cell * 3 + 2];
                let scale = entry.cellScales[cell];
                for (let k = 0; k < 3; k++) {
                    let source = triangleSource[triangle * 3 + k];
                    let x, y, z;
                    if (source < 0) {
                        let loopIndex = -2 - source;
                        x = loopCenters[loopIndex * 3] - centerX;
                        y = loopCenters[loopIndex * 3 + 1] - centerY;
                        z = loopCenters[loopIndex * 3 + 2] - centerZ;
                    } else {
                        x = surfacePositions[source * 3] - centerX;
                        y = surfacePositions[source * 3 + 1] - centerY;
                        z = surfacePositions[source * 3 + 2] - centerZ;
                    }
                    let dot = axisX * x + axisY * y + axisZ * z;
                    let rotatedX = x * cosine + (axisY * z - axisZ * y) * sine + axisX * dot * oneMinusCosine;
                    let rotatedY = y * cosine + (axisZ * x - axisX * z) * sine + axisY * dot * oneMinusCosine;
                    let rotatedZ = z * cosine + (axisX * y - axisY * x) * sine + axisZ * dot * oneMinusCosine;
                    let outputIndex = (triangle * 3 + k) * 3;
                    output[outputIndex] = centerX + rotatedX * scale + offsetX;
                    output[outputIndex + 1] = centerY + rotatedY * scale + offsetY;
                    output[outputIndex + 2] = centerZ + rotatedZ * scale + offsetZ;
                    if (normals && baseNormals && triangle < outerTriangleCount) {
                        let nx = baseNormals[source * 3];
                        let ny = baseNormals[source * 3 + 1];
                        let nz = baseNormals[source * 3 + 2];
                        let normalDot = axisX * nx + axisY * ny + axisZ * nz;
                        normals[outputIndex] = nx * cosine + (axisY * nz - axisZ * ny) * sine + axisX * normalDot * oneMinusCosine;
                        normals[outputIndex + 1] =
                            ny * cosine + (axisZ * nx - axisX * nz) * sine + axisY * normalDot * oneMinusCosine;
                        normals[outputIndex + 2] =
                            nz * cosine + (axisX * ny - axisY * nx) * sine + axisZ * normalDot * oneMinusCosine;
                    }
                }
                if (normals && triangle >= outerTriangleCount) {
                    let o = triangle * 9;
                    let ax2 = output[o + 3] - output[o];
                    let ay2 = output[o + 4] - output[o + 1];
                    let az2 = output[o + 5] - output[o + 2];
                    let bx2 = output[o + 6] - output[o];
                    let by2 = output[o + 7] - output[o + 1];
                    let bz2 = output[o + 8] - output[o + 2];
                    let nx2 = ay2 * bz2 - az2 * by2;
                    let ny2 = az2 * bx2 - ax2 * bz2;
                    let nz2 = ax2 * by2 - ay2 * bx2;
                    let len2 = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1;
                    normals[o] = normals[o + 3] = normals[o + 6] = nx2 / len2;
                    normals[o + 1] = normals[o + 4] = normals[o + 7] = ny2 / len2;
                    normals[o + 2] = normals[o + 5] = normals[o + 8] = nz2 / len2;
                }
            }
            positionAttribute.needsUpdate = true;
            if (normalAttribute) normalAttribute.needsUpdate = true;
        }
        unload() {
            PZ.object3d.deformer.prototype.unload.call(this);
            this.cache && this.cache.clear();
        }
    }),
    (PZ.object3d.voronoi.propertyDefinitions = Object.assign(
        {
            cells: { name: "Cells", type: PZ.property.type.NUMBER, value: 24, min: 1, max: 200, step: 1, decimals: 0 },
            seed: { name: "Seed", type: PZ.property.type.NUMBER, value: 1, step: 1, decimals: 0 },
            closed: { name: "Inner faces", type: PZ.property.type.OPTION, value: 1, items: "open;closed" },
            colors: { name: "Fragment colors", type: PZ.property.type.OPTION, value: 1, items: "material;random" },
            distance: {
                dynamic: true,
                name: "Distance",
                type: PZ.property.type.NUMBER,
                value: 0,
                min: -1000,
                max: 1000,
                step: 1,
                decimals: 2,
            },
            offset: {
                dynamic: true,
                name: "Offset fragments",
                type: PZ.property.type.NUMBER,
                value: 0,
                min: 0,
                max: 100,
                step: 1,
                decimals: 1,
            },
            scatter: {
                dynamic: true,
                name: "Scatter",
                type: PZ.property.type.NUMBER,
                value: 0,
                min: -1000,
                max: 1000,
                step: 1,
                decimals: 2,
            },
            spin: {
                dynamic: true,
                name: "Spin",
                type: PZ.property.type.NUMBER,
                value: 0,
                min: -3600,
                max: 3600,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
        },
        PZ.object3d.deform.fieldPropertyDefinitions
    )),
    (PZ.object3d.voronoi.prototype.defaultName = "Voronoi Fracture");
