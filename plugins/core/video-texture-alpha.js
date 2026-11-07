"use strict";

// CM3 creates every video schedule's texture as RGB, so the upload drops the
// alpha channel and a transparent VP9 or HEVC clip renders over opaque black.
// Upload RGBA instead. A video without alpha decodes with alpha 1 and renders
// the same pixels. Opaque materials ignore the alpha, so a Video material with
// Transparency off is unchanged.
module.exports = {
  activate(context) {
    const PZ = context.PZ;
    const THREE = context.window?.THREE;
    const Native = PZ?.schedule;
    if (typeof Native !== "function" || !THREE?.RGBFormat || !THREE.RGBAFormat) return;
    const Schedule = function Schedule(...args) {
      const schedule = Reflect.construct(Native, args, new.target || Schedule);
      if (schedule.texture?.format === THREE.RGBFormat) schedule.texture.format = THREE.RGBAFormat;
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
