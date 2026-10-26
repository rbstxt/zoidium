"use strict";

// Node graph project images: per-material image caches, async loading,
// dependency signatures, pixel sampling, and UV-remapped reads.

module.exports = function attachGraphImages(nodes, env) {
    const { PZ, document, newBuffer } = env;
    const imageCaches = new WeakMap();
    function projectAssets(material) {
        // Detached materials (clip deleted) throw when reading parentProject.
        try {
            return material?.parentProject?.assets || null;
        } catch (_error) {
            return null;
        }
    }
    nodes.getImageCache = function (material) {
        if (!material) return Object.create(null);
        if (!imageCaches.has(material)) imageCaches.set(material, Object.create(null));
        return imageCaches.get(material);
    };
    nodes.releaseImages = function (material) {
        const cache = imageCaches.get(material);
        const assets = projectAssets(material);
        if (cache) for (const entry of Object.values(cache)) {
            entry.disposed = true;
            if (entry.asset) assets?.unload?.(entry.asset);
        }
        imageCaches.delete(material);
    };
    nodes.reloadImages = async function (material, key, asset) {
        const entry = imageCaches.get(material)?.[key];
        if (!entry || entry.asset !== asset) return false;
        entry.canvas = null;
        entry.sample = null;
        entry.disposed = false;
        entry.loading = Promise.resolve(entry.loaded.loading).then(() => {
            if (entry.disposed) return;
            entry.canvas = entry.loaded.getImage();
            entry.revision++;
        });
        await entry.loading;
        return true;
    };
    nodes.dependencySignature = function (graph, material) {
        const cache = nodes.getImageCache(material);
        return graph.nodes.filter(n => n.params.asset).map(n => [n.params.asset, cache[n.params.asset]?.revision || 0]);
    };
    nodes.prepareImages = async function (graph, material) {
        const cache = nodes.getImageCache(material);
        const assets = projectAssets(material);
        const keys = new Set(graph.nodes.map(n => n.params.asset).filter(Boolean));
        for (const key of Object.keys(cache)) if (!keys.has(key)) {
            cache[key].disposed = true;
            if (assets) assets.unload(cache[key].asset);
            delete cache[key];
        }
        if (!assets) return;
        await Promise.all(Array.from(keys, key => {
            if (cache[key]) return cache[key].loading;
            const asset = assets.load(key);
            const loaded = new PZ.asset.image(asset);
            loaded.getImage();
            const entry = cache[key] = { asset, loaded, revision: 0, disposed: false };
            entry.loading = Promise.resolve(loaded.loading).then(() => {
                if (entry.disposed) return;
                entry.canvas = loaded.getImage();
                entry.revision++;
            });
            return entry.loading;
        }));
    };
    nodes.imageBuffers = function (graph, size, material, time = 0) {
        const result = Object.create(null);
        const cache = nodes.getImageCache(material);
        for (const node of graph.nodes) {
            const key = node.params.asset;
            if (!key || !cache[key]?.canvas || result[key]) continue;
            const entry = cache[key];
            const gif = entry.loaded?.data?.gif;
            let image = entry.canvas;
            if (gif?.frames?.length && gif.total > 0) {
                const target = ((time % gif.total) + gif.total) % gif.total;
                const index = gif.cumulative.findIndex(end => target < end);
                image = gif.frames[Math.max(0, index)].canvas;
            }
            if (entry.sample?.size === size && entry.sample.image === image) {
                result[key] = entry.sample.pixels;
                continue;
            }
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0, size, size);
            const pixels = ctx.getImageData(0, 0, size, size).data;
            entry.sample = { size, image, pixels };
            result[key] = pixels;
        }
        return result;
    };

    function imageBuffer(size, key, context, uv) {
        if (!key) return null;
        const source = context?.images?.[key];
        if (!source) return null;
        var buffer = newBuffer(size);
        if (!uv) {
            buffer.set(source);
            return buffer;
        }
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var index = (x + y * size) * 4;
                var sx = Math.min(size - 1, Math.max(0, Math.floor((uv[index] / 255) * size)));
                var sy = Math.min(size - 1, Math.max(0, Math.floor((uv[index + 1] / 255) * size)));
                var sourceIndex = (sx + sy * size) * 4;
                buffer[index] = source[sourceIndex];
                buffer[index + 1] = source[sourceIndex + 1];
                buffer[index + 2] = source[sourceIndex + 2];
                buffer[index + 3] = source[sourceIndex + 3];
            }
        }
        return buffer;
    }

    return imageBuffer;
};
