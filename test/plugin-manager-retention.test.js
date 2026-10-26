"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

async function retentionProbe() {
  assert.equal(typeof global.gc, "function");
  const events = new Map();
  const sandbox = {
    console, CM: { project: null },
    addEventListener: (name, callback) => events.set(name, callback),
    document: { dispatchEvent() {} },
    CustomEvent: class {},
    PZ: { project: class { toJSON() { return {}; } } },
    ZoidiumProjectCompatibility: { installTextMode() {}, installText2D() {} },
    ZoidiumPluginApis: { props: { cloneJson: (value) => JSON.parse(JSON.stringify(value)) } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of ["state", "persistence", "factories", "projects", "panel", "lifecycle"]) {
    const file = `zoidium/plugin-manager-${name}.js`;
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
  }
  const m = sandbox.ZoidiumPluginManagerInternals;
  m.installProjectPluginHooks();
  const state = {
    plugin: { id: "native-fx" }, runtimeModules: [],
    card: { dataset: { phase: "enabled" }, querySelector: () => null },
    toggle: {},
  };
  m.pluginStates.set(state.plugin.id, state);
  const metadata = { id: "native-fx", effect: "probe", effectName: "Probe" };
  function openProject(missing) {
    const project = new sandbox.PZ.project();
    const effect = { parentProject: project };
    project.effects = [effect];
    sandbox.CM.project = project;
    m.trackNativeEffect(effect, metadata, missing);
    // Duplicate loads must not increment explicit usage bookkeeping.
    m.trackNativeEffect(effect, metadata, missing);
    events.get("zoidium:project-changed")();
    assert.equal(state.toggle.disabled, true);
    return project;
  }
  const refs = [];
  for (let i = 0; i < 20; i++) refs.push(new WeakRef(openProject(i % 2 === 0)));
  const pendingSaveProject = openProject(true);
  const activeProject = openProject(false);
  const collect = async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      global.gc();
    }
  };
  await collect();
  const alive = refs.filter((ref) => ref.deref()).length;
  assert.equal(alive, 0, "manager tracking must release all 20 abandoned projects");
  assert.equal(m.trackedNativeEffects.size, 2, "iteration prunes collected effects");
  assert.equal(m.missingNativeEffects.size, 1, "missing effects must also be weakly indexed");
  assert.equal(m.getDebugProjectUsage().totalInstances, 1);
  assert.equal(m.getDebugProjectUsage().missingInstances, 0);
  assert.equal(m.collectProjectPlugins(pendingSaveProject)[0].effects[0], "probe");
  assert.equal(m.collectProjectPlugins(activeProject)[0].effects[0], "probe");
  sandbox.CM.project = pendingSaveProject;
  events.get("zoidium:project-changed")();
  assert.equal(state.toggle.disabled, true, "a still-owned old project keeps its usage lock");
  assert.equal(m.getDebugProjectUsage().missingInstances, 1);
  const effect = pendingSaveProject.effects[0];
  const countBeforeUnload = [...m.debugUsageCounts.values()][0];
  m.untrackNativeEffect(effect);
  m.untrackNativeEffect(effect);
  assert.equal([...m.debugUsageCounts.values()][0], countBeforeUnload - 1);
  assert.equal(m.trackedNativeEffects.has(effect), false);
  assert.equal(m.missingNativeEffects.has(effect), false);
  assert.equal(state.toggle.disabled, false, "explicit unload releases the lock immediately");
  assert.equal(m.collectProjectPlugins(pendingSaveProject).length, 0);
  assert.equal(m.trackedNativeEffects.size, 1);
  m.trackedNativeEffects.clear();
  assert.equal(m.trackedNativeEffects.size, 0);
  return { replacedProjects: 20, projectsAliveAfterGc: alive, stillOwnedProjects: 2 };
}

if (process.argv.includes("--retention-probe")) {
  retentionProbe().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  test("manager weak tracking releases replaced projects and preserves live ownership", () => {
    const result = spawnSync(process.execPath, ["--expose-gc", __filename, "--retention-probe"], {
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).projectsAliveAfterGc, 0);
  });
}
