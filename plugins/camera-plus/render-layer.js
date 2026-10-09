// Camera+ — compositor renderLayer with camera-layer skip, tracked-video
// rectangle path, and video motion-blur mode (extracted verbatim).
PZ.compositor.prototype.renderLayer = function (e, t, r) {
        // Dedicated Camera layers drive tracking only: their update() has
        // already run (fresh camera pose for sharing) and they draw nothing.
        if (e instanceof PZ.layer.camera) {
            return;
        }
        let i = this.screenBuffers[t];
        this.sceneDepthReady = false;
        e.composite.scene;
        let a = e.properties.resolution.get();
        let s = Math.min(Math.ceil(a[0] * this.ratio), i.width);
        let n = Math.min(Math.ceil(a[1] * this.ratio), i.height);
        var o = s / i.width;
        var p = n / i.height;
        this.readBuffer.viewport.set(0, 0, s, n);
        if (e.follow3dVideo && e.video3d && e.video3d.scene && e.video3d.cam) {
            // Transform video layer: render the footage rectangle with the
            // shared camera full-frame, exactly like a Scene layer would.
            s = i.width;
            n = i.height;
            o = 1;
            p = 1;
            this.readBuffer.viewport.set(0, 0, s, n);
            try {
                // The shared camera's ancestors (Camera-layer Group, etc.)
                // are not in this scene, so refresh its world chain here —
                // otherwise grouped cameras shoot through a stale pose.
                let _o = e.video3d.cam;
                let _chain = [];
                let _g = 0;
                while (_o && _g++ < 16) {
                    _chain.unshift(_o);
                    try {
                        _o = _o.parent;
                    } catch (e2) {
                        break;
                    }
                }
                for (let _k = 0; _k < _chain.length; _k++) {
                    try {
                        _chain[_k].updateMatrixWorld();
                    } catch (e2) {}
                }
            } catch (err) {}
            this.renderer.render(e.video3d.scene, e.video3d.cam, this.readBuffer);
        } else if (e.texture instanceof THREE.Texture) {
            this.copyPass.uniforms.tDiffuse.value = e.texture;
            this.copyPass.render(this.renderer, this.readBuffer, null, true);
            this.applyVideoMotionBlur(e, s, n);
        } else if (e instanceof PZ.layer.adjustment) {
            this.copyPass.render(this.renderer, this.readBuffer, i, true);
        } else if (e instanceof PZ.layer.shape) {
            let t = this.canvas.getContext("2d");
            e.draw(t);
            if (ISNODE) {
                let e = t.getImageData(0, 0, this.canvas.width, this.canvas.height);
                this.canvasTexture.image.data.set(e.data);
                this.copyPass.uniforms.uvScale.value.set(1, -1);
                this.copyPass.uniforms.uvOffset.value.set(0, 1);
            }
            this.canvasTexture.needsUpdate = true;
            this.copyPass.uniforms.tDiffuse.value = this.canvasTexture;
            this.copyPass.render(this.renderer, this.readBuffer, null, true);
            if (ISNODE) {
                this.copyPass.uniforms.uvOffset.value.set(0, 0);
                this.copyPass.uniforms.uvScale.value.set(1, 1);
            }
        } else if (e instanceof PZ.layer.composite) {
            if (!this.screenBuffers[t + 1]) {
                this.screenBuffers[t + 1] = this.readBuffer.clone();
            }
            this.clear(t + 1);
            for (var l = e.objects.length - 1; l >= 0; l--) {
                let r = e.objects[l];
                if (
                    (!(r instanceof PZ.layer.scene) || !!r.pass.camera) &&
                    (!(r instanceof PZ.layer.composite) || !!r.objects.length)
                ) {
                    this.renderLayer(r, t + 1);
                }
            }
            this.swapReadBuffer(t + 1);
        } else if (e.pass) {
            e.pass.globalDof = this.globalDofActive;
            try {
                // Same stale-pose guard as above: a borrowed Camera-layer
                // camera keeps ancestors outside this scene.
                if (e.pass.camera) {
                    let _o = e.pass.camera;
                    let _chain = [];
                    let _g = 0;
                    while (_o && _g++ < 16) {
                        _chain.unshift(_o);
                        try {
                            _o = _o.parent;
                        } catch (e2) {
                            break;
                        }
                    }
                    for (let _k = 0; _k < _chain.length; _k++) {
                        try {
                            _chain[_k].updateMatrixWorld();
                        } catch (e2) {}
                    }
                }
            } catch (err) {}
            e.pass.render(this.renderer, this.readBuffer, null, true);
            if (this.globalDofActive && e instanceof PZ.layer.scene) {
                this.renderSceneDepth(e, i, s, n);
            }
        }
        this.writeBuffer.viewport.set(0, 0, s, n);
        this.renderEffects(e.effects, o, p);
        if (e.composite.quad.material.uniforms && e.composite.quad.material.uniforms.tDiffuse) {
            e.composite.quad.material.uniforms.tBG.value = i.texture;
            e.composite.quad.material.uniforms.tDiffuse.value = this.readBuffer.texture;
            e.composite.quad.material.uniforms.uvScale.value.set(o, p);
        }
        this.scene.add(e.composite.group);
        this.compositeScene(r, i);
        this.compositeDepth(e, i, o, p);
        this.swapScreenBuffer(t);
    
};
PZ.compositor.prototype.applyVideoMotionBlur = function (layer, width, height) {
        if (!layer || !layer.texture || !layer.texture.image) {
            return;
        }
        if (typeof HTMLVideoElement === "undefined" || !(layer.texture.image instanceof HTMLVideoElement)) {
            return;
        }
        if (!this._sequence || this._sequence.properties.motionBlur.get() === 0) {
            return;
        }
        let time = layer._renderTime !== undefined ? layer._renderTime : 0;
        let layerBlur = layer.properties.motionBlurAmount ? layer.properties.motionBlurAmount.get(time) : 1;
        if (layerBlur <= 0) {
            return;
        }
        let sequenceTime = this._sequenceTime !== undefined ? this._sequenceTime : 0;
        let amount =
            16 *
            (this._sequence.properties.motionBlurSensitivity.get(sequenceTime) / 100) *
            this._sequence.properties.motionBlurShutter.get(sequenceTime) *
            layerBlur;
        amount = Math.max(0, Math.min(64, amount));
        if (amount <= 0.01 || !this.videoBlurTemp) {
            return;
        }
        let angle = 0;
        if (layer.properties.position) {
            let position = layer.properties.position.get(time);
            let previous = layer.properties.position.get(time - 1);
            let dx = position[0] - previous[0];
            let dy = position[1] - previous[1];
            if (dx !== 0 || dy !== 0) {
                angle = Math.atan2(dy, dx);
            }
        }
        this.videoBlurPass.uniforms.tDiffuse.value = this.readBuffer.texture;
        this.videoBlurPass.uniforms.resolution.value.set(this.readBuffer.width, this.readBuffer.height);
        this.videoBlurPass.uniforms.uvScale.value.set(1, 1);
        this.videoBlurPass.uniforms.center.value.set(
            width !== undefined ? (width / this.readBuffer.width) * 0.5 : 0.5,
            height !== undefined ? (height / this.readBuffer.height) * 0.5 : 0.5
        );
        this.videoBlurPass.uniforms.amount.value = amount;
        this.videoBlurPass.uniforms.angle.value = angle;
        this.videoBlurPass.render(this.renderer, this.videoBlurTemp, null, true);

        if (!this.videoBlurTemp2) {
            this.copyPass.uniforms.tDiffuse.value = this.videoBlurTemp.texture;
            this.copyPass.render(this.renderer, this.readBuffer, null, true);
            return;
        }

        if (!layer._mbPool) {
            layer._mbPool = [
                new THREE.WebGLRenderTarget(this.readBuffer.width, this.readBuffer.height, this.bufferParams),
                new THREE.WebGLRenderTarget(this.readBuffer.width, this.readBuffer.height, this.bufferParams),
                new THREE.WebGLRenderTarget(this.readBuffer.width, this.readBuffer.height, this.bufferParams),
            ];
            layer._mbHead = 0;
            layer._mbCount = 0;
        }
        let pool = layer._mbPool;
        for (let k = 0; k < pool.length; k++) {
            if (pool[k].width !== this.readBuffer.width || pool[k].height !== this.readBuffer.height) {
                pool[k].dispose();
                pool[k] = new THREE.WebGLRenderTarget(this.readBuffer.width, this.readBuffer.height, this.bufferParams);
            }
        }

        this.copyPass.uniforms.tDiffuse.value = this.videoBlurTemp.texture;
        this.copyPass.render(this.renderer, pool[layer._mbHead], null, true);

        let newest = pool[layer._mbHead];
        let middle = pool[(layer._mbHead + 2) % 3];
        let oldest = pool[(layer._mbHead + 1) % 3];
        let temporal = Math.max(
            0,
            Math.min(
                0.9,
                (this._sequence.properties.motionBlurSensitivity.get(sequenceTime) / 100) *
                    this._sequence.properties.motionBlurShutter.get(sequenceTime) *
                    layerBlur *
                    0.5
            )
        );
        let trackFrame = this._sequence.properties.motionBlurTrackFrame.get(sequenceTime);
        let videoMode =
            this._sequence.properties.motionBlurVideoMode !== undefined
                ? this._sequence.properties.motionBlurVideoMode.get(sequenceTime)
                : 0;
        let result = this.videoBlurTemp;
        let alreadyInReadBuffer = false;

        if (temporal > 0.001 && layer._mbCount >= 2) {
            if (videoMode === 1) {
                let strength = Math.max(0, Math.min(4, amount / 16));
                if (trackFrame === 1) {
                    this.videoWarpPass.uniforms.tCurrent.value = newest.texture;
                    this.videoWarpPass.uniforms.tNeighbor.value = middle.texture;
                    this.videoWarpPass.uniforms.resolution.value.set(this.readBuffer.width, this.readBuffer.height);
                    this.videoWarpPass.uniforms.uvScale.value.set(1, 1);
                    this.videoWarpPass.uniforms.strength.value = strength;
                    this.videoWarpPass.uniforms.hasNeighbor.value = 1;
                    this.videoWarpPass.render(this.renderer, this.videoBlurTemp2, null, true);
                    result = this.videoBlurTemp2;
                } else if (trackFrame === 2) {
                    this.videoWarpPass.uniforms.tCurrent.value = middle.texture;
                    this.videoWarpPass.uniforms.tNeighbor.value = newest.texture;
                    this.videoWarpPass.uniforms.resolution.value.set(this.readBuffer.width, this.readBuffer.height);
                    this.videoWarpPass.uniforms.uvScale.value.set(1, 1);
                    this.videoWarpPass.uniforms.strength.value = strength;
                    this.videoWarpPass.uniforms.hasNeighbor.value = 1;
                    this.videoWarpPass.render(this.renderer, this.videoBlurTemp2, null, true);
                    result = this.videoBlurTemp2;
                } else if (layer._mbCount >= 3) {
                    this.videoWarpPass.uniforms.resolution.value.set(this.readBuffer.width, this.readBuffer.height);
                    this.videoWarpPass.uniforms.uvScale.value.set(1, 1);
                    this.videoWarpPass.uniforms.strength.value = strength;
                    this.videoWarpPass.uniforms.hasNeighbor.value = 1;
                    this.videoWarpPass.uniforms.tCurrent.value = middle.texture;
                    this.videoWarpPass.uniforms.tNeighbor.value = oldest.texture;
                    this.videoWarpPass.render(this.renderer, this.videoBlurTemp2, null, true);
                    this.videoWarpPass.uniforms.tCurrent.value = middle.texture;
                    this.videoWarpPass.uniforms.tNeighbor.value = newest.texture;
                    this.videoWarpPass.render(this.renderer, this.videoBlurTemp, null, true);
                    this.videoMixPass.uniforms.tA.value = this.videoBlurTemp2.texture;
                    this.videoMixPass.uniforms.tB.value = this.videoBlurTemp.texture;
                    this.videoMixPass.uniforms.amount.value = 0.5;
                    this.videoMixPass.uniforms.uvScale.value.set(1, 1);
                    this.videoMixPass.render(this.renderer, this.readBuffer, null, true);
                    alreadyInReadBuffer = true;
                }
            } else if (trackFrame === 1) {
                this.videoMixPass.uniforms.tA.value = newest.texture;
                this.videoMixPass.uniforms.tB.value = middle.texture;
                this.videoMixPass.uniforms.amount.value = temporal;
                this.videoMixPass.uniforms.uvScale.value.set(1, 1);
                this.videoMixPass.render(this.renderer, this.videoBlurTemp2, null, true);
                result = this.videoBlurTemp2;
            } else if (trackFrame === 2) {
                this.videoMixPass.uniforms.tA.value = middle.texture;
                this.videoMixPass.uniforms.tB.value = newest.texture;
                this.videoMixPass.uniforms.amount.value = temporal;
                this.videoMixPass.uniforms.uvScale.value.set(1, 1);
                this.videoMixPass.render(this.renderer, this.videoBlurTemp2, null, true);
                result = this.videoBlurTemp2;
            } else if (layer._mbCount >= 3) {
                this.videoMixPass.uniforms.tA.value = oldest.texture;
                this.videoMixPass.uniforms.tB.value = newest.texture;
                this.videoMixPass.uniforms.amount.value = 0.5;
                this.videoMixPass.uniforms.uvScale.value.set(1, 1);
                this.videoMixPass.render(this.renderer, this.videoBlurTemp2, null, true);
                this.videoMixPass.uniforms.tA.value = middle.texture;
                this.videoMixPass.uniforms.tB.value = this.videoBlurTemp2.texture;
                this.videoMixPass.uniforms.amount.value = Math.min(1, temporal * 2);
                this.videoMixPass.render(this.renderer, this.videoBlurTemp, null, true);
                result = this.videoBlurTemp;
            }
        }

        if (!alreadyInReadBuffer) {
            this.copyPass.uniforms.tDiffuse.value = result.texture;
            this.copyPass.render(this.renderer, this.readBuffer, null, true);
        }

        layer._mbHead = (layer._mbHead + 1) % 3;
        if (layer._mbCount < 3) {
            layer._mbCount++;
        }
    
};
