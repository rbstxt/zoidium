"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

class Archive {
  constructor() { this.files = []; }
  addFile(name, data) { this.files.push({ name, data }); }
}

function load() {
  const window = { PZ: {} };
  return require("./project-archive-harness.cjs").installArchive(window);
}

test("entries in the pz/ folder of a CM2-era project lose that folder, as CM3's extraction did", async () => {
  const io = load();
  const source = new Archive();
  for (const name of ["pz/pz", "pz/objects", "pz/object0", "pz/font_adumu"]) source.addFile(name, new TextEncoder().encode("[]"));
  const archive = await io.decode(await io.encode(source), Archive);
  assert.deepEqual(archive.files.map(entry => entry.name), ["pz", "objects", "object0", "font_adumu"]);
});

test("only a leading pz/ folder is removed and flat Gen3 names are unchanged", async () => {
  const io = load();
  const source = new Archive();
  for (const name of ["project", "meta", "media/pz/x"]) source.addFile(name, new TextEncoder().encode("{}"));
  const archive = await io.decode(await io.encode(source), Archive);
  assert.deepEqual(archive.files.map(entry => entry.name), ["project", "meta", "media/pz/x"]);
});
