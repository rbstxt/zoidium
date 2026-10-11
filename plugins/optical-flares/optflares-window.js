"use strict";

// OpenZoid Optical Flares - options window.
//
// One floating window (context.ui.openWindow, see docs/plugin-ui.md) with a
// Browser (Flare, Elements and Presets tabs), the element stack, the selected
// element, Source, Global, Advanced and Custom Layers sections. The editor
// viewport behind it is the live preview.
//
// Every edit is written through the flare's own properties with CM3's property
// operations, and element add/remove/move uses CM3's object list commands, so
// undo and redo come from the host history. Dragging previews through
// property.set() only; the undo record is written once, on commit.
//
// The stack rows and browser tiles draw per-type thumbnails with the same
// seeded 2D routines the donor editor used (no wall clock, no Math.random),
// corrected so each type draws its own shape. Scoped widget CSS holds the
// row and tile layout; the host supplies standard window chrome.

// Optical Flares options window installer. Loads its data and thumbnails
// through the bundle require and registers the window opener on the
// PZ.opticalflares namespace.

function loadParts(PZ) {
    if (typeof require === "function") {
        return {
            data: require("./optflares-window-data.js")(),
            thumbs: require("./optflares-thumbs.js")(PZ),
        };
    }
    throw new Error("Optical Flares window needs its bundled sources.");
}

