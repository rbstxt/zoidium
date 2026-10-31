(function (global) {
  "use strict";

  // Project fonts in every font picker. Imported font files are ordinary
  // project assets with non-"/" keys; the host dropdown only lists the
  // built-in presets plus a "custom" file row. This wrapper rebuilds the
  // dropdown on every open as three groups (built-in presets, a labelled
  // "Project fonts" section sorted by family name, then "custom..."), and
  // paints the picker button with the selected project font. Preset rows
  // keep the host order, the host sprite, and the indexOf mapping, so saved
  // projects (which store asset keys) do not change. Selecting a project
  // font sets the existing asset key in one history step and never creates
  // a duplicate asset. Wraps PZ.ui.controls.generateFontInput on top of the
  // empty-state wrapper (font-empty-state.js): empty values still show None,
  // and the two wrappers share the button span instead of conflicting.
  //
  // Animated font properties (Shape+ Font Family and Fallback Font can hold
  // keys) pass the current frame to get/set. The host calls both without a
  // frame, and the keyframe index search loops forever on undefined, which
  // hangs the editor once a second key exists.

  var PREVIEW_WIDTH = 400;
  var PREVIEW_HEIGHT = 50;
  var PREVIEW_SIZE = 30;
  var CUSTOM_LABEL = "custom...";

  // Pure list logic (labels, sorting, descriptors) lives in
  // font-picker-list.js, which loads first. Fail closed without it.
  var listApi = global.__zoidiumFontPicker;
  if (!listApi) return;
  var presetPath = listApi.presetPath;
  var isProjectKey = listApi.isProjectKey;
  var presetNameFromKey = listApi.presetNameFromKey;
  var assetIsFont = listApi.assetIsFont;
  var collectProjectFonts = listApi.collectProjectFonts;
  var fileNameOf = listApi.fileNameOf;
  var labelFor = listApi.labelFor;
  var sortProjectFonts = listApi.sortProjectFonts;
  var buildDescriptors = listApi.buildDescriptors;
  var descriptorIndexForValue = listApi.descriptorIndexForValue;
  var stepIndex = listApi.stepIndex;
  var fileIdentity = listApi.fileIdentity;
  var SEPARATOR_LABEL = listApi.SEPARATOR_LABEL;

  function isEmptyValue(value) {
    return value === null || value === undefined || value === "";
  }

  var PZ = global.PZ;
  var controls = PZ && PZ.ui && PZ.ui.controls;
  var originalGenerate = controls && controls.generateFontInput;
  var editor = PZ && PZ.editor;
  if (!PZ || !controls || typeof originalGenerate !== "function" ||
      typeof editor.showFontDropDown !== "function" ||
      originalGenerate.__zoidiumFontPicker) {
    return;
  }

  var previewCache = {};

  function projectAssets(property) {
    try {
      return property && property.parentProject && property.parentProject.assets;
    } catch (_error) {
      return null;
    }
  }

  function allowsEmpty(property) {
    var definition = property && property.definition;
    if (!definition) return false;
    if (typeof definition.value === "function") return false;
    return definition.value === null || definition.value === undefined;
  }

  function currentEditor(buttonDiv) {
    try {
      var list = buttonDiv && typeof buttonDiv.closest === "function" && buttonDiv.closest("ul");
      var pzControls = list && list.pz_controls;
      if (pzControls && pzControls.editor) return pzControls.editor;
    } catch (_error) {
      // Fall through to the global below.
    }
    if (global.CM && global.CM.playback) return global.CM;
    return null;
  }

  function frameFor(property, buttonDiv, explicit) {
    if (typeof explicit === "number" && isFinite(explicit)) return explicit;
    if (!property || !property.animated) return undefined;
    // editStart stores the operation frame on the button's parent, which
    // is the buttonDiv passed here; fall back to the live playback frame.
    try {
      var stored = buttonDiv && buttonDiv.pz_frame;
      if (typeof stored === "number" && isFinite(stored)) return stored;
    } catch (_error) {
      // Fall through to the playback computation below.
    }
    try {
      var host = currentEditor(buttonDiv);
      var current = host && host.playback && host.playback.currentFrame;
      var offset = property.frameOffset || 0;
      if (typeof current === "number" && isFinite(current)) return current - offset;
    } catch (_error) {
      // No frame available; callers fall back to the stored frame.
    }
    return undefined;
  }

  function readValue(property, frame) {
    if (property.animated) return property.get(frame);
    return property.get();
  }

  function findParts(control) {
    var parts = Array.isArray(control) ? control : [control];
    var buttonDiv = parts[0] || null;
    var button = null;
    try {
      button = buttonDiv && buttonDiv.children && buttonDiv.children[0];
    } catch (_error) {
      button = null;
    }
    var span = null;
    try {
      span = button && button.children && button.children[0];
    } catch (_error) {
      span = null;
    }
    return { buttonDiv: buttonDiv, fileDiv: parts[1] || null, button: button, span: span };
  }

  function clearSpan(span) {
    if (!span) return;
    try {
      span.classList.remove("zoidium-font-none");
      span.classList.remove("zoidium-font-project");
      span.classList.remove("zoidium-font-text");
      span.classList.remove("zoidium-font-failed");
      span.classList.remove("zoidium-font-missing");
      span.textContent = "";
      var canvas = span.querySelector && span.querySelector("canvas");
      if (canvas && canvas.parentNode === span) span.removeChild(canvas);
    } catch (_error) {
      // Display cleanup must not break the update.
    }
  }

  function setSpanText(span, text, className) {
    clearSpan(span);
    if (!span) return;
    try {
      span.textContent = text;
      if (className) span.classList.add(className);
    } catch (_error) {
      // Display cleanup must not break the update.
    }
  }

  function entryForKey(assets, key) {
    if (!assets || !assets.list) return null;
    var asset = assets.list[key];
    if (!asset) return null;
    return { key: key, asset: asset };
  }

  function ensurePreview(entry) {
    var key = entry.key;
    var identity = fileIdentity(entry.asset);
    var cached = previewCache[key];
    if (cached && cached.identity === identity) {
      if (cached.failed) return Promise.resolve(null);
      if (cached.canvas) return Promise.resolve(cached.canvas);
      return cached.pending;
    }
    var record = { identity: identity, canvas: null, failed: false, pending: null };
    previewCache[key] = record;
    record.pending = readAndRender(entry).then(
      function (canvas) {
        record.canvas = canvas;
        record.pending = null;
        return canvas;
      },
      function () {
        record.failed = true;
        record.pending = null;
        return null;
      }
    );
    return record.pending;
  }

  function readAndRender(entry) {
    var wrapper;
    try {
      wrapper = new PZ.asset.font(entry.asset);
    } catch (error) {
      return Promise.reject(error);
    }
    var parsed;
    try {
      parsed = wrapper.getFont();
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(parsed).then(function (font2d) {
      if (!font2d) throw new Error("The font could not be parsed.");
      entry.font2d = font2d;
      return renderPreview(global.document, font2d, labelFor(entry));
    });
  }

  // Renders the family name in the font itself onto a 400x50 canvas shown
  // at 200x25, white on transparent so the theme tint filter applies. The
  // ink is centred vertically by scanning the drawn rows, like the sprite.
  // Canvas fill() uses nonzero winding, which is the preview we want.
  function renderPreview(doc, font2d, label) {
    var canvas = doc.createElement("canvas");
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    var context = canvas.getContext("2d");
    var size = PREVIEW_SIZE;
    try {
      if (typeof font2d.getAdvanceWidth === "function") {
        var advance = font2d.getAdvanceWidth(label, size);
        if (advance > PREVIEW_WIDTH - 20) {
          size = Math.max(8, (size * (PREVIEW_WIDTH - 20)) / advance);
        }
      }
    } catch (_error) {
      // Keep the default size when measuring is unavailable.
    }
    function draw(baseline) {
      context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      context.fillStyle = "#ffffff";
      var path;
      try {
        path = font2d.getPath(label, 10, baseline, size);
      } catch (_error) {
        return false;
      }
      // The host's opentype getPath() returns an opentype Path, not a Path2D.
      try {
        if (!(typeof Path2D === "function" && path instanceof Path2D)) {
          if (typeof Path2D === "function" && path && typeof path.toPathData === "function") path = new Path2D(path.toPathData(3));
          else if (path && typeof path.draw === "function") {
            path.fill = "#ffffff";
            path.draw(context);
            return true;
          }
        }
        context.fill(path);
      } catch (_error) {
        return false;
      }
      return true;
    }
    if (!draw(38)) return canvas;
    var bounds = null;
    try {
      var image = context.getImageData(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT).data;
      var top = -1;
      var bottom = -1;
      for (var y = 0; y < PREVIEW_HEIGHT; y += 1) {
        for (var x = 0; x < PREVIEW_WIDTH; x += 1) {
          if (image[(y * PREVIEW_WIDTH + x) * 4 + 3] > 0) {
            if (top < 0) top = y;
            bottom = y;
            break;
          }
        }
      }
      if (top >= 0) bounds = { top: top, bottom: bottom };
    } catch (_error) {
      bounds = null;
    }
    if (bounds) {
      var centre = (bounds.top + bounds.bottom) / 2;
      draw(38 + (PREVIEW_HEIGHT / 2 - centre));
    }
    return canvas;
  }

  function paintCanvasInto(span, cached) {
    if (!span || !cached) return false;
    try {
      var doc = span.ownerDocument || global.document;
      var canvas = doc.createElement("canvas");
      canvas.width = PREVIEW_WIDTH;
      canvas.height = PREVIEW_HEIGHT;
      canvas.className = "zoidium-font-preview";
      var context = canvas.getContext("2d");
      context.drawImage(cached, 0, 0);
      clearSpan(span);
      span.classList.add("zoidium-font-project");
      span.appendChild(canvas);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function paintButtonProject(parts, entry) {
    var key = entry.key;
    parts.button._zoidiumFontKey = key;
    ensurePreview(entry).then(function (cached) {
      if (parts.button._zoidiumFontKey !== key) return;
      if (cached) {
        paintCanvasInto(parts.span, cached);
        repaintOpenRow(key);
        return;
      }
      setSpanText(parts.span, fileNameOf(entry), "zoidium-font-text");
      try {
        parts.span.classList.add("zoidium-font-failed");
        var badge = (parts.span.ownerDocument || global.document).createElement("span");
        badge.className = "zoidium-font-badge";
        badge.textContent = "failed";
        parts.span.appendChild(badge);
      } catch (_error) {
        // The file name alone still identifies the row.
      }
      repaintOpenRow(key);
    });
    var cachedNow = previewCache[key];
    if (cachedNow && cachedNow.canvas) {
      paintCanvasInto(parts.span, cachedNow.canvas);
      return;
    }
    setSpanText(parts.span, fileNameOf(entry), "zoidium-font-text");
  }

  function setKeyWithHistory(button, property, buttonDiv, key) {
    controls.editStart.call(button, property);
    var frame = frameFor(property, buttonDiv);
    try {
      if (property.animated) property.set(key, frame);
      else property.set(key);
    } catch (error) {
      controls.editFinish.call(button, property, true);
      throw error;
    }
    controls.editFinish.call(button, property);
  }

  function setDescriptor(button, property, buttonDiv, descriptor) {
    var presets = PZ.asset.font.preset;
    if (!descriptor || descriptor.kind === "custom") {
      setKeyWithHistory(button, property, buttonDiv, null);
      return;
    }
    if (descriptor.kind === "preset") {
      var path = presetPath(presets[descriptor.index]);
      var assets = projectAssets(property);
      var created = assets.createFromPreset(PZ.asset.type.FONT, path);
      setKeyWithHistory(button, property, buttonDiv, created.key);
      return;
    }
    if (descriptor.kind === "project") {
      setKeyWithHistory(button, property, buttonDiv, descriptor.key);
    }
  }

  // The button update wraps the host (and empty-state) update. Static
  // properties keep the host rendering byte for byte; only project and
  // missing values add display on top. Animated properties never call the
  // host update, which reads without a frame.
  function updateButton(parts, property, previous, frame) {
    var value;
    try {
      value = readValue(property, frameFor(property, parts.buttonDiv, frame));
    } catch (_error) {
      return;
    }
    if (isEmptyValue(value)) {
      if (property.animated) {
        var fileDiv = parts.fileDiv;
        try {
          if (allowsEmpty(property)) {
            setSpanText(parts.span, "None", "zoidium-font-none");
            if (fileDiv) fileDiv.style.display = "none";
          } else {
            clearSpan(parts.span);
            if (fileDiv) {
              fileDiv.style.display = "";
              var row = fileDiv.querySelector ? fileDiv.querySelector("span") : null;
              if (row) {
                row.textContent = "(none)";
                row.title = "";
              }
            }
          }
        } catch (_error) {
          // Display cleanup must not break the update.
        }
        return;
      }
      previous.call(parts.buttonDiv, frame);
      return;
    }
    var assets = projectAssets(property);
    var missing = isProjectKey(value) && assets && assets.list && !assets.list[value];
    if (missing) {
      renderMissing(parts, value);
      return;
    }
    if (!property.animated) {
      previous.call(parts.buttonDiv, frame);
      if (isProjectKey(value)) {
        var entry = entryForKey(assets, value);
        if (entry) {
          try {
            if (parts.fileDiv) parts.fileDiv.style.display = "none";
          } catch (_error) {
            // Display cleanup must not break the update.
          }
          paintButtonProject(parts, entry);
        }
      } else {
        try {
          parts.button._zoidiumFontKey = value;
        } catch (_error) {
          // Bookkeeping must not break the update.
        }
      }
      return;
    }
    renderAnimated(parts, property, assets, value);
  }

  function renderAnimated(parts, property, assets, value) {
    var name = presetNameFromKey(value);
    var presets = PZ.asset.font.preset;
    if (typeof value === "string" && value.charAt(0) === "/" && name !== null && presets.indexOf(name) >= 0) {
      try {
        parts.button._zoidiumFontKey = value;
        if (parts.fileDiv) parts.fileDiv.style.display = "none";
      } catch (_error) {
        // Display cleanup must not break the update.
      }
      clearSpan(parts.span);
      try {
        parts.span.style.backgroundPositionY = -25 * presets.indexOf(name) + "px";
      } catch (_error) {
        // Display cleanup must not break the update.
      }
      return;
    }
    if (isProjectKey(value)) {
      var entry = entryForKey(assets, value);
      if (entry) {
        try {
          if (parts.fileDiv) parts.fileDiv.style.display = "none";
        } catch (_error) {
          // Display cleanup must not break the update.
        }
        paintButtonProject(parts, entry);
        return;
      }
    }
    clearSpan(parts.span);
    try {
      if (parts.fileDiv) {
        parts.fileDiv.style.display = "";
        var row = parts.fileDiv.querySelector ? parts.fileDiv.querySelector("span") : null;
        if (row) {
          row.textContent = "(none)";
          row.title = "";
        }
      }
      parts.span.style.backgroundPositionY = -25 * presets.length + "px";
    } catch (_error) {
      // Display cleanup must not break the update.
    }
  }

  function renderMissing(parts, value) {
    try {
      parts.button._zoidiumFontKey = value;
      setSpanText(parts.span, "Missing font", "zoidium-font-text");
      parts.span.classList.add("zoidium-font-missing");
      var fileDiv = parts.fileDiv;
      if (fileDiv) {
        fileDiv.style.display = "";
        var row = fileDiv.querySelector ? fileDiv.querySelector("span") : null;
        if (row) {
          row.textContent = "(missing)";
          row.title = String(value);
        }
      }
    } catch (_error) {
      // Display cleanup must not break the update.
    }
  }

  function wrappedGenerate(property) {
    var control = originalGenerate.apply(this, arguments);
    var parts = findParts(control);
    if (!parts.buttonDiv || typeof parts.buttonDiv.pz_update !== "function" || !parts.button) return control;
    var previous = parts.buttonDiv.pz_update;
    if (previous.__zoidiumFontPicker) return control;
    parts.button._zoidiumFontProperty = property;
    parts.button._zoidiumFontValue = function () {
      try {
        return readValue(property, frameFor(property, parts.buttonDiv));
      } catch (_error) {
        return undefined;
      }
    };
    parts.button.pz_setDescriptor = function (descriptor) {
      setDescriptor(parts.button, property, parts.buttonDiv, descriptor);
    };
    var replacement = function (frame) {
      return updateButton(parts, property, previous, frame);
    };
    replacement.__zoidiumFontPicker = true;
    parts.buttonDiv.pz_update = replacement;
    return control;
  }

  wrappedGenerate.__zoidiumFontPicker = true;
  controls.generateFontInput = wrappedGenerate;

  // ---- Dropdown -----------------------------------------------------------

  function spriteRow(doc, rowIndex) {
    var item = doc.createElement("li");
    var span = doc.createElement("span");
    span.style.cssText = "background-image: url('fonts.png');width:200px;height:25px;display:block;";
    span.style.backgroundPositionY = -25 * rowIndex + "px";
    item.appendChild(span);
    return item;
  }

  function separatorRow(doc) {
    var item = doc.createElement("li");
    item.className = "zoidium-font-separator";
    item.setAttribute("aria-hidden", "true");
    var span = doc.createElement("span");
    span.textContent = SEPARATOR_LABEL;
    item.appendChild(span);
    return item;
  }

  function projectRow(doc, entry) {
    var item = doc.createElement("li");
    item._zoidiumFontKey = entry.key;
    item._zoidiumFontName = fileNameOf(entry);
    var span = doc.createElement("span");
    span.style.cssText = "display:block; width:200px; height:25px;";
    span.className = "zoidium-font-text";
    span.textContent = fileNameOf(entry);
    span.title = fileNameOf(entry);
    item.appendChild(span);
    var cached = previewCache[entry.key];
    if (cached && cached.canvas) {
      paintCanvasInto(span, cached.canvas);
    } else if (!cached || !cached.failed) {
      ensurePreview(entry).then(function () {
        repaintOpenRow(entry.key);
      });
    } else {
      markRowFailed(doc, span, entry);
    }
    return item;
  }

  function markRowFailed(doc, span, entry) {
    try {
      clearSpan(span);
      span.className = "zoidium-font-text zoidium-font-failed";
      span.style.cssText = "display:block; width:200px; height:25px;";
      span.textContent = fileNameOf(entry);
      span.title = fileNameOf(entry);
      var badge = doc.createElement("span");
      badge.className = "zoidium-font-badge";
      badge.textContent = "failed";
      span.appendChild(badge);
    } catch (_error) {
      // The file name alone still identifies the row.
    }
  }

  function repaintOpenRow(key) {
    try {
      var dropdown = editor.fontDropDown;
      if (!dropdown || !dropdown.children) return;
      var rows = dropdown.children;
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i]._zoidiumFontKey === key) {
          var span = rows[i].children && rows[i].children[0];
          if (!span) return;
          var cached = previewCache[key];
          if (cached && cached.canvas) {
            paintCanvasInto(span, cached.canvas);
          } else if (cached && cached.failed) {
            markRowFailed(span.ownerDocument || global.document, span,
              { key: key, asset: { key: key, filename: rows[i]._zoidiumFontName || key } });
          }
          return;
        }
      }
    } catch (_error) {
      // A late preview must not disturb the open dropdown.
    }
  }

  function rebuildDropdown(dropdown, button) {
    var doc = dropdown.ownerDocument || global.document;
    var presets = PZ.asset.font.preset;
    var property = (button && button._zoidiumFontProperty) || null;
    var assets = property ? projectAssets(property) : null;
    if (!assets) {
      try {
        var project = global.CM && global.CM.project;
        assets = project && project.assets;
      } catch (_error) {
        assets = null;
      }
    }
    var list = (assets && assets.list) || {};
    var collected = sortProjectFonts(collectProjectFonts(list, PZ));
    var descriptors = buildDescriptors(presets.slice(), collected);
    dropdown.textContent = "";
    dropdown._zoidiumDescriptors = descriptors;
    var rows = [];
    for (var i = 0; i < descriptors.length; i += 1) {
      var descriptor = descriptors[i];
      var row;
      if (descriptor.kind === "preset") {
        row = spriteRow(doc, descriptor.index);
      } else if (descriptor.kind === "separator") {
        row = separatorRow(doc);
      } else if (descriptor.kind === "project") {
        row = projectRow(doc, { key: descriptor.key, asset: list[descriptor.key] });
      } else {
        row = spriteRow(doc, presets.length);
        try {
          var label = row.children[0];
          label.title = CUSTOM_LABEL;
        } catch (_error) {
          // The sprite row still selects the file input.
        }
      }
      row._zoidiumDescriptorIndex = i;
      rows.push(row);
      dropdown.appendChild(row);
    }
    dropdown.onkeydown = function (event) {
      var key = event.key;
      if (key === "Escape") {
        this.blur();
        event.preventDefault();
        return;
      }
      // Rows are the dropdown's own children. The host reads
      // parentElement here, which is the page body, so its arrows never
      // reach the rows; the picker navigates its rows instead.
      function rowsOf(node) {
        try {
          return Array.prototype.slice.call(node.children);
        } catch (_error) {
          return [];
        }
      }
      var rows = rowsOf(this);
      var active = rows.findIndex(function (child) {
        try {
          return child.classList.contains("pz-active");
        } catch (_error) {
          return false;
        }
      });
      if (key === "Enter") {
        var at = active >= 0 ? active : descriptorIndexForValue(descriptors, presets, currentButtonValue(button));
        if (at >= 0 && descriptors[at] && descriptors[at].kind !== "separator") {
          dispatchFromDropdown(this, descriptors[at]);
        }
        this.blur();
        event.preventDefault();
        return;
      }
      if (key !== "ArrowUp" && key !== "ArrowDown") return;
      var delta = key === "ArrowUp" ? -1 : 1;
      var start = active >= 0 ? active : descriptorIndexForValue(descriptors, presets, currentButtonValue(button));
      var next = stepIndex(descriptors, start < 0 ? (delta > 0 ? -1 : descriptors.length) : start, delta);
      try {
        rows.forEach(function (child) {
          child.classList.remove("pz-active");
        });
        var target = rows[next];
        if (target) target.classList.add("pz-active");
        if (typeof this.pz_scrollTo === "function") this.pz_scrollTo(next);
      } catch (_error) {
        // Keyboard feedback must not break selection.
      }
      event.preventDefault();
    };
    for (var r = 0; r < rows.length; r += 1) {
      (function (row, descriptor) {
        if (descriptor.kind === "separator") return;
        row.onmouseenter = function () {
          try {
            Array.prototype.forEach.call(this.parentElement.children, function (child) {
              child.classList.remove("pz-active");
            });
            this.classList.add("pz-active");
          } catch (_error) {
            // Hover feedback must not break selection.
          }
        };
        row.onclick = function () {
          dispatchFromDropdown(dropdown, descriptor);
          try {
            dropdown.blur();
          } catch (_error) {
            // Selection already applied.
          }
        };
      })(rows[r], descriptors[r]);
    }
    var value = currentButtonValue(button);
    var activeIndex = descriptorIndexForValue(descriptors, presets, value);
    try {
      if (rows[activeIndex]) rows[activeIndex].classList.add("pz-active");
      if (typeof dropdown.pz_scrollTo === "function") dropdown.pz_scrollTo(activeIndex);
    } catch (_error) {
      // Highlighting must not break the open.
    }
  }

  function currentButtonValue(button) {
    try {
      if (button && typeof button._zoidiumFontValue === "function") return button._zoidiumFontValue();
    } catch (_error) {
      // Fall through to the stored row value below.
    }
    try {
      if (button && typeof button.pz_value === "number") {
        var presets = PZ.asset.font.preset;
        if (button.pz_value < presets.length) return presetPath(presets[button.pz_value]);
        return null;
      }
    } catch (_error) {
      // No value available.
    }
    return null;
  }

  function dispatchFromDropdown(dropdown, descriptor) {
    try {
      var input = dropdown.pz_input;
      if (input && typeof input.pz_setDescriptor === "function") {
        input.pz_setDescriptor(descriptor);
        return;
      }
      var presets = PZ.asset.font.preset;
      if (!input || typeof input.pz_set !== "function") return;
      if (!descriptor || descriptor.kind === "custom") {
        input.pz_set(presets.length);
        return;
      }
      if (descriptor.kind === "preset") {
        input.pz_set(descriptor.index);
      }
    } catch (_error) {
      // Selection must not leave the dropdown open on failure.
    }
  }

  var originalShow = editor.showFontDropDown;
  editor.showFontDropDown = function (button) {
    try {
      if (editor.fontDropDown) {
        try {
          editor.fontDropDown.remove();
        } catch (_error) {
          // Rebuilding continues below.
        }
        editor.fontDropDown = undefined;
      }
    } catch (_error) {
      // Rebuilding continues below.
    }
    var result = originalShow.call(this, button);
    try {
      var dropdown = editor.fontDropDown;
      if (dropdown) rebuildDropdown(dropdown, button);
    } catch (_error) {
      // The host rows remain usable when the rebuild fails.
    }
    return result;
  };
  editor.showFontDropDown.__zoidiumFontPicker = true;

  // An open list reflects the project at open time. Close it when the
  // project changes so a stale list can never select a removed asset.
  try {
    if (editor.onProjectChanged && typeof editor.onProjectChanged.watch === "function" &&
        !editor.__zoidiumFontPickerWatched) {
      editor.__zoidiumFontPickerWatched = true;
      editor.onProjectChanged.watch(function () {
        try {
          var dropdown = editor.fontDropDown;
          if (dropdown && dropdown.parentElement) {
            try {
              dropdown.blur();
            } catch (_error) {
              // Fall through to the forced removal below.
            }
            try {
              if (dropdown.parentElement) dropdown.remove();
            } catch (_error) {
              // The list is gone or going.
            }
          }
          editor.fontDropDown = undefined;
        } catch (_error) {
          // Project teardown must not fail because of the picker.
        }
      });
    }
  } catch (_error) {
    // Watching is best-effort; the list still rebuilds on every open.
  }
})(globalThis);
