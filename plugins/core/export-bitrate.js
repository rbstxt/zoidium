(function installExportBitratePatch(global) {
  "use strict";

  // CM3 derives the device-render video bitrate only from the output size and
  // frame rate ((w/640)*(h/360) Mbps, x1.5 above 30 fps); the Quality choice
  // changes only crf/speed. The Bitrate option multiplies that target. At 1x
  // the native encode call is passed through untouched. A bare multiplier does
  // not tell the user what the export will request, so every label also states
  // the target the choice produces at the current resolution and frame rate.
  const PATCH_MARKER = "__zoidiumExportBitratePatch";
  const ORIGINAL_MARKER = "__zoidiumExportBitrateOriginal";
  const IO_SERIALIZATION_KEY = "zoidiumIoSerialization";
  const IO_SERIALIZATION_ORIGINAL = "__zoidiumIoSerializationOriginal";
  const BITRATE_SCALES = [1, 2, 4, 8];
  const REFRESH_KEY = "__zoidiumRefreshBitrateLabels";
  const RETRY_DELAY_MS = 100;
  const MAX_ATTEMPTS = 200;

  // CM3 rebuilds the device params every time the export dialog opens, so the
  // choice has to live outside them. It lasts for the page session: a reload
  // starts again at 1x.
  let rememberedBitrateScale = 1;

  function resetBitrateMemory() {
    rememberedBitrateScale = 1;
  }

  function normalizeBitrateScale(value) {
    const scale = Number(value);
    return BITRATE_SCALES.includes(scale) ? scale : 1;
  }

  // The unmultiplied target the Bitrate option scales: CM3's own
  // (w/640)*(h/360) Mbps formula, including the profile bitrate and the 1.5
  // factor above 30 fps. MP4 requests exactly this value times the chosen
  // scale, so the row can show the same number the encoder receives.
  function nativeVideoBitrate(params, profiles) {
    const width = Math.max(1, Number(params && params.width) || 640);
    const height = Math.max(1, Number(params && params.height) || 360);
    const rate = Math.max(1, Number(params && params.rate) || 30);
    const quality = params && params.quality;
    const profile = profiles && (profiles[quality] || profiles[2]);
    const profileBitrate =
      Number(profile && profile.bitrate) > 0 ? Number(profile.bitrate) : 1;
    return Math.round(width / 640 * (height / 360) * 1000000 *
      (rate > 30 ? 1.5 : 1) * profileBitrate);
  }

  function formatBitrate(bits) {
    if (!Number.isFinite(bits) || bits <= 0) return "unknown";
    const unit = bits >= 1e9 ? [1e9, "Gbps"] : bits >= 1e6 ? [1e6, "Mbps"] : [1e3, "kbps"];
    const value = Math.round(bits / unit[0] * 10) / 10;
    return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + " " + unit[1];
  }

  function bitrateLabels(params, profiles) {
    const target = nativeVideoBitrate(params, profiles);
    return BITRATE_SCALES.map((scale, index) =>
      (scale + "x" + (index === 0 ? " (default)" : "")) + ": " +
      formatBitrate(target * scale) + " target");
  }

  // Runs encode with the chosen quality profile's bitrate multiplied. CM3
  // reads PZ.av.profiles[quality] synchronously when encode is called, so the
  // scaled profile is visible to that call only and restored right after.
  function encodeWithBitrateScale(av, original, receiver, args) {
    const params = args[1];
    const scale = normalizeBitrateScale(params && params.bitrateScale);
    const profiles = av && av.profiles;
    const quality = params && params.quality;
    const profile = profiles && profiles[quality];
    if (scale === 1 || !profile) return original.apply(receiver, args);
    profiles[quality] = Object.assign({}, profile, {
      bitrate: (Number(profile.bitrate) || 1) * scale,
    });
    try {
      return original.apply(receiver, args);
    } finally {
      profiles[quality] = profile;
    }
  }

  function wrapEncode(av, original) {
    if (typeof original !== "function" || original[PATCH_MARKER]) {
      return original;
    }
    const wrapped = function zoidiumBitrateScaledEncode() {
      return encodeWithBitrateScale(
        av,
        original,
        this,
        Array.prototype.slice.call(arguments),
      );
    };
    wrapped[PATCH_MARKER] = true;
    wrapped[ORIGINAL_MARKER] = original;
    return wrapped;
  }

  // The scaling must sit directly around CM3's encode: the export serializer
  // queues calls and invokes the native encode later. When the serializer is
  // already installed, rebuild its wrapper around the scaled encode.
  function installEncode(PZ) {
    const av = PZ && PZ.av;
    if (!av || typeof av.encode !== "function") return false;
    const current = av.encode;
    if (current[PATCH_MARKER]) return true;
    const inner = current[IO_SERIALIZATION_ORIGINAL];
    const serializer =
      PZ[IO_SERIALIZATION_KEY] && PZ[IO_SERIALIZATION_KEY]._serializer;
    if (typeof inner === "function") {
      if (inner[PATCH_MARKER]) return true;
      if (!serializer || typeof serializer.wrapEncode !== "function") {
        return false;
      }
      av.encode = serializer.wrapEncode(wrapEncode(av, inner), av.profiles);
      return true;
    }
    av.encode = wrapEncode(av, current);
    return true;
  }

  function findQualityRow(page) {
    for (const select of page.querySelectorAll("select.pz-inputbox")) {
      const first = select.options[0] && select.options[0].text.trim();
      if (select.options.length === 5 && /^very low/.test(first)) {
        return select.closest(".proprow") || select.parentElement;
      }
    }
    return null;
  }

  function createBitrateRow(PZ, owner) {
    const profiles = PZ && PZ.av && PZ.av.profiles;
    const row = PZ.ui.controls.legacy.generateDropdown(
      {
        title: "Bitrate",
        items: bitrateLabels(owner.params, profiles).join(";"),
        get() {
          return BITRATE_SCALES.indexOf(
            normalizeBitrateScale(owner.params.bitrateScale),
          );
        },
        set(index) {
          owner.params.bitrateScale = BITRATE_SCALES[index] || 1;
          rememberedBitrateScale = normalizeBitrateScale(owner.params.bitrateScale);
        },
      },
      owner,
    );
    const select = row && typeof row.querySelector === "function"
      ? row.querySelector("select")
      : null;
    if (select) {
      select.title = "Target video bitrate for the selected resolution and " +
        "frame rate. MP4 encodes to this target; MKV/WebM also apply the " +
        "Quality preset.";
    }
    // Export options pages have no periodic update, so the labels follow the
    // resolution and frame rate choices through one change listener per page.
    row[REFRESH_KEY] = function refreshBitrateLabels() {
      const labels = bitrateLabels(owner.params, profiles);
      const options = select && select.options;
      if (!options) return;
      for (let index = 0; index < options.length && index < labels.length; index++) {
        if (options[index].text !== labels[index]) options[index].text = labels[index];
      }
    };
    return row;
  }

  function installOptionsPage(PZ) {
    const prototype = PZ && PZ.ui && PZ.ui.export && PZ.ui.export.device &&
      PZ.ui.export.device.prototype;
    if (!prototype || !PZ.ui.controls || !PZ.ui.controls.legacy) return false;
    if (prototype[PATCH_MARKER]) return true;
    const originalCreateOptionsPage = prototype.createOptionsPage;
    prototype.createOptionsPage = function createOptionsPageWithBitrate() {
      const page = originalCreateOptionsPage.apply(this, arguments);
      if (!page || !this.params) return page;
      // CM3 resets the params on every open; the last choice survives it.
      this.params.bitrateScale = normalizeBitrateScale(rememberedBitrateScale);
      const row = createBitrateRow(PZ, this);
      const qualityRow = findQualityRow(page);
      if (qualityRow && qualityRow.parentElement) {
        qualityRow.parentElement.insertBefore(row, qualityRow.nextSibling);
      } else {
        page.appendChild(row);
      }
      if (typeof page.addEventListener === "function") {
        page.addEventListener("change", row[REFRESH_KEY]);
      }
      return page;
    };
    prototype[PATCH_MARKER] = true;
    return true;
  }

  function installWithRetry(attempt) {
    const PZ = global && global.PZ;
    const encodeReady = installEncode(PZ);
    const pageReady = installOptionsPage(PZ);
    if ((encodeReady && pageReady) || attempt >= MAX_ATTEMPTS) {
      if (!(encodeReady && pageReady) && global.console) {
        global.console.warn("Zoidium: the export Bitrate option is unavailable.");
      }
      return;
    }
    setTimeout(() => installWithRetry(attempt + 1), RETRY_DELAY_MS);
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      BITRATE_SCALES,
      bitrateLabels,
      createBitrateRow,
      encodeWithBitrateScale,
      formatBitrate,
      installEncode,
      installOptionsPage,
      nativeVideoBitrate,
      normalizeBitrateScale,
      resetBitrateMemory,
      wrapEncode,
    };
    return;
  }
  installWithRetry(1);
})(typeof window !== "undefined" ? window : null);
