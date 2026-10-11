// OpenZoid Trapcode Suite — Plexus OBJ and BufferGeometry ingestion.
/*
 * plexus-geometry.js
 *
 * Reads the vertices of an OBJ (or JSON BufferGeometry) asset
 * for the OBJ geometry source. Shared with plexus-object.js
 * through T.plexusGeometry; loaded after plexus.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

    // Requests the vertices of an OBJ (or JSON BufferGeometry) asset. Resolves
    // to a flat xyz array or null.
    function loadMeshVertices(project, value) {
        if (!project || !value) return Promise.resolve(null);
        var asset = project.assets.load(value);
        if (!asset) return Promise.resolve(null);
        var finish = function (result) {
            try { project.assets.unload(asset); } catch (_error) { /* best effort */ }
            return result;
        };
        var geometryAsset;
        try {
            geometryAsset = new PZ.asset.geometry(asset);
        } catch (_error) {
            return Promise.resolve(finish(null));
        }
        var fromJson = function () {
            return geometryAsset.getGeometry().then(function (geometry) {
                var position = geometry && geometry.attributes && geometry.attributes.position;
                return position ? Array.prototype.slice.call(position.array) : null;
            });
        };
        var readText = null;
        try {
            readText = geometryAsset.readFile();
        } catch (_error) {
            readText = null;
        }
        if (readText && typeof readText.then === "function") {
            return readText
                .then(function (text) {
                    var positions = parseGeometryText(text);
                    return positions || fromJson();
                })
                .then(finish, function () { return finish(null); });
        }
        return fromJson().then(finish, function () { return finish(null); });
    }

    function computeBounds(source) {
        var minX = Infinity, minY = Infinity, minZ = Infinity;
        var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (var i = 0; i < source.length; i += 3) {
            var x = source[i], y = source[i + 1], z = source[i + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }
        if (minX === Infinity) {
            minX = minY = minZ = -0.5;
            maxX = maxY = maxZ = 0.5;
        }
        return { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ };
    }

    function parseGeometryText(text) {
        if (!text || typeof text !== "string") return null;
        var trimmed = text.trim();
        // Legacy three.js BufferGeometry JSON?
        if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
            try {
                var json = JSON.parse(text);
                var loader = new THREE.BufferGeometryLoader();
                var geo = loader.parse(json);
                if (geo && geo.attributes && geo.attributes.position) {
                    return Array.prototype.slice.call(geo.attributes.position.array);
                }
            } catch (err) { /* not a geometry */ }
            return null;
        }
        // Real .obj: prefer THREE.OBJLoader (returns Group of Meshes).
        try {
            if (THREE.OBJLoader) {
                var objLoader = new THREE.OBJLoader();
                var group = objLoader.parse(text);
                var collected = [];
                if (group && group.traverse) {
                    group.traverse(function (child) {
                        var pos = child && child.geometry && child.geometry.attributes && child.geometry.attributes.position;
                        if (pos) {
                            for (var i = 0; i < pos.array.length; i++) collected.push(pos.array[i]);
                        }
                    });
                }
                if (collected.length >= 3) return collected;
            }
        } catch (err) { /* fall through to the minimal parser */ }
        // Minimal `v x y z` fallback when OBJLoader is unavailable/strict.
        try {
            var verts = [];
            var lines = text.split("\n");
            for (var l = 0; l < lines.length; l++) {
                var line = lines[l].trim();
                if (line.charAt(0) !== "v" || line.charAt(1) !== " ") continue;
                var parts = line.split(/\s+/);
                if (parts.length >= 4) {
                    verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
                }
            }
            if (verts.length >= 3) return verts;
        } catch (err) { /* no vertices */ }
        return null;
    }

    // Shared with plexus-object.js, which loads after this file.
    T.plexusGeometry = {
        loadMeshVertices: loadMeshVertices,
        computeBounds: computeBounds,
        parseGeometryText: parseGeometryText,
    };
})();
