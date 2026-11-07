"use strict";

// CM3 creates every video schedule's texture as RGB, so the upload drops the
// alpha channel and a transparent VP9 or HEVC clip renders over opaque black.
// Upload RGBA for a Video layer and for a Video material with Transparency on.
// A video without alpha decodes with alpha 1 and renders the same pixels. An
// opaque material still writes its map's alpha to the buffer, and temporal
// effects read it, so a material with Transparency off keeps the RGB upload.
function uploadFormat(THREE, schedule) {
  const material = schedule.currentItem?.obj?.threeObj;
  return material && !material.transparent ? THREE.RGBFormat : THREE.RGBAFormat;
}

module.exports = {
  uploadFormat,
  activate(context) {
    const PZ = context.PZ;
    const THREE = context.window?.THREE;
    const Native = PZ?.schedule;
    if (typeof Native !== "function" || !THREE?.RGBFormat || !THREE.RGBAFormat) return;
    const Schedule = function Schedule(...args) {
      const schedule = Reflect.construct(Native, args, new.target || Schedule);
      if (schedule.texture?.format === THREE.RGBFormat) {
        // Three reads the format at each upload, after the schedule has its item.
        Object.defineProperty(schedule.texture, "format", {
          configurable: true,
          enumerable: true,
          get: () => uploadFormat(THREE, schedule),
          set() {},
        });
      }
      return schedule;
    };
    // Static members stay on the native constructor, including later patches.
    Object.setPrototypeOf(Schedule, Native);
    Schedule.prototype = Native.prototype;
    PZ.schedule = Schedule;
    context.lifecycle.onDispose(() => {
      if (PZ.schedule === Schedule) PZ.schedule = Native;
    });
  },
};
