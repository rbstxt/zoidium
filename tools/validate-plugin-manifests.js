#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const projectRoot = path.resolve(__dirname, "..");
const pluginsRoot = path.join(projectRoot, "plugins");
const registryPath = path.join(pluginsRoot, "registry.json");
const schemaPath = path.join(pluginsRoot, "manifest.schema.json");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read JSON ${path.relative(projectRoot, filePath)}: ${error.message}`);
  }
}

function localPath(value) {
  const raw = String(value).split(/[?#]/, 1)[0];
  const relative = raw.replace(/^\.\//, "").replace(/^\/+/, "");
  const resolved = path.resolve(projectRoot, relative);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Manifest path escapes the project root: ${value}`);
  }
  return resolved;
}

function formatSchemaErrors(errors) {
  return errors
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message}`;
    })
    .join("; ");
}

function validateManifest(manifest, label = "manifest") {
  if (!validateSchema(manifest)) {
    throw new Error(`${label} failed manifest schema: ${formatSchemaErrors(validateSchema.errors)}`);
  }

  // Per-kind contract: when a manifest declares its plugin kind, the sections
  // required by that kind must be present. Extra sections are allowed so
  // hybrid plugins (for example Layer Input, which ships native effects and
  // a material type) keep working while declaring their primary kind.
  const hasItems = (value) => Array.isArray(value) && value.length > 0;
  if (typeof manifest.kind === "string") {
    const kindRequirements = {
      "shader-pack": hasItems(manifest.effects) || hasItems(manifest.groups),
      "native-fx": hasItems(manifest.nativeEffects),
      "object": hasItems(manifest.objectClasses) || hasItems(manifest.objectTypes),
      "material-pack": hasItems(manifest.materialTypes),
      "extension": hasItems(manifest.modules) || hasItems(manifest.resources),
      "core": true,
    };
    if (!Object.prototype.hasOwnProperty.call(kindRequirements, manifest.kind)) {
      throw new Error(`${label} declares an unknown plugin kind: ${manifest.kind}`);
    }
    if (!kindRequirements[manifest.kind]) {
      throw new Error(`${label} declares kind "${manifest.kind}" but has none of its required sections`);
    }
    if (manifest.kind === "core") {
      if (manifest.visibility !== "hidden") {
        throw new Error(`${label} is a core plugin and must use visibility "hidden"`);
      }
      if (manifest.alwaysEnabled !== true) {
        throw new Error(`${label} is a core plugin and must set alwaysEnabled to true`);
      }
    }
  }

  for (const objectClass of manifest.objectClasses || []) {
    if (!objectClass.type.startsWith(`zoidium:${manifest.id}/`)) {
      throw new Error(
        `${label} has an object class outside its namespace: ${objectClass.type}`
      );
    }
  }

  return manifest;
}

function manifestFiles() {
  return fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsRoot, entry.name, "manifest.json"))
    .filter((filePath) => fs.existsSync(filePath));
}

// The panel groups visible plugins by category, so a typo in either the
// category id or a plugin's category reference would silently change how the
// pack list renders.
function validateRegistryCategories(registry) {
  const categories = Array.isArray(registry.categories) ? registry.categories : [];
  const ids = new Set();
  for (const category of categories) {
    if (!category || typeof category.id !== "string" || !category.id) {
      throw new Error("Every registry category needs a string id");
    }
    if (typeof category.name !== "string" || !category.name) {
      throw new Error(`Registry category "${category.id}" needs a name`);
    }
    if (category.collapsed !== undefined && typeof category.collapsed !== "boolean") {
      throw new Error(
        `Registry category "${category.id}" must use a boolean collapsed flag`
      );
    }
    if (ids.has(category.id)) {
      throw new Error(`Duplicate registry category id: ${category.id}`);
    }
    ids.add(category.id);
  }

  for (const plugin of registry.plugins) {
    if (!plugin || typeof plugin.id !== "string") continue;
    if (plugin.visibility === "hidden" || plugin.alwaysEnabled === true) continue;
    if (typeof plugin.category !== "string" || !plugin.category) {
      throw new Error(`Visible plugin "${plugin.id}" must declare a category`);
    }
    if (!ids.has(plugin.category)) {
      throw new Error(
        `Plugin "${plugin.id}" references unknown category "${plugin.category}"`
      );
    }
  }
}

function validateRegisteredManifests() {
  const registry = readJson(registryPath);
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
    throw new Error("Invalid plugin registry");
  }
  validateRegistryCategories(registry);

  const registeredPaths = new Set();
  for (const plugin of registry.plugins) {
    if (!plugin || typeof plugin.id !== "string" || typeof plugin.manifest !== "string") {
      throw new Error(`Invalid registry entry: ${plugin?.id || "unknown"}`);
    }

    const manifestPath = localPath(plugin.manifest);
    const manifest = readJson(manifestPath);
    const label = path.relative(projectRoot, manifestPath);
    validateManifest(manifest, label);
    if (manifest.id !== plugin.id) {
      throw new Error(`${label} id does not match registry entry ${plugin.id}`);
    }
    registeredPaths.add(path.resolve(manifestPath));
  }

  for (const manifestPath of manifestFiles()) {
    if (!registeredPaths.has(path.resolve(manifestPath))) {
      throw new Error(`Manifest is not registered: ${path.relative(projectRoot, manifestPath)}`);
    }
  }

  return registry.plugins.length;
}

if (require.main === module) {
  try {
    const count = validateRegisteredManifests();
    console.log(`[Zoidium] validated ${count} plugin manifests against manifest.schema.json.`);
  } catch (error) {
    console.error(`[Zoidium] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  validateManifest,
  validateRegistryCategories,
  validateRegisteredManifests,
};
