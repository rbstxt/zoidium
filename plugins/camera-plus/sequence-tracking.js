// Camera+ — shared-camera tracking on PZ.sequence (extracted verbatim).
PZ.sequence.prototype.collectSceneEntries = function ()  {
            // Every camera source in view: dedicated Camera layers plus Scene
            // layers (top-level tracks and Scenes nested inside collapsed
            // pre-comps), each with its owning track.
            let out = [];
            let labelOf = function (layer) {
                try {
                    let n = layer.properties && layer.properties.name ? layer.properties.name.get() : "";
                    if (n) return n;
                } catch (err) {}
                return "";
            };
            let hasCardTransform = function (layer) {
                // A pre-comp with a Transform effect is a 3D card: the whole
                // collapsed result follows the camera as one, like video.
                try {
                    if (!layer || !layer.effects) return false;
                    for (let k = 0; k < layer.effects.length; k++) {
                        if (layer.effects[k] && layer.effects[k].type === "transform") return true;
                    }
                } catch (err) {}
                return false;
            };
            let walk = function (layer, track, trackIdx, depth, topClipName, insideCard) {
                if (!layer) return;
                if (layer instanceof PZ.layer.camera) {
                    let camObj = null;
                    try {
                        if (layer.getCamera) camObj = layer.getCamera();
                    } catch (err) {}
                    let nm = labelOf(layer) + " " + (topClipName || "");
                    out.push({ track: track, trackIdx: trackIdx, layer: layer, camObj: camObj, depth: depth, label: nm, isCameraLayer: true, insideCard: !!insideCard });
                    return;
                }
                if (layer instanceof PZ.layer.scene) {
                    let camObj = null;
                    try {
                        if (layer.pass && layer.pass.camera) {
                            for (let k = 0; k < layer.objects.length; k++) {
                                let o = layer.objects[k];
                                if ((o instanceof PZ.object3d.camera || (o && o.type === 6)) && o.threeObj === layer.pass.camera) {
                                    camObj = o;
                                    break;
                                }
                            }
                        }
                    } catch (err) {}
                    let nm = labelOf(layer) + " " + (topClipName || "");
                    out.push({ track: track, trackIdx: trackIdx, layer: layer, camObj: camObj, depth: depth, label: nm, isCameraLayer: false, insideCard: !!insideCard });
                    return;
                }
                if (layer instanceof PZ.layer.composite && layer.objects) {
                    let card = !!insideCard || hasCardTransform(layer);
                    for (let k = 0; k < layer.objects.length; k++) {
                        try {
                            walk(layer.objects[k], track, trackIdx, depth + 1, topClipName, card);
                        } catch (err) {}
                    }
                }
            };
            for (let t = 0; t < this.videoTracks.length; t++) {
                let track = this.videoTracks[t];
                if (!track || track.enabled === false || !track.layer) continue;
                let topName = "";
                try {
                    let clip = track.layer.parent;
                    if (clip && clip.properties && clip.properties.name) topName = clip.properties.name.get() || "";
                } catch (err) {}
                try {
                    walk(track.layer, track, t, 0, topName);
                } catch (err) {}
            }
            return out;
        
};
PZ.sequence.prototype.getSharedCamera = function ()  {
            // The dedicated Camera layer drives every 3D-enabled scene, even
            // when the scenes live inside a collapsed pre-comp and even when
            // the Camera track itself never turned its own 3D button on.
            let entries = null;
            try {
                entries = this.collectSceneEntries();
            } catch (err) {
                return null;
            }
            let best = null;
            let bestScore = null;
            let less = function (a, b) {
                for (let k = 0; k < a.length; k++) {
                    if (a[k] < b[k]) return true;
                    if (a[k] > b[k]) return false;
                }
                return false;
            };
            for (let i = 0; i < entries.length; i++) {
                let en = entries[i];
                if (!en.camObj || !en.camObj.threeObj) continue;
                // Cameras frozen inside a 3D card never lead: the card as a
                // whole follows the outside camera instead.
                if (en.insideCard) continue;
                let isCamLayer = !!en.isCameraLayer;
                let isCam = isCamLayer;
                try {
                    if (/camera/i.test(en.label || "")) isCam = true;
                } catch (err) {}
                // Prefer: real Camera layer, then Camera-named, then
                // top-level, then lowest track.
                let score = [isCamLayer ? 0 : 1, isCam ? 0 : 1, en.depth, en.trackIdx];
                if (!best || less(score, bestScore)) {
                    best = en;
                    bestScore = score;
                }
            }
            if (!best) return null;
            let pos = [0, 0, 80];
            let rot = [0, 0, 0];
            try {
                // World space, not local: the camera often lives inside a
                // Group whose rotation carries it (Group > Camera), and its
                // ancestors are never in the rendered scene, so refresh the
                // chain root-first by hand before reading.
                let _o = best.camObj.threeObj;
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
                let _wp = new THREE.Vector3();
                best.camObj.threeObj.getWorldPosition(_wp);
                pos = [_wp.x, _wp.y, _wp.z];
                let _wq = new THREE.Quaternion();
                best.camObj.threeObj.getWorldQuaternion(_wq);
                let _we = new THREE.Euler(0, 0, 0, best.camObj.threeObj.rotation.order || "XYZ");
                _we.setFromQuaternion(_wq);
                rot = [_we.x, _we.y, _we.z];
            } catch (err) {
                try {
                    pos = [best.camObj.threeObj.position.x, best.camObj.threeObj.position.y, best.camObj.threeObj.position.z];
                    rot = [best.camObj.threeObj.rotation.x, best.camObj.threeObj.rotation.y, best.camObj.threeObj.rotation.z];
                } catch (err2) {}
            }
            return { track: best.track, scene: best.layer, camera: best.camObj, three: best.camObj.threeObj, position: pos, rotation: rot };
        
};
PZ.sequence.prototype.applySharedCamera = function (e)  {
            let master = this.getSharedCamera();
            let entries = null;
            try {
                entries = this.collectSceneEntries();
            } catch (err) {
                return;
            }
            let restoreOwn = function (layer) {
                if (!layer.pass || !layer.objects) return;
                let own = false;
                let firstOwn = null;
                for (let k = 0; k < layer.objects.length; k++) {
                    let o = layer.objects[k];
                    if ((o instanceof PZ.object3d.camera || (o && o.type === 6)) && o.threeObj) {
                        if (!firstOwn) firstOwn = o.threeObj;
                        if (o.threeObj === layer.pass.camera) {
                            own = true;
                            break;
                        }
                    }
                }
                if (!own && firstOwn) layer.pass.camera = firstOwn;
            };
            for (let i = 0; i < entries.length; i++) {
                let en = entries[i];
                if (master && en.layer === master.scene) continue;
                if (!en.layer.pass) continue;
                // Follower while its 3D switch is on and it is not frozen
                // inside a 3D card; restored to its own camera the moment it
                // is switched off, carded, or the master goes away, so
                // toggle-off takes effect immediately instead of sticking on
                // the borrowed camera.
                let follow = !!master && !!en.track.track3d && en.track.enabled !== false && !en.insideCard;
                if (follow) {
                    // Fit follower scenes to the master camera: disable their
                    // own cameras by rendering through the shared master camera,
                    // so the Camera layer drives every 3D-enabled scene.
                    if (master.three) en.layer.pass.camera = master.three;
                } else {
                    restoreOwn(en.layer);
                }
            }
            if (!master) return;
            // Second pass: re-apply 3D parallax to flat (video) layers with
            // the final master transform, so track order doesn't cause 1-frame lag.
            // Videos use a 3D transform (position/depth/tilt) driven by the camera.
            try {
                let cx = master.position[0] || 0;
                let cy = master.position[1] || 0;
                let cz = master.position[2] !== undefined ? master.position[2] : 80;
                let crx = master.rotation ? master.rotation[0] || 0 : 0;
                let cry = master.rotation ? master.rotation[1] || 0 : 0;
                let crz = master.rotation ? master.rotation[2] || 0 : 0;
                for (let t = 0; t < this.videoTracks.length; t++) {
                    let track = this.videoTracks[t];
                    if (!track.track3d || track.enabled === false) continue;
                    let layer = track.layer;
                    if (!layer || layer === master.scene) continue;
                    if (layer instanceof PZ.layer.scene) continue;
                    if (layer instanceof PZ.layer.camera) continue;
                    if (layer instanceof PZ.layer.composite) continue;
                    if (layer instanceof PZ.layer.adjustment) continue;
                    if (!layer.composite || !layer.composite.group) continue;
                    let clip = layer.parent;
                    let localT = e;
                    try {
                        if (clip && clip.start !== undefined) localT = e - clip.start;
                    } catch (err2) {}
                    let base = [0, 0];
                    let baseRot = 0;
                    let baseRX = 0;
                    let baseRY = 0;
                    let baseScale = [1, 1];
                    let depth = 0;
                    try {
                        base = layer.properties.position.get(localT);
                        baseRot = layer.properties.rotation.get(localT);
                        if (layer.properties.rotationX) baseRX = layer.properties.rotationX.get(localT);
                        if (layer.properties.rotationY) baseRY = layer.properties.rotationY.get(localT);
                        baseScale = layer.properties.scale.get(localT);
                        if (layer.properties.depth) depth = layer.properties.depth.get(localT);
                    } catch (err2) {}
                    let dist = Math.max(cz - depth, 1);
                    let persp = 80 / dist;
                    layer.composite.group.position.set((base[0] - cx) * persp, (base[1] - cy) * persp, 0);
                    layer.composite.group.rotation.set(baseRX - crx, baseRY - cry, baseRot - crz);
                    layer.composite.group.scale.set(baseScale[0] * persp, baseScale[1] * persp, 1);
                }
            } catch (err) {}
        
};
