"use strict";

let activeJobs = 0;

function install(context) {
  const PZ = context.PZ || globalThis.PZ;
  const scope = globalThis;
  const load = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/mp4-export/" });
  const { MP4_FORMAT, isMp4 } = load("./export-math.js");
  const { createJob } = load("./render.js");
  const prototype = PZ.ui.export.device.prototype;
  // The page owns its restoration record. The activation only keeps weak
  // page references so closed dialogs and their devices can be collected.
  const owned = new Set();
  const records = new WeakMap();
  const collected = new FinalizationRegistry(ref => owned.delete(ref));
  const qualityHint = "MP4 quality uses the Bitrate setting. Quality presets apply to MKV/WebM.";
  function patch(key, wrap) {
    const original = prototype[key];
    const replacement = wrap(original);
    context.lifecycle.onDispose(() => {
      if (prototype[key] === replacement) prototype[key] = original;
    });
    prototype[key] = replacement;
  }
  context.lifecycle.onDispose(() => {
    for (const ref of owned) {
      collected.unregister(ref);
      const page = ref.deref();
      const record = page && records.get(page);
      if (!record) continue;
      records.delete(page);
      const { select, change, wrapped, option, owner, restoreQuality } = record;
      if (select.onchange === wrapped) select.onchange = change;
      if (isMp4(owner.params)) { owner.params.format = owner.DEVICE_FORMATS[0]; select.selectedIndex = 0; }
      option.remove();
      restoreQuality();
    }
    owned.clear();
  });
  patch("createOptionsPage", (original) => function mp4OptionsPage() {
    const page = original.apply(this, arguments);
    const select = Array.from(page.querySelectorAll("select")).find(
      (element) => Array.from(element.options).some((option) => option.text.includes(".mkv")),
    );
    if (!select) return page;
    const option = document.createElement("option");
    option.text = ".mp4 (H.264 / AAC or Opus)";
    option.value = String(select.options.length);
    const index = select.options.length;
    select.appendChild(option);
    const owner = this;
    const change = select.onchange;
    const quality = Array.from(page.querySelectorAll("select")).find(
      (element) => element.options.length === 5 && /^very low/.test(element.options[0].text),
    );
    const qualityDisabled = quality?.disabled;
    const qualityTitle = quality?.title;
    function restoreQuality() {
      if (quality?.title === qualityHint) {
        quality.disabled = qualityDisabled;
        quality.title = qualityTitle;
      }
    }
    const wrapped = function mp4FormatChange(event) {
      if (select.selectedIndex === index) {
        owner.params.format = MP4_FORMAT;
        if (quality) { quality.disabled = true; quality.title = qualityHint; }
      } else {
        restoreQuality();
        return change?.call(this, event);
      }
    };
    records.set(page, { select, change, wrapped, option, owner, restoreQuality });
    const ref = new WeakRef(page);
    owned.add(ref);
    collected.register(page, ref, ref);
    select.onchange = wrapped;
    return page;
  });
  patch("createProgressPage", (original) => function mp4ProgressPage() {
    if (!isMp4(this.params)) return original.apply(this, arguments);
    const owner = this;
    const controls = PZ.ui.controls.legacy;
    let cancelled = false, settled = false, job = null, timer = null;
    const page = this.export.createPage("Rendering MP4...", true, () => {
      if (!settled) { cancelled = true; job?.cancel(); }
      else owner.renderCleanUp();
      clearInterval(timer);
      return true;
    });
    page.appendChild(controls.generateDescription({
      content: "Your MP4 is being rendered. Audio uses AAC when available, otherwise Opus. Opus in MP4 requires a compatible player.",
    }));
    this.editor.enabled = false;
    this.editor.playback.enabled = false;
    activeJobs++;
    // Begin after returning the page to CM3, including failures constructing
    // the renderer or loading the bundled writer.
    Promise.resolve().then(async () => {
      let exporter = null;
      const started = performance.now();
      try {
        if (cancelled) return;
        exporter = new PZ.export(owner.editor.sequence, owner.params);
        job = createJob(scope, PZ, exporter, () => load("./vendor/mediabunny-1.62.0.cjs"));
        const progress = page.appendChild(controls.generateProgressbar({
          get() { return exporter.framesRendered / exporter.totalFrames * 100; },
        }, owner));
        const time = page.appendChild(controls.generateValue({
          title: "Time left:",
          get() {
            if (!exporter.framesRendered) return "Preparing...";
            const seconds = (performance.now() - started) / 1000 / exporter.framesRendered *
              (exporter.totalFrames - exporter.framesRendered);
            return seconds > 0 ? PZ.ui.controls.getTimeString(seconds) : "Finalizing...";
          },
        }, owner));
        timer = setInterval(() => { progress.pz_update(); time.pz_update(); }, 250);
        const blob = await job.run();
        if (cancelled) return;
        PZ.downloadBlob = blob;
        PZ.downloadFilename = "video.mp4";
        settled = true;
        owner.export.navigate(owner.createFinishedPage());
      } catch (error) {
        if (cancelled) return;
        settled = true;
        // Native error pages interpolate HTML. Keep encoder messages as text.
        const failed = owner.export.createPage("Render error", true, () => { owner.renderCleanUp(); return true; });
        const description = controls.generateDescription({ content: "" });
        description.textContent = "MP4 export failed. " + (error?.message || "Try a smaller size or MKV/WebM.");
        failed.appendChild(description);
        owner.export.navigate(failed);
      } finally {
        clearInterval(timer);
        exporter?.unload();
        activeJobs--;
        owner.editor.enabled = true;
        owner.editor.playback.enabled = true;
        settled = true;
      }
    });
    return page;
  });
  patch("createFinishedPage", (original) => function mp4FinishedPage() {
    if (!isMp4(this.params)) return original.apply(this, arguments);
    const page = this.export.createPage("Render complete", true, () => { this.renderCleanUp(); return true; });
    const controls = PZ.ui.controls.legacy;
    page.appendChild(controls.generateDescription({ content: "Your MP4 is finished. Click below to download." }));
    const button = controls.generateButton({ title: "Download your video", clickfn() {} }, this);
    const manager = scope.ZoidiumDownloads;
    if (!manager) throw new Error("The download adapter is unavailable. Reload the editor and try again.");
    const artifact = manager.capture(PZ.downloadBlob, "video.mp4");
    manager.bind(button, artifact);
    page.appendChild(button);
    return page;
  });
}

module.exports = {
  activate: install,
  isInUse() { return activeJobs > 0; },
  inUseReason() { return "Finish or cancel the MP4 export before disabling MP4 Export."; },
};
