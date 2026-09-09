(function installPreciseTimeLeftPatch() {
  "use strict";

  if (PZ.ui?.controls?.__zoidiumPreciseTimeLeft) return;

  const originalGetTimeString = PZ.ui.controls.getTimeString;

  // Native CM3 formats short remaining times as "a few seconds" and hides
  // seconds once minutes appear. Show the exact count instead, so export
  // progress reads as real seconds down to the end of the render.
  PZ.ui.controls.getTimeString = function (seconds) {
    if (
      seconds === undefined ||
      Number.isNaN(Number(seconds)) ||
      seconds === Infinity
    ) {
      return originalGetTimeString
        ? originalGetTimeString.call(this, seconds)
        : "calculating...";
    }

    const total = Math.max(0, Math.ceil(Number(seconds)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const remainder = total % 60;

    const parts = [];
    if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    if (remainder || parts.length === 0) {
      parts.push(`${remainder} second${remainder === 1 ? "" : "s"}`);
    }
    return parts.join(" ");
  };

  PZ.ui.controls.__zoidiumPreciseTimeLeft = true;
})();
