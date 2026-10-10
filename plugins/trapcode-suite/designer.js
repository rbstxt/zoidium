// OpenZoid Trapcode Suite — designer windows.
/*
 * designer.js
 *
 * One designer window per Trapcode object (Particular, Form, Plexus), drawn in
 * the look of the original Trapcode Designer:
 *
 *   title bar    PRESETS and BLOCKS pills, the title, maximize and close
 *   presets      the preset list, then a PALETTE list with gradient swatches
 *                when the target has colors the palettes can set
 *   center card  transport row with the frame counter, the block tiles, and
 *                the systems strip (target pills and "+ Add ..." buttons)
 *   parameters   CM3's own property rows for the selected block, so keyframe
 *                stopwatches, expressions, scrubbing and undo work as in the
 *                Objects panel
 *
 * The window is a floating Zoidium window that uses the "designer" skin
 * (designer.skinCss). It has no preview of its own: the editor viewport behind
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
    var SKIN = "designer";
    var WINDOW_ID_PREFIX = "designer:";
    // CM3 has no frame-change event, so the frame counter is re-read at this
    // interval. The check is one number compare, so the cost stays negligible.
    var SYNC_MS = 250;
    var SVG_NS = "http://www.w3.org/2000/svg";
    var CLOSE_PATH = "M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z";
    var MAXIMIZE_PATH = "M2 2h12v12H2z M4 4v8h8V4z";
    var RESTORE_PATH = "M4 1h11v11h-3V4H4z M1 5h11v10H1z";

    var CSS = [
        // Davi's gold accents: kept exactly under Panzoid Classic. Other color
        // profiles take the profile's accent hue (from --zoidium-theme-link) at
        // the gold's saturation and lightness, so the designer matches the editor.
        ":scope{--tc-gold:#c9a13b;--tc-gold-light:#e8c56a;--tc-gold-warm:#e0b060;--tc-gold-dark:#3a3220;--tc-blue:#4a90d9;}",
        "html[data-zoidium-theme]:not([data-zoidium-theme=panzoid]) :scope{--tc-gold:hsl(from var(--zoidium-theme-link) h calc(56.8 * var(--zoidium-theme-saturation, 1)) 51.0);--tc-gold-light:hsl(from var(--zoidium-theme-link) h calc(73.3 * var(--zoidium-theme-saturation, 1)) 66.3);--tc-gold-warm:hsl(from var(--zoidium-theme-link) h calc(67.4 * var(--zoidium-theme-saturation, 1)) 62.7);--tc-gold-dark:hsl(from var(--zoidium-theme-link) h calc(28.9 * var(--zoidium-theme-saturation, 1)) 17.6);}",
        ":scope{background:radial-gradient(900px 480px at 10% -6%,color-mix(in srgb,var(--tc-gold) 15%,transparent),transparent 60%),radial-gradient(760px 520px at 97% 108%,color-mix(in srgb,var(--tc-blue) 10%,transparent),transparent 62%),linear-gradient(180deg,#101014 0%,#0a0b0e 55%,#060708 100%);color:#e8e9eb;font-family:system-ui,\"Segoe UI\",-apple-system,sans-serif;font-size:12px;animation:tcFade .28s ease;}",
        ":scope>.zoidium-window-body{display:flex;flex-direction:column;overflow:hidden;}",
        ":scope button{font-family:inherit;}",
        "@keyframes tcFade{from{opacity:0;}to{opacity:1;}}",
        "@keyframes tcRise{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}",
        ".tc-designer{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;}",
        ".tc-titlebar{flex:0 0 46px;display:flex;align-items:center;gap:8px;background:rgba(14,16,20,.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08);padding:0 12px;animation:tcRise .32s ease;cursor:move;user-select:none;}",
        ".tc-title{display:flex;align-items:center;gap:10px;padding:0 4px;font-weight:600;font-size:13px;letter-spacing:2px;color:#f2f3f5;flex:1;min-width:0;white-space:nowrap;overflow:hidden;}",
        ".tc-title:before{content:'';width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,var(--tc-gold-light),var(--tc-gold));box-shadow:0 0 12px color-mix(in srgb,var(--tc-gold) 80%,transparent);flex:0 0 auto;}",
        ".tc-pill{display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#d6d8dc;font-size:10px;letter-spacing:2px;font-weight:600;padding:7px 16px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease;}",
        ".tc-pill.tc-icon{padding:7px 12px;}",
        ".tc-pill:hover{background:color-mix(in srgb,var(--tc-gold) 16%,transparent);border-color:color-mix(in srgb,var(--tc-gold) 55%,transparent);color:#fff;transform:translateY(-1px);}",
        ".tc-pill:active{transform:none;}",
        ".tc-pill:focus-visible{outline:2px solid var(--tc-gold);outline-offset:2px;}",
        ".tc-presets-toggle{color:var(--tc-gold-warm);}",
        ".tc-glyph{width:11px;height:11px;fill:currentColor;display:block;pointer-events:none;}",
        ".tc-glyph-restore{display:none;}",
        ":scope.maximized .tc-glyph-max{display:none;}",
        ":scope.maximized .tc-glyph-restore{display:block;}",
        ".tc-body{flex:1 1 auto;display:flex;min-height:0;gap:10px;padding:10px;box-sizing:border-box;}",
        ".tc-presets{flex:0 0 208px;min-height:0;background:rgba(20,22,27,.86);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow-y:auto;padding:10px;animation:tcRise .36s ease;box-shadow:0 12px 32px rgba(0,0,0,.45);}",
        ".tc-presets.hidden{display:none;}",
        ".tc-preset{padding:8px 12px;cursor:pointer;border-radius:9px;color:#c9cdd4;font-size:11px;font-weight:500;letter-spacing:.3px;border:1px solid transparent;transition:background .15s ease,color .15s ease,transform .15s ease,border-color .15s ease;}",
        ".tc-preset:hover{background:color-mix(in srgb,var(--tc-gold) 13%,transparent);border-color:color-mix(in srgb,var(--tc-gold) 35%,transparent);color:#fff;transform:translateX(2px);}",
        ".tc-palettes-title{padding:12px 12px 6px;color:var(--tc-gold-warm);font-size:10px;font-weight:700;letter-spacing:2px;}",
        ".tc-palette{display:flex;align-items:center;gap:10px;padding:6px 10px;cursor:pointer;border-radius:9px;border:1px solid transparent;transition:background .15s ease,border-color .15s ease,transform .15s ease;}",
        ".tc-palette:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.10);transform:translateX(2px);}",
        ".tc-swatches{flex:0 0 64px;height:16px;border-radius:5px;border:1px solid rgba(0,0,0,.6);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);}",
        ".tc-palette span{color:#c9cdd4;font-size:11px;font-weight:500;}",
        ".tc-palette:hover span{color:#fff;}",
        ".tc-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.5);animation:tcRise .4s ease;}",
        ".tc-transport{flex:0 0 46px;display:flex;align-items:center;gap:8px;padding:0 12px;background:rgba(16,18,22,.9);border-bottom:1px solid rgba(255,255,255,.07);}",
        ".tc-transport button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e8e9eb;font-size:11px;padding:6px 12px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,color .15s ease;}",
        ".tc-transport button:hover{background:color-mix(in srgb,var(--tc-gold) 20%,transparent);border-color:color-mix(in srgb,var(--tc-gold) 60%,transparent);color:#fff;}",
        ".tc-transport button:focus-visible{outline:2px solid var(--tc-gold);outline-offset:2px;}",
        ".tc-time{margin-left:auto;color:var(--tc-gold-light);font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:1px;}",
        // The tiles fill the card: rows share the free height and tiles share each row.
        ".tc-strip{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));grid-auto-rows:minmax(96px,1fr);align-content:stretch;gap:8px;padding:10px 12px;background:rgba(13,15,18,.9);overflow-y:auto;}",
        ".tc-block{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-height:0;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.10);border-radius:11px;cursor:pointer;color:#cfd3d9;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:6px;text-align:center;box-sizing:border-box;transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease;}",
        ".tc-block:hover{border-color:color-mix(in srgb,var(--tc-gold) 50%,transparent);transform:translateY(-2px);}",
        ".tc-block .tc-thumb{flex:1 1 auto;min-height:0;width:100%;border-radius:7px;margin-bottom:6px;background:linear-gradient(135deg,var(--tc-gold-dark),#14161c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);}",
        ".tc-block.active{border-color:var(--tc-gold);color:#fff;box-shadow:0 0 0 1px var(--tc-gold),0 6px 18px color-mix(in srgb,var(--tc-gold) 35%,transparent);}",
        ".tc-systems{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:rgba(13,15,18,.9);border-top:1px solid rgba(255,255,255,.07);}",
        ".tc-system{padding:6px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.11);border-radius:999px;cursor:pointer;color:#c9cdd4;font-weight:500;white-space:nowrap;transition:background .15s ease,border-color .15s ease,color .15s ease;}",
        ".tc-system:hover{color:#fff;border-color:color-mix(in srgb,var(--tc-gold) 50%,transparent);}",
        ".tc-system.active{background:var(--tc-gold);color:#191919;border-color:var(--tc-gold);font-weight:700;box-shadow:0 4px 14px color-mix(in srgb,var(--tc-gold) 40%,transparent);}",
        ".tc-system.add{color:#9ae6a0;border-style:dashed;}",
        ".tc-system.add:hover{background:rgba(138,217,138,.12);border-color:rgba(138,217,138,.5);color:#fff;}",
        ".tc-system.remove{padding:6px 12px;color:#e89a9a;}",
        ".tc-system.remove:hover{background:rgba(217,138,138,.14);border-color:rgba(217,138,138,.5);color:#fff;}",
        ".tc-params{flex:0 0 380px;display:flex;flex-direction:column;min-height:0;background:rgba(20,22,27,.86);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;animation:tcRise .44s ease;box-shadow:0 12px 32px rgba(0,0,0,.45);}",
        ".tc-params.hidden{display:none;}",
        ":scope .tc-params>.zoidium-properties{flex:1 1 auto;min-height:0;background:transparent;}",
        // CM3's curve/gradient pickers carry a fixed 245px inline width that
        // overflows the parameter card once the label column takes its share.
        // Constrain them to the card and give the box the dark input color.
        // This skin CSS only applies inside the designer window, so the
        // standard property panel keeps the normal CM3 look.
        ".tc-params .editbox{min-width:0;max-width:100%;}",
        ".tc-params .editbox>div{width:100%!important;max-width:100%;box-sizing:border-box;background:#202020;border:1px solid #1b1b1b;border-radius:3px;}",
        ".tc-presets::-webkit-scrollbar,.tc-strip::-webkit-scrollbar,.tc-systems::-webkit-scrollbar,.tc-params .zoidium-properties::-webkit-scrollbar{width:10px;height:10px;}",
        ".tc-presets::-webkit-scrollbar-track,.tc-strip::-webkit-scrollbar-track,.tc-systems::-webkit-scrollbar-track,.tc-params .zoidium-properties::-webkit-scrollbar-track{background:transparent;}",
        ".tc-presets::-webkit-scrollbar-thumb,.tc-strip::-webkit-scrollbar-thumb,.tc-systems::-webkit-scrollbar-thumb,.tc-params .zoidium-properties::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px;border:2px solid transparent;background-clip:content-box;}",
        ".tc-presets::-webkit-scrollbar-thumb:hover,.tc-strip::-webkit-scrollbar-thumb:hover,.tc-systems::-webkit-scrollbar-thumb:hover,.tc-params .zoidium-properties::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--tc-gold) 50%,transparent);border:2px solid transparent;background-clip:content-box;}",
        "@media (prefers-reduced-motion:reduce){:scope *{animation:none!important;transition:none!important;}}",
    ].join("\n");

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

    function button(className, text, onClick) {
        var node = el("button", className, text);
        node.type = "button";
        node.onclick = onClick;
        return node;
    }

    function svgIcon(className, path) {
        var svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("class", className);
        var shape = document.createElementNS(SVG_NS, "path");
        shape.setAttribute("d", path);
        svg.appendChild(shape);
        return svg;
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
        this.syncMaximize();
    };

    // The host also maximizes on a title double-click, so the pill label is
    // re-read from the window state rather than assumed.
    Session.prototype.syncMaximize = function () {
        if (!this.nodes || !this.win) return;
        var label = this.win.isMaximized() ? "Restore" : "Maximize";
        if (this.nodes.maximize.title === label) return;
        this.nodes.maximize.title = label;
        this.nodes.maximize.setAttribute("aria-label", label);
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
        host.appendChild(el("div", "tc-palettes-title", "PALETTE"));
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
        var titlebar = el("div", "tc-titlebar");
        var presetsToggle = button("tc-pill tc-presets-toggle", "PRESETS", function () { presets.classList.toggle("hidden"); });
        var title = el("div", "tc-title", this.config.title || "Trapcode Designer");
        var blocksToggle = button("tc-pill", "BLOCKS", function () { params.classList.toggle("hidden"); });
        var maximize = button("tc-pill tc-icon", "", function () {
            win.toggleMaximized();
            self.syncMaximize();
        });
        maximize.title = "Maximize";
        maximize.setAttribute("aria-label", "Maximize");
        maximize.appendChild(svgIcon("tc-glyph tc-glyph-max", MAXIMIZE_PATH));
        maximize.appendChild(svgIcon("tc-glyph tc-glyph-restore", RESTORE_PATH));
        var close = button("tc-pill tc-icon", "", function () { win.close(); });
        close.title = "Close";
        close.setAttribute("aria-label", "Close");
        close.appendChild(svgIcon("tc-glyph", CLOSE_PATH));
        titlebar.appendChild(presetsToggle);
        titlebar.appendChild(title);
        titlebar.appendChild(blocksToggle);
        titlebar.appendChild(maximize);
        titlebar.appendChild(close);

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
        transport.appendChild(button("", "⏪", function () {
            var current = playback();
            if (!current) return;
            current.speed = 0;
            current.currentFrame = Math.max(0, frame() - 1);
        }));
        transport.appendChild(button("", "▶", function () {
            var current = playback();
            if (current) current.speed = 1;
        }));
        transport.appendChild(button("", "⏸", function () {
            var current = playback();
            if (current) current.speed = 0;
        }));
        transport.appendChild(button("", "⏩", function () {
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
        root.appendChild(titlebar);
        root.appendChild(content);
        body.appendChild(root);
        win.makeDragHandle(titlebar);

        // The parameter rows are CM3's own property editor. Its target is read
        // through the getter, so refresh() re-resolves the selected block.
        this.view = ui.properties({
            target: function () { return self.group(); },
            emptyText: "No parameters.",
            labelWidth: 0.48,
        });
        params.appendChild(this.view.element);

        this.nodes = { presets: presets, palettes: palettes, strip: strip, systems: systems, time: time, maximize: maximize };
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
        skinCss: CSS,
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
            skin: SKIN,
            chrome: "custom",
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
