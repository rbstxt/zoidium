#!/usr/bin/env node

/*
 * Scaffold a new Zoidium plugin for one of the five plugin kinds:
 * shader-pack, native-fx, object, material-pack, extension.
 *
 *   node tools/new-plugin.js --kind=native-fx --id=my-filter --name="My Filter"
 *   node tools/new-plugin.js --kind=shader-pack --id=my-pack
 *   node tools/new-plugin.js --kind=native-fx --template=temporal --id=my-time-fx
 *
 * The generator writes plugins/<id>/ with a manifest and starter sources.
 * It never touches the registry: add the printed registry entry yourself,
 * then run pnpm run build:plugin-bundles. See docs/plugin-api.md.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const KINDS = ["shader-pack", "native-fx", "object", "material-pack", "extension"];

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const match = token.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Bad argument: ${token}`);
    args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

function titleCase(id) {
  return id
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readmeFor(id, name, kind) {
  return `# ${name}\n\nA Zoidium ${kind} plugin. See docs/plugin-api.md for the ${kind} contract.\n\n\`\`\`bash\n# after adding the registry entry printed by the generator\npnpm run build:plugin-bundles\npnpm run verify\n\`\`\`\n`;
}

// The panel renders one collapsible pack per registry category, and the
// manifest check rejects a visible plugin without one, so the printed entry
// has to carry a category the registry already declares.
function registryCategoryIds() {
  const registry = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "plugins", "registry.json"), "utf8")
  );
  return (Array.isArray(registry.categories) ? registry.categories : [])
    .map((category) => category && category.id)
    .filter((id) => typeof id === "string" && id);
}

function registrySnippet(id, name, author, category) {
  return JSON.stringify(
    {
      id,
      category,
      name,
      author,
      version: "1",
      tagline: "TODO",
      description: "TODO",
      manifest: `./plugins/${id}/manifest.json?v=1`,
      bundle: `./plugins/${id}/bundle.json?v=1`,
    },
    null,
    2
  );
}

function shaderPackFiles(dir, id, name) {
  const effectId = `${id}-sample`;
  const manifest = {
    schemaVersion: 1,
    id,
    name,
    author: "Zoidium",
    version: "1",
    kind: "shader-pack",
    description: `TODO: describe ${name}.`,
    effects: [
      {
        id: effectId,
        name: "Sample",
        description: "TODO: describe this effect.",
        shader: `./plugins/${id}/shaders/sample.glsl`,
        preset: `./plugins/${id}/effects/sample.json`,
      },
    ],
  };
  writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFile(
    path.join(dir, "effects/sample.json"),
    JSON.stringify({ type: 1, properties: { name: "Sample" } }, null, 2) + "\n"
  );
  writeFile(
    path.join(dir, "shaders/sample.glsl"),
    [
      "precision highp float;",
      "",
      "uniform sampler2D tDiffuse;",
      "varying vec2 vUvScaled;",
      "",
      "void main() {",
      "  vec4 source = texture2D(tDiffuse, vUvScaled);",
      "  gl_FragColor = vec4(source.rgb, source.a);",
      "}",
      "",
    ].join("\n")
  );
}

function nativeFxFiles(dir, id, name, template) {
  const manifest = {
    schemaVersion: 1,
    id,
    name,
    author: "Zoidium",
    version: "1",
    kind: "native-fx",
    description: `TODO: describe ${name}.`,
    nativeEffects: [
      {
        id,
        name,
        description: `TODO: describe ${name}.`,
        source: `./plugins/${id}/effects/${id}.js`,
      },
    ],
  };
  writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const body =
    template === "temporal"
      ? [
          `"use strict";`,
          ``,
          `// Native FX (temporal): describe the time operator; the host in`,
          `// plugins/core/temporal-render.js applies it.`,
          `ZoidiumPluginApis.defineTemporal.call(this, {`,
          `  kind: "time-offset",`,
          `  displayName: "${name}",`,
          `  properties: {`,
          `    enabled: {`,
          `      dynamic: true,`,
          `      name: "Enabled",`,
          `      type: PZ.property.type.OPTION,`,
          `      value: 1,`,
          `      items: "off;on",`,
          `    },`,
          `    offset: {`,
          `      dynamic: true,`,
          `      name: "Offset (frames)",`,
          `      type: PZ.property.type.NUMBER,`,
          `      value: 0,`,
          `      min: -100000,`,
          `      max: 100000,`,
          `      step: 1,`,
          `    },`,
          `  },`,
          `  getOperator(effect, frame) {`,
          `    return {`,
          `      kind: "time-offset",`,
          `      enabled: effect.properties.enabled.get(frame) === 1,`,
          `      offsetFrames: Number(effect.properties.offset.get(frame)) || 0,`,
          `    };`,
          `  },`,
          `});`,
          ``,
        ].join("\n")
      : [
          `"use strict";`,
          ``,
          `// Native FX (filter): describe the shader and uniforms; loading,`,
          `// bundling, and disposal come from the shared helper.`,
          `ZoidiumPluginApis.defineFilter.call(this, {`,
          `  displayName: "${name}",`,
          `  fragShaderUrl: "/plugins/${id}/shaders/${id}.glsl",`,
          `  uniforms: {`,
          `    strength: { type: "f", value: 0.5 },`,
          `  },`,
          `  properties: {`,
          `    enabled: {`,
          `      dynamic: true,`,
          `      name: "Enabled",`,
          `      type: PZ.property.type.OPTION,`,
          `      value: 1,`,
          `      items: "off;on",`,
          `    },`,
          `    strength: {`,
          `      dynamic: true,`,
          `      name: "Strength",`,
          `      type: PZ.property.type.NUMBER,`,
          `      value: 0.5,`,
          `      min: 0,`,
          `      max: 1,`,
          `      step: 0.05,`,
          `    },`,
          `  },`,
          `  update(frame) {`,
          `    if (!this.pass) return;`,
          `    this.pass.enabled = this.properties.enabled.get(frame);`,
          `    this.pass.uniforms.strength.value = this.properties.strength.get(frame);`,
          `  },`,
          `});`,
          ``,
        ].join("\n");
  writeFile(path.join(dir, `effects/${id}.js`), body);
  if (template !== "temporal") {
    writeFile(
      path.join(dir, `shaders/${id}.glsl`),
      [
        "precision highp float;",
        "",
        "uniform sampler2D tDiffuse;",
        "uniform float strength;",
        "varying vec2 vUv;",
        "",
        "void main() {",
        "  vec4 source = texture2D(tDiffuse, vUv);",
        "  gl_FragColor = vec4(mix(source.rgb, vec3(1.0) - source.rgb, strength), source.a);",
        "}",
        "",
      ].join("\n")
    );
    const manifestWithResource = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    manifestWithResource.resources = [
      { id: `${id}-shader`, type: "text", source: `./plugins/${id}/shaders/${id}.glsl` },
    ];
    writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifestWithResource, null, 2) + "\n");
  }
}

function moduleStarter(id, name, hint) {
  return [
    `"use strict";`,
    ``,
    `// ${name}: extension module. activate() runs while the plugin is enabled,`,
    `// deactivate() (optional) undoes it. ${hint}`,
    `module.exports = {`,
    `  activate(context) {`,
    `    const { PZ, plugin } = context;`,
    `    if (!PZ) throw new Error("${name} needs the CM3 runtime.");`,
    `  },`,
    `  deactivate() {},`,
    `};`,
    ``,
  ].join("\n");
}

function objectFiles(dir, id, name) {
  const objectId = `${id}-shape`;
  const manifest = {
    schemaVersion: 1,
    id,
    name,
    author: "Zoidium",
    version: "1",
    kind: "object",
    description: `TODO: describe ${name}.`,
    objectCategory: name.toUpperCase(),
    objectClasses: [
      {
        id: objectId,
        type: `zoidium:${id}/${objectId}`,
        name,
        description: `TODO: describe ${name}.`,
        schemaVersion: 1,
      },
    ],
    modules: [{ id: `${id}-runtime`, source: `./plugins/${id}/${id}.js` }],
  };
  writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFile(
    path.join(dir, `${id}.js`),
    [
      `"use strict";`,
      ``,
      `// Object plugin: register the class through the scoped object3d API.`,
      `// Geometry+ (plugins/geometry-plus/geometry-plus.js) is the reference.`,
      `module.exports = {`,
      `  activate(context) {`,
      `    const { PZ, window, object3d, apis } = context;`,
      `    if (!PZ || !object3d) throw new Error("${name} needs the Zoidium 3D object registry.");`,
      `    const helpers = (apis && apis.objects) || null;`,
      `    void helpers;`,
      `    void window;`,
      `  },`,
      `};`,
      ``,
    ].join("\n")
  );
}

function materialFiles(dir, id, name) {
  const manifest = {
    schemaVersion: 1,
    id,
    name,
    author: "Zoidium",
    version: "1",
    kind: "material-pack",
    description: `TODO: describe ${name}.`,
    materialTypes: [{ id, name, description: `TODO: describe ${name}.` }],
    modules: [{ id: `${id}-runtime`, source: `./plugins/${id}/${id}.js` }],
  };
  writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFile(
    path.join(dir, `${id}.js`),
    moduleStarter(id, name, "Material+ (plugins/material-plus/material-plus.js) is the reference.")
  );
}

function extensionFiles(dir, id, name) {
  const manifest = {
    schemaVersion: 1,
    id,
    name,
    author: "Zoidium",
    version: "1",
    kind: "extension",
    description: `TODO: describe ${name}.`,
    modules: [{ id: `${id}-runtime`, source: `./plugins/${id}/${id}.js` }],
  };
  writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFile(
    path.join(dir, `${id}.js`),
    moduleStarter(id, name, "Player+ (plugins/player-plus/player-plus.js) is the reference.")
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.kind;
  const id = args.id;
  if (!KINDS.includes(kind)) {
    throw new Error(`--kind must be one of: ${KINDS.join(", ")}`);
  }
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error("--id must match ^[a-z0-9][a-z0-9-]*$ (for example my-filter)");
  }
  if (id === "core") throw new Error("core is reserved for the hidden Zoidium Core plugin");
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : titleCase(id);
  const dir = path.join(projectRoot, "plugins", id);
  if (fs.existsSync(dir)) throw new Error(`Refusing to overwrite existing directory: plugins/${id}/`);
  const template = args.template === undefined ? "filter" : args.template;
  if (kind === "native-fx" && template !== "filter" && template !== "temporal") {
    throw new Error("--template must be filter or temporal");
  }

  if (kind === "shader-pack") shaderPackFiles(dir, id, name);
  else if (kind === "native-fx") nativeFxFiles(dir, id, name, template);
  else if (kind === "object") objectFiles(dir, id, name);
  else if (kind === "material-pack") materialFiles(dir, id, name);
  else extensionFiles(dir, id, name);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (typeof args.author === "string" && args.author.trim()) {
    manifest.author = args.author.trim();
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  writeFile(path.join(dir, "README.md"), readmeFor(id, name, kind));

  console.log(`[Zoidium] scaffolded ${kind} plugin at plugins/${id}/`);
  console.log("[Zoidium] next steps:");
  console.log("  1. Fill in TODO descriptions and starter sources.");
  console.log("  2. Add this entry to plugins/registry.json:");
  const categoryIds = registryCategoryIds();
  const defaultCategory = categoryIds.includes("utilities") ? "utilities" : categoryIds[0];
  console.log(registrySnippet(id, name, manifest.author, defaultCategory));
  console.log(`     category must be one of: ${categoryIds.join(", ")}`);
  console.log("  3. Run pnpm run build:plugin-bundles && pnpm run verify.");
}

try {
  main();
} catch (error) {
  console.error(`[Zoidium] ${error.message}`);
  process.exit(1);
}
