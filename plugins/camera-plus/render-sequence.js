// Camera+ — sequence render with motion-blur track frames and global DOF
// (extracted verbatim from the OpenZoid core).
PZ.compositor.prototype.renderSequence = function (e) {
        this._sequenceTime = e;
        this.ratio = this.readBuffer.width / this._sequence.properties.resolution.get()[0];
        this.renderer.clearTarget(this.accumBuffers[0], true, true, true);
        if (this.depthBuffer) {
            this.renderer.clearTarget(this.depthBuffer, true, true, true);
        }
        var t = this._sequence.videoTracks;
        for (var r = 0; r < t.length; r++) {
            t[r].skip = true;
            let e = t[r].layer;
            if (e) {
                if (
                    (!(e instanceof PZ.layer.scene) || !!e.pass.camera) &&
                    (!(e instanceof PZ.layer.composite) || !!e.objects.length)
                ) {
                    t[r].skip = false;
                }
            }
        }
        let i = Math.floor(this._sequence.properties.motionBlurSamples.get(e));
        let blurOn = this._sequence.properties.motionBlur.get() !== 0;
        if (!blurOn) {
            i = 1;
        }
        let a =
            this._sequence.properties.motionBlurShutter.get(e) *
            this._sequence.properties.motionBlurSensitivity.get(e) *
            0.01;
        let trackFrame = this._sequence.properties.motionBlurTrackFrame.get(e);
        let frameStart = 0;
        let frameSpan = 0;
        if (blurOn && i > 1) {
            if (trackFrame === 1) {
                frameStart = -a;
                frameSpan = a;
            } else if (trackFrame === 2) {
                frameStart = 0;
                frameSpan = a;
            } else {
                frameStart = -a * 0.5;
                frameSpan = a;
            }
        }
        // Depth of field is driven by the shared (Camera layer) camera
        // object. The sequence carries no DOF controls: with no master
        // camera, or with its DOF off, the global pass stays inactive and
        // each scene falls back to its own camera-driven pass.
        let dofAperture = 0;
        let dofRange = null;
        try {
            const master = this._sequence && typeof this._sequence.getSharedCamera === "function"
                ? this._sequence.getSharedCamera()
                : null;
            const camObj = master && master.camera ? master.camera : null;
            const props = camObj && camObj.properties;
            const defs = PZ.object3d && PZ.object3d.camera && PZ.object3d.camera.propertyDefinitions;
            if (props && defs) {
                for (const key of ["dof", "dofAperture", "dofFocusDistance"]) {
                    try {
                        if (!props[key] && defs[key] && PZ.property && typeof PZ.property.create === "function" &&
                            props.add && typeof props.add === "function") {
                            props.add(key, PZ.property.create(defs[key]));
                        }
                        const p = props[key];
                        if (p && p.keyframes && !p.keyframes.length && typeof p.load === "function") {
                            p.load(null);
                        }
                    } catch (_k) { /* best effort per key */ }
                }
                const get = function (k, fb) {
                    try {
                        const p = props[k];
                        if (!p || typeof p.get !== "function") return fb;
                        const v = p.get(e);
                        return typeof v === "number" && isFinite(v) ? v : fb;
                    } catch (_g) { return fb; }
                };
                if (get("dof", 0) === 1) {
                    dofAperture = get("dofAperture", 0);
                    let near = 0.1;
                    let far = 5e3;
                    try {
                        if (master.three) {
                            if (typeof master.three.near === "number" && isFinite(master.three.near)) {
                                near = master.three.near;
                            }
                            if (typeof master.three.far === "number" && isFinite(master.three.far)) {
                                far = master.three.far;
                            }
                        }
                    } catch (_n) { /* keep defaults */ }
                    dofRange = { near: near, far: far, focusDistance: get("dofFocusDistance", 80) };
                }
            }
        } catch (_dof) { /* camera DOF degrades to off */ }
        this.globalDofActive = dofAperture > 0 && !!this.depthBuffer;
        if (!this.globalDofActive) dofRange = null;
        this._dofRange = dofRange;
        for (var s = 0; s < i; s++) {
            this.renderer.setClearColor(0, 1);
            this.clear(0);
            this.renderer.setClearColor(0, 0);
            for (r = 0; r < t.length; r++) {
                if (t[r].skip) {
                    continue;
                }
                let n = t[r].layer;
                let layerTime = e - n.parent.start;
                let layerBlur = n.properties.motionBlurAmount ? n.properties.motionBlurAmount.get(layerTime) : 1;
                n._renderTime = layerTime;
                n.update(layerTime + (frameStart + (s / i) * frameSpan) * layerBlur);
                this.renderLayer(n, 0, false);
            }
            this.mixPass.render(this.renderer, this.accumBuffers[1], this.accumBuffers[0], this.screenBuffers[0], true);
            this.swapAccumBuffers();
        }
        this.copyPass.uniforms.tDiffuse.value = this.accumBuffers[0].texture;
        this.copyPass.uniforms.opacity.value = 1 / i;
        if (dofAperture > 0 && this.depthBuffer) {
            this.copyPass.render(this.renderer, this.screenBuffers[0], null, false);
            this.renderDOF(dofAperture);
        } else {
            this.copyPass.render(this.renderer, null, null, true);
        }
        this.copyPass.uniforms.opacity.value = 1;
    
};
PZ.compositor.prototype.renderDOF = function (e) {
        // Range comes from the shared camera (stashed by renderSequence),
        // never from sequence properties.
        const range = this._dofRange || { near: 0.1, far: 5e3, focusDistance: 80 };
        this.dofQuad.material.uniforms.tColor.value = this.screenBuffers[0].texture;
        this.dofQuad.material.uniforms.tDepth.value = this.depthBuffer.texture;
        this.dofQuad.material.uniforms.resolution.value.set(this.screenBuffers[0].width, this.screenBuffers[0].height);
        this.dofQuad.material.uniforms.uvScale.value.set(1, 1);
        this.dofQuad.material.uniforms.near.value = range.near;
        this.dofQuad.material.uniforms.far.value = range.far;
        this.dofQuad.material.uniforms.aperture.value = e;
        this.dofQuad.material.uniforms.focusDistance.value = range.focusDistance;
        this.dofQuad.material.uniforms.orthographic.value = 1;
        this.renderer.render(this.dofScene, this.dofCamera, null);
    
};
