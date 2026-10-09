// Effector+ — deformer framework (extracted verbatim from the OpenZoid core:
// PZ.object3d.deform namespace, mesh data helpers, field weights, apply walk).
    (PZ.object3d.deform = {}),
    (PZ.object3d.deform.rng = function (e) {
        let t = (e || 0) >>> 0;
        return function () {
            t = (t + 0x6d2b79f5) | 0;
            let e = Math.imul(t ^ (t >>> 15), t | 1);
            e ^= e + Math.imul(e ^ (e >>> 7), e | 61);
            return ((e ^ (e >>> 14)) >>> 0) / 4294967296;
        };
    }),
    (PZ.object3d.deform.collectMeshes = function (e, t) {
        for (let r = 0; r < e.length; r++) {
            let i = e[r];
            if (i.objects) {
                PZ.object3d.deform.collectMeshes(i.objects, t);
            } else if (i.threeObj) {
                i.threeObj.traverse(function (e) {
                    e.isMesh && e.geometry && t.indexOf(e) === -1 && t.push(e);
                });
            }
        }
    }),
    (PZ.object3d.deform.getMeshData = function (e) {
        let t = e.userData.pzDeform;
        if (t && t.geometry !== e.geometry && t.fractured !== e.geometry) {
            t = e.userData.pzDeform = null;
        }
        if (!t) {
            let r = e.geometry;
            if (!r) return null;
            if (r.isGeometry) {
                let i = new THREE.BufferGeometry().fromGeometry(r);
                r.dispose(), (r = i), (e.geometry = r);
            }
            if (!r.isBufferGeometry || !r.attributes || !r.attributes.position) return null;
            let i = r.attributes.position.array,
                a = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
                s = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
            for (let e = 0; e + 2 < i.length; e += 3)
                for (let t = 0; t < 3; t++) {
                    let r = i[e + t];
                    r < a[t] && (a[t] = r), r > s[t] && (s[t] = r);
                }
            t = e.userData.pzDeform = {
                geometry: r,
                positions: new Float32Array(i),
                normals: r.attributes.normal ? new Float32Array(r.attributes.normal.array) : null,
                uvs: r.attributes.uv ? new Float32Array(r.attributes.uv.array) : null,
                index: r.index ? r.index.array : null,
                min: a,
                max: s,
                fractured: null,
                frustumCulled: e.frustumCulled,
            };
        }
        return t;
    }),
    (PZ.object3d.deform.restoreMesh = function (e) {
        let t = e.userData.pzDeform;
        if (!t) return;
        if (t.materialClone) {
            e.material === t.materialClone && (e.material = t.materialOriginal),
                t.materialClone.dispose(),
                (t.materialClone = null);
        }
        if (t.fractured) {
            e.geometry === t.fractured && (e.geometry = t.geometry),
                t.fractured.dispose(),
                (t.fractured = null),
                (e.frustumCulled = t.frustumCulled);
        }
        if (e.geometry === t.geometry) {
            let r = t.geometry.attributes.position;
            r.array.set(t.positions),
                (r.needsUpdate = true),
                t.geometry.attributes.normal &&
                    t.normals &&
                    (t.geometry.attributes.normal.array.set(t.normals), (t.geometry.attributes.normal.needsUpdate = true)),
                t.geometry.computeBoundingSphere();
        }
    }),
    (PZ.object3d.deform.setMeshPositions = function (e, t) {
        let r = e.userData.pzDeform;
        if (!r) return;
        if (r.fractured) {
            e.geometry === r.fractured && (e.geometry = r.geometry),
                r.fractured.dispose(),
                (r.fractured = null),
                (e.frustumCulled = r.frustumCulled);
        }
        let i = r.geometry.attributes.position;
        let a = false;
        for (let e = 0; e < i.array.length; e++)
            if (i.array[e] !== t[e]) {
                a = true;
                break;
            }
        if (!a) return;
        i.array.set(t), (i.needsUpdate = true), r.geometry.computeVertexNormals(), r.geometry.computeBoundingSphere();
    }),
    (PZ.object3d.deform.restore = function (e) {
        if (!e || !e.objects) return;
        let t = [];
        PZ.object3d.deform.collectMeshes(e.objects, t);
        for (let r = 0; r < t.length; r++) PZ.object3d.deform.restoreMesh(t[r]);
    }),
    (PZ.object3d.deform.fieldPropertyDefinitions = {
        field: { name: "Field", type: PZ.property.type.OPTION, value: 0, items: "infinite;linear;box;sphere" },
        fieldPosition: {
            name: "Field position",
            type: PZ.property.type.VECTOR3,
            value: [0, 0, 0],
            step: 1,
            decimals: 1,
        },
        fieldScale: {
            name: "Field scale",
            type: PZ.property.type.VECTOR3,
            value: [100, 100, 100],
            min: 0.01,
            step: 1,
            decimals: 1,
        },
    }),
    (PZ.object3d.deform.fieldWeight = function (x, y, z, type, position, scale) {
        if (!type) return 1;
        let weight = 1;
        if (type === 1) {
            let dx = x - position[0];
            weight = 1 - Math.max(0, dx) / (scale[0] || 1);
        } else if (type === 2) {
            let d = 0;
            let coords = [x, y, z];
            for (let a = 0; a < 3; a++) {
                let half = 0.5 * (scale[a] || 1);
                d = Math.max(d, Math.abs(coords[a] - position[a]) / half);
            }
            weight = d <= 1 ? 1 : Math.max(0, 1 - (d - 1));
        } else if (type === 3) {
            let dx = x - position[0];
            let dy = y - position[1];
            let dz = z - position[2];
            weight = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / (Math.abs(scale[0]) || 1);
        }
        return Math.max(0, Math.min(1, weight));
    }),
    (PZ.object3d.deform.apply = function (layer, time) {
        let deformMesh = function (mesh, chain) {
            if (chain.length === 0) {
                mesh.userData.pzDeform && PZ.object3d.deform.restoreMesh(mesh);
                return;
            }
            let data = PZ.object3d.deform.getMeshData(mesh);
            if (!data) return;
            let positions = null;
            for (let i = 0; i < chain.length; i++) {
                if (typeof chain[i].deformPositions !== "function") continue;
                positions || (positions = new Float32Array(data.positions));
                positions = chain[i].deformPositions(positions, time, data, mesh) || positions;
            }
            let fracture = null;
            for (let i = 0; i < chain.length; i++) {
                if (typeof chain[i].fractureGeometry === "function") {
                    fracture = chain[i];
                    break;
                }
            }
            if (fracture) {
                fracture.fractureGeometry(mesh, data, positions || new Float32Array(data.positions), time);
            } else {
                PZ.object3d.deform.setMeshPositions(mesh, positions || data.positions);
            }
        };
        let walk = function (objects, chain) {
            for (let i = 0; i < objects.length; i++) {
                let object = objects[i];
                if (typeof object.deformPositions === "function" || typeof object.fractureGeometry === "function") {
                    if (object.objects) {
                        let nextChain =
                            !object.properties.enabled || object.properties.enabled.get(time)
                                ? chain.concat(object)
                                : chain;
                        walk(object.objects, nextChain);
                    }
                } else if (object instanceof PZ.object3d.group) {
                    object.objects && walk(object.objects, chain);
                } else if (object.threeObj) {
                    object.threeObj.traverse(function (mesh) {
                        mesh.isMesh && mesh.geometry && deformMesh(mesh, chain);
                    });
                }
            }
        };
        walk(layer.objects, []);
    });
