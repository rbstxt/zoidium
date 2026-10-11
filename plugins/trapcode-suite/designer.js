// OpenZoid Trapcode Suite — designer windows.
/*
 * designer.js
 *
 * One designer window per Trapcode object (Particular, Form, Plexus), drawn in
 * the CM3 panel style:
 *
 *   host chrome title, maximize and close; body toolbar has Presets and Blocks
 *   presets      the preset list, then a PALETTE list with gradient swatches
 *                when the target has colors the palettes can set
 *   center card  transport row with the frame counter, the block tiles, and
 *                the systems strip (target pills and "+ Add ..." buttons)
 *   parameters   CM3's own property rows for the selected block, so keyframe
 *                stopwatches, expressions, scrubbing and undo work as in the
 *                Objects panel
 *
 * The window uses standard Zoidium chrome and editor theme tokens.
 * It has no preview of its own: the editor viewport behind
 * the window is the preview.
 *
 * designer-gear.js hands this file the module's window kit with
 * designer.bind(context.ui) and registers the object editors.
 *
 * Every edit is written through the object's properties with CM3 history
 * records, so undo and redo work. Presets and palettes record one undo step.
 * Structural changes (adding a system or object) push their own history
 * commands.
 *
 * The config contract (registerConfig) is shared with the object modules:
 *   title, targets(root), targetName(item, index), addKinds [{name, create(root)}],
 *   blocks(target) -> [{key, name}], groupFor(target, key),
 *   presets [{name}], applyPreset(root, target, preset)
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var WINDOW_ID_PREFIX = "designer:";
    // CM3 has no frame-change event; compare the frame counter every 250ms.
    var SYNC_MS = 250;

    // Only the designer body is styled here. The host owns window chrome.
    var CSS = [
        ".trapcode-designer-window>.zoidium-window-body{display:flex;flex-direction:column;overflow:hidden;scrollbar-gutter:auto;}",
        ".tc-designer{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;background:var(--zui-bg);color:var(--zui-text);font-family:var(--zui-font);font-size:13px;}",
        ".tc-toolbar{flex:0 0 32px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 6px;background:var(--zui-bg-title);border-bottom:1px solid var(--zui-border);}",
        ".tc-designer button{font-family:var(--zui-font);font-size:13px;}",
        ".tc-toolbar button{width:auto;padding:3px 12px;border:1px solid var(--zui-border);border-radius:2px;}",
        ".tc-toolbar button.active{background:var(--zui-accent);color:var(--zui-text-bright);}",
        ".tc-body{flex:1 1 auto;display:flex;min-height:0;gap:10px;padding:10px;box-sizing:border-box;}",
        ".tc-presets{flex:0 0 208px;min-height:0;background:var(--zui-bg);border:1px solid var(--zui-border);overflow-y:auto;padding:10px;}",
        ".tc-presets.hidden,.tc-params.hidden{display:none;}",
        ".tc-preset{padding:8px 12px;cursor:pointer;border-radius:2px;color:var(--zui-text);font-size:13px;}",
        ".tc-preset:hover,.tc-palette:hover{background:var(--zui-hover);color:var(--zui-text-bright);}",
        ".tc-palettes-title{padding:8px 12px 6px;background:var(--zui-bg-title);color:var(--zui-text-muted);font-size:11px;}",
        ".tc-palette{display:flex;align-items:center;gap:10px;padding:6px 10px;cursor:pointer;border-radius:2px;}",
        ".tc-swatches{flex:0 0 64px;height:16px;border-radius:2px;border:1px solid var(--zui-border);}",
        ".tc-palette span{font-size:11px;}",
        ".tc-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--zui-bg);border:1px solid var(--zui-border);overflow:hidden;}",
        ".tc-transport{flex:0 0 46px;display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--zui-bg-title);border-bottom:1px solid var(--zui-border);}",
        ".tc-transport button{width:auto;padding:4px 12px;border:1px solid var(--zui-border);border-radius:2px;}",
        ".tc-transport svg{width:14px;height:14px;fill:currentColor;}",
        ".tc-time{margin-left:auto;color:var(--zui-value);font-variant-numeric:tabular-nums;}",
        ".tc-strip{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));grid-auto-rows:minmax(96px,1fr);align-content:stretch;gap:8px;padding:10px 12px;overflow-y:auto;}",
        ".tc-block{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-height:0;background:var(--zui-bg-title);border:1px solid var(--zui-border);border-radius:2px;cursor:pointer;color:var(--zui-text);font-size:11px;padding:6px;text-align:center;box-sizing:border-box;}",
        ".tc-block:hover{background:var(--zui-hover);}",
        ".tc-block .tc-thumb{flex:1 1 auto;min-height:0;width:100%;margin-bottom:6px;background:var(--zui-bg-input);}",
        ".tc-block.active{border-color:var(--zui-accent);color:var(--zui-value);}",
        ".tc-systems{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:var(--zui-bg-title);border-top:1px solid var(--zui-border);}",
        ".tc-system{padding:6px 14px;background:var(--zui-bg);border:1px solid var(--zui-border);border-radius:2px;cursor:pointer;color:var(--zui-text);white-space:nowrap;}",
        ".tc-system:hover{background:var(--zui-hover);}",
        ".tc-system.active{background:var(--zui-accent);color:var(--zui-text-bright);border-color:var(--zui-accent);}",
        ".tc-params{flex:0 0 380px;display:flex;flex-direction:column;min-height:0;background:var(--zui-bg);border:1px solid var(--zui-border);overflow:hidden;}",
        ".tc-params>.zoidium-properties{flex:1 1 auto;min-height:0;}",
        // Native curve/gradient pickers have a fixed 245px inline width.
        ".tc-params .editbox{min-width:0;max-width:100%;}",
        ".tc-params .editbox>div{width:100%!important;max-width:100%;box-sizing:border-box;background:var(--zui-bg-input);border:1px solid var(--zui-border);border-radius:2px;}",
    ].map(function (rule) {
        var start = rule.indexOf("{");
        var selectors = rule.slice(0, start).split(",").map(function (selector) {
            return selector.indexOf(".trapcode-designer-window") === 0 ? selector : ".trapcode-designer-window " + selector;
        });
        return selectors.join(",") + rule.slice(start);
    }).join("\n");

    function playback() {
        return typeof CM !== "undefined" && CM ? CM.playback || null : null;
    }

    function frame() {
        var current = playback();
        var value = current ? Number(current.currentFrame) : 0;
        return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    }

    function frameText(value) {
        return String(value).padStart(4, "0");
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

    // Structural add: the new item is recorded so undo removes it again.
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

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(ui, className, text, onClick) {
        var node = ui.controls.button({ title: text, onClick: onClick }).element;
        if (className) node.classList.add.apply(node.classList, className.split(" "));
        return node;
    }

    function transportButton(ui, icon, title, onClick) {
        var node = button(ui, "", "", onClick);
        node.title = title;
        node.setAttribute("aria-label", title);
        node.appendChild(PZ.ui.generateIcon(icon));
        return node;
    }

    // One designer window: the state for one Trapcode object and the DOM the
    // window body holds. The parameter rows are a CM3 property view that reads
    // the selected block of the selected target.
    function Session(ui, id, root, config) {
        this.ui = ui;
        this.id = id;
        this.root = root;
        this.config = config;
        this.target = null;
        this.block = null;
        this.list = [];
        this.labels = [];
        this.view = null;
        this.timer = 0;
        this.win = null;
        this.nodes = null;
    }

    Session.prototype.targetList = function () {
        var list = this.config.targets ? this.config.targets(this.root) : null;
        return list ? Array.prototype.slice.call(list) : [];
    };

    Session.prototype.nameOf = function (item, index) {
        return this.config.targetName ? String(this.config.targetName(item, index)) : "System " + (index + 1);
    };

    Session.prototype.labelsOf = function (list) {
        var self = this;
        return list.map(function (item, index) { return self.nameOf(item, index); });
    };

    Session.prototype.group = function () {
        if (!this.target || !this.block) return null;
        if (this.config.groupFor) return this.config.groupFor(this.target, this.block);
        return this.target.properties ? this.target.properties[this.block] : null;
    };

    // Re-reads the target list. A structural change (a system or object added,
    // removed or renamed elsewhere) re-renders the window; otherwise only the
    // frame counter moves.
    Session.prototype.sync = function () {
        var list = this.targetList();
        var labels = this.labelsOf(list);
        var changed = labels.length !== this.labels.length ||
            list.some(function (item, i) { return item !== this.list[i]; }, this) ||
            labels.some(function (text, i) { return text !== this.labels[i]; }, this);
        if (changed) this.refreshAll();
        if (!this.nodes) return;
        this.nodes.time.textContent = frameText(frame());
    };

    Session.prototype.refreshAll = function () {
        var list = this.targetList();
        if (!this.target || list.indexOf(this.target) < 0) {
            this.target = list.length ? list[0] : this.root;
            this.block = null;
        }
        this.list = list;
        this.labels = this.labelsOf(list);
        this.renderSystems();
        this.renderPalettes();
        this.renderBlocks();
        this.refreshParams();
    };

    Session.prototype.select = function (item) {
        this.target = item;
        this.block = null;
        this.renderSystems();
        this.renderPalettes();
        this.renderBlocks();
        this.refreshParams();
    };

    Session.prototype.refreshParams = function () {
        if (this.view) this.view.refresh();
    };

    Session.prototype.renderSystems = function () {
        var self = this;
        var host = this.nodes.systems;
        host.textContent = "";
        this.list.forEach(function (item, index) {
            var pill = el("div", "tc-system", self.labels[index]);
            pill.classList.toggle("active", item === self.target);
            pill.onclick = function () { self.select(item); };
            host.appendChild(pill);
        });
        (this.config.addKinds || []).forEach(function (kind) {
            var add = el("div", "tc-system add", "+ " + kind.name);
            add.onclick = function () { self.addTarget(kind); };
            host.appendChild(add);
        });
    };

    Session.prototype.addTarget = function (kind) {
        var self = this;
        var list = this.config.targets ? this.config.targets(this.root) : null;
        var created = null;
        operate(function () {
            created = kind.create(self.root);
            if (created && list) pushInsertUndo(list, created);
        });
        if (!created) return;
        this.target = created;
        this.block = null;
        this.refreshAll();
    };

    Session.prototype.renderPalettes = function () {
        var self = this;
        var host = this.nodes.palettes;
        host.textContent = "";
        var schemes = (T && T.palettes) || [];
        if (!this.target || !schemes.length || typeof T.supportsPalette !== "function" || !T.supportsPalette(this.target)) return;
        host.appendChild(el("div", "tc-palettes-title", "Palette"));
        schemes.forEach(function (scheme) {
            var row = el("div", "tc-palette");
            var bar = el("div", "tc-swatches");
            bar.style.background = T.paletteCSS(scheme);
            row.appendChild(bar);
            row.appendChild(el("span", "", scheme.name));
            row.onclick = function () {
                if (!self.target) return;
                recordChanges(self.target, function () { T.applyPalette(self.target, scheme); });
                self.refreshParams();
            };
            host.appendChild(row);
        });
    };

    Session.prototype.renderBlocks = function () {
        var self = this;
        var host = this.nodes.strip;
        host.textContent = "";
        var blocks = (this.config.blocks ? this.config.blocks(this.target) : []) || [];
        if (!blocks.some(function (block) { return block.key === self.block; })) {
            this.block = blocks.length ? blocks[0].key : null;
        }
        blocks.forEach(function (block) {
            var tile = el("div", "tc-block");
            tile.appendChild(el("div", "tc-thumb"));
            tile.appendChild(el("span", "", block.name));
            tile.classList.toggle("active", block.key === self.block);
            tile.onclick = function () {
                self.block = block.key;
                self.renderBlocks();
                self.refreshParams();
            };
            host.appendChild(tile);
        });
    };

    Session.prototype.mount = function (body, win) {
        var self = this;
        var ui = this.ui;
        this.win = win;

        var root = el("div", "tc-designer");
        var style = el("style");
        style.textContent = CSS;
        root.appendChild(style);
        var toolbar = el("div", "tc-toolbar");
        var presetsToggle = button(ui, "tc-presets-toggle active", "Presets", function () {
            var hidden = presets.classList.toggle("hidden");
            presetsToggle.classList.toggle("active", !hidden);
            presetsToggle.setAttribute("aria-pressed", String(!hidden));
        });
        var blocksToggle = button(ui, "tc-blocks-toggle active", "Blocks", function () {
            var hidden = params.classList.toggle("hidden");
            blocksToggle.classList.toggle("active", !hidden);
            blocksToggle.setAttribute("aria-pressed", String(!hidden));
        });
        presetsToggle.setAttribute("aria-pressed", "true");
        blocksToggle.setAttribute("aria-pressed", "true");
        toolbar.appendChild(presetsToggle);
        toolbar.appendChild(blocksToggle);

        var content = el("div", "tc-body");
        var presets = el("div", "tc-presets");
        var main = el("div", "tc-main");
        var params = el("div", "tc-params");

        (this.config.presets || []).forEach(function (preset) {
            presets.appendChild(el("div", "tc-preset", preset.name)).onclick = function () {
                if (!self.target || !self.config.applyPreset) return;
                recordChanges(self.target, function () {
                    self.config.applyPreset(self.root, self.target, preset);
                });
                self.refreshAll();
            };
        });
        var palettes = el("div", "tc-palette-list");
        presets.appendChild(palettes);

        var transport = el("div", "tc-transport");
        var time = el("span", "tc-time", frameText(frame()));
        transport.appendChild(transportButton(ui, "prevframe", "Previous frame", function () {
            var current = playback();
            if (!current) return;
            current.speed = 0;
            current.currentFrame = Math.max(0, frame() - 1);
        }));
        transport.appendChild(transportButton(ui, "play", "Play", function () {
            var current = playback();
            if (current) current.speed = 1;
        }));
        transport.appendChild(transportButton(ui, "pause", "Pause", function () {
            var current = playback();
            if (current) current.speed = 0;
        }));
        transport.appendChild(transportButton(ui, "nextframe", "Next frame", function () {
            var current = playback();
            if (!current) return;
            current.speed = 0;
            current.currentFrame = Math.min(frame() + 1, Math.max(0, current.totalFrames - 1));
        }));
        transport.appendChild(time);

        var strip = el("div", "tc-strip");
        var systems = el("div", "tc-systems");
        main.appendChild(transport);
        main.appendChild(strip);
        main.appendChild(systems);

        content.appendChild(presets);
        content.appendChild(main);
        content.appendChild(params);
        root.appendChild(toolbar);
        root.appendChild(content);
        body.appendChild(root);

        // The parameter rows are CM3's own property editor. Its target is read
        // through the getter, so refresh() re-resolves the selected block.
        this.view = ui.properties({
            target: function () { return self.group(); },
            emptyText: "No parameters.",
            labelWidth: 0.48,
        });
        params.appendChild(this.view.element);

        this.nodes = { presets: presets, palettes: palettes, strip: strip, systems: systems, time: time };
        this.refreshAll();
        this.timer = setInterval(function () { self.sync(); }, SYNC_MS);
        sessions[this.id] = this;

        return function dispose() {
            clearInterval(self.timer);
            self.timer = 0;
            if (sessions[self.id] === self) delete sessions[self.id];
            if (self.view) self.view.dispose();
            self.view = null;
            self.nodes = null;
        };
    };

    var sessions = {};
    var keys = typeof WeakMap === "function" ? new WeakMap() : null;
    var nextKey = 1;

    function configFor(root) {
        if (!root) return null;
        return root.constructor && root.constructor.designer ? root.constructor.designer : null;
    }

    function windowIdFor(root) {
        var key = keys ? keys.get(root) : root.__trapcodeDesignerKey;
        if (!key) {
            key = nextKey++;
            if (keys) keys.set(root, key);
            else root.__trapcodeDesignerKey = key;
        }
        return WINDOW_ID_PREFIX + key;
    }

    var designer = {
        ui: null,
    };

    // Binds the window kit of one plugin module. Returns the unbind function.
    designer.bind = function (ui) {
        designer.ui = ui || null;
        return function unbind() {
            if (designer.ui === ui) designer.ui = null;
        };
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

    // Opens the designer window of one object, or focuses it when it is open.
    designer.open = function (root) {
        var config = configFor(root);
        var ui = designer.ui;
        if (!config || !ui || typeof ui.openWindow !== "function") return null;
        var id = windowIdFor(root);
        var existing = typeof ui.getWindow === "function" ? ui.getWindow(id) : null;
        if (existing && existing.isOpen()) {
            existing.focus();
            if (sessions[id]) sessions[id].sync();
            return existing;
        }
        var session = new Session(ui, id, root, config);
        return ui.openWindow({
            id: id,
            title: config.title || "Trapcode Designer",
            persistKey: "designer",
            placement: "center",
            width: 1060,
            height: 600,
            minWidth: 760,
            minHeight: 420,
            className: "trapcode-designer-window",
            isValid: function () { return root.parent != null; },
            mount: function (body, win) { return session.mount(body, win); },
        });
    };

    designer.registerConfig = function (cls, config) {
        cls.designer = config;
    };

    T.designer = designer;
})();
