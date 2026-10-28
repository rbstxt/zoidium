// Project file naming and error helpers shared by the project-files core
// scripts. Pure functions only: no archive, editor, or UI access, so every
// consumer (runtime scripts and node test harnesses) can load this file
// first and read the helpers off PZ.zoidium.projectFilesShared.
(function installProjectFilesShared(global) {
  "use strict";

  var PZ = global.PZ;
  if (!PZ) return;

  PZ.zoidium = PZ.zoidium || {};
  if (PZ.zoidium.projectFilesShared) return;

  var DEFAULT_PROJECT_NAME = "project";

  function normalizeProjectName(value) {
    var name = String(value == null ? "" : value).trim();
    return name || DEFAULT_PROJECT_NAME;
  }

  function fileNameForProject(value) {
    var name = normalizeProjectName(value)
      .replace(/\.pz$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return (name || DEFAULT_PROJECT_NAME) + ".pz";
  }

  function projectNameFromFileName(value) {
    var name = String(value || "").replace(/\.pz$/i, "").trim();
    return normalizeProjectName(name);
  }

  // Older desktop builds replaced non-ASCII names with labels such as
  // "Project [U+3046 U+304A]" before the renderer's font path was fixed.
  // Decode that exact legacy format at the UI boundary so existing restore
  // points become readable without changing unrelated user-entered names.
  function decodeLegacyDisplayName(value) {
    var name = normalizeProjectName(value);
    var match = /^Project \[((?:U\+[0-9A-Fa-f]{1,6})(?: U\+[0-9A-Fa-f]{1,6})*)\]$/.exec(name);
    if (!match) return name;

    var tokens = match[1].split(" ");
    var codePoints = [];
    for (var index = 0; index < tokens.length; index += 1) {
      var codePoint = Number.parseInt(tokens[index].slice(2), 16);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return name;
      }
      codePoints.push(codePoint);
    }

    try {
      return String.fromCodePoint.apply(String, codePoints) || name;
    } catch (_error) {
      // Overlong escapes fall back to the raw filename.
      return name;
    }
  }

  // Keep this as a single display-name hook so project-name rendering stays
  // consistent across the toolbar, restore points, and accessibility labels.
  // Electron's font backend is configured in the desktop main process; the
  // renderer must not replace a user's real name with an artificial label.
  function displayNameForUi(value) {
    return decodeLegacyDisplayName(value);
  }

  function fileDiagnostics(file) {
    if (!file) return {};
    return {
      filename: typeof file.name === "string" ? file.name : "",
      size: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
      type: typeof file.type === "string" ? file.type : "",
      lastModified: Number.isFinite(Number(file.lastModified))
        ? Number(file.lastModified)
        : null,
    };
  }

  function errorMessage(error, fallback) {
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
    return fallback;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  var VALIDATION_PREFIX = {
    save: "Nothing was saved.",
    open: "This project file cannot be opened.",
    restore: "This restore point cannot be opened.",
  };

  function isProjectDataError(error) {
    return Boolean(error && error.name === "ProjectDataError");
  }

  function projectDataError(mode, detail) {
    var error = new Error((VALIDATION_PREFIX[mode] || VALIDATION_PREFIX.open) + " " + String(detail).replace(/[.]+$/, "") + ".");
    error.name = "ProjectDataError";
    return error;
  }

  PZ.zoidium.projectFilesShared = {
    DEFAULT_PROJECT_NAME: DEFAULT_PROJECT_NAME,
    normalizeProjectName: normalizeProjectName,
    fileNameForProject: fileNameForProject,
    projectNameFromFileName: projectNameFromFileName,
    decodeLegacyDisplayName: decodeLegacyDisplayName,
    displayNameForUi: displayNameForUi,
    fileDiagnostics: fileDiagnostics,
    errorMessage: errorMessage,
    isPlainObject: isPlainObject,
    VALIDATION_PREFIX: VALIDATION_PREFIX,
    isProjectDataError: isProjectDataError,
    projectDataError: projectDataError,
  };
})(window);
