(function (global) {
  "use strict";

  const kinds = new Map([
    ["png", "image"], ["webp", "image"],
    ["webm_vp8_opus", "video"], ["mkv_vp8_opus", "video"],
  ]);

  function alphaFormat(params) {
    return params?.transparentBackground === true ? kinds.get(params.format) || null : null;
  }

  function webpEncoding(document) {
    try { return document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp;"); }
    catch (_error) { return false; }
  }

  function formatReason(format, webp, video) {
    if (format === "png" || format === "webp" && webp || kinds.get(format) === "video" && video?.status === true) {
      return "";
    }
    if (format === "jpg") return "JPEG has no alpha channel.";
    if (format === "mp4_h264") return "H.264 MP4 has no alpha channel.";
    if (format === "webp") return "WebP encoding is unavailable in this browser.";
    if (kinds.get(format) === "video") {
      if (!video) return "Enable MP4 Export to use transparent video.";
      if (video.status === undefined) return "Checking for VP8 alpha encoding.";
      return "VP8 alpha encoding is unavailable in this browser.";
    }
    return "This format has no alpha channel.";
  }

  function installAlphaOption(page, owner, { document, webp, video }) {
    const select = Array.from(page.querySelectorAll("select")).find(element =>
      Array.from(element.options).some(option => /^\.(?:png|mkv)\b/i.test(option.text)));
    const formatRow = select?.closest(".proprow");
    if (!formatRow?.parentElement) return;

    const params = owner.params;
    const label = document.createElement("label");
    label.className = "proprow noselect";
    label.style.gap = "8px";
    label.style.justifyContent = "start";
    label.style.alignItems = "center";
    const input = document.createElement("input");
    input.type = "checkbox";
    const text = document.createElement("span");
    text.textContent = "Transparent background";
    label.append(input, text);
    const hint = document.createElement("div");
    hint.className = "proprow";
    hint.setAttribute("role", "status");
    hint.style.gridTemplateColumns = "minmax(0, 1fr)";

    function update() {
      const format = params.format;
      const audioOnly = format === "audio_wav" || format === "audio_m4a";
      const provider = audioOnly ? undefined : video();
      const reason = audioOnly ? "" : formatReason(format, format === "webp" && webp(), provider);
      input.disabled = audioOnly || Boolean(reason);
      label.style.display = input.disabled ? "none" : "flex";
      hint.style.display = reason ? "" : "none";
      hint.textContent = reason;
      if (input.disabled) delete params.transparentBackground;
      input.checked = params.transparentBackground === true;
      if (kinds.get(format) === "video" && provider?.status === undefined && provider?.probe) {
        provider.probe().then(update);
      }
    }
    input.addEventListener("change", () => {
      if (!input.disabled && input.checked) params.transparentBackground = true;
      else delete params.transparentBackground;
    });
    select.addEventListener("change", update);
    page.__zoidiumRefreshAlphaOption = update;
    const next = formatRow.nextSibling;
    formatRow.parentElement.insertBefore(label, next);
    formatRow.parentElement.insertBefore(hint, next);
    update();
  }

  function installAlphaImageEncoder(encoder) {
    if (typeof encoder?.encode !== "function") return;
    const original = encoder.encode;
    encoder.encode = function (exporter, params) {
      if (alphaFormat(params) !== "image") return original.apply(this, arguments);
      return encodeTransparentImage(encoder, exporter, params);
    };
  }

  async function encodeTransparentImage(encoder, exporter, params) {
    // toBlob reads the premultiplied WebGL canvas and writes straight alpha.
    await exporter.getVideoFrame();
    exporter.checkExportContext("before image encoding");
    const blob = await encoder.canvasToBlob(exporter.renderer.domElement, params.format, params.quality);
    // The native progress page can be closed while toBlob is in flight.
    if (exporter.__zoidiumExportDisposed) return new Promise(() => {});
    exporter.checkExportContext("after image encoding");
    if (blob?.type !== "image/" + params.format) {
      throw new Error(params.format.toUpperCase() + " encoding did not produce an image in the requested format.");
    }
    exporter.__zoidiumPendingFrame = null;
    return blob;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { alphaFormat, installAlphaOption, installAlphaImageEncoder };
    return;
  }

  const { PZ } = global;
  PZ.zoidium ||= {};
  PZ.zoidium.alphaFormat = alphaFormat;
  installAlphaImageEncoder(PZ.imageEncoder);
  let webp;
  for (const type of ["frame", "device"]) {
    const prototype = PZ.ui?.export?.[type]?.prototype;
    const original = prototype?.createOptionsPage;
    if (!original) continue;
    prototype.createOptionsPage = function () {
      const page = original.apply(this, arguments);
      if (page && this.params) installAlphaOption(page, this, {
        document: page.ownerDocument,
        webp: () => (webp ??= webpEncoding(page.ownerDocument)),
        video: () => PZ.zoidium.alphaVideo,
      });
      return page;
    };
  }
})(globalThis);
