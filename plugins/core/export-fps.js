(function installExportFpsPatch() {
  "use strict";

  const MIN_FPS = 1;
  const MAX_FPS = 240;
  const PATCH_MARKER = "__zoidiumExportFpsPatch";

  function normalizeDecimalText(value) {
    return String(value)
      .trim()
      .replace(/[０-９]/g, (digit) =>
        String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
      )
      .replace(/[．，,]/g, ".");
  }

  function readFps(value, fallback) {
    const trimmed = normalizeDecimalText(value);
    if (!trimmed) return fallback;

    const fps = Number(trimmed);
    if (!Number.isFinite(fps)) return fallback;
    return Math.min(MAX_FPS, Math.max(MIN_FPS, fps));
  }

  function updateExportLength(owner, rate) {
    const sequenceRate = owner.editor.sequence.properties.rate.get();
    owner.params.length = owner.editor.sequence.length * (rate / sequenceRate);
  }

  function createFpsInput(owner) {
    const row = document.createElement("div");
    row.classList.add("proprow", "noselect");

    const title = document.createElement("span");
    title.innerText = "Frame rate";
    row.appendChild(title);

    const controls = document.createElement("div");
    const input = document.createElement("input");
    input.classList.add("pz-inputbox");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Frame rate (FPS)");
    input.style.width = "90px";
    controls.appendChild(input);
    row.appendChild(controls);

    function update() {
      input.value = String(owner.params.rate);
    }

    function commit() {
      const fps = readFps(input.value, owner.params.rate);
      owner.params.rate = fps;
      updateExportLength(owner, fps);
      update();
    }

    input.onchange = commit;
    row.pz_update = update;
    update();
    return row;
  }

  function findFrameRateRow(page) {
    for (const select of page.querySelectorAll("select.pz-inputbox")) {
      const items = Array.from(select.options).map((option) =>
        option.text.trim(),
      );
      if (items.length === 2 && items[0] === "30" && items[1] === "60") {
        return select.closest(".proprow") || select.parentElement;
      }
    }
    return null;
  }

  function installDeviceExportPatch() {
    const prototype = PZ.ui?.export?.device?.prototype;
    if (!prototype || prototype[PATCH_MARKER]) return;

    const originalCreateOptionsPage = prototype.createOptionsPage;
    prototype.createOptionsPage = function createOptionsPageWithFpsInput() {
      const page = originalCreateOptionsPage.apply(this, arguments);
      if (!page || !this.params || !this.editor) return page;

      const fpsRow = createFpsInput(this);
      const frameRateRow = findFrameRateRow(page);
      if (frameRateRow && frameRateRow.parentElement) {
        frameRateRow.replaceWith(fpsRow);
      } else {
        page.appendChild(fpsRow);
      }
      return page;
    };

    prototype[PATCH_MARKER] = true;
  }

  installDeviceExportPatch();
})();
