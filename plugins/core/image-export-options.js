(function installImageExportOptionsPatch() {
  "use strict";

  const PATCH_MARKER = "__zoidiumImageExportOptionsPatch";
  const DEFAULT_ASPECT_RATIO_MODE = 0;
  const RESOLUTION_PRESETS = [
    [426, 240],
    [640, 360],
    [854, 480],
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ];
  const RESOLUTION_LABELS = ["240p", "360p", "480p", "720p", "1080p", "2k", "4k"];

  function isFinitePositive(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function gcd(a, b) {
    return b ? gcd(b, a % b) : a;
  }

  function getSequenceResolution(owner) {
    const resolution = owner.editor?.sequence?.properties?.resolution?.get?.();
    if (Array.isArray(resolution) && isFinitePositive(resolution[0]) && isFinitePositive(resolution[1])) {
      return [Number(resolution[0]), Number(resolution[1])];
    }
    return [1920, 1080];
  }

  function reducedRatio(width, height) {
    const divisor = gcd(Math.round(width), Math.round(height)) || 1;
    return [Math.round(width) / divisor, Math.round(height) / divisor];
  }

  function normalizeAspectRatio(value, fallback) {
    let aspectRatio = fallback;
    if (Array.isArray(value)) {
      aspectRatio = value;
    } else if (typeof value === "string") {
      const match = value.trim().match(
        /^([0-9]+(?:\.[0-9]+)?)\s*[:x/]\s*([0-9]+(?:\.[0-9]+)?)$/i,
      );
      if (match) aspectRatio = [match[1], match[2]];
    }
    if (
      !Array.isArray(aspectRatio) ||
      !isFinitePositive(aspectRatio[0]) ||
      !isFinitePositive(aspectRatio[1])
    ) {
      return fallback.slice();
    }
    return [Number(aspectRatio[0]), Number(aspectRatio[1])];
  }

  function readPositiveInteger(value, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function applyResolution(owner, width, height) {
    owner.params.width = width;
    owner.params.height = height;
  }

  function createResolutionRow(owner) {
    const projectResolution = getSequenceResolution(owner);
    const projectIsPreset = RESOLUTION_PRESETS.some(
      ([width, height]) =>
        width === projectResolution[0] && height === projectResolution[1],
    );
    const offset = projectIsPreset ? 0 : 1;
    const items = [];
    if (!projectIsPreset) {
      items.push(`Project (${projectResolution[0]}x${projectResolution[1]})`);
    }
    RESOLUTION_PRESETS.forEach(([width, height], index) => {
      items.push(`${width}x${height} (${RESOLUTION_LABELS[index]})`);
    });

    let selectedIndex = projectIsPreset
      ? RESOLUTION_PRESETS.findIndex(
          ([width, height]) =>
            width === projectResolution[0] && height === projectResolution[1],
        )
      : 0;
    applyResolution(owner, projectResolution[0], projectResolution[1]);

    const row = PZ.ui.controls.legacy.generateDropdown(
      {
        title: "Resolution",
        items: items.join(";"),
        get() {
          return selectedIndex;
        },
        set(index) {
          if (!Number.isInteger(index) || index < 0 || index >= items.length) {
            return;
          }
          selectedIndex = index;
          const [width, height] =
            index === 0 && !projectIsPreset
              ? projectResolution
              : RESOLUTION_PRESETS[index - offset];
          applyResolution(owner, width, height);
        },
      },
      owner,
    );
    return row;
  }

  function createAspectRatioRow(owner) {
    const row = document.createElement("div");
    row.classList.add("proprow", "noselect");

    const title = document.createElement("span");
    title.innerText = "Aspect ratio";
    row.appendChild(title);

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.alignItems = "center";

    const widthInput = document.createElement("input");
    widthInput.classList.add("pz-inputbox");
    widthInput.type = "text";
    widthInput.inputMode = "numeric";
    widthInput.autocomplete = "off";
    widthInput.setAttribute("aria-label", "Aspect ratio width");
    widthInput.style.width = "90px";

    const separator = document.createElement("span");
    separator.innerText = ":";
    separator.style.margin = "0 8px";

    const heightInput = document.createElement("input");
    heightInput.classList.add("pz-inputbox");
    heightInput.type = "text";
    heightInput.inputMode = "numeric";
    heightInput.autocomplete = "off";
    heightInput.setAttribute("aria-label", "Aspect ratio height");
    heightInput.style.width = "90px";

    controls.appendChild(widthInput);
    controls.appendChild(separator);
    controls.appendChild(heightInput);
    row.appendChild(controls);

    function update() {
      const [width, height] = normalizeAspectRatio(
        owner.params.aspectRatio,
        [16, 9],
      );
      widthInput.value = String(width);
      heightInput.value = String(height);
    }

    function commit() {
      const [currentWidth, currentHeight] = normalizeAspectRatio(
        owner.params.aspectRatio,
        [16, 9],
      );
      owner.params.aspectRatio = [
        readPositiveInteger(widthInput.value, currentWidth),
        readPositiveInteger(heightInput.value, currentHeight),
      ];
      update();
    }

    widthInput.onchange = commit;
    heightInput.onchange = commit;
    row.pz_update = update;
    update();
    return row;
  }

  function createAspectRatioModeRow(owner) {
    return PZ.ui.controls.legacy.generateDropdown(
      {
        title: "Aspect ratio mode",
        items: "crop;black fill",
        get() {
          return owner.params.aspectRatioMode === 1 ? 1 : 0;
        },
        set(value) {
          owner.params.aspectRatioMode = value;
        },
      },
      owner,
    );
  }

  function findFormatRow(page) {
    for (const select of page.querySelectorAll("select.pz-inputbox")) {
      const items = Array.from(select.options).map((option) =>
        option.text.trim(),
      );
      if (items.join(";") === ".png;.jpg;.webp") {
        return select.closest(".proprow");
      }
    }
    return null;
  }

  function installImageExportPatch() {
    const prototype = PZ.ui?.export?.frame?.prototype;
    if (!prototype || prototype[PATCH_MARKER]) return;

    const originalCreateOptionsPage = prototype.createOptionsPage;
    prototype.createOptionsPage = function createOptionsPageWithImageOptions() {
      const page = originalCreateOptionsPage.apply(this, arguments);
      if (!page || !this.params || !this.editor) return page;

      const owner = this;

      // Reuse the shared aspect-render pipeline from render-aspect-ratio.js:
      // the export constructor syncs width/height from the aspect ratio and
      // the compositor renders crop / black-fill output for this export too.
      Object.defineProperty(this.params, "__zoidiumAspectRender", {
        configurable: true,
        enumerable: false,
        value: true,
        writable: true,
      });
      this.params.aspectRatio = reducedRatio(
        ...getSequenceResolution(this),
      );
      this.params.aspectRatioMode = DEFAULT_ASPECT_RATIO_MODE;

      const formatRow = findFormatRow(page);
      const insertTarget = formatRow?.parentElement || page;
      const rows = [
        createResolutionRow(this),
        createAspectRatioRow(this),
        createAspectRatioModeRow(this),
      ];
      for (const row of rows) {
        if (formatRow) insertTarget.insertBefore(row, formatRow);
        else insertTarget.appendChild(row);
      }

      const buttons = page.querySelectorAll("button.propbutton");
      const startButton = buttons[buttons.length - 1];
      if (startButton) {
        // The native Start handler overwrites width/height with the sequence
        // resolution; keep the chosen resolution and aspect instead.
        startButton.onclick = function () {
          owner.params.start = owner.editor.playback.currentFrame;
          owner.export.navigate(owner.createProgressPage(), true);
        };
      }

      return page;
    };

    prototype[PATCH_MARKER] = true;
  }

  installImageExportPatch();
})();
