#!/usr/bin/env node

/*
 * Build one self-contained runtime bundle for every registered plugin.
 *
 * The source manifests and asset files remain readable authoring inputs. The
 * main bundle contains the manifest and eager assets. Resources grouped by
 * optionalBundle are emitted separately with integrity digests and loaded
 * only when the plugin requests them.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { createHash } = require("node:crypto");
const { validateManifest } = require("./validate-plugin-manifests");
const { writeFileAtomic, writeFileIfChangedAtomic } = require("./atomic-write");

const projectRoot = path.resolve(__dirname, "..");
const registryPath = path.join(projectRoot, "plugins", "registry.json");
const checkOnly = process.argv.includes("--check");

// Core declarations are executable pre-init inputs, not just bundle contents.
// Insert core declarations in manifest order. Shell-only scripts retain their
// positions relative to existing core scripts, including their dependencies.
function syncCoreScripts() {
  const manifestPath = path.join(projectRoot, "plugins/core/manifest.json");
  // The builder is also used by small registries containing no Core plugin.
  if (!fs.existsSync(manifestPath)) return;
  const manifest = readJson(manifestPath);
  const configPath = path.join(projectRoot, "zoidium/runtime-config.js");
  const config = fs.readFileSync(configPath, "utf8");
  const match = /preInitScripts: \[([\s\S]*?)\n    \],/.exec(config);
  if (!match) throw new Error("Runtime config has no pre-init script list.");
  const declared = (manifest.coreScripts || []).map(script => script.source);
  const configured = Array.from(match[1].matchAll(/"([^"\n]+)"/g), entry => entry[1]);
  const sources = [], core = new Set(declared);
  let cursor = 0;
  for (const source of configured) {
    if (!core.has(source)) { sources.push(source); continue; }
    const index = declared.indexOf(source);
    if (index >= cursor) { sources.push(...declared.slice(cursor, index + 1)); cursor = index + 1; }
  }
  sources.push(...declared.slice(cursor));
  if (JSON.stringify(sources) === JSON.stringify(configured)) return;
  if (checkOnly) throw new Error("Core pre-init script order differs from the manifest. Rebuild plugin bundles.");
  // Comment lines above an entry stay attached to it when the list is rewritten.
  const comments = new Map();
  let pending = [];
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) pending.push(line);
    const entry = /"([^"\n]+)"/.exec(line);
    if (entry) { comments.set(entry[1], pending); pending = []; }
  }
  const scripts = "\n" + sources.map(source => (comments.get(source) || []).map(line => line + "\n").join("") +
    "      " + JSON.stringify(source)).join(",\n");
  const next = config.replace(match[0], "preInitScripts: [" + scripts + "\n    ],")
    .replace(/assetVersion: (\d+)/, (_match, version) => "assetVersion: " + (Number(version) + 1));
  writeFileIfChangedAtomic(configPath, next);
}

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
    if (resource.optionalBundle) continue;
    if (resource.type === "text") addTextAsset(assets, resource.source, `resource ${resource.id}`);
    else if (resource.type === "json") addJsonAsset(assets, resource.source, `resource ${resource.id}`);
    else if (resource.type === "image") addImageAsset(assets, resource.source, `resource ${resource.id}`);
    else throw new Error(`Unsupported plugin resource type for ${resource.id}: ${resource.type}`);
  }

  // Core plugins run as plain pre-init scripts (see zoidium/runtime-config.js),
  // but their sources are embedded here too so the bundle stays a complete
  // integrity snapshot of the plugin. Core script URLs are intentionally not
  // version-normalized: the runtime loader cache-busts them with the shared
  // assetVersion instead of per-file ?v= queries.
  for (const script of manifest.coreScripts || []) {
    addTextAsset(assets, script.source, `core script ${script.id}`);
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
  // Bundles and the registry are runtime trust inputs: replace them atomically
  // (temporary sibling plus rename) so an interrupted build never leaves a
  // truncated file behind.
  return writeFileIfChangedAtomic(filePath, content);
}

function versionedSource(value, version) {
  const base = stripUrlQuery(value);
  return base + "?v=" + encodeURIComponent(String(version));
}

// Plugin authors bump only the manifest version: every asset URL the bundle
// embeds (modules, native effects, effect shaders and presets, group presets
// and shaders, resources) is rewritten here to the manifest version. Hand-written
// per-file counters drift apart, so the builder owns the number and check mode
// rejects a manifest that was edited without rebuilding. Bundle asset keys ignore
// the query, so this only changes the embedded manifest, never the payload.
function normalizeManifestSources(manifest) {
  const version = manifest.version;
  let changed = 0;
  const fixField = (holder, key) => {
    if (holder && typeof holder[key] === "string") {
      const next = versionedSource(holder[key], version);
      if (holder[key] !== next) {
        holder[key] = next;
        changed += 1;
      }
    }
  };
  for (const definition of manifest.modules || []) fixField(definition, "source");
  for (const definition of manifest.nativeEffects || []) fixField(definition, "source");
  for (const definition of manifest.effects || []) {
    fixField(definition, "shader");
    fixField(definition, "preset");
  }
  for (const definition of manifest.groups || []) {
    fixField(definition, "preset");
    (definition.shaders || []).forEach((shader, index) => {
      if (typeof shader === "string") {
        const next = versionedSource(shader, version);
        if (definition.shaders[index] !== next) {
          definition.shaders[index] = next;
          changed += 1;
        }
      }
    });
  }
  for (const resource of manifest.resources || []) fixField(resource, "source");
  return changed;
}

function main() {
  const registry = readJson(registryPath);
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
    throw new Error("Invalid plugin registry");
  }

  let changedBundles = 0;
  let changedManifests = 0;
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
    const relativeManifest = path.relative(projectRoot, manifestPath);
    if (normalizeManifestSources(manifest) > 0) {
      if (checkOnly) {
        throw new Error("Plugin manifest asset URLs are stale (run pnpm run build:plugin-bundles): " + relativeManifest);
      }
      if (writeIfChanged(manifestPath, JSON.stringify(manifest, null, 2) + "\n")) changedManifests += 1;
    }
    const bundle = buildBundle(manifest);
    const groups = [...new Set((manifest.resources || []).map(r => r.optionalBundle).filter(Boolean))];
    for (const id of groups) {
      const optional = buildBundle({ resources: manifest.resources.filter(r => r.optionalBundle === id).map(({optionalBundle, ...r}) => r) });
      const content = JSON.stringify({ schemaVersion: 1, assets: optional.assets }) + "\n";
      const filename = id + ".bundle.json", target = path.join(path.dirname(manifestPath), filename);
      if (checkOnly) {
        if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) throw new Error("Optional bundle is stale: " + id);
      } else writeIfChanged(target, content);
      (bundle.assets.optional ||= {})[id] = {
        source: "./" + path.relative(projectRoot, target).split(path.sep).join("/") + "?v=" + manifest.version,
        integrity: "sha256-" + createHash("sha256").update(content).digest("base64"),
      };
    }
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

    const integrity = "sha256-" + createHash("sha256").update(bundleContent, "utf8").digest("base64");
    const nextBundle = bundleUrl(manifestPath, manifest.version);
    const nextManifest = manifestUrl(manifestPath, manifest.version);
    if (
      plugin.integrity !== integrity ||
      plugin.bundle !== nextBundle ||
      plugin.manifest !== nextManifest ||
      String(plugin.version ?? "") !== String(manifest.version ?? "")
    ) {
      if (checkOnly) {
        throw new Error(`Registry metadata is stale for plugin: ${plugin.id}`);
      }
      plugin.integrity = integrity;
      plugin.bundle = nextBundle;
      plugin.manifest = nextManifest;
      delete plugin.locale;
      plugin.version = String(manifest.version ?? "");
      changedRegistry = true;
    }
  }

  if (!checkOnly && changedRegistry) {
    writeFileAtomic(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  }

  const summary = checkOnly ? "Verified" : "Built " + changedBundles + " changed (" + changedManifests + " manifests normalized)";
  console.log(summary + " " + registry.plugins.length + " plugin bundles.");
}

if (require.main === module) {
  try {
    syncCoreScripts();
    main();
  } catch (error) {
    console.error(`[Zoidium] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { writeIfChanged };

