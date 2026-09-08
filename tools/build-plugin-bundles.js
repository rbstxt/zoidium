#!/usr/bin/env node

/*
 * Build one self-contained runtime bundle for every registered plugin.
 *
 * The source manifests and asset files remain readable authoring inputs. The
 * generated bundle is the only runtime package fetched by the plugin manager:
 * it contains the manifest plus the text, JSON, and embedded image assets
 * referenced by it.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { validateManifest } = require("./validate-plugin-manifests");

const projectRoot = path.resolve(__dirname, "..");
const registryPath = path.join(projectRoot, "plugins", "registry.json");
const checkOnly = process.argv.includes("--check");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read JSON ${path.relative(projectRoot, filePath)}: ${error.message}`);
  }
}

function stripUrlQuery(value) {
  return String(value).split(/[?#]/, 1)[0];
}

function localPath(source) {
  const raw = stripUrlQuery(source);
  if (!raw || /^[a-z][a-z\d+.-]*:/i.test(raw)) {
    throw new Error(`Plugin bundle references a non-local asset: ${source}`);
  }

  const relative = raw.replace(/^\.\//, "").replace(/^\/+/, "");
  const resolved = path.resolve(projectRoot, relative);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Plugin bundle asset escapes the project root: ${source}`);
  }
  return resolved;
}

function assetKey(source) {
  const raw = stripUrlQuery(source).replace(/\\/g, "/");
  return `/${raw.replace(/^\.\//, "").replace(/^\/+/, "")}`;
}

function readText(source) {
  const filePath = localPath(source);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read plugin asset ${source}: ${error.message}`);
  }
}

function readAssetJson(source) {
  return readJson(localPath(source));
}

function addAsset(map, source, value, description) {
  const key = assetKey(source);
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    const existing = map[key];
    const equal =
      existing === value ||
      (typeof existing === "object" &&
        typeof value === "object" &&
        JSON.stringify(existing) === JSON.stringify(value));
    if (!equal) throw new Error(`Conflicting ${description} asset: ${source}`);
    return;
  }
  map[key] = value;
}

function addTextAsset(assets, source, description) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error(`Missing text asset source for ${description}`);
  }
  addAsset(assets.text, source, readText(source), description);
}

function addJsonAsset(assets, source, description) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error(`Missing JSON asset source for ${description}`);
  }
  addAsset(assets.json, source, readAssetJson(source), description);
}

const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function addImageAsset(assets, source, description) {
  if (typeof source !== "string" || !source.trim()) {
    throw new Error(`Missing image asset source for ${description}`);
  }
  const ext = path.extname(stripUrlQuery(source)).toLowerCase();
  const mime = IMAGE_MIME_TYPES[ext];
  if (!mime) throw new Error(`Unsupported image asset type for ${description}: ${source}`);
  const data = fs.readFileSync(localPath(source));
  addAsset(assets.text, source, `data:${mime};base64,${data.toString("base64")}`, description);
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")));
}

function buildBundle(manifest) {
  const assets = { text: {}, json: {} };

  for (const definition of manifest.modules || []) {
    addTextAsset(assets, definition.source, `module ${definition.id}`);
  }
  for (const definition of manifest.nativeEffects || []) {
    addTextAsset(assets, definition.source, `native effect ${definition.id}`);
  }
  for (const definition of manifest.effects || []) {
    addTextAsset(assets, definition.shader, `effect shader ${definition.id}`);
    addJsonAsset(assets, definition.preset, `effect preset ${definition.id}`);
  }
  for (const definition of manifest.groups || []) {
    addJsonAsset(assets, definition.preset, `group preset ${definition.id}`);
    for (const shader of definition.shaders || []) {
      addTextAsset(assets, shader, `group shader ${definition.id}`);
    }
  }
  for (const resource of manifest.resources || []) {
    if (resource.type === "text") addTextAsset(assets, resource.source, `resource ${resource.id}`);
    else if (resource.type === "json") addJsonAsset(assets, resource.source, `resource ${resource.id}`);
    else if (resource.type === "image") addImageAsset(assets, resource.source, `resource ${resource.id}`);
    else throw new Error(`Unsupported plugin resource type for ${resource.id}: ${resource.type}`);
  }

  return {
    schemaVersion: 1,
    manifest,
    assets: {
      text: sortObject(assets.text),
      json: sortObject(assets.json),
    },
  };
}

function bundleUrl(manifestPath, version) {
  const relative = path.relative(projectRoot, path.join(path.dirname(manifestPath), "bundle.json"));
  return `./${relative.split(path.sep).join("/")}?v=${encodeURIComponent(String(version))}`;
}

function manifestUrl(manifestPath, version) {
  const relative = path.relative(projectRoot, manifestPath);
  return `./${relative.split(path.sep).join("/")}?v=${encodeURIComponent(String(version))}`;
}

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function main() {
  const registry = readJson(registryPath);
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
    throw new Error("Invalid plugin registry");
  }

  let changedBundles = 0;
  let changedRegistry = false;
  for (const plugin of registry.plugins) {
    if (!plugin?.id || typeof plugin.manifest !== "string") {
      throw new Error(`Registry entry has no manifest: ${plugin?.id || "unknown"}`);
    }

    const manifestPath = localPath(plugin.manifest);
    const manifest = readJson(manifestPath);
    validateManifest(manifest, path.relative(projectRoot, manifestPath));
    if (manifest.id !== plugin.id) {
      throw new Error(`Manifest does not match registry entry: ${plugin.id}`);
    }
    const bundle = buildBundle(manifest);
    const bundlePath = path.join(path.dirname(manifestPath), "bundle.json");
    const bundleJson = JSON.stringify(bundle);
    if (/[\r\n]/.test(bundleJson)) {
      throw new Error(`Plugin bundle must be single-line JSON: ${plugin.id}`);
    }
    const bundleContent = `${bundleJson}\n`;
    if (checkOnly) {
      if (!fs.existsSync(bundlePath) || fs.readFileSync(bundlePath, "utf8") !== bundleContent) {
        throw new Error(`Plugin bundle is stale or missing: ${path.relative(projectRoot, bundlePath)}`);
      }
    } else if (writeIfChanged(bundlePath, bundleContent)) {
      changedBundles += 1;
    }

    const nextBundle = bundleUrl(manifestPath, manifest.version);
    const nextManifest = manifestUrl(manifestPath, manifest.version);
    if (
      plugin.bundle !== nextBundle ||
      plugin.manifest !== nextManifest ||
      String(plugin.version ?? "") !== String(manifest.version ?? "")
    ) {
      if (checkOnly) {
        throw new Error(`Registry metadata is stale for plugin: ${plugin.id}`);
      }
      plugin.bundle = nextBundle;
      plugin.manifest = nextManifest;
      delete plugin.locale;
      plugin.version = String(manifest.version ?? "");
      changedRegistry = true;
    }
  }

  if (!checkOnly && changedRegistry) {
    fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  }

  const action = checkOnly ? "Verified" : `Built ${changedBundles} changed`;
  console.log(`${action} ${registry.plugins.length} plugin bundles.`);
}

try {
  main();
} catch (error) {
  console.error(`[Zoidium] ${error.message}`);
  process.exit(1);
}
