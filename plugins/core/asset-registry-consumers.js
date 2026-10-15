(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  parts.rebuildConsumers = async function (PZ, project, asset, kind) {
    const jobs = [];
    project.sequence?.traverse?.(node => {
      if (node.font?.asset === asset) { node.fontNeedsUpdate = true; node.geometryNeedsUpdate = true; node.shapesNeedUpdate = true; }
      if (node.customGeometry?.asset === asset) node.generatePresetGeometry?.();
      if (node.lut?.asset === asset && node.lut.data.lut) {
        node.pass?.uniforms?.tLUT?.value?.dispose?.();
        node.updateTexture?.(node.lut.data.lut);
      }
      for (const [wrapperKey, field] of [["vertShader", "vertexShader"], ["fragShader", "fragmentShader"], ["_vertShader", "vertexShader"]]) {
        const wrapper = node[wrapperKey];
        if (wrapper?.asset !== asset) continue;
        for (const material of [node.pass?.material, node.material, node.threeObj, node.composite?.quad?.material]) {
          if (!material || !(field in material)) continue;
          material[field] = wrapper.data.shader; material.needsUpdate = true;
        }
      }
    });
    if (kind === "audio" || kind === "video") {
      global.ZoidiumVideoDecodeStatus?.set?.(asset, "loading");
      // Rebind existing schedules in place. Never rebuild clips or refcounts.
      for (const schedule of [...project.sequence?.videoSchedules || [], ...project.sequence?.audioSchedules || []]) {
        if (!schedule.items?.some(item => item.media === asset) || !schedule.el) continue;
        const element = schedule.el;
        const current = schedule.currentItem;
        if (current?.media !== asset) continue;
        const time = element.currentTime;
        delete schedule.__zoidiumVideoExportState;
        schedule.lastFrame = -1;
        jobs.push(new Promise((resolve, reject) => {
          const finish = error => {
            element.removeEventListener("loadeddata", ready); element.removeEventListener("error", failed);
            global.clearTimeout(timer);
            if (error) reject(error); else resolve();
          };
          const ready = () => {
            asset.length = element.duration;
            element.currentTime = time;
            if (schedule.texture) schedule.texture.needsUpdate = true;
            finish();
          };
          const failed = () => finish(new Error("This browser cannot decode the " + kind + "."));
          const timer = global.setTimeout(() => finish(new Error("The media decoder timed out.")), 30000);
          element.addEventListener("loadeddata", ready); element.addEventListener("error", failed);
          element.src = asset.url; element.load();
        }));
      }
      if (!jobs.length && global.document) {
        const element = global.document.createElement(kind === "video" ? "video" : "audio");
        jobs.push(new Promise((resolve, reject) => {
          const finish = error => {
            global.clearTimeout(timer); element.onloadedmetadata = element.onerror = null;
            element.removeAttribute("src"); element.load();
            error ? reject(error) : resolve();
          };
          const timer = global.setTimeout(() => finish(new Error("The media decoder timed out.")), 30000);
          element.onloadedmetadata = () => { asset.length = element.duration; finish(); };
          element.onerror = () => finish(new Error("This browser cannot decode the " + kind + "."));
          element.preload = "metadata"; element.src = asset.url;
        }));
      }
    }
    try {
      await Promise.all(jobs);
      if (kind === "video" || kind === "audio") global.ZoidiumVideoDecodeStatus?.set?.(asset, "ready");
    } catch (error) {
      global.ZoidiumVideoDecodeStatus?.set?.(asset, "failed");
      throw error;
    }
  };
})(globalThis);
