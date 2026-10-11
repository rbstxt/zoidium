// OpenZoid Trapcode Suite — Plexus catalog registration and designer wiring.
/*
 * plexus-config.js
 *
 * Registers the Plexus geometry/effector/renderer catalog, the
 * designer configuration, and the terrain preset helper.
 * Loaded after plexus-object.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

    T.registerObjectTypes(PZ.object3d.plexus.object, [
        {
            name: "Add Geometry",
            desc: "Add a geometry source.",
            type: 0,
            list: [
                { name: "Layers", type: 0, data: { objectKind: 0, subType: 0, name: "Layers" } },
                { name: "Paths", type: 0, data: { objectKind: 0, subType: 1, name: "Paths" } },
                { name: "OBJ", type: 0, data: { objectKind: 0, subType: 2, name: "OBJ" } },
                { name: "Primitives", type: 0, data: { objectKind: 0, subType: 3, name: "Primitives" } },
                { name: "Instances", type: 0, data: { objectKind: 0, subType: 4, name: "Instances" } },
                { name: "Slicer", type: 0, data: { objectKind: 0, subType: 5, name: "Slicer" } },
            ],
        },
        {
            name: "Add Effector",
            desc: "Add an effector.",
            type: 0,
            list: [
                { name: "Noise", type: 0, data: { objectKind: 1, subType: 0, name: "Noise" } },
                { name: "Spherical Field", type: 0, data: { objectKind: 1, subType: 1, name: "Spherical Field" } },
                { name: "Container", type: 0, data: { objectKind: 1, subType: 2, name: "Container" } },
                { name: "Transform", type: 0, data: { objectKind: 1, subType: 3, name: "Transform" } },
                { name: "Color Map", type: 0, data: { objectKind: 1, subType: 4, name: "Color Map" } },
                { name: "Shade Effector", type: 0, data: { objectKind: 1, subType: 5, name: "Shade Effector" } },
                { name: "Sound Effector", type: 0, data: { objectKind: 1, subType: 6, name: "Sound Effector" } },
            ],
        },
        {
            name: "Add Renderer",
            desc: "Add a renderer.",
            type: 0,
            list: [
                { name: "Points", type: 0, data: { objectKind: 2, subType: 0, name: "Points" } },
                { name: "Lines", type: 0, data: { objectKind: 2, subType: 1, name: "Lines" } },
                { name: "Facets", type: 0, data: { objectKind: 2, subType: 2, name: "Facets" } },
                { name: "Triangulation", type: 0, data: { objectKind: 2, subType: 3, name: "Triangulation" } },
                { name: "Beams", type: 0, data: { objectKind: 2, subType: 4, name: "Beams" } },
            ],
        },
    ]);

    if (T.designer) {
        T.designer.registerConfig(PZ.object3d.plexus, {
            title: "Plexus Designer",
            targets: function (root) {
                return root.objects;
            },
            targetName: function (object, index) {
                var name = object.properties.common.name.get(PZ.trapcode.currentTime);
                if (!name || name === "Object") {
                    if (object.isRenderer()) name = ["Points", "Lines", "Facets", "Triangulation", "Beams"][object.subType];
                    else if (object.isEffector()) name = "Effector";
                    else name = "Geometry";
                }
                return name || "Object";
            },
            addKinds: [
                { name: "Add Geometry", create: function (root) { return addPlexusObject(root, 0, 3, "Primitives"); } },
                { name: "Add Effector", create: function (root) { return addPlexusObject(root, 1, 0, "Noise"); } },
                { name: "Add Renderer", create: function (root) { return addPlexusObject(root, 2, 1, "Lines"); } },
            ],
            blocks: function (target) {
                if (target && target.isEffector && target.isEffector()) {
                    return [{ key: "effector", name: "Effector" }, { key: "common", name: "Object" }];
                }
                if (target && target.isRenderer && target.isRenderer()) {
                    return [{ key: "renderer", name: "Renderer" }, { key: "common", name: "Object" }];
                }
                return [{ key: "geometry", name: "Geometry" }, { key: "common", name: "Object" }];
            },
            groupFor: function (target, key) {
                return target.properties ? target.properties[key] : null;
            },
            presets: [
                { name: "Points cloud", preset: "points" },
                { name: "Lines web", preset: "lines" },
                { name: "Facets", preset: "facets" },
                { name: "Triangulation", preset: "triangulation" },
                { name: "Beams", preset: "beams" },
                { name: "Terrain", preset: "terrain" },
            ],
            applyPreset: function (root, target, preset) {
                if (!root || !root.objects) return;
                if (preset.preset === "terrain") {
                    setupTerrain(root);
                    return;
                }
                for (var i = 0; i < root.objects.length; i++) {
                    var object = root.objects[i];
                    if (object.isRenderer && object.isRenderer()) object.applyPreset(preset.preset);
                }
                root.update(0);
            },
        });
    }

    function setupTerrain(root) {
        var geo = null,
            lines = null,
            points = null,
            noise = null;
        var t = PZ.trapcode.currentTime;
        for (var i = 0; i < root.objects.length; i++) {
            var o = root.objects[i];
            if (o.isGeometry()) {
                if (!geo) geo = o;
            } else if (o.isEffector()) {
                if (!noise) noise = o;
            } else if (o.isRenderer()) {
                var type = o.properties.renderer.rendererType.get(t);
                if (type === 1 && !lines) lines = o;
                else if (type === 0 && !points) points = o;
            }
        }
        if (!geo) geo = addPlexusObject(root, 0, 3, "Terrain Grid");
        geo.properties.common.enabled.set(1);
        geo.properties.geometry.geometryType.set(3);
        geo.properties.geometry.primitiveShape.set(3);
        geo.properties.geometry.primitiveCount.set(10000);
        geo.properties.geometry.primitiveSize.set([2400, 100, 2400]);
        geo.properties.geometry.position.set([0, -300, 0]);
        if (!noise) noise = addPlexusObject(root, 1, 0, "Terrain Noise");
        noise.subType = 0;
        noise.properties.common.enabled.set(1);
        noise.properties.effector.effectorType.set(0);
        noise.properties.effector.noiseAmount.set(140);
        noise.properties.effector.noiseScale.set(2.5);
        if (!lines) lines = addPlexusObject(root, 2, 1, "Terrain Lines");
        lines.properties.common.enabled.set(1);
        lines.properties.renderer.rendererType.set(1);
        lines.properties.renderer.maxDistance.set(42);
        lines.properties.renderer.maxConnections.set(6);
        lines.properties.renderer.opacity.set(35);
        lines.properties.renderer.color.set([0.45, 0.25, 1.0]);
        if (!points) points = addPlexusObject(root, 2, 0, "Terrain Points");
        points.properties.common.enabled.set(1);
        points.properties.renderer.rendererType.set(0);
        points.properties.renderer.size.set(3.5);
        points.properties.renderer.color.set([0.55, 0.35, 1.0]);
        root.update(0);
    }

    function addPlexusObject(root, kind, subType, name) {
        var object = new PZ.object3d.plexus.object();
        root.objects.push(object);
        object.loading = object.load({ objectKind: kind, subType: subType, name: name, properties: {} });
        if (kind === 0) {
            object.subType = subType;
            object.properties.geometry.geometryType.set(subType);
        }
        if (kind === 2 && subType === 1) {
            object.properties.renderer.lineType.set(0);
            object.properties.renderer.maxDistance.set(200);
        }
        root.update(0);
        return object;
    }
})();
