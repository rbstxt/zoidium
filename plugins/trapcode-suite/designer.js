// OpenZoid Trapcode Suite — designer windows.
/*
 * designer.js
 *
 * One designer window per Trapcode object (Particular, Form, Plexus). The
 * window is a floating ZoidiumUI window above the editor, so the main
 * viewport stays the live preview. Layout, top to bottom:
 *
 *   Target   system/object picker and the "add" buttons from the config
 *   Presets  preset list (applies on click), then a PALETTE list when the
 *            target has colors the palettes can set
 *   Blocks   a tab per property group; each row is a CM3 property control
 *
 * Every edit is written through the object's properties with CM3 history
 * records, so undo/redo works. Slider drags preview live and record one undo
 * step on release. Structural changes (adding a system or object) push their
 * own history commands.
 *
 * The config contract (registerConfig) is shared with the object modules:
 *   title, targets(root), targetName(item, index), addKinds [{name, create(root)}],
 *   blocks(target) -> [{key, name}], groupFor(target, key),
 *   presets [{name}], applyPreset(root, target, preset), customOpen(root, designer)
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var WINDOW_PREFIX = "trapcode-suite:designer:";
    var REFRESH_MS = 300;

    var CONFIGS = {};
    var handles = {};
    var nextKey = 1;

    function configFor(root) {
        if (!root) return null;
        return root.constructor && root.constructor.designer ? root.constructor.designer : null;
    }

    function ui() {
        return typeof window !== "undefined" && window.ZoidiumUI ? window.ZoidiumUI : null;
    }

    function frame() {
        var playback = typeof CM !== "undefined" && CM ? CM.playback : null;
        var value = playback ? Number(playback.currentFrame) : 0;
        return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    }

    function snapshot(property) {
        return JSON.parse(JSON.stringify(property.get(frame())));
    }

    function sameValue(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    // Runs fn inside one CM3 history operation. Nested calls join the outer one.
    function operate(fn) {
        var history = typeof CM !== "undefined" && CM ? CM.history : null;
        if (!history || typeof history.startOperation !== "function" || history.operation) {
            return fn();
        }
        history.startOperation();
        try {
            return fn();
        } finally {
            history.finishOperation();
        }
    }

    function recordSetValue(property, value, oldValue) {
        var ops = new PZ.ui.properties(CM);
        ops.setValue({ property: property.getAddress(), frame: frame(), value: value, oldValue: oldValue });
    }

    // Commits one edit. `before` is the value captured when a drag started;
    // live previews have already written the new value.
    function commitEdit(property, value, before) {
        var old = before === undefined ? snapshot(property) : before;
        if (sameValue(old, value)) return;
        operate(function () { recordSetValue(property, value, old); });
    }

    // Live-preview and commit pair for one property.
    function propertyEditor(property) {
        var before;
        return {
            input: function (value) {
                if (before === undefined) before = snapshot(property);
                property.set(value, frame());
            },
            change: function (value) {
                var old = before;
                before = undefined;
                commitEdit(property, value, old);
            },
        };
    }

    // Leaf properties under a list or a group, in definition order.
    function collectLeaves(list, out) {
        out = out || [];
        if (!list) return out;
        if (list instanceof PZ.property) {
            if (list.objects && list.objects.length) list.objects.forEach(function (child) { collectLeaves(child, out); });
            else out.push(list);
            return out;
        }
        if (list instanceof PZ.propertyList) {
            Object.keys(list).forEach(function (key) { collectLeaves(list[key], out); });
        }
        return out;
    }

    // Runs a config callback (presets, palettes) and records every property it
    // changed as one undo step.
    function recordChanges(target, fn) {
        var leaves = collectLeaves(target.properties);
        var before = leaves.map(snapshot);
        var result = fn();
        operate(function () {
            leaves.forEach(function (property, index) {
                var now = snapshot(property);
                if (!sameValue(before[index], now)) recordSetValue(property, now, before[index]);
            });
        });
        return result;
    }

    function rgbToHex(rgb) {
        var parts = [0, 1, 2].map(function (i) {
            var v = Math.round(Math.max(0, Math.min(1, Number(rgb[i]) || 0)) * 255);
            return (v < 16 ? "0" : "") + v.toString(16);
        });
        return "#" + parts.join("");
    }

    function hexToRgb(hex) {
        var n = parseInt(String(hex).slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    // Each control built here is tracked so the window can re-read values
    // while the frame changes (animated properties).
    function Session(root, config, body, win) {
        this.root = root;
        this.config = config;
        this.body = body;
        this.win = win;
        this.target = null;
        this.block = null;
        this.tracked = [];
        this.frameLabel = null;
        this.timer = 0;
    }

    Session.prototype.targets = function () {
        var list = this.config.targets ? this.config.targets(this.root) : null;
        return list ? Array.prototype.slice.call(list) : [];
    };

    Session.prototype.targetList = function () {
        return this.config.targets ? this.config.targets(this.root) : null;
    };

    Session.prototype.track = function (control, read) {
        this.tracked.push({ control: control, read: read });
        return control;
    };

    Session.prototype.refresh = function () {
        var active = typeof document !== "undefined" ? document.activeElement : null;
        this.tracked.forEach(function (entry) {
            var element = entry.control.element;
            if (active && element && element.contains && element.contains(active)) return;
            try { entry.control.set(entry.read()); } catch (_error) { /* property gone */ }
        });
        if (this.frameLabel) this.frameLabel.textContent = "Frame " + frame();
    };

    Session.prototype.rebuild = function () {
        var targets = this.targets();
        if (!this.target || targets.indexOf(this.target) < 0) {
            this.target = targets.length ? targets[0] : this.root;
            this.block = null;
        }
        this.tracked = [];
        this.body.textContent = "";
        var C = ui().controls;
        this.body.appendChild(this.targetSection(targets, C).element);
        this.body.appendChild(this.presetSection(C).element);
        if (T.supportsPalette(this.target) && T.palettes && T.palettes.length) {
            this.body.appendChild(this.paletteSection(C).element);
        }
        this.body.appendChild(this.blockSection(C).element);
        this.frameLabel = C.note("Frame " + frame()).element;
        this.body.appendChild(this.frameLabel);
        this.refresh();
    };

    Session.prototype.targetSection = function (targets, C) {
        var self = this;
        var section = C.section({ title: "Target" });
        var options = targets.map(function (item, index) {
            var name = self.config.targetName ? self.config.targetName(item, index) : "System " + (index + 1);
            return { value: String(index), label: name };
        });
        var current = targets.indexOf(this.target);
        if (options.length) {
            section.body.appendChild(C.select({
                label: "Object",
                value: String(current < 0 ? 0 : current),
                options: options,
                onChange: function (value) {
                    self.target = targets[Number(value)] || self.target;
                    self.block = null;
                    self.rebuild();
                },
            }).element);
        } else {
            section.body.appendChild(C.note("Nothing to edit yet.").element);
        }
        var kinds = this.config.addKinds || [];
        if (kinds.length) {
            section.body.appendChild(C.buttonRow(kinds.map(function (kind) {
                return {
                    title: kind.name,
                    onClick: function () { self.addTarget(kind); },
                };
            })).element);
        }
        return section;
    };

    // Structural add: the new item is recorded so undo removes it again.
    Session.prototype.addTarget = function (kind) {
        var self = this;
        var list = this.targetList();
        var created = null;
        operate(function () {
            created = kind.create(self.root);
            if (created && list) pushInsertUndo(list, created);
        });
        if (created) {
            this.target = created;
            this.block = null;
            this.rebuild();
        }
    };

    function pushInsertUndo(list, item) {
        var history = CM.history;
        if (!history || !history.operation) return;
        history.pushCommand(removeCommand, { list: list, item: item });
    }

    function removeCommand(payload) {
        var index = payload.list.indexOf(payload.item);
        if (index < 0) return;
        payload.list.splice(index, 1);
        CM.history.pushCommand(insertCommand, { list: payload.list, item: payload.item, index: index });
    }

    function insertCommand(payload) {
        payload.list.splice(payload.index, 0, payload.item);
        CM.history.pushCommand(removeCommand, { list: payload.list, item: payload.item });
    }

    Session.prototype.presetSection = function (C) {
        var self = this;
        var section = C.section({ title: "Presets", collapsed: true });
        var presets = this.config.presets || [];
        var list = C.list({
            items: presets.map(function (preset, index) {
                return { id: index, title: preset.name, detail: "" };
            }),
            emptyText: "No presets.",
            onSelect: function (index) {
                var preset = presets[index];
                if (!preset || !self.target || !self.config.applyPreset) return;
                recordChanges(self.target, function () {
                    self.config.applyPreset(self.root, self.target, preset);
                });
                self.rebuild();
            },
        });
        section.body.appendChild(list.element);
        return section;
    };

    Session.prototype.paletteSection = function (C) {
        var self = this;
        var section = C.section({ title: "Palette", collapsed: true });
        var schemes = T.palettes;
        var list = C.list({
            items: schemes.map(function (scheme, index) {
                return { id: index, title: scheme.name, detail: "" };
            }),
            emptyText: "No palettes.",
            onSelect: function (index) {
                var scheme = schemes[index];
                if (!scheme || !self.target) return;
                recordChanges(self.target, function () {
                    T.applyPalette(self.target, scheme);
                });
                self.refresh();
            },
        });
        section.body.appendChild(list.element);
        return section;
    };

    Session.prototype.blockSection = function (C) {
        var self = this;
        var section = C.section({ title: "Parameters" });
        var blocks = (this.config.blocks ? this.config.blocks(this.target) : []) || [];
        if (!blocks.length) {
            section.body.appendChild(C.note("No parameters.").element);
            return section;
        }
        if (!this.block || !blocks.some(function (b) { return b.key === self.block; })) {
            this.block = blocks[0].key;
        }
        var tabs = C.tabs({
            value: this.block,
            tabs: blocks.map(function (block) {
                return {
                    id: block.key,
                    title: block.name,
                    render: function (panel) {
                        var group = self.config.groupFor
                            ? self.config.groupFor(self.target, block.key)
                            : self.target.properties[block.key];
                        self.renderGroup(group, panel, C);
                    },
                };
            }),
            onChange: function (id) { self.block = id; },
        });
        section.body.appendChild(tabs.element);
        return section;
    };

    Session.prototype.renderGroup = function (group, panel, C) {
        if (!group) return;
        var self = this;
        Object.keys(group).forEach(function (key) {
            var property = group[key];
            if (!(property instanceof PZ.property)) return;
            if (property.definition && property.definition.visible === false) return;
            self.renderProperty(property, panel, C);
        });
    };

    Session.prototype.renderProperty = function (property, panel, C) {
        var self = this;
        var def = property.definition || {};
        var label = def.name || "";
        var types = PZ.property.type;

        if (property.objects && property.objects.length) {
            if (def.type === types.COLOR) {
                this.renderColor(property, panel, C);
            } else {
                property.objects.forEach(function (child) { self.renderProperty(child, panel, C); });
            }
            return;
        }

        if (def.type === types.NUMBER) {
            var edit = propertyEditor(property);
            var number = C.number({
                label: label,
                value: property.get(frame()),
                min: def.min,
                max: def.max,
                step: def.step || 1,
                onInput: edit.input,
                onChange: edit.change,
            });
            panel.appendChild(number.element);
            this.track(number, function () { return property.get(frame()); });
        } else if (def.type === types.OPTION) {
            var items = String(def.items || "").split(";").map(function (text, index) {
                return { value: String(index), label: text };
            });
            var select = C.select({
                label: label,
                value: String(Math.round(property.get(frame()))),
                options: items,
                onChange: function (value) { commitEdit(property, Number(value)); },
            });
            panel.appendChild(select.element);
            this.track(select, function () { return String(Math.round(property.get(frame()))); });
        } else if (def.type === types.TEXT) {
            panel.appendChild(C.text({
                label: label,
                value: property.get(frame()),
                onChange: function (value) { commitEdit(property, value); },
            }).element);
        } else {
            var current = property.get(frame());
            var summary = typeof current === "string" && current ? current : "none";
            panel.appendChild(C.note(label + ": " + summary + ". Assign curves, gradients and assets in the Edit panel.").element);
        }
    };

    Session.prototype.renderColor = function (group, panel, C) {
        var children = group.objects;
        var before = null;
        var read = function () {
            return rgbToHex(children.map(function (child) { return child.get(frame()); }));
        };
        var control = C.color({
            label: group.definition.name || "Color",
            value: read(),
            onInput: function (hex) {
                var rgb = hexToRgb(hex);
                if (!before) before = children.map(snapshot);
                children.forEach(function (child, i) { child.set(rgb[i], frame()); });
            },
            onChange: function (hex) {
                var rgb = hexToRgb(hex);
                var old = before || children.map(snapshot);
                before = null;
                operate(function () {
                    children.forEach(function (child, i) {
                        if (!sameValue(old[i], rgb[i])) recordSetValue(child, rgb[i], old[i]);
                    });
                });
            },
        });
        panel.appendChild(control.element);
        this.track(control, read);
    };

    // Builds the window content for one object and returns the teardown.
    function mountDesigner(root, config, body, win) {
        var session = new Session(root, config, body, win);
        session.target = session.targets()[0] || root;
        session.rebuild();
        session.timer = setInterval(function () { session.refresh(); }, REFRESH_MS);
        return {
            rebuild: function () { session.rebuild(); },
            dispose: function () {
                clearInterval(session.timer);
                session.tracked = [];
            },
        };
    }

    function windowIdFor(root) {
        if (!root.__trapcodeDesignerKey) root.__trapcodeDesignerKey = nextKey++;
        return WINDOW_PREFIX + root.__trapcodeDesignerKey;
    }

    var designer = {
        current: null,
        configs: CONFIGS,
    };

    designer.openFirst = function (kind) {
        if (typeof CM === "undefined" || !CM.project) return null;
        var found = null;
        CM.project.forEachItemOfType(PZ.object3d, function (object) {
            if (found) return;
            if (kind && configFor(object) !== kind && object.constructor !== kind) return;
            if (configFor(object)) found = object;
        });
        if (found) designer.open(found);
        return found;
    };

    designer.open = function (root) {
        var config = configFor(root);
        if (!config) return null;
        if (config.customOpen) {
            config.customOpen(root, designer);
            return null;
        }
        var host = ui();
        if (!host || typeof host.openWindow !== "function") return null;

        var id = windowIdFor(root);
        var handle = handles[id];
        if (handle && handle.win && handle.win.isOpen()) {
            handle.win.focus();
            handle.refresh();
            designer.current = handle;
            return handle.win;
        }

        handle = { root: root, win: null, refresh: function () {}, close: function () {} };
        handles[id] = handle;
        var name = root.properties && root.properties.name ? root.properties.name.get() : "";
        var win = host.openWindow({
            id: id,
            title: config.title || "Trapcode Designer",
            subtitle: name || "",
            persistKey: "trapcode-designer:" + String(config.title || "designer").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            width: 360,
            height: 560,
            minWidth: 300,
            minHeight: 260,
            className: "trapcode-designer-window",
            mount: function (body, win) {
                var session = mountDesigner(root, config, body, win);
                handle.refresh = session.rebuild;
                return session.dispose;
            },
            isValid: function () { return root.parent != null; },
        });
        if (!win) {
            delete handles[id];
            return null;
        }
        handle.win = win;
        handle.close = function () { win.close(); };
        win.onClose(function () {
            if (handles[id] === handle) delete handles[id];
            if (designer.current === handle) designer.current = null;
        });
        designer.current = handle;
        return win;
    };

    designer.registerConfig = function (cls, config) {
        cls.designer = config;
    };

    T.designer = designer;
})();
