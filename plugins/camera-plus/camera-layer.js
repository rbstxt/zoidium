// Camera+ — dedicated Camera layer (extracted verbatim from the OpenZoid core).
    (PZ.layer.camera = class extends PZ.layer {
        constructor() {
            super(), (this.threeObj = new THREE.Group()), (this.objects = new PZ.objectList(this, PZ.object3d)), this.children.splice(1, 0, this.objects);
        }
        load(e) {
            super.load(e), this.properties.load(e && e.properties);
            // The layer-level transform sliders do nothing on a Camera layer
            // (it draws nothing) — the camera OBJECT is what you animate, so
            // hide the dead controls to avoid keyframing the wrong thing.
            try {
                ["position", "scale", "rotation", "rotationX", "rotationY", "depth"].forEach((k) => {
                    if (this.properties[k]) this.properties[k].visible = false;
                });
            } catch (err) {}
            let t = null;
            try {
                t = this.parentProject.sequence.properties.resolution.get();
            } catch (err) {}
            if (t) this.properties.resolution.set([t[0], t[1]]);
            if ("object" == typeof e && e.objects) {
                for (let t = 0; t < e.objects.length; t++) {
                    // Camera layers hold cameras (and groups to organize them).
                    if (e.objects[t].type !== 6 && e.objects[t].type !== 5) continue;
                    let r = PZ.object3d.create(e.objects[t].type);
                    this.objects.push(r), (r.loading = r.load(e.objects[t]));
                }
            }
            if (!this.objects.length) {
                let r = PZ.object3d.create(6);
                this.objects.push(r), (r.loading = r.load({ objectType: 1 }));
            }
            this.properties.name.set(PZ.layer.getName(this));
        }
        toJSON() {
            var e = super.toJSON();
            return (e.objects = this.objects), e;
        }
        unload() {
            for (let e = 0; e < this.objects.length; e++) this.objects[e].unload();
            super.unload();
        }
        async prepare(e, t) {
            for (let r = 0; r < this.objects.length; r++) await this.objects[r].prepare(e, t);
            await super.prepare(e, t);
        }
        update(e) {
            for (let t = 0; t < this.objects.length; t++) this.objects[t].update(e);
            this.threeObj.updateMatrixWorld(), super.update(e);
        }
        getCamera() {
            let walk = (list) => {
                if (!list || typeof list.length !== "number") return null;
                for (let e = 0; e < list.length; e++) {
                    let t = list[e];
                    if (!t) continue;
                    // Duck-typed: cameras created before this pack enabled are
                    // instances of the vanilla class, not the replaced one.
                    if ((t instanceof PZ.object3d.camera || t.type === 6) && t.threeObj) return t;
                    if (t.objects && typeof t.objects.length === "number") {
                        let f = walk(t.objects);
                        if (f) return f;
                    }
                }
                return null;
            };
            return walk(this.objects);
        }
    }),
    (PZ.layer.camera.prototype.defaultName = "Camera");
