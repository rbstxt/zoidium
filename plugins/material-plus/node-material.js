"use strict";

const GRAPH_SOURCE = "./plugins/material-plus/graph-runtime.js";
const SURFACE_SOURCE = "./plugins/material-plus/surface-runtime.js";
let active = null;

function activate(context) {
  if (active) return;
  const PZ = context.PZ || context.window.PZ;
  const THREE = context.window.THREE;
  const doc = context.document || context.window.document;
  const graphSource = context.getAsset("text", GRAPH_SOURCE);
  const surfaceSource = context.getAsset("text", SURFACE_SOURCE);
  const nodes = new Function(graphSource)()(PZ, doc);
  const surface = new Function(surfaceSource)();
  const owned = new Map();
  const materials = new Set();
  const ids = new WeakMap();
  let nextId = 0;
  const previous = context.window.ZoidiumMaterialPlus;
  context.lifecycle.onDispose(() => {
    for (const material of materials) material._surfaceDispose?.();
    for (const [id, entry] of owned) if (PZ.material.fnList[id] === entry.factory) {
      if (entry.previous) PZ.material.fnList[id] = entry.previous;
      else delete PZ.material.fnList[id];
    }
    if (context.window.ZoidiumMaterialPlus === api) {
      if (previous) context.window.ZoidiumMaterialPlus = previous;
      else delete context.window.ZoidiumMaterialPlus;
    }
    active = null;
  });

  function install(material, nodeMode) {
    material._nodeBaseMap = nodeMode;
    const donor = { properties: { addAll(defs) { donor.defs = defs; } } };
    surface.call(donor, PZ, THREE, nodes, doc);
    const excluded = new Set(["load", "update", "unload", "prepare", "toJSON", "properties", "defs", "defaultName", "props"]);
    for (const [key, value] of Object.entries(donor)) if (!excluded.has(key)) material[key] = value;
    const extra = {};
    for (const [key, def] of Object.entries(donor.defs)) if (!material.properties[key]) extra[key] = def;
    extra.nodeImage = { name: "Selected node image", visible: false, type: PZ.property.type.ASSET, assetType: PZ.asset.type.IMAGE, accept: "image/*", value: null, changed: function () {
      const owner = this.parentObject;
      if (!owner._selectedImageNode) return;
      const graph = nodes.parse(owner.properties.graph.get());
      const node = graph.nodes.find(n => n.id === owner._selectedImageNode);
      if (!node) return;
      node.params.asset = this.value || "";
      const CM = context.window.CM;
      const property = owner.properties.graph;
      const value = JSON.stringify(graph);
      if (CM?.history?.operation) (CM.propertyOps || new PZ.ui.properties(CM)).setValue({ property: property.getAddress(), frame: 0, value, oldValue: property.get() });
      else property.set(value);
    } };
    extra.useNodeGraph = { name: "Use node graph", type: PZ.property.type.OPTION, items: "off;on", value: nodeMode ? 1 : 0 };
    if (nodeMode) {
      extra.graph.value = JSON.stringify({ ...nodes.defaultGraph(), schemaVersion: 1 });
      extra.bumpStrength.value = 1;
    }
    material.pzLoading = true;
    material.properties.addAll(extra);
    material.pzLoading = false;
    material._surfaceInit = () => {
      donor.load.call(material, { surfaceOnly: true });
      material._surfaceReady = true;
    };
    // Graph maps take precedence only while enabled; disconnected channels restore native maps.
    material.bindGraphChannel = function (slot) {
      const map = { color: null, luminance: "emissiveMap", roughness: "roughnessMap", metalness: "metalnessMap", bump: "bumpMap", opacity: "alphaMap" }[slot];
      const texture = this.pzGraphTextures[slot];
      if (slot === "color") {
        this.pzUniforms.uPzGraphColor.value = nodeMode ? null : texture;
        return nodeMode ? this.pzAssignMap("map", texture || this.pzTextures.texture) : false;
      }
      if (slot === "bump" && this.properties.bumpNoise.get() === 1) return this.pzAssignMap(map, this.pzNoiseTexture);
      return this.pzAssignMap(map, texture || this._zoidiumTextureSlots?.[map]?.texture);
    };
    material.refreshBindings = function () {
      for (const slot of Object.keys(this.pzGraphTextures)) if (this.bindGraphChannel(slot)) this.threeObj.needsUpdate = true;
      this.pzUniforms.uPzAOMap.value = this.pzTextures.ao || null;
      this.updateDefines();
    };
    let environmentSource = null;
    if (nodeMode) material.initReflection = function () {
      const enabled = this.properties.reflection.get() === 1 || this.properties.reflReflection.get() === 1;
      const source = enabled ? this.parentLayer?.envMap : null;
      if (source === environmentSource) return;
      environmentSource?.releaseTexture?.();
      environmentSource = source || null;
      this.threeObj.envMap = environmentSource?.getTexture?.() || null;
      this.threeObj.needsUpdate = true;
    };
    let worker = null;
    let workerUrl = null;
    let request = 0;
    let latestKey = null;
    let pending = null;
    let disposed = false;
    let refinement = null;
    let preparing = false;
    let prepareQueue = Promise.resolve();
    let lastIdentity = null;
    const clock = () => context.window.performance?.now?.() ?? Date.now();
    const trace = (event, job, extra = {}) => material._surfaceBakeTrace?.({ event, key: job.key, size: job.size, time: job.time, at: clock(), ...extra });
    // One worker per material, one active bake and one replaceable pending request.
    function ensureWorker() {
      if (!worker && context.window.Worker && context.window.Blob && context.window.URL?.createObjectURL) {
        const code = `const nodes = new Function(${JSON.stringify(graphSource)})()({}, null); onmessage = e => { const {id,graph,size,time,images}=e.data; try { const started=performance.now(); const outputs=nodes.evaluate(graph,size,time,{images}); postMessage({id,outputs,duration:performance.now()-started}, [...new Set(Object.values(outputs).filter(p => ArrayBuffer.isView(p)).map(p => p.buffer))]); } catch(error) { postMessage({id,error:error.message}); } };`;
        workerUrl = context.window.URL.createObjectURL(new context.window.Blob([code], { type: "text/javascript" }));
        worker = new context.window.Worker(workerUrl);
      }
    }
    function apply(outputs, size) {
      if (outputs.__fresnel) {
        material.pzFresnel = outputs.__fresnel;
        material.pzUniforms.uPzFresnelColor.value.set(...material.pzFresnel.color);
        material.pzUniforms.uPzFresnelPower.value = material.pzFresnel.power;
        material.pzUniforms.uPzFresnelMix.value = material.pzFresnel.mix;
      }
      for (const slot of Object.keys(material.pzGraphTextures)) {
        const pixels = outputs[slot];
        let canvas = null;
        if (pixels) {
          canvas = material.pzGraphTextures[slot]?.image || doc.createElement("canvas");
          if (canvas.width !== size || canvas.height !== size) canvas.width = canvas.height = size;
          const ctx = canvas.getContext("2d");
          const texture = material.pzGraphTextures[slot];
          const image = texture?._graphPixels?.width === size ? texture._graphPixels : ctx.createImageData(size, size);
          image.data.set(pixels);
          ctx.putImageData(image, 0, 0);
          canvas._graphPixels = image;
        }
        material.setGraphChannel(slot, canvas, true);
        const texture = material.pzGraphTextures[slot];
        if (texture) { texture._graphPixels = canvas._graphPixels; material.applyWrap(texture); }
      }
      const transparent = !!material.pzGraphTextures.opacity || material.properties.transparent.get() === 1;
      if (material.threeObj.transparent !== transparent) { material.threeObj.transparent = transparent; material.threeObj.needsUpdate = true; }
      if (nodeMode) {
        const lit = material.pzGraphTextures.luminance ? 1 : 0;
        material.threeObj.emissive.setRGB(lit, lit, lit);
      }
      material.updateDefines();
    }
    const pure = new Function(graphSource)()({}, null);
    let cancelBake = null;
    function run(job) {
      ensureWorker();
      const id = ++request;
      trace("started", job);
      return new Promise((resolve, reject) => {
        if (!worker) {
          try { resolve(pure.evaluate(job.graph, job.size, job.time, { images: job.images })); } catch (error) { reject(error); }
          return;
        }
        cancelBake = () => { cancelBake = null; resolve({}); };
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          cancelBake = null;
          trace("finished", job, { duration: data.duration });
          if (data.error) reject(new Error(data.error)); else resolve(data.outputs);
        };
        worker.onerror = (event) => { cancelBake = null; reject(new Error(event.message || "Material+ graph worker failed.")); };
        worker.postMessage({ ...job, id });
      });
    }
    async function drain() {
      while (pending && !disposed) {
        const job = pending;
        pending = null;
        let outputs;
        try { outputs = await run(job); }
        catch (error) { if (latestKey === job.key) throw error; else continue; }
        // A completed preview remains useful even when a newer frame is pending.
        // Disabled graphs and export preparations must never receive stale maps.
        if (!disposed && material.properties.useNodeGraph.get() === 1 && (!preparing || latestKey === job.key)) {
          apply(outputs, job.size);
          material.pzBakeKey = job.key;
          trace("applied", job);
          context.window.CM?.viewport?.requestRender?.();
        }
      }
    }
    let running = null;
    function startDrain() {
      if (running || !pending || disposed) return;
      material._surfaceError = null;
      running = drain().catch(error => {
        material._surfaceError = error;
        console.error("Material+ graph bake failed", error);
      }).finally(() => {
        running = null;
        startDrain();
      });
    }
    material.bakeGraph = function () { if (this._surfaceReady) this._surfaceUpdate(this._surfaceFrame || 0); };
    material._surfaceUpdate = function (frame, exact = false) {
      if (!this._surfaceReady || disposed || (preparing && !exact)) return;
      this._surfaceFrame = frame;
      const enabled = this.properties.useNodeGraph.get() === 1;
      const graph = nodes.parse(enabled ? this.properties.graph.get(frame) : { nodes: [], links: [] });
      const chosenSize = [128, 256, 512, 1024, 2048][this.properties.bakeResolution.get()] || 256;
      const size = exact ? chosenSize : Math.min(chosenSize, 128);
      const rate = Number(this.parentProject?.sequence?.properties.rate?.get()) || 30;
      const bakeFrame = nodes.isAnimated(graph, this) ? frame : 0;
      const dependencies = { rate, images: nodes.dependencySignature(graph, this) };
      const identity = nodes.cacheKey(graph, chosenSize, bakeFrame, dependencies);
      const key = nodes.cacheKey(graph, size, bakeFrame, dependencies);
      this.pzGraph = graph;
      this.pzFresnel = enabled ? (this.pzBakeKey === key ? this.pzFresnel : nodes.fresnelSettings(graph, frame / rate)) : null;
      if (this.pzFresnel) {
        this.pzUniforms.uPzFresnelColor.value.set(...this.pzFresnel.color);
        this.pzUniforms.uPzFresnelPower.value = this.pzFresnel.power;
        this.pzUniforms.uPzFresnelMix.value = this.pzFresnel.mix;
      }
      this.updateDefines();
      // Update the shared shader parameters without starting a donor bake.
      const oldKey = this.pzBakeKey;
      this.pzBakeKey = this.graphBakeKey(frame / rate);
      donor.update.call(this, frame);
      this.pzBakeKey = oldKey;
      if (nodeMode) {
        this.initReflection();
        this.threeObj.roughness = this.properties.roughness.get(frame);
        this.threeObj.metalness = this.properties.metalness.get(frame);
        this.threeObj.envMapIntensity = this.properties.reflectionBrightness.get(frame);
        this.threeObj.emissiveIntensity = this.properties.luminanceBrightness.get(frame);
        const lit = this.pzGraphTextures.luminance ? 1 : 0;
        this.threeObj.emissive.setRGB(lit, lit, lit);
      }
      if (!exact && lastIdentity === identity) return;
      lastIdentity = identity;
      if (refinement !== null) clearTimeout(refinement);
      refinement = null;
      if (!running && !pending && (this.pzBakeKey === key || this.pzBakeKey === identity)) { latestKey = this.pzBakeKey; return; }
      if (latestKey === key) return;
      latestKey = key;
      if (!enabled) {
        pending = null;
        this._surfaceAssets = Promise.resolve();
        this._surfaceError = null;
        apply({}, size);
        this.pzBakeKey = key;
        return;
      }
      const queue = () => {
        if (disposed || latestKey !== key) return;
        pending = { key, graph, size, time: frame / rate, images: nodes.imageBuffers(graph, size, this, frame / rate) };
        trace("requested", pending);
        startDrain();
      };
      if (!exact && size < chosenSize) {
        const refine = () => {
          refinement = null;
          if (disposed || preparing || lastIdentity !== identity) return;
          // A slow viewport can pause updates for longer than the idle delay.
          // Keep playback at preview size even in that case.
          if (context.window.CM?.playback?.speed) { refinement = setTimeout(refine, 250); return; }
          this._surfaceUpdate(frame, true);
        };
        refinement = setTimeout(refine, 180);
      }
      // Asset loading always completes before a bake enters the worker.
      this._surfaceAssets = nodes.prepareImages(graph, this).then(queue).catch(error => {
        if (latestKey === key) {
          this._surfaceError = error;
          console.error("Material+ could not load a graph project image", error);
        }
      });
    };
    material._surfacePrepare = function (frame) {
      // Export calls are serialized and protected from interactive updates.
      const prepare = async () => {
        if (disposed) return;
        preparing = true;
        try {
          const graph = nodes.parse(this.properties.useNodeGraph.get() === 1 ? this.properties.graph.get(frame) : { nodes: [], links: [] });
          await nodes.prepareImages(graph, this);
          if (disposed) return;
          this._surfaceUpdate(frame, true);
          await this._surfaceAssets;
          while (running) await running;
          if (disposed) return;
          if (this._surfaceError) throw this._surfaceError;
          await Promise.all(Object.values(this.pzImages || {}).map(image => image?.loading));
        } finally { preparing = false; }
      };
      const result = prepareQueue.then(prepare);
      prepareQueue = result.catch(() => {});
      return result;
    };
    material._surfaceDispose = function () {
      if (disposed) return;
      disposed = true;
      if (refinement !== null) clearTimeout(refinement);
      pending = null;
      cancelBake?.();
      worker?.terminate();
      if (workerUrl) context.window.URL.revokeObjectURL(workerUrl);
      nodes.releaseImages(this);
      for (const texture of Object.values(this.pzGraphTextures || {})) texture?.dispose();
      for (const key of Object.keys(this.pzImages || {})) {
        if (this.pzImages[key]) this.parentProject.assets.unload(this.pzImages[key]);
        this.pzTextures[key]?.dispose();
      }
      environmentSource?.releaseTexture?.();
      environmentSource = null;
      this.pzNoiseTexture?.dispose();
      this.pzRampTexture?.dispose();
      materials.delete(this);
    };
    materials.add(material);
  }

  function nodeFactory() {
    const material = this;
    material.defaultName = "Node Material";
    install(material, true);
    material.properties.addAll({
      reflectionBrightness: { name: "Reflection brightness", dynamic: true, type: PZ.property.type.NUMBER, value: 1, min: 0, max: 2, step: 0.01 },
      luminanceBrightness: { name: "Luminance brightness", dynamic: true, type: PZ.property.type.NUMBER, value: 1, min: 0, max: 4, step: 0.01 },
    });
    material.load = function (data) {
      this.threeObj = new THREE.MeshPhysicalMaterial();
      this._surfaceInit();
      this.pzLoading = true;
      try { this.properties.load(data?.properties); } finally { this.pzLoading = false; }
      this.properties.graph.value = JSON.stringify(nodes.parse(this.properties.graph.get()));
      this.syncRamp();
      for (const [key, slot] of [["texture", "texture"], ["normalMap", "normalMap"], ["aoTexture", "ao"]]) {
        const value = this.properties[key].get();
        if (value) this.setImage(slot, value);
      }
      this.threeObj.map = this.pzTextures.texture || null;
      this.threeObj.normalMap = this.pzTextures.normalMap || null;
      this.refreshAO();
      this.updateBumpMap();
      this.initReflection();
      this.threeObj.transparent = this.properties.transparent.get() === 1;
      this.threeObj.side = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide][this.properties.side.get()];
      this.update(0);
      PZ.zoidium?.trackPluginMaterial?.(this, { ...context.plugin, material: "nodes", materialName: "Node Material", compatibility: "incompatible" }, false);
    };
    material.update = function (frame) { this._surfaceUpdate(frame); };
    material.prepare = function (frame) { return this._surfacePrepare(frame); };
    material.toJSON = function () { return { type: this.type, properties: this.properties }; };
    material.unload = function () { this._surfaceDispose(); PZ.zoidium?.untrackPluginMaterial?.(this); this.threeObj?.dispose(); };
  }
  const api = { install, nodes };
  context.window.ZoidiumMaterialPlus = api;
  const factory = Promise.resolve(nodeFactory);
  factory._zoidiumMaterialMode = "native";
  owned.set("nodes", { factory, previous: PZ.material.fnList.nodes });
  PZ.material.fnList.nodes = factory;

  function editorGraph(material) {
    const graph = nodes.parse(material.properties.graph.get());
    return { schemaVersion: 1, nodes: graph.nodes.map(n => ({ ...n, params: Object.fromEntries(Object.entries(n.params).map(([k, v]) => [k, Array.isArray(v) ? "#" + v.map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("") : v])) })), links: graph.links.map((l, i) => ({ id: "l" + i, from: { node: l.from, port: l.fromPort }, to: { node: l.to, port: l.toPort } })) };
  }
  function openEditor(material) {
    if (!ids.has(material)) ids.set(material, ++nextId);
    const CM = context.window.CM;
    return context.ui.openWindow({ id: "nodes:" + ids.get(material), title: "Node Editor", width: 1000, height: 620, placement: "center", maximizable: true, persistKey: "node-editor", isValid: () => materials.has(material), mount(body) {
      body.style.display = "flex";
      const host = doc.createElement("div"); host.style.cssText = "flex:1;min-width:0;height:100%";
      const strip = doc.createElement("div"); strip.style.cssText = "width:140px;padding:8px;overflow:auto";
      const canvas = doc.createElement("canvas"); canvas.width = canvas.height = 128; canvas.style.width = "128px";
      // The canvas shows the graph's Color result; it is not an input. Image and
      // Texture nodes take their picture from the row shown below it on selection.
      const caption = doc.createElement("div"); caption.textContent = "Color output";
      caption.style.cssText = "margin:0 0 4px;color:var(--zui-text-muted);font-size:11px";
      const note = doc.createElement("div"); note.textContent = "Select an Image or Texture node to choose its picture.";
      note.style.cssText = "margin:6px 0 0;color:var(--zui-text-faint);font-size:11px;line-height:1.35";
      const previewChildren = [caption, canvas, note];
      strip.append(...previewChildren);
      body.append(host, strip);
      const registry = {};
      for (const [id, def] of Object.entries(nodes.types)) registry[id] = {
        title: def.name, category: def.category, hidden: def.hidden, hint: def.hint, ...(id === "output" ? { maxInstances: 1, deletable: false } : {}),
        inputs: def.inputs.map(p => ({ id: p.key, label: p.name, type: p.type === "number" || (id === "math" && ["a", "b"].includes(p.key)) ? "float" : p.key === "uv" ? "vector" : ["t", "roughness", "metalness", "bump", "opacity", "fresnel"].includes(p.key) ? "float" : "color" })),
        outputs: def.outputs.map(p => ({ id: p.key, label: p.name, type: ["projection", "uvw"].includes(id) ? "vector" : p.name === "Value" ? "float" : "color" })),
        params: def.params.filter(p => p.type !== "asset").map(p => ({ id: p.key, label: p.name, socket: ["number", "color"].includes(p.type), control: p.type === "option" ? "select" : p.type, min: p.min, max: p.max, step: p.step, default: p.type === "color" ? "#" + p.value.map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("") : p.value, options: p.items?.map((label, value) => ({ label, value })) })),
      };
      function commit(graph) {
        const previous = new Map(nodes.parse(material.properties.graph.get()).nodes.map(n => [n.id, n]));
        for (const n of graph.nodes) for (const p of nodes.types[n.type]?.params || []) if (p.type === "color" && typeof n.params[p.key] === "string") {
          const color = n.params[p.key];
          const old = previous.get(n.id)?.params[p.key] || p.value;
          const oldHex = "#" + old.map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
          n.params[p.key] = color.toLowerCase() === oldHex ? old.slice() : [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
        }
        const value = JSON.stringify(nodes.parse(graph));
        const property = material.properties.graph;
        if (value === property.get()) return;
        CM.history.startOperation();
        try { (CM.propertyOps || new PZ.ui.properties(CM)).setValue({ property: property.getAddress(), frame: 0, value, oldValue: property.get() }); }
        finally { CM.history.finishOperation(); }
      }
      let editorDisposed = false;
      const editor = context.window.ZoidiumUI.nodeEditor({ nodeTypes: registry, canConnect: () => true, graph: editorGraph(material), onChange: commit, onSelect(selected) {
        const selectedId = selected[0];
        // The host selects a newly added node before committing the gesture.
        Promise.resolve().then(() => {
          if (editorDisposed) return;
          assetView?.dispose(); assetView = null;
          material._selectedImageNode = null;
          material.properties.nodeImage.definition.visible = false;
          strip.replaceChildren(...previewChildren);
          const graph = nodes.parse(material.properties.graph.get());
          const node = graph.nodes.find(n => n.id === selectedId && ["image", "texture"].includes(n.type));
          if (!node) return;
          material.properties.nodeImage.definition.visible = true;
          assetView = context.ui.properties({ target: material, keys: ["nodeImage"] });
          material._selectedImageNode = node.id;
          material.properties.nodeImage.value = node.params.asset || null;
          assetView.refresh();
          strip.replaceChildren(caption, canvas, assetView.element);
        });
      } });
      let assetView = null;
      const syncGraph = () => editor.setGraph(editorGraph(material));
      material.properties.graph.onChanged.watch(syncGraph);
      host.appendChild(editor.element);
      let fitRequest = context.window.requestAnimationFrame(() => {
        fitRequest = context.window.requestAnimationFrame(() => editor.frameAll());
      });
      const timer = setInterval(() => {
        const image = material.pzGraphTextures?.color?.image;
        if (image) canvas.getContext("2d").drawImage(image, 0, 0, 128, 128);
      }, 250);
      return () => { editorDisposed = true; clearInterval(timer); context.window.cancelAnimationFrame(fitRequest); material._selectedImageNode = null; material.properties.nodeImage.definition.visible = false; material.properties.graph.onChanged.unwatch(syncGraph); assetView?.dispose(); editor.destroy(); };
    } });
  }
  context.ui?.registerEditor({ title: "Node Editor", match: target => target?.type === "nodes" || target?.type === "pbrplus", open: openEditor });
  active = api;
}

module.exports = { activate };
