"use strict";
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const root = path.resolve(__dirname, "../..");
const cache = process.env.ZOIDIUM_RESOURCE_DIR || path.join(root, ".zoidium-resources");
function host() {
  const c = vm.createContext({ PZ: {}, ISNODE: true, console, setTimeout, clearTimeout,
    setInterval, clearInterval, TextEncoder, TextDecoder, performance, URL, Image: class {},
    CSS: { supports: () => true }, navigator: {}, document: {}, addEventListener() {} });
  c.window = { addEventListener() {} };
  for (const file of ["three.r91.min.js", "core-1.0.102.js", "ui-1.0.72.js"])
    vm.runInContext(fs.readFileSync(path.join(cache, file), "utf8"), c, { filename: file });
  c.window = c;
  for (const file of ["random", "props", "color", "gl", "json", "windows"])
    vm.runInContext(fs.readFileSync(path.join(root, "zoidium/shared", file + ".js"), "utf8"), c);
  vm.runInContext(fs.readFileSync(path.join(root, "zoidium/plugin-apis.js"), "utf8"), c);
  return c;
}
function fixture({ PZ }) {
  const project = new PZ.project(); project.sequence.properties.load();
  const track = new PZ.track.video(); project.sequence.videoTracks.push(track);
  const clip = new PZ.clip.video(6); clip.start = 0; clip.length = 100; track.clips.push(clip);
  const layer = clip.object; layer.properties.load();
  return { project, track, clip, layer };
}
function editorFor(PZ, project) {
  const editor = { playback: { currentFrame: 0 }, sequence: project.sequence };
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor); editor.project = project;
  return editor;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
module.exports = { host, fixture, editorFor, deferred };
