// Paste this entire file into DevTools on the STILL-OPEN affected editor tab.
// It reads the project and attached files without changing the live project.
// Then run ZoidiumRescue.download("original") and, separately,
// await ZoidiumRescue.download("compatible"). Do not refresh the affected tab.
(async function rescueNodeImage(global) {
  "use strict";
  if (global.ZoidiumRescue) throw new Error("A rescue snapshot already exists. Keep it until its files are downloaded.");
  const PZ = global.PZ;
  const editor = global.CM;
  const io = PZ?.zoidiumProjectArchive;
  const files = PZ?.zoidium?.projectFiles;
  if (!editor?.project || !io?.encode || !io?.decode || !io?.checkAssets || !files?.openValidatedArchive) {
    throw new Error("Run this script in the affected Zoidium editor's main frame.");
  }
  const state = global.ZoidiumRescue = {
    capturedAt: new Date().toISOString(), repairs: [], graphWarnings: [],
    originalBlob: null, compatibleBlob: null, projectBlob: null,
    error: null, assetError: null, ready: false,
  };
  const stamp = state.capturedAt.replace(/[:.]/g, "-");
  const project = editor.project;
  // Hold the File/Blob references before yielding to rendering or other tasks.
  const assets = Object.values(project.assets?.list || {}).map(asset => ({
    name: asset?.sha256 || asset?.key, file: asset?.file,
  }));
  function downloadBlob(blob, name) {
    if (!blob?.size) throw new Error("That rescue file is not available. Inspect ZoidiumRescue.error.");
    const url = global.URL.createObjectURL(blob);
    const link = global.document.createElement("a");
    link.href = url;
    link.download = "zoidium-rescue-" + stamp + "-" + name;
    link.style.display = "none";
    global.document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 60000);
  }
  state.download = async function (kind) {
    if (kind === "original") return downloadBlob(state.originalBlob, "original.pz");
    if (kind === "json") return downloadBlob(state.projectBlob, "project.json");
    if (kind !== "compatible") throw new Error('Choose "original", "compatible", or "json".');
    if (!state.compatibleBlob) throw new Error("No validated compatible file exists. Download the original and JSON first.");
    // Recheck with the live page's own validator immediately before delivery.
    await files.openValidatedArchive(state.compatibleBlob, "save");
    return downloadBlob(state.compatibleBlob, "compatible.pz");
  };
  function scan(value, visit, path = "project", depth = 0) {
    if (depth > 128) throw new Error("The project exceeds the 128-level nesting limit.");
    if (!value || typeof value !== "object") return;
    visit(value, path);
    for (const [key, child] of Object.entries(value)) scan(child, visit, path + "." + key, depth + 1);
  }
  try {
    const original = new PZ.archive();
    // CM3 serializes the editable project, without loading or replacing it.
    await PZ.project.save(original, project);
    const entry = original.peekFile("project");
    if (!entry) throw new Error("CM3 did not serialize a project entry.");
    state.projectBlob = new Blob([await io.bytes(entry.data, "Project JSON")]);
    const document = JSON.parse(await state.projectBlob.text());
    if (!document?.assets || !document.sequence || !Array.isArray(document.media)) {
      throw new Error("The serialized project is incomplete. Keep the JSON snapshot.");
    }
    const names = new Set(original.files.map(file => file.name));
    for (const asset of assets) if (asset.name && asset.file && !names.has(asset.name)) {
      original.addFile(asset.name, asset.file);
      names.add(asset.name);
    }
    for (const file of original.files) file.data = new Blob([await io.bytes(file.data, file.name)]);
    // Keep the original serialized references even when the old validator
    // refuses them. This emergency file is NOT claimed to pass that validator.
    state.originalBlob = await io.encode(original);
    const decodedOriginal = await io.decode(state.originalBlob, PZ.archive);
    try { await io.checkAssets(decodedOriginal, document, null, "save"); }
    catch (error) { state.assetError = error.message; }
    const hasAsset = key => Object.prototype.hasOwnProperty.call(document.assets, key);
    const graphText = properties => {
      const graph = typeof properties.graph === "string" ? JSON.parse(properties.graph) : properties.graph;
      if (!graph || !Array.isArray(graph.nodes)) throw new Error("The graph cannot be inspected safely.");
      return graph;
    };
    // Inspect graph JSON too: the normal validator does not look inside strings.
    scan(document, (value, path) => {
      if (!["nodes", "pbrplus"].includes(value.type) || !value.properties) return;
      const properties = value.properties;
      let graph;
      try { graph = graphText(properties); }
      catch (error) {
        state.graphWarnings.push(path + ": " + error.message);
        return;
      }
      scan(graph, (part, graphPath) => {
        if (typeof part.asset === "string" && /^[a-f0-9]{32}(?:[a-f0-9]{32})?$/.test(part.asset) && !hasAsset(part.asset)) {
          state.graphWarnings.push(path + ".properties.graph." + graphPath + ": missing asset " + part.asset);
        }
      }, "graph");
      const key = properties.nodeImage;
      if (typeof key !== "string" || !/^[a-f0-9]{32}(?:[a-f0-9]{32})?$/.test(key) || hasAsset(key)) return;
      // Be conservative: any occurrence in the real graph prevents deletion.
      if (JSON.stringify(graph).includes(key)) {
        state.graphWarnings.push(path + ": nodeImage is still referenced by the graph; it was preserved.");
        return;
      }
      properties.nodeImage = null;
      state.repairs.push({ path: path + ".properties.nodeImage", previous: key });
    });
    if (state.assetError || state.graphWarnings.length) {
      throw new Error("Original snapshot retained. Asset or graph problems need inspection before a compatible file can be made.");
    }
    const compatible = new PZ.archive();
    for (const file of original.files) if (!["project", "zoidium.json"].includes(file.name)) {
      compatible.addFile(file.name, file.data);
    }
    compatible.addFile("project", new Blob([JSON.stringify(document)]));
    await files.sanitizeProjectArchive(compatible);
    compatible.addFileString("zoidium.json", JSON.stringify({
      version: 1, name: files.getProjectName(editor), integrity: await io.integrity(compatible),
    }));
    await files.validateProjectArchive(compatible, "save");
    const blob = await io.encode(compatible);
    await files.openValidatedArchive(blob, "save");
    state.compatibleBlob = blob;
    state.ready = true;
    global.console.log("Rescue copies are ready. The live project was not changed.", {
      originalBytes: state.originalBlob.size, compatibleBytes: blob.size,
      repairs: state.repairs, capturedAt: state.capturedAt,
    });
    global.console.log('Run ZoidiumRescue.download("original"), then await ZoidiumRescue.download("compatible") as separate commands.');
  } catch (error) {
    state.error = error.message;
    global.console.error("Rescue stopped. Keep this tab open. Available copies remain in ZoidiumRescue.", {
      error: state.error, assetError: state.assetError, graphWarnings: state.graphWarnings,
      originalBytes: state.originalBlob?.size || 0, jsonBytes: state.projectBlob?.size || 0,
    });
  }
  return state;
})(window);
