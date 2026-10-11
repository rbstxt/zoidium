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

    // Ingestion caps (SEC-05): geometry arrives from project-referenced
    // assets, so a hostile file must fail fast with a clear message instead
    // of hanging the tab or exhausting memory. Source text beyond
    // MAX_GEOMETRY_TEXT_BYTES is rejected before parsing; more than
    // MAX_GEOMETRY_VERTICES vertices are rejected after parsing. Plexus
    // samples at most 60,000 points per source (fewer for link and mesh
    // renderers), so real models keep wide headroom. Rejections resolve to
    // null, which the caller treats as "no mesh" and falls back to a
    // primitive. Limits are also exposed on T.plexusGeometry for tests.
    var MAX_GEOMETRY_TEXT_BYTES = 16 * 1024 * 1024;
    var MAX_GEOMETRY_VERTICES = 500000;

    function rejectGeometry(reason) {
        try {
            console.warn("Trapcode Plexus: the OBJ file was skipped (" + reason + "); using a primitive instead.");
        } catch (_error) { /* logging is best effort */ }
        return null;
    }

    // Counts `v x y z` lines without splitting the text, so a huge file is
    // rejected before OBJLoader builds anything. Lines the minimal fallback
    // would skip (such as tab-separated ones) may undercount; the parsed
    // vertex check below still bounds those.
    function countObjVertices(text) {
        var count = text.charAt(0) === "v" && text.charAt(1) === " " ? 1 : 0;
        var at = -1;
        while ((at = text.indexOf("\nv ", at + 1)) !== -1) count++;
        return count;
    }

    function overVertexLimit(count) {
        return count > MAX_GEOMETRY_VERTICES;
    }
    // Requests the vertices of an OBJ (or JSON BufferGeometry) asset.
    // Resolves to a flat xyz array or null.
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
            console.warn("[Zoidium] trapcode-suite: geometry asset could not be read; using a primitive instead.", _error);
            return Promise.resolve(finish(null));
        }
        var fromJson = function () {
            return geometryAsset.getGeometry().then(function (geometry) {
                var position = geometry && geometry.attributes && geometry.attributes.position;
                if (!position) return null;
                if (position.array.length / 3 > MAX_GEOMETRY_VERTICES) {
                    return rejectGeometry("the decoded mesh has " +
                        Math.floor(position.array.length / 3) + " vertices (limit " + MAX_GEOMETRY_VERTICES + ")");
                }
                return Array.prototype.slice.call(position.array);
            });
        };
        var readText = null;
        try {
            readText = geometryAsset.readFile();
        } catch (_error) {
            readText = null; // Unreadable as text: fall through to the decoded-geometry path below.
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
        if (text.length > MAX_GEOMETRY_TEXT_BYTES) {
            return rejectGeometry("the file is " + text.length + " bytes (limit " + MAX_GEOMETRY_TEXT_BYTES + ")");
        }
        var trimmed = text.trim();
        // Legacy three.js BufferGeometry JSON?
        if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
            try {
                var json = JSON.parse(text);
                var loader = new THREE.BufferGeometryLoader();
                var geo = loader.parse(json);
                if (geo && geo.attributes && geo.attributes.position) {
                    var parsed = geo.attributes.position.array;
                    var jsonCount = Math.floor(parsed.length / 3);
                    if (overVertexLimit(jsonCount)) {
                        return rejectGeometry("the geometry has " + jsonCount +
                            " vertices (limit " + MAX_GEOMETRY_VERTICES + ")");
                    }
                    return Array.prototype.slice.call(parsed);
                }
            } catch (err) { /* not a geometry */ }
            return null;
        }
        if (countObjVertices(text) > MAX_GEOMETRY_VERTICES) {
            return rejectGeometry("the file declares more than " + MAX_GEOMETRY_VERTICES + " vertices");
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
                if (collected.length >= 3) {
                    var objCount = Math.floor(collected.length / 3);
                    if (overVertexLimit(objCount)) {
                        return rejectGeometry("the OBJ mesh has " + objCount +
                            " vertices (limit " + MAX_GEOMETRY_VERTICES + ")");
                    }
                    return collected;
                }
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
            if (verts.length >= 3) {
                var vCount = Math.floor(verts.length / 3);
                if (overVertexLimit(vCount)) {
                    return rejectGeometry("the OBJ mesh has " + vCount +
                        " vertices (limit " + MAX_GEOMETRY_VERTICES + ")");
                }
                return verts;
            }
        } catch (err) { /* no vertices */ }
        return null;
    }

    // Shared with plexus-object.js, which loads after this file.
    T.plexusGeometry = {
        loadMeshVertices: loadMeshVertices,
        computeBounds: computeBounds,
        parseGeometryText: parseGeometryText,
        MAX_GEOMETRY_TEXT_BYTES: MAX_GEOMETRY_TEXT_BYTES,
        MAX_GEOMETRY_VERTICES: MAX_GEOMETRY_VERTICES,
    };
})();
