// Precomp+ — composition tabs engine (extracted verbatim from the OpenZoid
// UI, with one fix: the project-changed watcher only resets comp state
// when the project object is replaced, so entering a comp no longer pops
// back out to Main).
PZ.ui.comps = {
    panels: [],
    getActive: function (editor) {
        if (!editor) return null;
        return editor.activeComp || null;
    },
    isCompMedia: function (m) {
        if (!m) return false;
        try {
            if (m.isComp) return true;
        } catch (e) {}
        return false;
    },
    listComps: function (editor) {
        let out = [];
        if (!editor || !editor.project) return out;
        out.push({ id: "main", name: "Main", isMain: true, media: null });
        try {
            for (let i = 0; i < editor.project.media.length; i++) {
                let m = editor.project.media[i];
                if (PZ.ui.comps.isCompMedia(m)) {
                    let nm = "Comp";
                    try {
                        nm = m.properties.name.get();
                    } catch (e) {}
                    out.push({ id: "media:" + i, name: nm, isMain: false, media: m, index: i });
                }
            }
        } catch (e) {}
        return out;
    },
    serializeCurrent: function (editor) {
        let seq = editor.project.sequence;
        return {
            video: JSON.parse(JSON.stringify(seq.videoTracks)),
            audio: JSON.parse(JSON.stringify(seq.audioTracks)),
            length: seq.length,
        };
    },
    saveCurrent: function (editor) {
        if (!editor || !editor.project) return;
        try {
            if (!editor.activeComp) {
                try {
                    editor.mainBackup = PZ.ui.comps.serializeCurrent(editor);
                } catch (e) {}
                return;
            }
            let m = editor.activeComp;
            if (!m || !editor.project.media.includes(m)) {
                editor.activeComp = null;
                return;
            }
            let snap = PZ.ui.comps.serializeCurrent(editor);
            editor.history.startOperation();
            m.data = [];
            for (let i = 0; i < snap.video.length; i++) m.data.push(snap.video[i]);
            for (let i = 0; i < snap.audio.length; i++) m.data.push(snap.audio[i]);
            m.compLength = snap.length;
            try {
                m.properties.name.get();
            } catch (e) {}
            editor.history.finishOperation();
        } catch (e) {}
    },
    restoreIntoSequence: function (editor, videoJSON, audioJSON, length) {
        let seq = editor.project.sequence;
        seq.videoTracks.splice(0, seq.videoTracks.length);
        seq.audioTracks.splice(0, seq.audioTracks.length);
        if (videoJSON) {
            for (let i = 0; i < videoJSON.length; i++) {
                let tr = new PZ.track.video();
                seq.videoTracks.push(tr);
                try {
                    tr.load(videoJSON[i]);
                } catch (e) {}
            }
        }
        if (audioJSON) {
            for (let i = 0; i < audioJSON.length; i++) {
                let tr = new PZ.track.audio();
                seq.audioTracks.push(tr);
                try {
                    tr.load(audioJSON[i]);
                } catch (e) {}
            }
        }
        if (length) seq.length = length;
        try {
            PZ.schedule.analyzeSequence(seq);
        } catch (e) {}
        try {
            if (editor.playback) editor.playback.currentFrame = 0;
        } catch (e) {}
        try {
            let tl = null;
            if (editor.windows) {
                for (let w = 0; w < editor.windows.length; w++) {
                    try {
                        let panels = editor.windows[w].panels || [];
                    } catch (e2) {}
                }
            }
        } catch (e) {}
        PZ.ui.comps.refreshTimeline(editor);
    },
    refreshTimeline: function (editor) {
        try {
            let timelines = [];
            let findPanels = function (obj) {
                if (!obj) return;
                if (obj instanceof PZ.ui.timeline) timelines.push(obj);
                if (obj.panels) {
                    for (let i = 0; i < obj.panels.length; i++) findPanels(obj.panels[i]);
                }
                if (obj.el && obj.el.querySelectorAll) {
                    let els = obj.el.querySelectorAll(".clip");
                }
            };
            if (editor._timelineRef) {
                timelines.push(editor._timelineRef);
            }
            if (editor._allTimelines) {
                for (let i = 0; i < editor._allTimelines.length; i++) timelines.push(editor._allTimelines[i]);
            }
            for (let i = 0; i < timelines.length; i++) {
                try {
                    timelines[i].tracks.deselectClips();
                    timelines[i].tracks.selectClips();
                    timelines[i].tracks.redraw();
                    timelines[i].tracks.zoom();
                    timelines[i].tracks.verticalZoom();
                    if (timelines[i].updateZoom) timelines[i].updateZoom();
                } catch (e) {}
            }
            if (!timelines.length && editor.project) {
                try {
                    editor.project.ui.onChanged.update();
                } catch (e) {}
            }
        } catch (e) {}
        PZ.ui.comps.refreshPanels();
    },
    switchTo: function (editor, mediaOrNull) {
        if (!editor || !editor.project) return false;
        try {
            let cur = editor.activeComp || null;
            if (cur === mediaOrNull) {
                PZ.ui.comps.refreshPanels();
                return true;
            }
            PZ.ui.comps.saveCurrent(editor);
            if (!mediaOrNull) {
                let backup = editor.mainBackup;
                if (backup) {
                    PZ.ui.comps.restoreIntoSequence(editor, backup.video, backup.audio, backup.length);
                }
                editor.activeComp = null;
            } else {
                let data = mediaOrNull.data || [];
                let video = [];
                let audio = [];
                for (let i = 0; i < data.length; i++) {
                    if (data[i].type === 0) video.push(JSON.parse(JSON.stringify(data[i])));
                    else audio.push(JSON.parse(JSON.stringify(data[i])));
                }
                if (!video.length && !audio.length) {
                    video = [{ type: 0, clips: [] }];
                }
                let len = mediaOrNull.compLength || editor.project.sequence.length || 180;
                PZ.ui.comps.restoreIntoSequence(editor, video, audio, len);
                editor.activeComp = mediaOrNull;
            }
            try {
                editor.project.ui.dirty = true;
            } catch (e) {}
            PZ.ui.comps.refreshPanels();
            return true;
        } catch (e) {
            return false;
        }
    },
    newComp: function (editor, name, videoJSON, audioJSON, length, switchAfter) {
        if (!editor || !editor.project) return null;
        try {
            PZ.ui.comps.saveCurrent(editor);
            let nm = name || ("Comp " + (PZ.ui.comps.listComps(editor).length));
            let data = [];
            if (videoJSON) {
                for (let i = 0; i < videoJSON.length; i++) data.push(videoJSON[i]);
            }
            if (audioJSON) {
                for (let i = 0; i < audioJSON.length; i++) data.push(audioJSON[i]);
            }
            if (!data.length) {
                data.push({ type: 0, clips: [] });
            }
            let len = length || (editor.project.sequence ? editor.project.sequence.length : 180);
            let m = new PZ.media();
            editor.project.media.push(m);
            let payload = {
                properties: { name: nm, icon: "layers" },
                icon: "layers",
                data: JSON.parse(JSON.stringify(data)),
                baseType: "track",
                assets: [],
                isComp: true,
                compLength: len,
            };
            m.loading = m.load(payload);
            if (switchAfter === false) {
                try {
                    if (editor.project) editor.project.ui.dirty = true;
                } catch (e2) {}
                PZ.ui.comps.refreshPanels();
                return m;
            }
            editor.activeComp = null;
            PZ.ui.comps.switchTo(editor, m);
            return m;
        } catch (e) {
            return null;
        }
    },
    newEmptyComp: function (editor) {
        let n = PZ.ui.comps.listComps(editor).length;
        return PZ.ui.comps.newComp(editor, "Comp " + n, [{ type: 0, clips: [] }], [], editor.project.sequence.length);
    },
    precomposeFromSelection: function (editor) {
        if (!editor || !editor.project || !editor.project.sequence) return null;
        let seq = editor.project.sequence;
        let sel = [];
        try {
            if (editor.timelineSelection && editor.timelineSelection.length) {
                sel = Array.from(editor.timelineSelection);
            }
        } catch (e) {}
        if (!sel.length) {
            try {
                alert("Select one or more clips first, then Pre-compose.");
            } catch (e) {}
            return null;
        }
        try {
            let minStart = Math.min.apply(
                null,
                sel.map((c) => c.start)
            );
            let maxEnd = Math.max.apply(
                null,
                sel.map((c) => c.start + c.length)
            );
            // Group selected clips by their source track so multi-track
            // selections keep their layering instead of collapsing onto
            // one track (which made overlapping layers disappear).
            // Map: "v:<trackIdx>" -> { track, clips: [] }, "a:<trackIdx>" -> {...}
            let groups = new Map();
            for (let i = 0; i < sel.length; i++) {
                let c = sel[i];
                let found = null;
                for (let ti = 0; ti < seq.videoTracks.length; ti++) {
                    if (seq.videoTracks[ti].clips.indexOf(c) >= 0) {
                        found = { kind: "v", idx: ti, track: seq.videoTracks[ti] };
                        break;
                    }
                }
                if (!found) {
                    for (let ti = 0; ti < seq.audioTracks.length; ti++) {
                        if (seq.audioTracks[ti].clips.indexOf(c) >= 0) {
                            found = { kind: "a", idx: ti, track: seq.audioTracks[ti] };
                            break;
                        }
                    }
                }
                if (!found) {
                    let isAudio = false;
                    try {
                        isAudio = c.object && c.object instanceof PZ.audio;
                    } catch (e2) {}
                    found = { kind: isAudio ? "a" : "v", idx: -1, track: null };
                }
                let key = found.kind + ":" + found.idx;
                if (!groups.has(key)) groups.set(key, { kind: found.kind, idx: found.idx, track: found.track, clips: [] });
                groups.get(key).clips.push(c);
            }
            let videoTracksJSON = [];
            let audioTracksJSON = [];
            groups.forEach((g) => {
                // Sort clips left-to-right so restored order matches timeline.
                g.clips.sort((a, b) => a.start - b.start);
                let clipsJSON = [];
                for (let i = 0; i < g.clips.length; i++) {
                    let c = g.clips[i];
                    let jd = JSON.parse(JSON.stringify(c));
                    jd.start = c.start - minStart;
                    // Unlink copies in the new comp; keep links only as numbers.
                    try {
                        if (jd.link !== null && typeof jd.link === "object") jd.link = null;
                    } catch (e2) {}
                    clipsJSON.push(jd);
                }
                let trackJSON = { type: g.kind === "v" ? 0 : 1, clips: clipsJSON };
                // Preserve eye + 3D switches from the source track.
                try {
                    if (g.track) {
                        if (g.track.enabled !== undefined) trackJSON.enabled = !!g.track.enabled;
                        if (g.kind === "v" && g.track.track3d !== undefined) trackJSON.track3d = !!g.track.track3d;
                    }
                } catch (e2) {}
                if (g.kind === "v") videoTracksJSON.push({ json: trackJSON, srcIdx: g.idx });
                else audioTracksJSON.push({ json: trackJSON, srcIdx: g.idx });
            });
            // Keep original track order.
            videoTracksJSON.sort((a, b) => a.srcIdx - b.srcIdx);
            audioTracksJSON.sort((a, b) => a.srcIdx - b.srcIdx);
            let videoJSON = videoTracksJSON.map((e) => e.json);
            let audioJSON = audioTracksJSON.map((e) => e.json);
            if (!videoJSON.length && !audioJSON.length) {
                videoJSON = [{ type: 0, clips: [] }];
            }
            let compLen = Math.max(maxEnd - minStart, 30);
            let n = PZ.ui.comps.listComps(editor).length;
            let compName = "Pre-comp " + n;
            try {
                let firstName = sel[0].properties.name.get();
                if (firstName) compName = firstName + " comp";
            } catch (e) {}
            // AE-style move: selected clips go into the new comp tab, and
            // Main keeps a single pre-comp layer holding them, so Main
            // shows 1 layer instead of N.
            let shiftKeys = function (obj, off) {
                if (!obj || off === 0) return;
                if (Array.isArray(obj)) {
                    for (let k = 0; k < obj.length; k++) shiftKeys(obj[k], off);
                    return;
                }
                if (typeof obj !== "object") return;
                if (obj.keyframes && Array.isArray(obj.keyframes)) {
                    for (let k = 0; k < obj.keyframes.length; k++) {
                        try {
                            if (typeof obj.keyframes[k].frame === "number") obj.keyframes[k].frame += off;
                        } catch (e2) {}
                    }
                }
                for (let key in obj) {
                    if (key === "keyframes") continue;
                    try {
                        shiftKeys(obj[key], off);
                    } catch (e2) {}
                }
            };
            let m = PZ.ui.comps.newComp(editor, compName, videoJSON, audioJSON, compLen, false);
            if (m) {
                try {
                    m.compSource = sel.map((c) => {
                        try {
                            return c.properties.name.get();
                        } catch (e) {
                            return "";
                        }
                    });
                } catch (e) {}
            }
            // Build the single collapsed layer: video selections become
            // children of one Pre-comp (composite) clip in Main.
            try {
                let tracksUI = editor._timelineRef ? editor._timelineRef.tracks : null;
                if (tracksUI && m) {
                    let videoSel = [];
                    for (let i = 0; i < sel.length; i++) {
                        let c = sel[i];
                        let ti = -1;
                        for (let t = 0; t < seq.videoTracks.length; t++) {
                            if (seq.videoTracks[t].clips.indexOf(c) >= 0) {
                                ti = t;
                                break;
                            }
                        }
                        if (ti >= 0) videoSel.push({ clip: c, trackIdx: ti });
                    }
                    if (videoSel.length) {
                        // Top track first: composite renders objects[0] on top.
                        videoSel.sort((a, b) => b.trackIdx - a.trackIdx || a.clip.start - b.clip.start);
                        let children = [];
                        for (let i = 0; i < videoSel.length; i++) {
                            let c = videoSel[i].clip;
                            let off = c.start - minStart;
                            let layerJSON = JSON.parse(JSON.stringify(c.object));
                            shiftKeys(layerJSON, off);
                            children.push(layerJSON);
                        }
                        let targetTrackIdx = Math.min.apply(
                            null,
                            videoSel.map((e) => e.trackIdx)
                        );
                        // DOM elements for the selected clips (reverse order deletes safely).
                        let allClipEls = Array.from(tracksUI.container.querySelectorAll(".clip"));
                        let selSet = new Set(sel);
                        let selEls = allClipEls.filter((el) => el.pz_object && selSet.has(el.pz_object));
                        selEls.reverse();
                        editor.history.startOperation();
                        if (selEls.length) tracksUI.deleteClips(selEls);
                        let targetTrack = seq.videoTracks[targetTrackIdx];
                        let newIdx = 0;
                        if (targetTrack) {
                            newIdx = targetTrack.clips.length;
                            for (let k = 0; k < targetTrack.clips.length; k++) {
                                if (targetTrack.clips[k].start < minStart) newIdx = k + 1;
                            }
                        }
                        tracksUI.createClip({
                            type: 0,
                            newTrackIdx: targetTrackIdx,
                            newIdx: newIdx,
                            data: {
                                properties: { name: compName },
                                object: { type: 2, objects: children, effects: [], properties: { name: compName } },
                            },
                            start: minStart,
                            length: compLen,
                        });
                        editor.history.finishOperation();
                        tracksUI.selectClips();
                        tracksUI.zoom();
                    } else {
                        // Audio-only selection: just moved into the comp tab.
                        let allClipEls = Array.from(tracksUI.container.querySelectorAll(".clip"));
                        let selSet = new Set(sel);
                        let selEls = allClipEls.filter((el) => el.pz_object && selSet.has(el.pz_object));
                        selEls.reverse();
                        editor.history.startOperation();
                        if (selEls.length) tracksUI.deleteClips(selEls);
                        editor.history.finishOperation();
                        tracksUI.selectClips();
                        tracksUI.zoom();
                    }
                }
            } catch (e) {}
            try {
                PZ.ui.comps.refreshPanels();
            } catch (e) {}
            return m;
        } catch (e) {
            return null;
        }
    },
    openSourceOfClip: function (editor, clip) {
        if (!editor || !clip) return false;
        try {
            let nm = "";
            try {
                nm = clip.properties.name.get();
            } catch (e) {}
            let comps = PZ.ui.comps.listComps(editor);
            for (let i = 0; i < comps.length; i++) {
                if (comps[i].isMain) continue;
                if (comps[i].name === nm) {
                    PZ.ui.comps.switchTo(editor, comps[i].media);
                    return true;
                }
            }
            if (nm) {
                for (let i = 0; i < comps.length; i++) {
                    if (comps[i].isMain) continue;
                    try {
                        let src = comps[i].media.compSource;
                        if (src && src.indexOf(nm) >= 0) {
                            PZ.ui.comps.switchTo(editor, comps[i].media);
                            return true;
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
        return false;
    },
    refreshPanels: function () {
        try {
            for (let i = 0; i < PZ.ui.comps.panels.length; i++) {
                try {
                    PZ.ui.comps.panels[i].refresh();
                } catch (e) {}
            }
        } catch (e) {}
    },
    attachSaveHook: function (editor) {
        if (!editor || editor._compsSaveHooked) return;
        editor._compsSaveHooked = true;
        try {
            let origSave = editor.save.bind(editor);
            editor.save = async function (asTemplate) {
                let cur = editor.activeComp || null;
                try {
                    PZ.ui.comps.saveCurrent(editor);
                    if (cur) {
                        let backup = editor.mainBackup;
                        if (backup) {
                            let curSnap = PZ.ui.comps.serializeCurrent(editor);
                            PZ.ui.comps.restoreIntoSequence(editor, backup.video, backup.audio, backup.length);
                            let r = await origSave(asTemplate);
                            PZ.ui.comps.restoreIntoSequence(editor, curSnap.video, curSnap.audio, curSnap.length);
                            editor.activeComp = cur;
                            PZ.ui.comps.refreshPanels();
                            return r;
                        }
                    }
                } catch (e) {}
                return await origSave(asTemplate);
            };
        } catch (e) {}
        try {
            if (editor.recovery && editor.recovery.backUp && !editor.recovery._compsHooked) {
                editor.recovery._compsHooked = true;
                let origBackup = editor.recovery.backUp.bind(editor.recovery);
                editor.recovery.backUp = function () {
                    let cur = null;
                    let curSnap = null;
                    try {
                        cur = editor.activeComp || null;
                        if (cur) {
                            PZ.ui.comps.saveCurrent(editor);
                            curSnap = PZ.ui.comps.serializeCurrent(editor);
                            let backup = editor.mainBackup;
                            if (backup) {
                                PZ.ui.comps.restoreIntoSequence(editor, backup.video, backup.audio, backup.length);
                            }
                        }
                    } catch (e) {}
                    let r = null;
                    try {
                        r = origBackup();
                    } catch (e) {}
                    try {
                        if (cur && curSnap) {
                            PZ.ui.comps.restoreIntoSequence(editor, curSnap.video, curSnap.audio, curSnap.length);
                            editor.activeComp = cur;
                        }
                    } catch (e) {}
                    return r;
                };
            }
        } catch (e) {}
        try {
            let lastProject = editor.project || null;
            editor.onProjectChanged.watch(() => {
                // Comp switches mutate the same project object in place;
                // only a replaced project (new/open) drops comp state.
                if (editor.project !== lastProject) {
                    lastProject = editor.project || null;
                    editor.activeComp = null;
                    editor.mainBackup = null;
                }
                PZ.ui.comps.refreshPanels();
            });
        } catch (e) {}
        try {
            editor.precomposeSelection = function () {
                return PZ.ui.comps.precomposeFromSelection(editor);
            };
        } catch (e) {}
    },
};
PZ.ui.compsPanel = function (e) {
    PZ.ui.panel.call(this, e);
    this.title = "Comps";
    this.icon = "layers";
    this.el.style.overflowY = "auto";
    this.el.style.padding = "6px";
    this.listEl = document.createElement("div");
    this.el.appendChild(this.listEl);
    PZ.ui.comps.panels.push(this);
    try {
        PZ.ui.comps.attachSaveHook(this.editor);
    } catch (err) {}
    try {
        this.editor.onProjectChanged.watch(this.refresh.bind(this), true);
    } catch (err) {}
    this.refresh();
};
PZ.ui.compsPanel.prototype = Object.create(PZ.ui.panel.prototype);
PZ.ui.compsPanel.prototype.constructor = PZ.ui.compsPanel;
PZ.ui.compsPanel.prototype.refresh = function () {
    let self = this;
    try {
        this.listEl.innerHTML = "";
        let editor = this.editor;
        if (!editor || !editor.project) {
            let d = document.createElement("div");
            d.style = "color:#888;font-size:12px;padding:4px;";
            d.innerText = "No project.";
            this.listEl.appendChild(d);
            return;
        }
        PZ.ui.comps.attachSaveHook(editor);
        let btnRow = document.createElement("div");
        btnRow.style = "display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;";
        let mkBtn = (label, title, fn) => {
            let b = document.createElement("button");
            b.innerText = label;
            b.title = title;
            b.style = "background:#2e3b4d;color:#e8eef5;border:1px solid #43536a;border-radius:3px;padding:4px 8px;font-size:11px;cursor:pointer;";
            b.onclick = fn;
            btnRow.appendChild(b);
            return b;
        };
        mkBtn("New comp", "Create an empty composition", () => {
            PZ.ui.comps.newEmptyComp(editor);
        });
        mkBtn("Pre-compose", "Create a comp from selected clips", () => {
            PZ.ui.comps.precomposeFromSelection(editor);
        });
        this.listEl.appendChild(btnRow);
        let comps = PZ.ui.comps.listComps(editor);
        let active = editor.activeComp || null;
        for (let i = 0; i < comps.length; i++) {
            let c = comps[i];
            let row = document.createElement("div");
            let isActive = c.isMain ? !active : active === c.media;
            row.style = "display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:3px;cursor:pointer;font-size:12px;color:#c7d3df;margin-bottom:2px;background:" + (isActive ? "#3a5a86;color:#fff" : "transparent");
            let nm = document.createElement("span");
            nm.style = "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            nm.innerText = (c.isMain ? "★ Main" : "◉ " + c.name) + (isActive ? "  (open)" : "");
            nm.title = c.isMain ? "Main composition" : "Composition: " + c.name + " — click to open";
            row.appendChild(nm);
            row.onclick = ((mediaOrNull) => {
                return () => {
                    PZ.ui.comps.switchTo(editor, mediaOrNull);
                };
            })(c.isMain ? null : c.media);
            if (!c.isMain) {
                let del = document.createElement("button");
                del.innerText = "×";
                del.title = "Delete composition (clips in Main are kept)";
                del.style = "background:transparent;border:0;color:#93a5b8;cursor:pointer;font-size:14px;";
                del.onclick = ((media) => {
                    return (ev) => {
                        ev.stopPropagation();
                        try {
                            if (!confirm("Delete composition?")) return;
                            if (editor.activeComp === media) {
                                PZ.ui.comps.switchTo(editor, null);
                            }
                            let idx = editor.project.media.indexOf(media);
                            if (idx >= 0) {
                                editor.history.startOperation();
                                try {
                                    media.unload();
                                } catch (e) {}
                                editor.project.media.splice(idx, 1);
                                editor.history.finishOperation();
                            }
                            PZ.ui.comps.refreshPanels();
                        } catch (e) {}
                    };
                })(c.media);
                row.appendChild(del);
            }
            self.listEl.appendChild(row);
        }
        let hint = document.createElement("div");
        hint.style = "color:#7f93a8;font-size:11px;line-height:1.5;margin-top:8px;padding:0 2px;";
        hint.innerText = "Tabs = compositions. Click to switch timeline. Pre-compose moves selected clips into a new comp tab. Drag comps from Project media to reuse clips in other comps.";
        self.listEl.appendChild(hint);
    } catch (e) {}
};
