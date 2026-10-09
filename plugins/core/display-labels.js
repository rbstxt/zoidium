(function (global) {
  "use strict";

  // The Afterzoid shader pack (AlipFX) names its effects and custom
  // properties with GLSL identifiers: "A_Glossy", "Global_Color",
  // "Fill_Color_1", "SETUP GLOSSY", and "=====" separator rows. CM3 shows
  // those names as typed in the properties panel.
  //
  // This file changes only the text the panel displays for rows that belong
  // to these packs:
  //   - underscores become spaces, and a leading "A_" is dropped from effects;
  //   - all-caps headings of two or more words become Title Case;
  //   - labels made only of "=" or "-" become empty, so the row and its
  //     position stay in place.
  //
  // The stored name, which is also the uniform name used by expressions, is
  // never changed. Editing a name still reads and writes the real value,
  // because CM3 takes the rename text from the property, not the label.
  var PZ = global.PZ;
  if (!PZ || !PZ.ui || !PZ.ui.edit || !PZ.ui.edit.prototype) return;
  if (typeof PZ.ui.edit.prototype.generateListItem !== "function") return;

  var SHADER_PACK_IDS = ["alipfx-shader-pack-4"];
  var SHADER_MARKER = "// @zoidium-plugin ";
  var innerTextDescriptor = global.HTMLElement
    ? Object.getOwnPropertyDescriptor(global.HTMLElement.prototype, "innerText")
    : null;

  function isAllCapsHeading(text) {
    return /^[A-Z0-9 ]+$/.test(text) &&
      /[A-Z]/.test(text) &&
      text.split(" ").filter(Boolean).length >= 2;
  }

  function titleCase(text) {
    return text.split(" ").map(function (word) {
      return word.charAt(0) + word.slice(1).toLowerCase();
    }).join(" ");
  }

  // Pure display transform. Applying it to its own output changes nothing.
  function displayLabel(value, kind) {
    var text = value === null || value === undefined ? "" : String(value);
    // Separator rows: only "=" and "-", optionally spaced, and at least one of them.
    if (/^[\s=-]*[=-][\s=-]*$/.test(text)) return "";
    if (kind === "effect") text = text.replace(/^A_/, "");
    text = text.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (isAllCapsHeading(text)) text = titleCase(text);
    return text;
  }

  function isPropertyRow(object) {
    return typeof PZ.property === "function" && object instanceof PZ.property;
  }

  // The plugin manager writes its id into the effect's fragment shader as a
  // trailing "// @zoidium-plugin {json}" line. That is the only reliable link
  // from an effect to its pack.
  function shaderPackIdOf(effect) {
    var fragShader = effect && effect.properties && effect.properties.fragShader;
    var source = fragShader && typeof fragShader.get === "function" ? fragShader.get() : null;
    if (typeof source !== "string") return null;
    var index = source.lastIndexOf(SHADER_MARKER);
    if (index < 0) return null;
    var line = source.slice(index + SHADER_MARKER.length).split(/\r?\n/, 1)[0];
    try {
      var metadata = JSON.parse(line);
      return metadata && typeof metadata.id === "string" ? metadata.id : null;
    } catch (_error) {
      return null;
    }
  }

  function isShaderPackEffect(effect) {
    var id = shaderPackIdOf(effect);
    return id !== null && SHADER_PACK_IDS.indexOf(id) !== -1;
  }

  // "effect" for a pack effect row, "property" for a row of one of its
  // properties, or null for everything else. Decided when the text is written,
  // because CM3 builds an effect's row before it loads the shader.
  function labelKindFor(object) {
    try {
      if (isPropertyRow(object)) {
        return isShaderPackEffect(object.parentObject) ? "property" : null;
      }
      return isShaderPackEffect(object) ? "effect" : null;
    } catch (_error) {
      return null;
    }
  }

  // Rows get a guard when they are built. Effects and their properties are
  // the only rows that can belong to a pack.
  function canBelongToPack(object) {
    if (!object) return false;
    if (isPropertyRow(object)) return true;
    return !!(object.properties && object.properties.fragShader);
  }

  function findLabel(item) {
    var row = item && item.firstElementChild;
    var children = row ? Array.prototype.slice.call(row.children) : [];
    for (var i = 0; i < children.length; i += 1) {
      if (children[i].tagName === "SPAN") return children[i];
    }
    return null;
  }

  // Re-applies the transform to the text already on screen. Only the title
  // that CM3 copied from the text is updated.
  function refreshLabel(label, object) {
    var kind = labelKindFor(object);
    if (!kind) return;
    var raw = label.textContent;
    var titleWasText = label.title === raw;
    label.innerText = raw;
    if (titleWasText) label.title = label.innerText;
  }

  // A row built before its effect's shader arrives shows the default text.
  // Loading the shader sets fragShader, which notifies its observers, so the
  // row is relabeled then. One watcher per shader property serves all rows.
  var pendingByShader = new WeakMap();

  function shaderPropertyOf(object) {
    var effect = isPropertyRow(object) ? object.parentObject : object;
    var fragShader = effect && effect.properties && effect.properties.fragShader;
    return fragShader && fragShader.onChanged && typeof fragShader.onChanged.watch === "function"
      ? fragShader
      : null;
  }

  function deferUntilShaderKnown(label, object) {
    var shader = shaderPropertyOf(object);
    if (!shader) return;
    var entries = pendingByShader.get(shader);
    if (!entries) {
      entries = [];
      pendingByShader.set(shader, entries);
      shader.onChanged.watch(function () {
        entries.splice(0).forEach(function (entry) {
          if (entry.label.isConnected !== false) refreshLabel(entry.label, entry.object);
        });
      });
    }
    for (var i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].label.isConnected === false) entries.splice(i, 1);
    }
    entries.push({ label: label, object: object });
  }

  // CM3 writes the label through innerText: once when the row is built and
  // again from the name watch on every rename. The setter on this one element
  // applies the transform to every later write. The getter returns the
  // displayed text, which CM3 copies into title.
  function guardLabel(label, object) {
    if (!innerTextDescriptor || !innerTextDescriptor.get || !innerTextDescriptor.set) return;
    Object.defineProperty(label, "innerText", {
      configurable: true,
      get: function () {
        return innerTextDescriptor.get.call(this);
      },
      set: function (value) {
        var kind = labelKindFor(object);
        innerTextDescriptor.set.call(this, kind ? displayLabel(value, kind) : value);
      },
    });
    refreshLabel(label, object);
    if (!labelKindFor(object)) deferUntilShaderKnown(label, object);
  }

  var prototype = PZ.ui.edit.prototype;
  if (prototype.generateListItem.__zoidiumDisplayLabels) return;

  var originalGenerateListItem = prototype.generateListItem;

  function generateListItem(parent, object, index) {
    var item = originalGenerateListItem.call(this, parent, object, index);
    try {
      var label = canBelongToPack(object) ? findLabel(item) : null;
      if (label) guardLabel(label, object);
    } catch (error) {
      console.warn("[Zoidium] could not adjust a display label:", error);
    }
    return item;
  }

  generateListItem.__zoidiumDisplayLabels = true;
  generateListItem.__zoidiumOriginal = originalGenerateListItem;
  prototype.generateListItem = generateListItem;
})(window);
