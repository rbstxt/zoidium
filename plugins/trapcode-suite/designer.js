// OpenZoid Trapcode Suite — designer windows (ported verbatim from designer.js).
// Entry points (Object-panel gear wiring) arrive with the designer/UI phase;
// designer.openFirst(kind) is available as soon as the plugin is enabled.
/*
 * designer.js
 *
 * Trapcode-style full-screen Designer windows for the Particular, Form and
 * Plexus object3d types. Mirrors the structure shown in the reference
 * screenshots: title bar, PRESETS column, BLOCKS toggle, live preview,
 * transport bar, systems strip and a parameter panel.
 *
 * SaaS theme (v7): Inter type, silk-gradient backdrop, gold suite accents,
 * pill controls, staggered rise-in motion, and slim scrollbars. All DOM
 * structure and class names are unchanged; this is a CSS-only reskin.
 *
 * Reuses the main viewport for the preview (like the VHS setup window) and
 * PZ.ui.edit for the parameter tree.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

    var CSS = [
        ".tc-designer{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;background:radial-gradient(900px 480px at 10% -6%,rgba(201,161,59,.15),transparent 60%),radial-gradient(760px 520px at 97% 108%,rgba(74,144,217,.10),transparent 62%),linear-gradient(180deg,#101014 0%,#0a0b0e 55%,#060708 100%);color:#e8e9eb;font-family:Inter,'Segoe UI',system-ui,-apple-system,sans-serif;font-size:12px;animation:tcFade .28s ease;}",
        ".tc-designer button{font-family:inherit;}",
        "@keyframes tcFade{from{opacity:0;}to{opacity:1;}}",
        "@keyframes tcRise{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}",
        ".tc-titlebar{flex:0 0 46px;display:flex;align-items:center;gap:8px;background:rgba(14,16,20,.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08);padding:0 12px;animation:tcRise .32s ease;}",
        ".tc-title{display:flex;align-items:center;gap:10px;padding:0 4px;font-weight:600;font-size:13px;letter-spacing:2px;color:#f2f3f5;flex:1;}",
        ".tc-title:before{content:'';width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#e8c56a,#c9a13b);box-shadow:0 0 12px rgba(201,161,59,.8);flex:0 0 auto;}",
        ".tc-titlebar button{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#d6d8dc;font-size:10px;letter-spacing:2px;padding:7px 16px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease;}",
        ".tc-titlebar button:hover{background:rgba(201,161,59,.16);border-color:rgba(201,161,59,.55);color:#fff;transform:translateY(-1px);}",
        ".tc-titlebar button:active{transform:none;}",
        ".tc-titlebar button:focus-visible{outline:2px solid #c9a13b;outline-offset:2px;}",
        ".tc-body{flex:1;display:flex;min-height:0;gap:10px;padding:10px;box-sizing:border-box;}",
        ".tc-presets{flex:0 0 208px;background:rgba(20,22,27,.86);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow-y:auto;padding:10px;animation:tcRise .36s ease;box-shadow:0 12px 32px rgba(0,0,0,.45);}",
        ".tc-presets.hidden{display:none;}",
        ".tc-preset{padding:8px 12px;cursor:pointer;border-radius:9px;color:#c9cdd4;font-size:11px;font-weight:500;letter-spacing:.3px;border:1px solid transparent;transition:background .15s ease,color .15s ease,transform .15s ease,border-color .15s ease;}",
        ".tc-preset:hover{background:rgba(201,161,59,.13);border-color:rgba(201,161,59,.35);color:#fff;transform:translateX(2px);}",
        ".tc-palettes-title{padding:12px 12px 6px;color:#e0b060;font-size:10px;font-weight:700;letter-spacing:2px;}",
        ".tc-palette{display:flex;align-items:center;gap:10px;padding:6px 10px;cursor:pointer;border-radius:9px;border:1px solid transparent;transition:background .15s ease,border-color .15s ease,transform .15s ease;}",
        ".tc-palette:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.10);transform:translateX(2px);}",
        ".tc-swatches{flex:0 0 64px;height:16px;border-radius:5px;border:1px solid rgba(0,0,0,.6);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);}",
        ".tc-palette span{color:#c9cdd4;font-size:11px;font-weight:500;}",
        ".tc-palette:hover span{color:#fff;}",
        ".tc-main{flex:1;display:flex;flex-direction:column;min-width:0;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.5);animation:tcRise .4s ease;}",
        ".tc-screen{flex:1;position:relative;min-height:0;background:#000;overflow:hidden;}",
        ".tc-screen .editorpanel{position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;border:0!important;background:#000!important;}",
        ".tc-placeholder{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#9aa0a8;font-size:12px;letter-spacing:1px;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.16);padding:14px 22px;border-radius:12px;white-space:nowrap;}",
        ".tc-transport{flex:0 0 46px;display:flex;align-items:center;gap:8px;padding:0 12px;background:rgba(16,18,22,.9);border-top:1px solid rgba(255,255,255,.07);}",
        ".tc-transport button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e8e9eb;font-size:11px;padding:6px 12px;cursor:pointer;border-radius:999px;transition:background .15s ease,border-color .15s ease,color .15s ease;}",
        ".tc-transport button:hover{background:rgba(201,161,59,.2);border-color:rgba(201,161,59,.6);color:#fff;}",
        ".tc-transport button:focus-visible{outline:2px solid #c9a13b;outline-offset:2px;}",
        ".tc-time{margin-left:auto;color:#e8c56a;font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:1px;}",
        ".tc-strip{flex:0 0 104px;display:flex;gap:8px;padding:10px 12px;background:rgba(13,15,18,.9);border-top:1px solid rgba(255,255,255,.07);overflow-x:auto;}",
        ".tc-block{flex:0 0 82px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.10);border-radius:11px;cursor:pointer;color:#cfd3d9;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:6px;text-align:center;height:100%;box-sizing:border-box;transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease;}",
        ".tc-block:hover{border-color:rgba(201,161,59,.5);transform:translateY(-2px);}",
        ".tc-block .tc-thumb{flex:1;width:100%;border-radius:7px;margin-bottom:6px;background:linear-gradient(135deg,#3a3220,#14161c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);}",
        ".tc-block.active{border-color:#c9a13b;color:#fff;box-shadow:0 0 0 1px #c9a13b,0 6px 18px rgba(201,161,59,.35);}",
        ".tc-block.off{opacity:.45;}",
        ".tc-systems{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(13,15,18,.9);border-top:1px solid rgba(255,255,255,.07);overflow-x:auto;}",
        ".tc-system{padding:6px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.11);border-radius:999px;cursor:pointer;color:#c9cdd4;font-weight:500;white-space:nowrap;transition:background .15s ease,border-color .15s ease,color .15s ease;}",
        ".tc-system:hover{color:#fff;border-color:rgba(201,161,59,.5);}",
        ".tc-system.active{background:#c9a13b;color:#191919;border-color:#c9a13b;font-weight:700;box-shadow:0 4px 14px rgba(201,161,59,.4);}",
        ".tc-system.remove{padding:6px 12px;color:#e89a9a;}",
        ".tc-system.remove:hover{background:rgba(217,138,138,.14);border-color:rgba(217,138,138,.5);color:#fff;}",
        ".tc-system.add{color:#9ae6a0;border-style:dashed;}",
        ".tc-system.add:hover{background:rgba(138,217,138,.12);border-color:rgba(138,217,138,.5);color:#fff;}",
        ".tc-params{flex:0 0 380px;background:rgba(20,22,27,.86);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow-y:auto;animation:tcRise .44s ease;box-shadow:0 12px 32px rgba(0,0,0,.45);}",
        ".tc-params.hidden{display:none;}",
        ".tc-params.hint{padding:10px;color:#9aa0a8;}",
        ".tc-presets::-webkit-scrollbar,.tc-params::-webkit-scrollbar,.tc-strip::-webkit-scrollbar,.tc-systems::-webkit-scrollbar{width:10px;height:10px;}",
        ".tc-presets::-webkit-scrollbar-track,.tc-params::-webkit-scrollbar-track,.tc-strip::-webkit-scrollbar-track,.tc-systems::-webkit-scrollbar-track{background:transparent;}",
        ".tc-presets::-webkit-scrollbar-thumb,.tc-params::-webkit-scrollbar-thumb,.tc-strip::-webkit-scrollbar-thumb,.tc-systems::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px;border:2px solid transparent;background-clip:content-box;}",
        ".tc-presets::-webkit-scrollbar-thumb:hover,.tc-params::-webkit-scrollbar-thumb:hover,.tc-strip::-webkit-scrollbar-thumb:hover,.tc-systems::-webkit-scrollbar-thumb:hover{background:rgba(201,161,59,.5);border:2px solid transparent;background-clip:content-box;}",
        "@media (prefers-reduced-motion:reduce){.tc-designer *{animation:none!important;transition:none!important;}}",
    ].join("\n");

    function injectStyle() {
        if (document.getElementById("tc-designer-style")) return;
        var style = document.createElement("style");
        style.id = "tc-designer-style";
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    var CONFIGS = {};

    function configFor(root) {
        if (!root) return null;
        return root.constructor && root.constructor.designer ? root.constructor.designer : null;
    }

    var designer = {
        current: null,
        configs: CONFIGS,
    };

    designer.openFirst = function (kind) {
        if (typeof CM === "undefined" || !CM.project) return;
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
        if (!config) return;
        if (designer.current && designer.current.root === root) {
            designer.current.refresh();
            return;
        }
        if (designer.current) designer.current.close();
        if (config.customOpen) {
            config.customOpen(root, designer);
            return;
        }
        injectStyle();

        var make = function (tag, cls, text) {
            var el = document.createElement(tag);
            if (cls) el.className = cls;
            if (text !== undefined) el.textContent = text;
            return el;
        };
        var frame = function () {
            return CM.playback ? CM.playback.currentFrame : 0;
        };

        var state = {
            root: root,
            config: config,
            target: null,
            block: null,
            viewport: CM.mainViewport || null,
            viewportParent: null,
            viewportStyle: null,
            wasEdit: null,
            interval: null,
            edit: null,
        };

        var targets = config.targets(root);
        state.target = targets && targets.length ? targets[0] : root;

        var rootEl = make("div", "tc-designer");
        var titlebar = make("div", "tc-titlebar");
        var presetsToggle = make("button", "", "PRESETS");
        presetsToggle.style.color = "#e0b060";
        var title = make("div", "tc-title", "Trapcode Designer");
        var blocksToggle = make("button", "", "BLOCKS");
        var closeButton = make("button", "", "\u2715");
        titlebar.appendChild(presetsToggle);
        titlebar.appendChild(title);
        titlebar.appendChild(blocksToggle);
        titlebar.appendChild(closeButton);

        var body = make("div", "tc-body");
        var presets = make("div", "tc-presets");
        var main = make("div", "tc-main");
        var screen = make("div", "tc-screen");
        var placeholder = make("div", "tc-placeholder", "no preview");
        screen.appendChild(placeholder);
        var transport = make("div", "tc-transport");
        var blocksStrip = make("div", "tc-strip");
        var systemsStrip = make("div", "tc-systems");
        var params = make("div", "tc-params");

        var playButton = make("button", "", "\u25B6");
        var pauseButton = make("button", "", "\u23F8");
        var prevButton = make("button", "", "\u23EA");
        var nextButton = make("button", "", "\u23E9");
        var timeLabel = make("span", "tc-time", "0000");
        transport.appendChild(prevButton);
        transport.appendChild(playButton);
        transport.appendChild(pauseButton);
        transport.appendChild(nextButton);
        transport.appendChild(timeLabel);

        var blocksFor = config.blocks || function () {
            return [];
        };
        var groupFor = config.groupFor || function (target, key) {
            return target.properties ? target.properties[key] : null;
        };

        var currentGroup = function () {
            if (!state.target) return null;
            return groupFor(state.target, state.block);
        };

        var edit = new PZ.ui.edit(CM, {
            childFilter: function () {
                return true;
            },
            skipSingleChildren: false,
            showListItemButtons: false,
            emptyMessage: "no parameters",
            objectFilter: function () {
                return !!currentGroup();
            },
            objectMap: function () {
                return currentGroup();
            },
        });
        edit.title = "Parameters";
        edit.icon = "settings";
        state.edit = edit;
        params.appendChild(edit.el);
        edit.objects = new PZ.objectList();
        edit.objects.push(root);
        edit.enabled = true;

        var buildBlocks = function () {
            blocksStrip.innerHTML = "";
            var blocks = blocksFor(state.target) || [];
            if (!state.block && blocks.length) state.block = blocks[0].key;
            blocks.forEach(function (block) {
                var el = make("div", "tc-block");
                el.appendChild(make("div", "tc-thumb"));
                el.appendChild(make("span", "", block.name));
                el.classList.toggle("active", block.key === state.block);
                el.onclick = function () {
                    state.block = block.key;
                    buildBlocks();
                    refreshParams();
                };
                blocksStrip.appendChild(el);
            });
        };

        var refreshParams = function () {
            if (edit.objects && edit.objects.length) edit.objectsChanged();
        };

        var buildSystems = function () {
            systemsStrip.innerHTML = "";
            var list = config.targets(root);
            if (list && list.length) {
                list.forEach(function (item, index) {
                    var el = make("div", "tc-system");
                    el.textContent = config.targetName ? config.targetName(item, index) : "System " + (index + 1);
                    el.classList.toggle("active", item === state.target);
                    el.onclick = function () {
                        state.target = item;
                        state.block = null;
                        buildBlocks();
                        buildSystems();
                        buildPalettes();
                        refreshParams();
                    };
                    systemsStrip.appendChild(el);
                });
            }
            var kinds = config.addKinds || [];
            kinds.forEach(function (kind) {
                var addEl = make("div", "tc-system add", "+ " + kind.name);
                addEl.onclick = function () {
                    var created = kind.create(root);
                    if (created) {
                        state.target = created;
                        state.block = null;
                        buildBlocks();
                        buildSystems();
                        refreshParams();
                    }
                };
                systemsStrip.appendChild(addEl);
            });
        };

        var buildPresets = function () {
            presets.innerHTML = "";
            var list = (config.presets || []).slice();
            list.forEach(function (preset) {
                var el = make("div", "tc-preset", preset.name);
                el.onclick = function () {
                    if (config.applyPreset) config.applyPreset(root, state.target, preset);
                    buildBlocks();
                    buildSystems();
                    refreshParams();
                };
                presets.appendChild(el);
            });
            buildPalettes();
        };

        var buildPalettes = function () {
            var schemes = (T && T.palettes) || [];
            var supported = !!(state.target && T && typeof T.supportsPalette === "function" &&
                T.supportsPalette(state.target)) && schemes.length > 0;
            var old = null;
            try {
                old = presets.querySelector ? presets.querySelector(".tc-palettes") : null;
            } catch (e) {}
            if (old) {
                if (supported && old.__tcBuiltFor === state.target) return;
                if (old.parentElement) old.parentElement.removeChild(old);
            }
            if (!supported) return;
            var wrap = make("div", "tc-palettes");
            wrap.__tcBuiltFor = state.target;
            wrap.appendChild(make("div", "tc-palettes-title", "PALETTE"));
            schemes.forEach(function (scheme) {
                var row = make("div", "tc-palette");
                var bar = make("div", "tc-swatches");
                try {
                    bar.style.background = T.paletteCSS(scheme);
                } catch (e) {}
                row.appendChild(bar);
                row.appendChild(make("span", "", scheme.name));
                row.onclick = function () {
                    try {
                        if (typeof T.applyPalette === "function") {
                            T.applyPalette(state.target, scheme);
                        }
                    } catch (e) {}
                    refreshParams();
                };
                wrap.appendChild(row);
            });
            presets.appendChild(wrap);
        };

        var refresh = function () {
            timeLabel.textContent = String(Math.max(0, Math.round(frame()))).padStart(4, "0");
            buildPalettes();
        };

        playButton.onclick = function () {
            if (CM.playback) CM.playback.speed = 1;
        };
        pauseButton.onclick = function () {
            if (CM.playback) CM.playback.speed = 0;
        };
        prevButton.onclick = function () {
            if (CM.playback) {
                CM.playback.speed = 0;
                CM.playback.currentFrame = Math.max(0, frame() - 1);
            }
        };
        nextButton.onclick = function () {
            if (CM.playback) {
                CM.playback.speed = 0;
                CM.playback.currentFrame = frame() + 1;
            }
        };
        presetsToggle.onclick = function () {
            presets.classList.toggle("hidden");
        };
        blocksToggle.onclick = function () {
            params.classList.toggle("hidden");
        };

        main.appendChild(screen);
        main.appendChild(transport);
        main.appendChild(blocksStrip);
        main.appendChild(systemsStrip);
        body.appendChild(presets);
        body.appendChild(main);
        body.appendChild(params);
        rootEl.appendChild(titlebar);
        rootEl.appendChild(body);
        document.body.appendChild(rootEl);

        title.textContent = config.title || "Trapcode Designer";

        if (state.viewport && state.viewport.el) {
            state.viewportParent = state.viewport.el.parentElement;
            state.viewportStyle = state.viewport.el.getAttribute("style");
            state.wasEdit = state.viewport.edit;
            state.viewport.edit = false;
            screen.appendChild(state.viewport.el);
            placeholder.remove();
            requestAnimationFrame(function () {
                if (state.viewport) state.viewport.resize();
            });
        }

        var close = function () {
            if (state.interval) {
                clearInterval(state.interval);
                state.interval = null;
            }
            if (edit) edit.enabled = false;
            if (state.viewport && state.viewportParent) {
                state.viewport.el.setAttribute("style", state.viewportStyle || "");
                state.viewportParent.appendChild(state.viewport.el);
                state.viewport.edit = state.wasEdit;
                state.viewport.resize();
            }
            window.removeEventListener("resize", onResize);
            document.removeEventListener("keydown", onKeydown);
            rootEl.remove();
            designer.current = null;
        };
        var onResize = function () {
            if (state.viewport) state.viewport.resize();
        };
        var onKeydown = function (event) {
            if (event.key === "Escape") close();
        };
        closeButton.onclick = close;
        window.addEventListener("resize", onResize);
        document.addEventListener("keydown", onKeydown);

        buildPresets();
        buildBlocks();
        buildSystems();
        edit.objectsChanged();
        refresh();
        state.interval = setInterval(refresh, 200);

        designer.current = {
            root: root,
            close: close,
            refresh: function () {
                buildBlocks();
                buildSystems();
                refreshParams();
                refresh();
            },
        };
    };

    designer.registerConfig = function (cls, config) {
        cls.designer = config;
    };

    T.designer = designer;
})();
