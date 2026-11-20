(function installTimelineTimeInput(global) {
  "use strict";
  const prototype = global.PZ?.ui?.timeline?.prototype;
  if (!prototype || typeof prototype.create !== "function") return;

  function parseFrame(text, fps) {
    const value = text.trim();
    if (/^\d+$/.test(value)) return Number(value);
    let match = /^(\d+):(\d{2}):(\d{2}):(\d+)$/.exec(value);
    if (match) return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * fps + Number(match[4]);
    match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
    if (match) return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * fps;
    return NaN;
  }

  const create = prototype.create;
  prototype.create = function () {
    const result = create.apply(this, arguments);
    const timeline = this;
    const timestamp = this.timestamp;
    const input = global.document.createElement("input");
    input.type = "text";
    input.setAttribute("aria-label", "Jump to frame or timecode");
    input.style.cssText = "display:none;width:100%;height:30px;box-sizing:border-box";
    timestamp.parentNode.appendChild(input);
    function finish(commit) {
      if (input.style.display === "none") return;
      if (commit) {
        const frame = parseFrame(input.value, timeline.editor.playback.frameRate);
        if (Number.isFinite(frame)) timeline.setFrame(timeline.frameToPx(frame));
      }
      input.style.display = "none";
      timestamp.style.display = "block";
    }
    timestamp.style.cursor = "text";
    timestamp.title = "Click to enter a frame or timecode";
    timestamp.onclick = function () {
      input.value = String(timestamp.innerText);
      timestamp.style.display = "none";
      input.style.display = "block";
      input.focus();
      input.select();
    };
    input.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finish(event.key === "Enter");
      }
    });
    input.addEventListener("keyup", event => event.stopPropagation());
    input.addEventListener("keypress", event => event.stopPropagation());
    input.addEventListener("blur", () => finish(false));
    return result;
  };
})(window);
