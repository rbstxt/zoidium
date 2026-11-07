"use strict";

// The timeline's keyframe panel is three rows high by default and a deep
// property, such as Base Form Size.X on Form, adds its row below the fold. The
// row exists and scrolls into view, but nothing shows that it was created.
// Scroll to the row when the user animates a property. Loading a project or
// selecting an object rebuilds every row and must not move the panel.

function revealRow(container, row) {
  const box = container.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  if (rect.top < box.top) container.scrollTop -= box.top - rect.top;
  else if (rect.bottom > box.bottom) container.scrollTop += rect.bottom - box.bottom;
}

module.exports = {
  revealRow,
  activate(context) {
    const prototype = context.PZ?.ui?.timeline?.keyframes?.prototype;
    if (typeof prototype?.trackAnimatedChanged !== "function" ||
        typeof prototype.createKeyframeTrack !== "function") return;
    const originalChanged = prototype.trackAnimatedChanged;
    const originalCreate = prototype.createKeyframeTrack;
    let building = 0;
    // A new track reports its initial state through the same watcher.
    const createKeyframeTrack = function () {
      building += 1;
      try {
        return originalCreate.apply(this, arguments);
      } finally {
        building -= 1;
      }
    };
    const trackAnimatedChanged = function (track, property) {
      const result = originalChanged.apply(this, arguments);
      if (!building && property.animated && !property.expression && track.children.length && this.container) {
        revealRow(this.container, track);
      }
      return result;
    };
    prototype.createKeyframeTrack = createKeyframeTrack;
    prototype.trackAnimatedChanged = trackAnimatedChanged;
    context.lifecycle.onDispose(() => {
      if (prototype.createKeyframeTrack === createKeyframeTrack) prototype.createKeyframeTrack = originalCreate;
      if (prototype.trackAnimatedChanged === trackAnimatedChanged) prototype.trackAnimatedChanged = originalChanged;
    });
  },
};
