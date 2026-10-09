"use strict";

// OpenZoid Optical Flares - options window.
//
// One floating window (context.ui.openWindow, see docs/plugin-ui.md) with
// sections for Presets, Elements, the selected element, Source, Global and
// Advanced settings. The editor viewport behind it is the live preview.
//
// Every edit is written through the flare's own properties with CM3's property
// operations, and element add/remove/move uses CM3's object list commands, so
// undo and redo come from the host history. Dragging previews through
// property.set() only; the undo record is written once, on commit.

(function () {
    var SOURCE_FIELDS = [
        { path: "positioning.sourceType", label: "Source", kind: "select" },
        { path: "positioning.lightIndex", label: "Light index", kind: "number" },
        { path: "flareSetup.centerPosition", label: "Center", kind: "xy" },
        { path: "positioning.foreground.occlude", label: "Occlude", kind: "check" },
        { path: "positioning.margin", label: "Edge margin", kind: "number" },
        { path: "positioning.distanceFalloff", label: "Distance falloff", kind: "number" },
        { path: "positioning.referenceDistance", label: "Reference distance", kind: "number" },
    ];

    var GLOBAL_FIELDS = [
        { path: "flareSetup.brightness", label: "Brightness", kind: "number" },
        { path: "flareSetup.scale", label: "Scale", kind: "number" },
        { path: "flareSetup.color", label: "Color", kind: "color" },
        { path: "flareSetup.colorMode", label: "Color mode", kind: "select" },
        { path: "flareSetup.rotationOffset", label: "Rotation offset", kind: "number" },
        { path: "flareSetup.animationEvolution", label: "Evolution", kind: "number" },
        { path: "positioning.flicker.amount", label: "Flicker", kind: "number" },
        { path: "positioning.flicker.speed", label: "Flicker speed", kind: "number" },
        { path: "flareSetup.gpu", label: "High quality", kind: "check" },
    ];

    var ADVANCED_FIELDS = [
        { path: "global.scale", label: "Element scale", kind: "number" },
        { path: "global.aspectRatio", label: "Aspect ratio", kind: "number" },
        { path: "global.blendMode", label: "Blend mode", kind: "select" },
        { path: "global.color", label: "Color", kind: "color" },
        { path: "global.globalSeed", label: "Seed", kind: "number" },
        { path: "global.scaleOffset", label: "Scale with distance", kind: "check" },
        { path: "motionBlur.renderMode", label: "Render mode", kind: "select" },
    ];

    var ELEMENT_FIELDS = [
        { path: "element.enabled", label: "Enabled", kind: "check" },
        { path: "globalParams.color", label: "Color", kind: "color" },
        { path: "globalParams.scale", label: "Size", kind: "number" },
        { path: "element.opacity", label: "Brightness", kind: "number" },
        { path: "element.distance", label: "Position", kind: "number" },
        { path: "element.rotation", label: "Rotation", kind: "number" },
        { path: "globalParams.aspectRatio", label: "Aspect ratio", kind: "number" },
        { path: "globalParams.blendMode", label: "Blend mode", kind: "select" },
        { path: "globalParams.scaleOffset", label: "Scale with distance", kind: "check" },
        { path: "element.animate", label: "Animate", kind: "check" },
        { path: "globalParams.globalSeed", label: "Seed", kind: "number" },
    ];

    var SHAPE_FIELDS = [
        { path: "lensTexture.textureImage", label: "Texture", kind: "select" },
        { path: "lensTexture.illuminationRadius", label: "Illumination", kind: "number" },
        { path: "lensTexture.falloff", label: "Falloff", kind: "number" },
        { path: "matteBox.shape", label: "Matte shape", kind: "select" },
        { path: "matteBox.startRange", label: "Matte start", kind: "number" },
        { path: "matteBox.fadeAmount", label: "Matte fade", kind: "number" },
    ];

    var windowSerial = 0;
    var windowIds = new WeakMap();

    function resolve(base, path) {
        var node = base;
        var parts = path.split(".");
        for (var i = 0; i < parts.length && node; i++) node = node[parts[i]];
        return node || null;
    }

    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function toHex(rgb) {
        return "#" + [0, 1, 2].map(function (i) {
            var v = Math.round(Math.max(0, Math.min(1, Number(rgb && rgb[i]) || 0)) * 255);
            return (v < 16 ? "0" : "") + v.toString(16);
        }).join("");
    }

    function fromHex(hex) {
        var n = parseInt(String(hex).slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    function optionItems(definition) {
        return String(definition && definition.items || "").split(";").map(function (label, index) {
            return { value: String(index), label: label };
        });
    }

    // Group of observer subscriptions that can be dropped together. Callbacks
    // never re-subscribe from inside the observable they are attached to.
    function Scope() {
        this.disposers = [];
    }
    Scope.prototype.watch = function (observable, fn) {
        if (!observable || typeof observable.watch !== "function") return;
        observable.watch(fn);
        this.disposers.push(function () { observable.unwatch(fn); });
    };
    Scope.prototype.dispose = function () {
        var list = this.disposers.splice(0, this.disposers.length);
        for (var i = 0; i < list.length; i++) list[i]();
    };

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
        var presetKey = PZ.opticalflares.PRESETS[0].key;
        var addType = 0;
        var suspended = 0;

        var stackScope = new Scope();
        var elementScope = new Scope();
        var selectedScope = new Scope();
        var staticScope = new Scope();
        var view = {};

        function frameOf(prop) {
            var frame = editor.playback ? Math.round(editor.playback.currentFrame) : 0;
            return Math.max(0, frame - (prop.frameOffset || 0));
        }

        function read(prop) {
            return prop.get(frameOf(prop));
        }

        // Live preview while dragging: no undo record yet.
        function live(prop, value) {
            if (!pending.has(prop)) pending.set(prop, copy(read(prop)));
            prop.set(value, frameOf(prop));
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
            var old = pending.has(prop) ? pending.get(prop) : copy(read(prop));
            pending.delete(prop);
            if (JSON.stringify(old) === JSON.stringify(value)) return;
            group(function () { record(prop, value, old); });
        }

        function watchProp(scope, prop, fn) {
            scope.watch(prop.onChanged, fn);
            if (prop.objects) {
                for (var i = 0; i < prop.objects.length; i++) scope.watch(prop.objects[i].onChanged, fn);
            }
        }

        // Builds the DOM for one field and keeps it in step with its property.
        function field(scope, base, spec) {
            var prop = resolve(base, spec.path);
            if (!prop) return [];
            var definition = prop.definition || {};
            var sync;
            var element;
            if (spec.kind === "xy") {
                return [0, 1].map(function (axis) {
                    var withAxis = function (v) {
                        var next = copy(read(prop));
                        next[axis] = v;
                        return next;
                    };
                    var num = ctl.number({
                        label: spec.label + (axis ? " Y" : " X"),
                        value: read(prop)[axis],
                        step: 1,
                        onInput: function (v) { live(prop, withAxis(v)); },
                        onChange: function (v) { commit(prop, withAxis(v)); },
                    });
                    scope.watch(prop.onChanged, function () { num.set(read(prop)[axis]); });
                    return num.element;
                });
            }
            if (spec.kind === "check") {
                var check = ctl.checkbox({
                    label: spec.label,
                    value: read(prop) === 1,
                    onChange: function (v) { commit(prop, v ? 1 : 0); },
                });
                sync = function () { check.set(read(prop) === 1); };
                element = check.element;
            } else if (spec.kind === "select") {
                var select = ctl.select({
                    label: spec.label,
                    value: String(read(prop)),
                    options: optionItems(definition),
                    onChange: function (v) { commit(prop, Number(v)); },
                });
                sync = function () { select.set(String(read(prop))); };
                element = select.element;
            } else if (spec.kind === "color") {
                var swatch = ctl.color({
                    label: spec.label,
                    value: toHex(read(prop)),
                    onInput: function (hex) { live(prop, fromHex(hex)); },
                    onChange: function (hex) { commit(prop, fromHex(hex)); },
                });
                sync = function () { swatch.set(toHex(read(prop))); };
                element = swatch.element;
            } else {
                var input = ctl.number({
                    label: spec.label,
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
            mutate(function () {
                insertAt(root.stack.length, copy(Element.create(addType)));
                selected = root.stack.length - 1;
            });
        }

        function duplicateElement() {
            var element = selectedElement();
            if (!element) return;
            mutate(function () {
                insertAt(selected + 1, copy(element));
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

        function applyPreset(key) {
            mutate(function () {
                for (var i = root.stack.length - 1; i >= 0; i--) removeAt(i);
                PZ.opticalflares.presetData(key).forEach(function (data, index) {
                    insertAt(index, data);
                });
                selected = 0;
            });
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

        function elementItems() {
            return Array.from(root.stack).map(function (element, index) {
                var enabled = read(element.properties.element.enabled) === 1;
                var typeName = types[element.type].name;
                var name = element.properties.name.get() || typeName;
                var detail = name === typeName ? "" : typeName;
                if (!enabled) detail = detail ? detail + " (off)" : "Off";
                return { id: String(index), title: name, detail: detail };
            });
        }

        // Refreshes list text and selection only. Safe to call from property
        // observers because it changes no subscriptions.
        function renderItems() {
            if (!view.list) return;
            if (selected >= root.stack.length) selected = root.stack.length - 1;
            view.list.setItems(elementItems());
            view.list.set(String(selected));
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
                value: String(element.type),
                options: typeOptions(),
                onChange: function (v) { changeType(element, Number(v)); },
            });
            selectedScope.watch(element.properties.element.elementType.onChanged, function () {
                typeSelect.set(String(element.type));
            });
            view.selectedBody.appendChild(typeSelect.element);
            appendFields(selectedScope, view.selectedBody, element.properties, ELEMENT_FIELDS);
            var shape = ctl.section({ title: "Shape", collapsed: true });
            appendFields(selectedScope, shape.body, element.properties, SHAPE_FIELDS);
            view.selectedBody.appendChild(shape.element);
        }

        // Full refresh after the element stack itself changed.
        function renderStack() {
            if (suspended > 0 || !view.list) return;
            elementScope.dispose();
            Array.from(root.stack).forEach(function (element) {
                var p = element.properties;
                elementScope.watch(p.name.onChanged, renderItems);
                elementScope.watch(p.element.elementType.onChanged, renderItems);
                elementScope.watch(p.element.enabled.onChanged, renderItems);
            });
            renderItems();
            renderSelected();
        }

        function presetSection(section) {
            var items = PZ.opticalflares.PRESETS.map(function (preset) {
                return { id: preset.key, title: preset.name };
            });
            section.body.appendChild(ctl.list({
                items: items,
                value: presetKey,
                onSelect: function (id) { presetKey = id; },
                onActivate: function (id) { presetKey = id; applyPreset(id); },
            }).element);
            section.body.appendChild(ctl.buttonRow([{
                title: "Apply preset",
                variant: "primary",
                hint: "Replaces every element. Undo restores the previous stack.",
                onClick: function () { applyPreset(presetKey); },
            }]).element);
        }

        function elementsSection(section) {
            var addSelect = ctl.select({
                label: "Add type",
                value: String(addType),
                options: typeOptions(),
                onChange: function (v) { addType = Number(v); },
            });
            view.list = ctl.list({
                items: elementItems(),
                value: String(selected),
                emptyText: "No elements. Add one or apply a preset.",
                onSelect: function (id) {
                    selected = Number(id);
                    renderSelected();
                },
            });
            section.body.appendChild(addSelect.element);
            section.body.appendChild(view.list.element);
            section.body.appendChild(ctl.buttonRow([
                { title: "Add", variant: "primary", onClick: addElement },
                { title: "Duplicate", onClick: duplicateElement },
                { title: "Remove", variant: "danger", onClick: removeElement },
                { title: "Up", onClick: function () { moveElement(-1); } },
                { title: "Down", onClick: function () { moveElement(1); } },
            ]).element);
        }

        if (!windowIds.has(root)) windowIds.set(root, ++windowSerial);
        var win = ui.openWindow({
            id: "flares:" + windowIds.get(root),
            title: "Optical Flares",
            subtitle: root.properties.name.get(),
            persistKey: "options",
            width: 360,
            height: 620,
            isValid: function () { return root.isLive(); },
            mount: function (body) {
                var presets = ctl.section({ title: "Presets", collapsed: true });
                presetSection(presets);
                var elements = ctl.section({ title: "Elements" });
                elementsSection(elements);
                view.selectedBody = document.createElement("div");
                var selectedSection = ctl.section({ title: "Selected element" });
                selectedSection.body.appendChild(view.selectedBody);
                var source = ctl.section({ title: "Source" });
                appendFields(staticScope, source.body, root.properties, SOURCE_FIELDS);
                var global = ctl.section({ title: "Global" });
                appendFields(staticScope, global.body, root.properties, GLOBAL_FIELDS);
                var advanced = ctl.section({ title: "Advanced", collapsed: true });
                appendFields(staticScope, advanced.body, root.properties, ADVANCED_FIELDS);
                [presets, elements, selectedSection, source, global, advanced].forEach(function (section) {
                    body.appendChild(section.element);
                });

                stackScope.watch(root.stack.onListChanged, renderStack);
                renderStack();
                return function () {
                    stackScope.dispose();
                    elementScope.dispose();
                    selectedScope.dispose();
                    staticScope.dispose();
                    pending.clear();
                    view = {};
                };
            },
            footer: [{ title: "Done", variant: "primary", onClick: function () { win.close(); } }],
        });
        return win;
    };
})();
