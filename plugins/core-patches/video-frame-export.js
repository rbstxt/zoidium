(function installDeterministicVideoExportPatch() {
  "use strict";

  if (!PZ.schedule || !PZ.export || PZ.schedule.prototype.__zoidiumVideoExportPatch) {
    return;
  }

  const HAVE_METADATA = 1;
  const HAVE_CURRENT_DATA = 2;
  const DEFAULT_TIMEOUT_MS = 15000;
  const FRAME_CALLBACK_GRACE_MS = 500;
  const SAME_TIME_EPSILON = 1e-7;

  const diagnostics = (PZ.videoFrameExportDiagnostics =
    PZ.videoFrameExportDiagnostics || {
      enabled: false,
      maxRecords: 2000,
      records: [],
      clear() {
        this.records.length = 0;
      },
    });

  function recordDiagnostic(record) {
    if (!diagnostics.enabled) return;
    diagnostics.records.push(record);
    if (diagnostics.records.length > diagnostics.maxRecords) {
      diagnostics.records.splice(0, diagnostics.records.length - diagnostics.maxRecords);
    }
  }

  function getSourceId(video) {
    return video.currentSrc || video.src || "";
  }

  function clampMediaTime(video, requestedTime) {
    let mediaTime = Number.isFinite(requestedTime) ? requestedTime : 0;
    mediaTime = Math.max(0, mediaTime);

    if (Number.isFinite(video.duration) && video.duration > 0) {
      mediaTime = Math.min(mediaTime, Math.max(0, video.duration - 1e-7));
    }

    return mediaTime;
  }

  function waitForMetadata(video, timeoutMs) {
    if (video.readyState >= HAVE_METADATA) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let timeoutId;

      function cleanUp() {
        clearTimeout(timeoutId);
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("error", onError);
      }

      function onLoadedMetadata() {
        cleanUp();
        resolve();
      }

      function onError() {
        cleanUp();
        reject(video.error || new Error("Unable to load video metadata."));
      }

      video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
      video.addEventListener("error", onError, { once: true });
      timeoutId = setTimeout(() => {
        cleanUp();
        reject(new Error("Timed out while loading video metadata."));
      }, timeoutMs);
    });
  }

  function seekToMediaTime(video, mediaTime, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timeoutId;

      function cleanUp() {
        clearTimeout(timeoutId);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      }

      function onSeeked() {
        cleanUp();
        resolve();
      }

      function onError() {
        cleanUp();
        reject(video.error || new Error("Video seek failed."));
      }

      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      timeoutId = setTimeout(() => {
        cleanUp();
        reject(new Error(`Timed out seeking video to ${mediaTime.toFixed(6)}s.`));
      }, timeoutMs);

      try {
        video.currentTime = mediaTime;
      } catch (error) {
        cleanUp();
        reject(error);
      }
    });
  }

  function waitForPresentedFrame(video) {
    if (typeof video.requestVideoFrameCallback !== "function") {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let callbackId = null;
      const timeoutId = setTimeout(() => {
        if (callbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(callbackId);
        }
        resolve(null);
      }, FRAME_CALLBACK_GRACE_MS);

      callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        clearTimeout(timeoutId);
        resolve(metadata || null);
      });
    });
  }

  PZ.schedule.prototype.decodeFrame = async function decodeExactExportFrame(requestedTime) {
    const video = this.el;
    if (!video) return;

    const timeoutMs = diagnostics.timeoutMs || DEFAULT_TIMEOUT_MS;
    await waitForMetadata(video, timeoutMs);

    const mediaTime = clampMediaTime(video, requestedTime);
    const sourceId = getSourceId(video);
    const state = this.__zoidiumVideoExportState || {
      sourceId: "",
      requestedTime: NaN,
      presentedMediaTime: NaN,
    };
    this.__zoidiumVideoExportState = state;

    const hasRequestedFrame =
      Math.abs(video.currentTime - mediaTime) <= SAME_TIME_EPSILON &&
      !video.seeking &&
      video.readyState >= HAVE_CURRENT_DATA;
    let presentedMetadata = null;
    if (!hasRequestedFrame) {
      const presentedFramePromise = waitForPresentedFrame(video);
      await seekToMediaTime(video, mediaTime, timeoutMs);
      presentedMetadata = await presentedFramePromise;
    }

    state.sourceId = sourceId;
    state.requestedTime = mediaTime;
    state.presentedMediaTime =
      presentedMetadata && Number.isFinite(presentedMetadata.mediaTime)
        ? presentedMetadata.mediaTime
        : video.currentTime;

    if (this.texture) this.texture.needsUpdate = true;

    recordDiagnostic({
      source: sourceId,
      requestedMediaTime: mediaTime,
      presentedMediaTime: state.presentedMediaTime,
      difference: state.presentedMediaTime - mediaTime,
      reused: hasRequestedFrame,
    });
  };

  PZ.export.prototype.getVideoFrame = async function getDeterministicVideoFrame(output) {
    if (this.framesRendered >= this.totalFrames) return 0;

    // Image export uses rate=0. In that mode frameAdvance is Infinity, so
    // calculating the first frame as 0 * Infinity produces NaN. The export
    // constructor already initializes `frame` to the requested start frame;
    // keep using that value so Single Frame Capture also prepares frame 0.
    const projectFrame = this.frame;

    this.frame = projectFrame;
    this.frameWaiting = projectFrame;
    this.framePromise = this.sequence.prepare(projectFrame, this);
    await this.framePromise;

    this.compositor.renderSequence(projectFrame);

    if (this.readPixelsWorkaround) {
      const context = this.renderer.context;
      const drawingBufferWidth = context.drawingBufferWidth;
      const drawingBufferHeight = context.drawingBufferHeight;
      this.readPixelsCtx.drawImage(
        context.canvas,
        0,
        0,
        drawingBufferWidth,
        drawingBufferHeight,
        0,
        -drawingBufferHeight,
        drawingBufferWidth,
        drawingBufferHeight,
      );
      output.set(
        this.readPixelsCtx.getImageData(
          0,
          0,
          drawingBufferWidth,
          drawingBufferHeight,
        ).data,
      );
    } else {
      const context = this.renderer.context;
      context.readPixels(
        0,
        0,
        this.params.width,
        this.params.height,
        context.RGBA,
        context.UNSIGNED_BYTE,
        output,
      );
    }

    this.framesRendered += 1;
    this.frame += this.frameAdvance;
    this.frameWaiting = -1;
    this.framePromise = null;
    return 1;
  };

  PZ.schedule.prototype.__zoidiumVideoExportPatch = true;
})();
