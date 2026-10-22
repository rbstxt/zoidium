"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const EventEmitter = require("node:events");
const test = require("node:test");
const vm = require("node:vm");

test("desktop dev startup forwards project paths and flags after the staged application", async () => {
  const processFake = new EventEmitter();
  Object.assign(processFake, {
    argv: ["node", "tools/start-electron.js", "/tmp/My Project.PZ", "--no-sandbox"],
    execPath: "/node", platform: "darwin",
  });
  let launch;
  const removed = [];
  const docsStages = [];
  const requireFake = (name) => {
    if (name === "node:fs") return {
      existsSync: () => true,
      promises: {
        mkdtemp: async () => "/tmp/stage",
        symlink: async () => {},
        rm: async (root) => removed.push(root),
      },
    };
    if (name === "./build-docs") return { buildDocs: async root => docsStages.push(root) };
    if (name === "./runtime-resources") return {
      projectRoot: "/worktree",
      prepareRuntimeStage: async () => ({ resources: [] }),
    };
    if (name === "node:child_process") return {
      spawn(command, args, options) {
        launch = { command, args: Array.from(args), options };
        const child = new EventEmitter();
        child.exitCode = 0;
        setImmediate(() => child.emit("exit", 0));
        return child;
      },
    };
    return require(name);
  };
  requireFake.resolve = () => "/electron/cli.js";
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../tools/start-electron.js"), "utf8"), {
    require: requireFake, process: processFake, console: { log() {}, error(message) { throw new Error(message); } },
  });
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(docsStages, ["/tmp/stage"]);
  assert.equal(launch.command, "/node");
  assert.deepEqual(launch.args, ["/electron/cli.js", "/tmp/stage", "/tmp/My Project.PZ", "--no-sandbox"]);
  assert.equal(launch.options.cwd, "/worktree");
  assert.deepEqual(removed, ["/tmp/stage"]);
  assert.equal(processFake.exitCode, 0);
});
