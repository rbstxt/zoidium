// Camera+ — C4D camera object with film system, vibrate link, and DOF
// properties (extracted verbatim from the OpenZoid core).
    (PZ.object3d.camera = class extends PZ.object3d {
        constructor() {
            super(),
                (this.threeObj = null),
                (this.objectType = 1),
                (this.vibrate = new PZ.vibrate()),
                (this._time = 0),
                (this._loaded = false),
                (this._resolutionWatched = false),
                this.properties.addAll(PZ.object3d.camera.propertyDefinitions),
                this.properties.add("vibrate", this.vibrate.properties),
                (this.properties.equivFocalLength.hideAnimateToggle = true),
                (this.properties.fovH.hideAnimateToggle = true),
                (this.properties.fovV.hideAnimateToggle = true);
        }
        load(e) {
            let t = "object" == typeof e && 2 === e.objectType ? 2 : 1;
            this.changeObjectType(t),
                this.properties.load(e && e.properties),
                (this._loaded = true),
                this.changeObjectType(t),
                this.properties.projection.set(2 === t ? "orthographic" : "perspective"),
                this.resolutionChanged();
        }
        toJSON() {
            return { type: this.type, objectType: this.objectType, properties: this.properties };
        }
        changeObjectType(e) {
            if (this.threeObj && this.objectType === e) {
                return;
            }
            let t = "Camera";
            let r = this.threeObj;
            switch (((this.objectType = e), this.objectType)) {
                case 1:
                    (t = "Perspective Camera"), (this.threeObj = new THREE.PerspectiveCamera(60, 1, 0.1, 5e3));
                    break;
                case 2:
                    (t = "Orthographic Camera"),
                        (this.threeObj = new THREE.OrthographicCamera(-0.05, 0.05, 0.05, -0.05, 0.1, 5e3));
            }
            r && r.parent && r.parent.remove(r),
                this.properties.name.set(t),
                this.parentChanged(),
                // Camera objects can live in Scenes (drives that scene) or in
                // dedicated Camera layers (drives every 3D scene). Camera
                // layers have no render pass, so guard the pass assignment.
                this.parentLayer && this.parentLayer.pass && (this.parentLayer.pass.camera = this.threeObj),
                this._resolutionWatched ||
                    ((this._resolutionWatched = true),
                    this.parentLayer &&
                        this.parentLayer.properties &&
                        this.parentLayer.properties.resolution &&
                        this.parentLayer.properties.resolution.onChanged.watch(this.resolutionChanged.bind(this))),
                this.resolutionChanged();
        }
        resolutionChanged() {
            if (!this.parentProject || !this.threeObj) {
                return;
            }
            let e = this.parentProject.sequence.properties.resolution.get();
            if (1 === this.objectType) {
                this.threeObj.aspect = e[0] / e[1];
            }
            this.updateProjection(this._time);
        }
        updateProjection(e) {
            let t = this.threeObj;
            if (!t || !this._loaded) {
                return;
            }
            let r = this.properties,
                i = r.zoom.get(e),
                a = r.filmOffsetX.get(e),
                s = r.filmOffsetY.get(e);
            if (1 === this.objectType) {
                let n = r.filmGate.get(e),
                    o = r.focalLength.get(e);
                (t.filmGauge = n),
                    (t.zoom = i),
                    (t.filmOffset = n * (a / 100)),
                    o > 0 && (t.fov = 2 * Math.atan(t.getFilmHeight() / 2 / o) * (180 / Math.PI)),
                    t.updateProjectionMatrix(),
                    s && (t.projectionMatrix.elements[9] += 2 * (s / 100));
            } else {
                let n = this.parentProject ? this.parentProject.sequence.properties.resolution.get() : [1920, 1080],
                    o = (0.05 * n[1]) / Math.max(i, 1e-4),
                    p = (0.05 * n[0]) / Math.max(i, 1e-4),
                    l = p * 2 * (a / 100),
                    h = o * 2 * (s / 100);
                (t.left = -p - l),
                    (t.right = p - l),
                    (t.top = o + h),
                    (t.bottom = -o + h),
                    t.updateProjectionMatrix();
            }
        }
        getFieldOfView(e) {
            let t = this.threeObj;
            if (!t || !t.isPerspectiveCamera) {
                return [0, 0];
            }
            let r = t.getEffectiveFOV() * (Math.PI / 180),
                i = 2 * Math.atan(Math.tan(r / 2) * t.aspect);
            return [i * (180 / Math.PI), r * (180 / Math.PI)];
        }
        getEquivalentFocalLength(e) {
            let t = this.properties.filmGate.get(e),
                r = this.properties.focalLength.get(e);
            return t > 0 ? r * (36 / t) : r;
        }
        update(e) {
            (this._time = e), this.updateProjection(e);
            let t = this.properties.position.get(e);
            this.threeObj.position.set(t[0], t[1], t[2]);
            let r = this.properties.rotation.get(e);
            this.threeObj.rotation.set(r[0], r[1], r[2]), this.vibrate.apply(e, this.threeObj, t, r);
        }
    }),
    (PZ.object3d.camera.filmGates = [
        { name: "Classic 35 mm (36.0 mm)", value: 36 },
        { name: "35 mm Photo (36.0 mm)", value: 36 },
        { name: "35 mm Full Aperture (36.0 mm)", value: 36 },
        { name: "35 mm Academy (21.95 mm)", value: 21.95 },
        { name: "Super 35 (24.89 mm)", value: 24.89 },
        { name: "APS-C (23.6 mm)", value: 23.6 },
        { name: "APS-C Canon (22.3 mm)", value: 22.3 },
        { name: "Micro Four Thirds (17.3 mm)", value: 17.3 },
        { name: "1 inch (13.2 mm)", value: 13.2 },
        { name: "2/3 inch (8.8 mm)", value: 8.8 },
        { name: "Super 16 (12.52 mm)", value: 12.52 },
        { name: "16 mm (10.26 mm)", value: 10.26 },
    ]),
    (PZ.object3d.camera.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Camera" },
        position: {
            dynamic: true,
            group: true,
            objects: [
                { dynamic: true, name: "Position.X", type: PZ.property.type.NUMBER, value: 0, step: 1, decimals: 2 },
                { dynamic: true, name: "Position.Y", type: PZ.property.type.NUMBER, value: 0, step: 1, decimals: 2 },
                { dynamic: true, name: "Position.Z", type: PZ.property.type.NUMBER, value: 80, step: 1, decimals: 2 },
            ],
            name: "Position",
            type: PZ.property.type.VECTOR3,
        },
        rotation: {
            dynamic: true,
            group: true,
            objects: [
                {
                    dynamic: true,
                    name: "Rotation.X",
                    type: PZ.property.type.NUMBER,
                    value: 0,
                    scaleFactor: Math.PI / 180,
                    step: 1,
                },
                {
                    dynamic: true,
                    name: "Rotation.Y",
                    type: PZ.property.type.NUMBER,
                    value: 0,
                    scaleFactor: Math.PI / 180,
                    step: 1,
                },
                {
                    dynamic: true,
                    name: "Rotation.Z",
                    type: PZ.property.type.NUMBER,
                    value: 0,
                    scaleFactor: Math.PI / 180,
                    step: 1,
                },
            ],
            name: "Rotation",
            type: PZ.property.type.VECTOR3,
            scaleFactor: Math.PI / 180,
        },
        eulerOrder: {
            name: "Rotation order",
            type: PZ.property.type.LIST,
            value: "XYZ",
            items: PZ.object3d.eulerOrders,
            changed: function () {
                this.parentObject.threeObj.rotation.order = this.value;
            },
        },
        projection: {
            name: "Projection",
            type: PZ.property.type.LIST,
            value: "perspective",
            items: [
                { name: "Perspective", value: "perspective" },
                { name: "Orthographic", value: "orthographic" },
            ],
            changed: function () {
                this.parentObject.changeObjectType("orthographic" === this.value ? 2 : 1);
            },
        },
        focalLength: {
            dynamic: true,
            name: "Focal Length",
            type: PZ.property.type.NUMBER,
            value: 35,
            min: 1,
            max: 1e4,
            step: 1,
            decimals: 2,
        },
        filmGate: {
            name: "Sensor Size (Film Gate)",
            type: PZ.property.type.LIST,
            value: 36,
            items: PZ.object3d.camera.filmGates,
        },
        equivFocalLength: {
            dynamic: true,
            name: "35mm Equiv. Focal Length",
            type: PZ.property.type.NUMBER,
            value: 35,
            readOnly: true,
            hideAnimateToggle: true,
            decimals: 2,
            getValue: function (e) {
                return this.parentObject.getEquivalentFocalLength(e);
            },
        },
        fovH: {
            dynamic: true,
            name: "Field of View (Horizontal)",
            type: PZ.property.type.NUMBER,
            value: 0,
            readOnly: true,
            hideAnimateToggle: true,
            decimals: 4,
            getValue: function (e) {
                return this.parentObject.getFieldOfView(e)[0];
            },
        },
        fovV: {
            dynamic: true,
            name: "Field of View (Vertical)",
            type: PZ.property.type.NUMBER,
            value: 0,
            readOnly: true,
            hideAnimateToggle: true,
            decimals: 4,
            getValue: function (e) {
                return this.parentObject.getFieldOfView(e)[1];
            },
        },
        zoom: {
            dynamic: true,
            name: "Zoom",
            type: PZ.property.type.NUMBER,
            value: 1,
            min: 0.01,
            max: 1e3,
            step: 0.01,
            decimals: 2,
        },
        filmOffsetX: {
            dynamic: true,
            name: "Film Offset X",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: -1e3,
            max: 1e3,
            step: 0.1,
            decimals: 2,
        },
        filmOffsetY: {
            dynamic: true,
            name: "Film Offset Y",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: -1e3,
            max: 1e3,
            step: 0.1,
            decimals: 2,
        },
        dof: {
            dynamic: true,
            name: "Depth of Field",
            type: PZ.property.type.OPTION,
            value: 0,
            items: "off;on",
        },
        dofFocusDistance: {
            dynamic: true,
            name: "Focus Distance",
            type: PZ.property.type.NUMBER,
            value: 80,
            min: 0,
            max: 5e3,
            step: 1,
            decimals: 1,
            buttons: [
                { name: "Link", title: "Link Focus Distance to Layer", action: "focusDistanceLink" },
                { name: "Set", title: "Set Focus Distance to Layer", action: "focusDistanceSet" },
                { name: "Unlink", title: "Unlink Focus Distance", action: "focusDistanceUnlink" },
            ],
        },
        dofAperture: {
            dynamic: true,
            name: "Aperture",
            type: PZ.property.type.NUMBER,
            value: 3,
            min: 0,
            max: 10,
            step: 0.1,
            decimals: 1,
        },
        dofFocusAreaWidth: {
            dynamic: true,
            name: "Focus Area Width",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: 0,
            max: 4e3,
            step: 1,
            decimals: 0,
        },
        dofNearBlurLevel: {
            dynamic: true,
            name: "Near Blur Level",
            type: PZ.property.type.NUMBER,
            value: 100,
            min: 0,
            max: 400,
            step: 1,
            decimals: 0,
        },
        dofFarBlurLevel: {
            dynamic: true,
            name: "Far Blur Level",
            type: PZ.property.type.NUMBER,
            value: 100,
            min: 0,
            max: 400,
            step: 1,
            decimals: 0,
        },
    }),
    (PZ.object3d.camera.prototype.defaultName = "Camera");