module.exports = function installWindow(PZ) {
    if (!PZ) throw new Error("Optical Flares window needs the CM3 runtime.");
    if (!PZ.opticalflares) throw new Error("Optical Flares needs optflares.js loaded first.");
    var parts = loadParts(PZ);
    var winData = parts.data;
    var thumbs = parts.thumbs;

    PZ.opticalflares.openWindow = function (ui, editor, root) {
        var ctl = ui.controls;
        var types = PZ.opticalflares.ELEMENT_TYPES;
        var Element = PZ.object3d.optflares.element;
        var history = editor.history;
        var ops = new PZ.ui.properties(editor);
        var edit = PZ.ui.edit.prototype;
        var editContext = { editor: editor };

        var pending = new Map();
        var selected = 0;
        var addType = 0;
        var suspended = 0;
        var checker = winData.loadPreviewBg() === "checker";
        var favs = winData.loadFavs();
        var browserTab = "flare";
        var lensMode = "basic";
        var presetCategory = "Cinematic";
        var presetFavOnly = false;

        var stackScope = new winData.Scope();
        var elementScope = new winData.Scope();
        var selectedScope = new winData.Scope();
        var staticScope = new winData.Scope();
        var view = {};
        var customView = null;

        function frameOf(prop) {
            var frame = editor.playback ? Math.round(editor.playback.currentFrame) : 0;
            return Math.max(0, frame - (prop.frameOffset || 0));
        }

        function read(prop) {
            return prop.get(frameOf(prop));
        }

        // Live preview while dragging: no undo record yet.
        function live(prop, value) {
            if (!pending.has(prop)) pending.set(prop, winData.copy(read(prop)));
            prop.set(value, frameOf(prop));
        }

        var refreshQueued = false;
        function queueRefresh() {
            if (refreshQueued || !view.stackList) return;
            refreshQueued = true;
            if (typeof setTimeout !== "function") {
                refreshQueued = false;
                renderStack();
                return;
            }
            setTimeout(function () {
                refreshQueued = false;
                renderStack();
            }, 0);
        }

        function defaultOf(prop) {
            try {
                var value = prop.getDefaultValue();
                return value === undefined ? 0 : winData.copy(value);
            } catch (ignored) {
                return 0;
            }
        }

        // Reads a property without throwing on the transient empty-keyframes
        // state CM3 passes through while loading an element: reset() empties
        // the keyframes before list.load() refills them, and name.set()
        // notifies in between. Throwing here would break out into the
        // operation in flight (notably undo) and leave it half applied, so
        // fall back to the definition default and queue one settled refresh.
        function safeRead(prop) {
            try {
                if (prop && prop.keyframes && prop.keyframes.length === 0) {
                    queueRefresh();
                    return defaultOf(prop);
                }
                return read(prop);
            } catch (error) {
                queueRefresh();
                return defaultOf(prop);
            }
        }

        function safeType(element) {
            try {
                return element.type;
            } catch (error) {
                queueRefresh();
                return 0;
            }
        }

        function group(fn) {
            history.startOperation();
            try {
                fn();
            } finally {
                history.finishOperation();
            }
        }

        function record(prop, value, oldValue) {
            ops.setValue({ property: prop.getAddress(), frame: frameOf(prop), value: value, oldValue: oldValue });
        }

        // One undo record per user edit.
        function commit(prop, value) {
            var old = pending.has(prop) ? pending.get(prop) : winData.copy(read(prop));
            pending.delete(prop);
            if (JSON.stringify(old) === JSON.stringify(value)) return;
            group(function () { record(prop, value, old); });
        }

        function toggleProp(prop) {
            var next = read(prop) === 1 ? 0 : 1;
            commit(prop, next);
        }

        // CM3 notifies value edits on different observables per property
        // kind: static props (text, asset) use onChanged, dynamic keyframes
        // use onKeyframeChanged. Watch every notifier a property offers so
        // the window follows commits, undo and redo instead of going stale.
        function watchValue(scope, prop, fn) {
            if (!prop) return;
            scope.watch(prop.onChanged, fn);
            scope.watch(prop.onKeyframeChanged, fn);
            scope.watch(prop.onAnimatedChanged, fn);
        }

        function watchProp(scope, prop, fn) {
            watchValue(scope, prop, fn);
            if (prop.objects) {
                for (var i = 0; i < prop.objects.length; i++) watchProp(scope, prop.objects[i], fn);
            }
        }

        function makeElement(tag, cls, text) {
            var node = document.createElement(tag);
            if (cls) node.className = cls;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        function makeButton(text, cls, title, onClick) {
            var node = ctl.button({ title: text, hint: title }).element;
            (cls || "of-mini").split(/\s+/).forEach(function (name) { node.classList.add(name); });
            node.type = "button";
            if (title) node.title = title;
            node.onclick = function (event) {
                winData.stop(event);
                onClick();
            };
            return node;
        }

        // Builds the DOM for one field and keeps it in step with its property.
        function field(scope, base, spec) {
            var prop = winData.resolve(base, spec.path);
            if (!prop) return [];
            var definition = prop.definition || {};
            var sync;
            var element;
            if (spec.kind === "xy") {
                return [0, 1].map(function (axis) {
                    var withAxis = function (v) {
                        var next = winData.copy(read(prop));
                        next[axis] = v;
                        return next;
                    };
                    var num = ctl.number({
                        label: spec.label + (axis ? " Y" : " X"),
                        hint: spec.hint,
                        value: read(prop)[axis],
                        step: 1,
                        onInput: function (v) { live(prop, withAxis(v)); },
                        onChange: function (v) { commit(prop, withAxis(v)); },
                    });
                    watchValue(scope, prop, function () { num.set(read(prop)[axis]); });
                    return num.element;
                });
            }
            if (spec.kind === "check") {
                var check = ctl.checkbox({
                    label: spec.label,
                    hint: spec.hint,
                    value: read(prop) === 1,
                    onChange: function (v) { commit(prop, v ? 1 : 0); },
                });
                sync = function () { check.set(read(prop) === 1); };
                element = check.element;
            } else if (spec.kind === "select") {
                var select = ctl.select({
                    label: spec.label,
                    hint: spec.hint,
                    value: String(read(prop)),
                    options: winData.optionItems(definition),
                    onChange: function (v) { commit(prop, Number(v)); },
                });
                sync = function () { select.set(String(read(prop))); };
                element = select.element;
            } else if (spec.kind === "color") {
                var swatch = ctl.color({
                    label: spec.label,
                    hint: spec.hint,
                    value: winData.toHex(read(prop)),
                    onInput: function (hex) { live(prop, winData.fromHex(hex)); },
                    onChange: function (hex) { commit(prop, winData.fromHex(hex)); },
                });
                sync = function () { swatch.set(winData.toHex(read(prop))); };
                element = swatch.element;
            } else {
                var input = ctl.number({
                    label: spec.label,
                    hint: spec.hint,
                    value: read(prop),
                    min: definition.min,
                    max: definition.max,
                    step: definition.step || 0.01,
                    onInput: function (v) { live(prop, v); },
                    onChange: function (v) { commit(prop, v); },
                });
                sync = function () { input.set(read(prop)); };
                element = input.element;
            }
            watchProp(scope, prop, sync);
            return [element];
        }

        function appendFields(scope, target, base, specs) {
            specs.forEach(function (spec) {
                field(scope, base, spec).forEach(function (node) {
                    target.appendChild(node);
                });
            });
        }

        /* ---------------- stack operations ---------------- */

        function insertAt(index, data) {
            edit.createObject.call(editContext, {
                newParentAddress: root.stack.getAddress(),
                newIdx: index,
                baseType: root.stack.type,
                subType: data.type,
                data: data,
            });
        }

        function removeAt(index) {
            edit.deleteObject.call(editContext, {
                oldParentAddress: root.stack.getAddress(),
                oldIdx: index,
            });
        }

        function moveTo(from, to) {
            var address = root.stack.getAddress();
            edit.moveObject.call(editContext, {
                oldParentAddress: address,
                oldIdx: from,
                newParentAddress: address,
                newIdx: to,
            });
        }

        // Runs one or more stack edits as a single undo step, then refreshes
        // the window once.
        function mutate(fn) {
            suspended += 1;
            try {
                group(fn);
            } finally {
                suspended -= 1;
            }
            renderStack();
        }

        function selectedElement() {
            return selected >= 0 && selected < root.stack.length ? root.stack[selected] : null;
        }

        function addElement() {
            addElementOfType(addType);
        }

        function addElementOfType(type) {
            mutate(function () {
                insertAt(root.stack.length, winData.copy(Element.create(type)));
                selected = root.stack.length - 1;
            });
        }

        function addCustomElement(slot) {
            mutate(function () {
                var data = winData.copy(Element.create(0));
                if (data.properties && data.properties.lensTexture) {
                    data.properties.lensTexture.textureImage = slot + 7;
                }
                insertAt(root.stack.length, data);
                selected = root.stack.length - 1;
            });
        }

        function duplicateElement() {
            var element = selectedElement();
            if (!element) return;
            mutate(function () {
                insertAt(selected + 1, winData.copy(element));
                selected += 1;
            });
        }

        function removeElement() {
            if (!selectedElement()) return;
            mutate(function () {
                removeAt(selected);
                selected = Math.max(0, Math.min(selected, root.stack.length - 1));
            });
        }

        function moveElement(delta) {
            var target = selected + delta;
            if (!selectedElement() || target < 0 || target >= root.stack.length) return;
            mutate(function () {
                moveTo(selected, target);
                selected = target;
            });
        }

        function applyRecords(records) {
            mutate(function () {
                for (var i = root.stack.length - 1; i >= 0; i--) removeAt(i);
                records.forEach(function (data, index) {
                    insertAt(index, data);
                });
                selected = 0;
            });
        }

        function applyPreset(key) {
            applyRecords(PZ.opticalflares.presetData(key));
        }

        // Restores the default stack and every root property group in one
        // undo step.
        function resetAll() {
            mutate(function () {
                ops.resetAll(root.properties.flareSetup);
                ops.resetAll(root.properties.positioning);
                ops.resetAll(root.properties.motionBlur);
                ops.resetAll(root.properties.global);
                for (var i = root.stack.length - 1; i >= 0; i--) removeAt(i);
                PZ.opticalflares.presetData("default").forEach(function (data, index) {
                    insertAt(index, data);
                });
                selected = 0;
            });
        }

        function resetGroup(list) {
            if (!list) return;
            group(function () { ops.resetAll(list); });
            renderStack();
        }

        function resetSelectedElement() {
            var element = selectedElement();
            if (!element) return;
            group(function () {
                ops.resetAll(element.properties.element);
                ops.resetAll(element.properties.globalParams);
                ops.resetAll(element.properties.matteBox);
                ops.resetAll(element.properties.lensTexture);
            });
            renderStack();
        }

        function changeType(element, index) {
            var old = element.type;
            if (old === index) return;
            var nameProp = element.properties.name;
            var oldName = nameProp.get();
            var typeProp = element.properties.element.elementType;
            group(function () {
                record(typeProp, index, old);
                if (oldName === types[old].name) record(nameProp, types[index].name, oldName);
            });
        }

        /* ---------------- rendering ---------------- */

        function typeOptions() {
            return types.map(function (type, index) {
                return { value: String(index), label: type.name };
            });
        }

        // The window title is the product name; the flare's own name is the
        // subtitle. The default name equals the title, so it is left blank.
        function subtitleFor(name) {
            var text = String(name || "");
            return text === winData.TITLE ? "" : text;
        }

        function checkerClass(canvas) {
            if (!canvas || !canvas.classList) return;
            if (typeof canvas.classList.toggle !== "function") return;
            canvas.classList.toggle("of-checker", checker);
        }

        function paintThumb(canvas, element) {
            checkerClass(canvas);
            var color = safeRead(element.properties.globalParams.color);
            thumbs.drawThumb(canvas, safeType(element), color);
        }

        function selectElement(index) {
            selected = Number(index);
            renderItems();
            renderSelected();
            refreshElementsTab();
        }

        function buildRow(element, index) {
            var props = element.properties;
            var row = makeElement("div", "of-row");
            row.draggable = true;

            var thumb = makeElement("canvas", "of-thumb");
            thumb.width = 72;
            thumb.height = 44;
            thumb.title = "Toggle visibility";
            thumb.onclick = function (event) {
                winData.stop(event);
                toggleProp(props.element.enabled);
            };
            row.appendChild(thumb);

            var body = makeElement("div", "of-row-body");
            var top = makeElement("div", "of-row-top");
            var name = makeElement("span", "of-row-name");
            top.appendChild(name);
            var actions = makeElement("span", "of-row-actions");
            var hideButton = makeButton("Hide", "of-mini", "Toggle visibility", function () {
                toggleProp(props.element.enabled);
            });
            var soloButton = makeButton("Solo", "of-mini", "Preview this element alone", function () {
                toggleProp(props.element.solo);
            });
            var deleteButton = makeButton("X", "of-mini x", "Remove this element", function () {
                selected = index;
                removeElement();
            });
            actions.appendChild(hideButton);
            actions.appendChild(soloButton);
            actions.appendChild(deleteButton);
            top.appendChild(actions);
            body.appendChild(top);

            var fields = makeElement("div", "of-row-fields");
            var scaleProp = props.globalParams.scale;
            var scaleNum = ctl.number({
                label: "Scale",
                value: safeRead(scaleProp),
                min: scaleProp.definition && scaleProp.definition.min,
                max: scaleProp.definition && scaleProp.definition.max,
                step: 0.1,
                dragSpeed: 1,
                onInput: function (v) { live(scaleProp, v); },
                onChange: function (v) { commit(scaleProp, v); },
            });
            var distanceProp = props.element.distance;
            var distanceNum = ctl.number({
                label: "Distance",
                value: safeRead(distanceProp),
                min: distanceProp.definition && distanceProp.definition.min,
                max: distanceProp.definition && distanceProp.definition.max,
                step: 0.1,
                dragSpeed: 1,
                onInput: function (v) { live(distanceProp, v); },
                onChange: function (v) { commit(distanceProp, v); },
            });
            fields.appendChild(scaleNum.element);
            fields.appendChild(distanceNum.element);
            body.appendChild(fields);
            row.appendChild(body);

            row.onclick = function () {
                if (selected !== index) selectElement(index);
            };
            row.ondragstart = function (event) {
                if (event && event.dataTransfer) {
                    event.dataTransfer.setData("text/plain", String(index));
                    event.dataTransfer.effectAllowed = "move";
                }
            };
            row.ondragover = function (event) {
                if (event && typeof event.preventDefault === "function") event.preventDefault();
                if (row.classList) row.classList.add("dragover");
            };
            row.ondragleave = function () {
                if (row.classList) row.classList.remove("dragover");
            };
            row.ondrop = function (event) {
                if (event && typeof event.preventDefault === "function") event.preventDefault();
                if (row.classList) row.classList.remove("dragover");
                var from = event && event.dataTransfer
                    ? parseInt(event.dataTransfer.getData("text/plain"), 10)
                    : NaN;
                if (isNaN(from) || from === index) return;
                mutate(function () {
                    moveTo(from, index);
                    selected = index;
                });
            };

            watchValue(elementScope, props.name, renderItems);
            watchValue(elementScope, props.element.elementType, renderItems);
            watchValue(elementScope, props.element.enabled, renderItems);
            watchValue(elementScope, props.element.solo, renderItems);
            watchValue(elementScope, props.globalParams.color, renderItems);
            watchProp(elementScope, scaleProp, function () { scaleNum.set(safeRead(scaleProp)); });
            watchProp(elementScope, distanceProp, function () { distanceNum.set(safeRead(distanceProp)); });

            return {
                element: element,
                row: row,
                thumb: thumb,
                name: name,
                scaleNum: scaleNum,
                scaleProp: scaleProp,
                distanceNum: distanceNum,
                distanceProp: distanceProp,
                hideButton: hideButton,
                soloButton: soloButton,
            };
        }

        // Refreshes row text, states and thumbnails only. Safe to call from
        // property observers because it changes no subscriptions.
        function renderItems() {
            if (!view.stackList) return;
            if (selected >= root.stack.length) selected = root.stack.length - 1;
            if (!view.rows) return;
            view.rows.forEach(function (entry, index) {
                var element = entry.element;
                var enabled = safeRead(element.properties.element.enabled) === 1;
                var solo = safeRead(element.properties.element.solo) === 1;
                var typeName = types[safeType(element)].name;
                var label = (index + 1) + ". " + typeName + (enabled ? "" : " (off)");
                entry.name.textContent = label;
                var custom = element.properties.name.get();
                entry.name.title = custom && custom !== typeName ? custom : label;
                if (entry.row.classList) {
                    entry.row.classList.toggle("active", index === selected);
                    entry.row.classList.toggle("disabled", !enabled);
                }
                if (entry.hideButton.classList) entry.hideButton.classList.toggle("on", !enabled);
                if (entry.soloButton.classList) entry.soloButton.classList.toggle("on", solo);
                paintThumb(entry.thumb, element);
            });
            if (!root.stack.length && view.emptyNote) view.emptyNote.hidden = false;
            else if (view.emptyNote) view.emptyNote.hidden = true;
        }

        function renderSelected() {
            if (!view.selectedBody) return;
            selectedScope.dispose();
            view.selectedBody.textContent = "";
            var element = selectedElement();
            if (!element) {
                view.selectedBody.appendChild(ctl.note("Select an element to edit it.").element);
                return;
            }
            var typeSelect = ctl.select({
                label: "Type",
                value: String(safeType(element)),
                options: typeOptions(),
                onChange: function (v) { changeType(element, Number(v)); },
            });
            watchValue(selectedScope, element.properties.element.elementType, function () {
                typeSelect.set(String(safeType(element)));
            });
            view.selectedBody.appendChild(typeSelect.element);
            appendFields(selectedScope, view.selectedBody, element.properties, winData.ELEMENT_FIELDS);
            var shape = ctl.section({ title: "Shape", collapsed: true });
            appendFields(selectedScope, shape.body, element.properties, winData.SHAPE_FIELDS);
            view.selectedBody.appendChild(shape.element);
        }

        // Full refresh after the element stack itself changed.
        function renderStack() {
            if (suspended > 0 || !view.stackList) return;
            elementScope.dispose();
            view.stackList.textContent = "";
            view.rows = [];
            Array.from(root.stack).forEach(function (element, index) {
                var entry = buildRow(element, index);
                view.rows.push(entry);
                view.stackList.appendChild(entry.row);
            });
            renderItems();
            renderSelected();
            refreshElementsTab();
        }

        /* ---------------- browser ---------------- */

        function makeTile(name, type, tint, onClick) {
            var tile = makeElement("div", "of-tile");
            tile.title = name;
            var canvas = makeElement("canvas");
            canvas.width = 160;
            canvas.height = 56;
            checkerClass(canvas);
            thumbs.drawThumb(canvas, type, tint);
            tile.appendChild(canvas);
            var row = makeElement("div", "of-tile-row");
            row.appendChild(makeElement("span", "of-tile-name", name));
            tile.appendChild(row);
            tile.onclick = function () { onClick(); };
            return tile;
        }

        function browserGrid() {
            var grid = makeElement("div", "of-grid");
            return grid;
        }

        function renderFlareTab(panel) {
            if (!panel) return;
            panel.textContent = "";
            var grid = browserGrid();
            PZ.opticalflares.PRESETS.forEach(function (preset) {
                var thumbType = preset.key === "sparkle" ? 7 : preset.key === "scifi" ? 9
                    : preset.key === "anamorphic" ? 3 : 0;
                grid.appendChild(makeTile(preset.name, thumbType, [1, 1, 1], function () {
                    applyPreset(preset.key);
                }));
            });
            panel.appendChild(grid);
            panel.appendChild(ctl.buttonRow([{
                title: "Reset All",
                hint: "Restores the default stack and every flare setting. Undo restores the previous state.",
                onClick: resetAll,
            }]).element);
            view.panels.flare = panel;
        }

        function selectedElementType() {
            var element = selectedElement();
            return element ? safeType(element) : -1;
        }

        function renderElementsTab() {
            var panel = view.panels.elements;
            if (!panel) return;
            panel.textContent = "";
            var sub = makeElement("div", "of-sub");
            var basicButton = makeButton("Basic", "of-mini" + (lensMode === "basic" ? " on" : ""), "Show the element types", function () {
                lensMode = "basic";
                renderElementsTab();
            });
            var customButton = makeButton("Custom", "of-mini" + (lensMode === "custom" ? " on" : ""), "Show the custom layers", function () {
                lensMode = "custom";
                renderElementsTab();
            });
            sub.appendChild(basicButton);
            sub.appendChild(customButton);
            panel.appendChild(sub);
            var grid = browserGrid();
            if (lensMode === "basic") {
                var activeType = selectedElementType();
                types.forEach(function (type, index) {
                    var tile = makeTile(type.name, index, type.color, function () {
                        addElementOfType(index);
                    });
                    if (index === activeType && tile.classList) tile.classList.add("active");
                    grid.appendChild(tile);
                });
            } else {
                var layers = root.properties.positioning.customLayers;
                ["layer1", "layer2", "layer3"].forEach(function (key, slot) {
                    var layer = layers && layers[key];
                    var asset = layer ? read(layer) : null;
                    var tile = makeTile(
                        asset ? "Custom Layer " + (slot + 1) : "Custom " + (slot + 1) + " (empty)",
                        0,
                        [1, 1, 1],
                        function () {
                            if (!asset) return;
                            addCustomElement(slot);
                        }
                    );
                    grid.appendChild(tile);
                });
                var hint = makeElement("div", "of-hint",
                    "Assign Custom Layers in the Custom Layers section, then use them as a Lens Texture.");
                panel.appendChild(grid);
                panel.appendChild(hint);
                return;
            }
            panel.appendChild(grid);
        }

        function refreshElementsTab() {
            if (view.panels && view.panels.elements) renderElementsTab();
        }

        function renderPresetsTab(panel) {
            if (!panel) return;
            panel.textContent = "";
            var category = ctl.select({
                label: "Presets",
                value: presetCategory,
                options: ["Cinematic", "Rainbow (8)", "Gold (8)"].map(function (name) {
                    return { value: name.replace(/ \(8\)$/, ""), label: name };
                }),
                onChange: function (v) {
                    presetCategory = v;
                    renderPresetsTab(view.panels.presets);
                },
            });
            panel.appendChild(category.element);
            var favOnly = ctl.checkbox({
                label: "Favorites only",
                value: presetFavOnly,
                onChange: function (v) {
                    presetFavOnly = Boolean(v);
                    renderPresetsTab(view.panels.presets);
                },
            });
            panel.appendChild(favOnly.element);
            var grid = browserGrid();
            var names = thumbs.variantNames(presetCategory);
            var shown = 0;
            names.forEach(function (name, idx) {
                var favKey = presetCategory + ":" + name;
                if (presetFavOnly && !favs[favKey]) return;
                shown += 1;
                var tile = makeTile((favs[favKey] ? "* " : "") + name,
                    thumbs.variantThumbType(presetCategory, idx), thumbs.variantTint(presetCategory, idx), function () {
                        applyRecords(thumbs.variantRecords(presetCategory, idx));
                    });
                var row = tile.children && tile.children[tile.children.length - 1];
                var favButton = makeButton(favs[favKey] ? "Unfav" : "Fav",
                    "of-mini" + (favs[favKey] ? " on" : ""), "Toggle favorite", function () {
                        if (favs[favKey]) delete favs[favKey];
                        else favs[favKey] = true;
                        winData.saveFavs(favs);
                        renderPresetsTab(view.panels.presets);
                    });
                if (row) row.appendChild(favButton);
                else tile.appendChild(favButton);
                grid.appendChild(tile);
            });
            panel.appendChild(grid);
            var count = presetCategory === "Cinematic" ? "8 cinematic presets - Afterglow to Flash In The Darkness"
                : presetCategory === "Rainbow" ? "8 rainbow flares presets"
                : "8 gold flares presets";
            panel.appendChild(makeElement("div", "of-section-label",
                shown === names.length ? count : shown + " of " + names.length + " favorites"));
            view.panels.presets = panel;
        }

        function browserSection(section) {
            var bgRow = makeElement("div", "of-sub");
            var bgSelect = ctl.select({
                label: "Preview bg",
                value: checker ? "checker" : "black",
                options: [
                    { value: "black", label: "Black" },
                    { value: "checker", label: "Checker" },
                ],
                onChange: function (v) {
                    checker = v === "checker";
                    winData.savePreviewBg(checker ? "checker" : "black");
                    renderStack();
                    if (view.panels.flare) renderFlareTab(view.panels.flare);
                    refreshElementsTab();
                    if (view.panels.presets) renderPresetsTab(view.panels.presets);
                },
            });
            bgRow.appendChild(bgSelect.element);
            section.body.appendChild(bgRow);
            view.panels = {};
            section.body.appendChild(ctl.tabs({
                value: browserTab,
                tabs: [
                    {
                        id: "flare",
                        title: "Flare",
                        render: function (panel) { renderFlareTab(panel); },
                    },
                    {
                        id: "elements",
                        title: "Elements",
                        render: function (panel) {
                            view.panels.elements = panel;
                            renderElementsTab();
                        },
                    },
                    {
                        id: "presets",
                        title: "Presets",
                        render: function (panel) { renderPresetsTab(panel); },
                    },
                ],
                onChange: function (id) { browserTab = id; },
            }).element);
        }

        function elementsSection(section) {
            var addSelect = ctl.select({
                label: "Add type",
                value: String(addType),
                options: typeOptions(),
                onChange: function (v) { addType = Number(v); },
            });
            view.stackList = makeElement("div", "of-stack");
            view.emptyNote = makeElement("div", "of-hint", "No elements. Add one or apply a preset.");
            section.body.appendChild(addSelect.element);
            section.body.appendChild(view.stackList);
            section.body.appendChild(view.emptyNote);
            section.body.appendChild(ctl.buttonRow([
                { title: "Add", variant: "primary", onClick: addElement },
                { title: "Duplicate", onClick: duplicateElement },
                { title: "Remove", variant: "danger", onClick: removeElement },
            ]).element);
            section.body.appendChild(ctl.buttonRow([
                { title: "Move Up", onClick: function () { moveElement(-1); } },
                { title: "Move Down", onClick: function () { moveElement(1); } },
            ]).element);
        }

        function resetRow(section, title, hint, onReset) {
            section.body.appendChild(ctl.buttonRow([{
                title: title,
                hint: hint,
                onClick: onReset,
            }]).element);
        }

        if (!winData.windowIds.has(root)) winData.windowIds.set(root, ++winData.windowSerial);
        var win = ui.openWindow({
            id: "flares:" + winData.windowIds.get(root),
            title: winData.TITLE,
            subtitle: subtitleFor(root.properties.name.get()),
            persistKey: "options",
            // Wide enough for the longest 16px element name ("5. Multi Iris").
            width: 380,
            height: 620,
            isValid: function () { return root.isLive(); },
            mount: function (body, handle) {
                body.classList.add("of-window");
                var style = document.createElement("style");
                style.textContent = winData.WIDGET_CSS;
                body.appendChild(style);
                var browser = ctl.section({ title: "Browser", collapsed: true });
                browserSection(browser);
                var elements = ctl.section({ title: "Elements" });
                elementsSection(elements);
                view.selectedBody = document.createElement("div");
                var selectedSection = ctl.section({ title: "Selected element" });
                selectedSection.body.appendChild(view.selectedBody);
                resetRow(selectedSection, "Reset Element", "Resets the selected element to its defaults. Undo restores it.", resetSelectedElement);
                var source = ctl.section({ title: "Source" });
                appendFields(staticScope, source.body, root.properties, winData.SOURCE_FIELDS);
                resetRow(source, "Reset Source", "Resets the source settings. Undo restores them.", function () {
                    resetGroup(root.properties.positioning);
                });
                var global = ctl.section({ title: "Global" });
                appendFields(staticScope, global.body, root.properties, winData.GLOBAL_FIELDS);
                resetRow(global, "Reset Global", "Resets the flare settings. Undo restores them.", function () {
                    resetGroup(root.properties.flareSetup);
                });
                var advanced = ctl.section({ title: "Advanced", collapsed: true });
                appendFields(staticScope, advanced.body, root.properties, winData.ADVANCED_FIELDS);
                resetRow(advanced, "Reset Advanced", "Resets the shared element settings. Undo restores them.", function () {
                    resetGroup(root.properties.global);
                    resetGroup(root.properties.motionBlur);
                });
                var custom = ctl.section({ title: "Custom Layers", collapsed: true });
                if (ui && typeof ui.properties === "function") {
                    customView = ui.properties({
                        editor: editor,
                        target: function () { return root.properties.positioning.customLayers; },
                    });
                    custom.body.appendChild(customView.element);
                } else {
                    custom.body.appendChild(ctl.note("Custom layers are edited in the Objects panel.").element);
                }
                [browser, elements, selectedSection, source, global, advanced, custom].forEach(function (section) {
                    body.appendChild(section.element);
                });

                watchValue(staticScope, root.properties.name, function () {
                    handle.setSubtitle(subtitleFor(root.properties.name.get()));
                });
                var customLayers = root.properties.positioning.customLayers;
                if (customLayers) {
                    ["layer1", "layer2", "layer3"].forEach(function (key) {
                        if (customLayers[key]) watchValue(staticScope, customLayers[key], refreshElementsTab);
                    });
                }
                stackScope.watch(root.stack.onListChanged, renderStack);
                renderStack();
                return function () {
                    stackScope.dispose();
                    elementScope.dispose();
                    selectedScope.dispose();
                    staticScope.dispose();
                    if (customView && typeof customView.dispose === "function") customView.dispose();
                    customView = null;
                    pending.clear();
                    view = {};
                };
            },
            footer: [{ title: "Done", variant: "primary", onClick: function () { win.close(); } }],
        });
        return win;
    };


    PZ.opticalflares.drawThumb = thumbs.drawThumb;
};
