(function (global) {
  "use strict";

  // Keep image texture detail: Three r91 resizes every non-power-of-two image
  // that needs mipmaps or repeat down to the FLOOR power of two with an
  // unsmoothed drawImage, so a 1920 image uploads at 1024 with aliasing. This
  // wrapper swaps the texture image for a high-quality resample at the NEAREST
  // power of two before the first upload, so Three sees a power-of-two image
  // and leaves it alone. Power-of-two sources pass through untouched.
  const PATCH_MARKER = "__zoidiumTextureResample";
  const FALLBACK_MAX_TEXTURE_SIZE = 4096;
  const MIN_TEXTURE_SIZE = 1;

  function floorDimension(value) {
    if (typeof value !== "number" || !isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }

  // Prefer natural dimensions (decoded pixels) over the width/height
  // attributes, which may be unset or styled. Unloaded images report 0.
  function sourceDimensions(image) {
    if (!image || (typeof image !== "object" && typeof image !== "function")) return null;
    const width = floorDimension(image.naturalWidth) || floorDimension(image.width);
    const height = floorDimension(image.naturalHeight) || floorDimension(image.height);
    if (width < MIN_TEXTURE_SIZE || height < MIN_TEXTURE_SIZE) return null;
    return [width, height];
  }

  // Three r91 resizes an image only for repeat wrapping or a mipmap filter
  // (ClampToEdgeWrapping 1001, NearestFilter 1003, LinearFilter 1006).
  function needsPowerOfTwo(texture) {
    return texture.wrapS !== 1001 || texture.wrapT !== 1001 ||
      (texture.minFilter !== 1003 && texture.minFilter !== 1006);
  }

  function isPowerOfTwo(value) {
    return value >= MIN_TEXTURE_SIZE && (value & (value - 1)) === 0;
  }

  // Nearest power of two in log2 space; exact ties round up.
  function nearestPowerOfTwo(value) {
    if (!(value >= MIN_TEXTURE_SIZE)) return MIN_TEXTURE_SIZE;
    return Math.max(MIN_TEXTURE_SIZE, 2 ** Math.round(Math.log2(value)));
  }

  function targetSize(sourceWidth, sourceHeight, maxSize) {
    const limit = floorDimension(maxSize) || FALLBACK_MAX_TEXTURE_SIZE;
    return [
      Math.max(MIN_TEXTURE_SIZE, Math.min(limit, nearestPowerOfTwo(sourceWidth))),
      Math.max(MIN_TEXTURE_SIZE, Math.min(limit, nearestPowerOfTwo(sourceHeight))),
    ];
  }

  // Intermediate sizes for downscales over 2x per axis. Each step scales an
  // axis by at most 2x so no draw skips source pixels; the final draw from
  // the last step to the target is always 2x or less.
  function planSteps(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const steps = [];
    let width = sourceWidth, height = sourceHeight;
    while (width > targetWidth * 2 || height > targetHeight * 2) {
      if (width > targetWidth * 2) width = Math.max(MIN_TEXTURE_SIZE, Math.floor(width / 2));
      if (height > targetHeight * 2) height = Math.max(MIN_TEXTURE_SIZE, Math.floor(height / 2));
      steps.push([width, height]);
    }
    return steps;
  }

  function paintStep(context, source, width, height) {
    context.imageSmoothingEnabled = true;
    try {
      context.imageSmoothingQuality = "high";
    } catch (_ignored) {
      // Older 2d contexts accept smoothing without a quality level.
    }
    context.drawImage(source, 0, 0, width, height);
  }

  // Draw source down (or up) to targetWidth/targetHeight through the planned
  // halving steps. Returns the canvas, or null when no 2d context exists.
  function resampleImage(source, sourceWidth, sourceHeight, targetWidth, targetHeight, createCanvas) {
    if (typeof createCanvas !== "function") return null;
    let current = source;
    const steps = planSteps(sourceWidth, sourceHeight, targetWidth, targetHeight);
    for (const [stepWidth, stepHeight] of steps) {
      const canvas = createCanvas(stepWidth, stepHeight);
      const context = canvas && canvas.getContext && canvas.getContext("2d");
      if (!context) return null;
      paintStep(context, current, stepWidth, stepHeight);
      current = canvas;
    }
    const output = createCanvas(targetWidth, targetHeight);
    const outputContext = output && output.getContext && output.getContext("2d");
    if (!outputContext) return null;
    paintStep(outputContext, current, targetWidth, targetHeight);
    return output;
  }

  function detectMaxTextureSize(document, fallback) {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (context) {
        const size = context.getParameter(context.MAX_TEXTURE_SIZE);
        const lose = context.getExtension && context.getExtension("WEBGL_lose_context");
        if (lose && lose.loseContext) lose.loseContext();
        if (typeof size === "number" && isFinite(size) && size >= MIN_TEXTURE_SIZE) return Math.floor(size);
      }
    } catch (_ignored) {
      // Context probing is best-effort; the fallback below still improves sampling.
    }
    return floorDimension(fallback) || FALLBACK_MAX_TEXTURE_SIZE;
  }

  function createResampler(options = {}) {
    const createCanvas = options.createCanvas;
    const maxTextureSize = floorDimension(options.maxTextureSize) || FALLBACK_MAX_TEXTURE_SIZE;
    const ImageConstructor = options.Image || null;
    const VideoConstructor = options.Video || null;
    const customIsCanvas = typeof options.isCanvas === "function" ? options.isCanvas : null;
    const cache = new WeakMap(); // decoded image -> resampled canvas
    const resampled = new WeakSet(); // canvases produced here
    const slots = new WeakMap(); // texture -> { current }
    const raws = new WeakMap(); // texture -> last assigned raw value
    const textureData = new WeakMap(); // texture -> shared asset data
    const waiters = new WeakMap(); // loading image -> Set(texture)
    const hooked = new WeakSet(); // loading images already observed

    function isCanvasLike(value) {
      if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
      if (customIsCanvas) return !!customIsCanvas(value);
      return typeof value.getContext === "function";
    }

    // Only still photographs are resampled. Canvases cover GIF frames,
    // placeholders and baked surfaces; video is out of scope.
    function isImageLike(image) {
      if (!image || (typeof image !== "object" && typeof image !== "function")) return false;
      if (resampled.has(image)) return false;
      if (isCanvasLike(image)) return false;
      if (VideoConstructor && image instanceof VideoConstructor) return false;
      if (typeof image.videoWidth === "number" && typeof image.videoHeight === "number") return false;
      if (ImageConstructor && image instanceof ImageConstructor) return true;
      if (typeof image.width !== "number" || typeof image.height !== "number") return false;
      return true;
    }

    function cachedOrResample(image, sourceWidth, sourceHeight) {
      let canvas = cache.get(image) || null;
      if (!canvas) {
        const [targetWidth, targetHeight] = targetSize(sourceWidth, sourceHeight, maxTextureSize);
        if (targetWidth === sourceWidth && targetHeight === sourceHeight) return null;
        canvas = resampleImage(image, sourceWidth, sourceHeight, targetWidth, targetHeight, createCanvas);
        if (!canvas) return null;
        resampled.add(canvas);
        cache.set(image, canvas);
      }
      return canvas;
    }

    function settleImage(image) {
      const pending = waiters.get(image);
      if (!pending) return;
      waiters.delete(image);
      const dimensions = sourceDimensions(image);
      if (!dimensions || image.complete === false) return;
      for (const texture of Array.from(pending)) {
        if (raws.get(texture) !== image) continue;
        const slot = slots.get(texture);
        if (!slot || slot.current !== image) continue;
        swapFor(texture, slot, textureData.get(texture), image);
      }
    }

    function watch(image, texture, data) {
      let pending = waiters.get(image);
      if (!pending) {
        pending = new Set();
        waiters.set(image, pending);
      }
      pending.add(texture);
      if (hooked.has(image)) return;
      hooked.add(image);
      const settle = () => settleImage(image);
      const loading = data && data.loading;
      if (loading && typeof loading.then === "function") {
        Promise.resolve(loading).then(settle, settle);
      } else if (image && typeof image.addEventListener === "function") {
        try {
          image.addEventListener("load", settle, { once: true });
        } catch (_ignored) {
          try {
            image.addEventListener("load", settle);
          } catch (_ignoredAgain) {
            // Without a load signal the raw image stays; rendering is unchanged.
          }
        }
      }
    }

    // Compute the effective texture image for an assigned value and store it
    // in the slot. Resampled canvases are shared per decoded image; reloads
    // assign a new image object and therefore produce a new canvas.
    function swapFor(texture, slot, data, next) {
      raws.set(texture, next);
      if (data && data.gif) {
        slot.current = next;
        return;
      }
      if (!isImageLike(next)) {
        slot.current = next;
        return;
      }
      const dimensions = sourceDimensions(next);
      if (!dimensions || next.complete === false) {
        slot.current = next;
        watch(next, texture, data);
        return;
      }
      const canvas = cachedOrResample(next, dimensions[0], dimensions[1]);
      slot.current = canvas || next;
      if (slot.current !== next) texture.needsUpdate = true;
    }

    function directAdopt(texture, data) {
      // The texture image cannot be intercepted (non-configurable property).
      // Swap it once without reload tracking rather than failing the call.
      const next = texture.image;
      if (data && data.gif) return false;
      if (!isImageLike(next)) return false;
      const dimensions = sourceDimensions(next);
      if (!dimensions || next.complete === false) return false;
      const canvas = cachedOrResample(next, dimensions[0], dimensions[1]);
      if (!canvas) return false;
      texture.image = canvas;
      texture.needsUpdate = true;
      return true;
    }

    function adopt(texture, data) {
      if (!texture || (typeof texture !== "object" && typeof texture !== "function")) return false;
      textureData.set(texture, data || null);
      let slot = slots.get(texture);
      if (!slot) {
        const initial = texture.image;
        slot = { current: initial };
        slots.set(texture, slot);
        try {
          Object.defineProperty(texture, "image", {
            configurable: true,
            enumerable: true,
            get() {
              const entry = slots.get(texture);
              if (!entry) return undefined;
              // Three uploads clamped textures without mipmaps at their own size.
              if (entry.current !== raws.get(texture) && !needsPowerOfTwo(texture)) return raws.get(texture);
              return entry.current;
            },
            set(next) {
              const entry = slots.get(texture);
              if (entry) swapFor(texture, entry, textureData.get(texture), next);
            },
          });
        } catch (_ignored) {
          slots.delete(texture);
          textureData.delete(texture);
          return directAdopt(texture, data);
        }
      }
      swapFor(texture, slot, data, slot.current);
      return true;
    }

    return { adopt, targetSizeFor: (width, height) => targetSize(width, height, maxTextureSize) };
  }

  function install(PZ, host, options = {}) {
    const prototype = PZ && PZ.asset && PZ.asset.image && PZ.asset.image.prototype;
    if (!prototype || typeof prototype.getTexture !== "function" || prototype[PATCH_MARKER]) return false;
    if (host && host.ISNODE) return false;
    const document = options.document || (host && host.document);
    if (!document || typeof document.createElement !== "function") return false;
    const maxTextureSize = floorDimension(options.maxTextureSize) ||
      detectMaxTextureSize(document, options.fallbackMaxTextureSize);
    const resampler = createResampler({
      createCanvas(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      maxTextureSize,
      Image: options.Image || (host && host.Image) || null,
      Video: options.Video || (host && host.HTMLVideoElement) || null,
    });
    const previous = prototype.getTexture;
    prototype.getTexture = function () {
      const texture = previous.apply(this, arguments);
      try {
        resampler.adopt(texture, this && this.data);
      } catch (_ignored) {
        // Texture bookkeeping must never break material creation.
      }
      return texture;
    };
    prototype[PATCH_MARKER] = true;
    return resampler;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      PATCH_MARKER,
      FALLBACK_MAX_TEXTURE_SIZE,
      isPowerOfTwo,
      nearestPowerOfTwo,
      sourceDimensions,
      targetSize,
      planSteps,
      resampleImage,
      detectMaxTextureSize,
      createResampler,
      install,
    };
    return;
  }

  install(global && global.PZ, global);
})(typeof window !== "undefined" ? window : null);
