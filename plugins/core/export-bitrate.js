(function installExportBitratePatch(global) {
  "use strict";

  // CM3 derives the device-render video bitrate only from the output size and
  // frame rate ((w/640)*(h/360) Mbps, x1.5 above 30 fps); the Quality choice
  // changes only crf/speed. The Bitrate option multiplies that target. At 1x
  // the native encode call is passed through untouched.
  const PATCH_MARKER = "__zoidiumExportBitratePatch";
  const ORIGINAL_MARKER = "__zoidiumExportBitrateOriginal";
  const IO_SERIALIZATION_KEY = "zoidiumIoSerialization";
  const IO_SERIALIZATION_ORIGINAL = "__zoidiumIoSerializationOriginal";
  const BITRATE_SCALES = [1, 2, 4, 8];
  const BITRATE_LABELS = ["1x (default)", "2x", "4x", "8x"];
  const RETRY_DELAY_MS = 100;
  const MAX_ATTEMPTS = 200;

  function normalizeBitrateScale(value) {
    const scale = Number(value);
    return BITRATE_SCALES.includes(scale) ? scale : 1;
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
    return PZ.ui.controls.legacy.generateDropdown(
      {
        title: "Bitrate",
        items: BITRATE_LABELS.join(";"),
        get() {
          return BITRATE_SCALES.indexOf(
            normalizeBitrateScale(owner.params.bitrateScale),
          );
        },
        set(index) {
          owner.params.bitrateScale = BITRATE_SCALES[index] || 1;
        },
      },
      owner,
    );
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
      this.params.bitrateScale = 1;
      const row = createBitrateRow(PZ, this);
      const qualityRow = findQualityRow(page);
      if (qualityRow && qualityRow.parentElement) {
        qualityRow.parentElement.insertBefore(row, qualityRow.nextSibling);
      } else {
        page.appendChild(row);
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
      BITRATE_LABELS,
      BITRATE_SCALES,
      encodeWithBitrateScale,
      installEncode,
      installOptionsPage,
      normalizeBitrateScale,
      wrapEncode,
    };
    return;
  }
  installWithRetry(1);
})(typeof window !== "undefined" ? window : null);
