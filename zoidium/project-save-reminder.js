// Zoidium save reminder: a quiet status next to the project name.
// Shows nothing when the project matches the file on disk, "Not saved to
// disk" when it has never been saved to a file, and "Unsaved · N min" once
// it has changes since the last disk save, counting from the first unsaved
// change. Past the configured threshold the status takes an accent colour.
// Clicking it runs Save. Restore points and automatic backups never count
// as a disk save: they stay in the browser, and the tooltip says so.
// Loads after project-restore.js (see zoidium/runtime-config.js), which owns
// the toolbar field and the Restore panel this status and its setting attach
// to. The refresh tick and the edit watcher only read the project revision
// and update the status element; they never touch project data, and no code
// here runs on export or rendering paths.
(function installProjectSaveReminder(global) {
  "use strict";

  var STORAGE_KEY = "zoidium.save-reminder";
  var THRESHOLDS = [5, 10, 20, 30];
  var DEFAULT_THRESHOLD = 10;
  var REFRESH_MS = 30000;
  var INSTALL_RETRY_MS = 250;
  var TEXT_NEVER = "Not saved to disk";
  var TITLE_NEVER = "This project has never been saved to a file. " +
    "Automatic restore points stay in this browser only. Click to save.";
  var TITLE_UNSAVED = "Unsaved changes. " +
    "Automatic restore points stay in this browser only. Click to save.";

  function storageOf() {
    try {
      if (global.localStorage) return global.localStorage;
    } catch (_error) {
      // Storage may be blocked; the default threshold still applies.
    }
    return null;
  }

  function readThreshold(storage) {
    var raw = null;
    try {
      raw = storage ? storage.getItem(STORAGE_KEY) : null;
    } catch (_error) {
      raw = null;
    }
    if (raw === null || raw === undefined || raw === "") return DEFAULT_THRESHOLD;
    var value = Number(raw);
    if (value === 0) return 0;
    return THRESHOLDS.indexOf(value) === -1 ? DEFAULT_THRESHOLD : value;
  }

  function writeThreshold(storage, value) {
    try {
      if (storage) storage.setItem(STORAGE_KEY, String(value));
    } catch (_error) {
      // The setting still applies for the current session when storage is
      // unavailable.
    }
  }

  function projectFilesOf() {
    return global.PZ && global.PZ.zoidium && global.PZ.zoidium.projectFiles;
  }

  function editorOf() {
    return global.CM || null;
  }

  function safeRevision(editor) {
    try {
      var files = projectFilesOf();
      if (editor && files && typeof files.getProjectRevision === "function") {
        return files.getProjectRevision(editor);
      }
    } catch (_error) {
      // Revision tracking must never break the status update.
    }
    return 0;
  }

  function createState(thresholdMin) {
    return {
      thresholdMin: thresholdMin,
      everSaved: false,
      onDisk: false,
      project: null,
      revision: 0,
      dirtySince: null,
      observedProject: null,
      watched: null,
      watcher: null,
      button: null,
      setting: null,
      lastText: null,
      lastOverdue: null,
      lastVisible: null,
      refreshTimer: null,
      installTimer: null,
      observer: null,
      stopped: false,
    };
  }

  function snapshotOf(editor) {
    var project = editor && editor.project ? editor.project : null;
    return { project: project, revision: project ? safeRevision(editor) : 0 };
  }

  function isUnsaved(state, snap) {
    return !state.onDisk || snap.project !== state.project || snap.revision !== state.revision;
  }

  function minutesBetween(dirtySince, nowMs) {
    return Math.max(0, Math.floor((nowMs - dirtySince) / 60000));
  }

  // The single place that mutates dirtySince: set on the first observed
  // unsaved change, cleared as soon as the content matches the disk file
  // again or a new project takes over. A failed save changes neither the
  // baseline nor dirtySince, so the count continues from the first change.
  function refresh(state, nowMs) {
    var editor = editorOf();
    var project = editor && editor.project ? editor.project : null;
    if (project !== state.observedProject) {
      rewatch(state, editor);
      state.observedProject = project;
    }
    var unsaved = state.everSaved && isUnsaved(state, snapshotOf(editor));
    if (!unsaved) state.dirtySince = null;
    else if (state.dirtySince === null || state.dirtySince === undefined) state.dirtySince = nowMs;
    render(state, describe(state, nowMs));
  }

  function describe(state, nowMs) {
    if (state.thresholdMin <= 0) return { hidden: true };
    if (!state.everSaved) return { hidden: false, kind: "never" };
    if (state.dirtySince === null || state.dirtySince === undefined) return { hidden: false, kind: "clean" };
    return {
      hidden: false,
      kind: "unsaved",
      minutes: minutesBetween(state.dirtySince, nowMs),
      overdue: nowMs - state.dirtySince >= state.thresholdMin * 60000,
    };
  }

  function textOf(view) {
    if (view.kind === "never") return TEXT_NEVER;
    if (view.kind === "unsaved") return "Unsaved · " + view.minutes + " min";
    return "";
  }

  // The button keeps a fixed width (see ui-overrides.css) and hides through
  // visibility, so saved/unsaved transitions never shift the toolbar. DOM
  // writes happen only when the visible state actually changes, so the
  // 30-second tick is the only recurring update.
  function render(state, view) {
    var button = state.button;
    if (!button) return;
    var visible = !view.hidden;
    var text = !visible || view.kind === "clean" ? "" : textOf(view);
    var overdue = visible && view.kind === "unsaved" && !!view.overdue;
    if (text === state.lastText && overdue === state.lastOverdue && visible === state.lastVisible) return;
    state.lastText = text;
    state.lastOverdue = overdue;
    state.lastVisible = visible;
    if (!visible) {
      button.style.display = "none";
      return;
    }
    button.style.display = "";
    button.textContent = text;
    button.title = view.kind === "never" ? TITLE_NEVER : view.kind === "unsaved" ? TITLE_UNSAVED : "";
    if (overdue) button.classList.add("is-overdue");
    else button.classList.remove("is-overdue");
    button.style.visibility = text ? "visible" : "hidden";
  }

  function runSave() {
    var editor = editorOf();
    if (!editor) return;
    try {
      if (typeof editor.save === "function") editor.save();
      else if (projectFilesOf() && typeof projectFilesOf().saveProject === "function") {
        projectFilesOf().saveProject(editor);
      }
    } catch (_error) {
      // Save failures surface through zoidium:project-error.
    }
  }

  function rewatch(state, editor) {
    if (state.watched && state.watcher && typeof state.watched.unwatch === "function") {
      try {
        state.watched.unwatch(state.watcher);
      } catch (_error) {
        // A stale observable must not break the status update.
      }
    }
    state.watched = null;
    state.watcher = null;
    var project = editor && editor.project ? editor.project : null;
    var changed = project && project.ui && project.ui.onChanged;
    if (!changed || typeof changed.watch !== "function") return;
    var watcher = function () {
      refresh(state, Date.now());
    };
    try {
      changed.watch(watcher);
    } catch (_error) {
      return;
    }
    state.watched = changed;
    state.watcher = watcher;
  }

  function rebaseline(state, editor) {
    var snap = snapshotOf(editor);
    state.project = snap.project;
    state.revision = snap.revision;
    state.observedProject = snap.project;
    rewatch(state, editor);
  }

  // A project change always clears the unsaved timer: new and opened
  // projects start clean, and a restore starts counting from the restore.
  function onProjectChanged(state, reason, nowMs) {
    var editor = editorOf();
    rebaseline(state, editor);
    if (reason === "open") {
      state.everSaved = true;
      state.onDisk = true;
      state.dirtySince = null;
    } else if (reason === "restore") {
      state.onDisk = false;
      state.dirtySince = state.everSaved ? nowMs : null;
    } else {
      state.everSaved = false;
      state.onDisk = false;
      state.dirtySince = null;
    }
    refresh(state, nowMs);
  }

  function onProjectSaved(state, nowMs) {
    var editor = editorOf();
    state.everSaved = true;
    state.onDisk = true;
    state.dirtySince = null;
    rebaseline(state, editor);
    refresh(state, nowMs);
  }

  function detailOf(event) {
    return (event && event.detail) || {};
  }

  function forCurrentEditor(detail) {
    return !detail.editor || detail.editor === editorOf();
  }

  function findNameField() {
    if (!global.document || typeof global.document.querySelector !== "function") return null;
    return global.document.querySelector(".zoidium-project-name");
  }

  function ensureButton(state) {
    var field = findNameField();
    if (!field || typeof global.document.createElement !== "function") return false;
    var existing = null;
    try {
      existing = field.querySelector(".zoidium-save-reminder");
    } catch (_error) {
      existing = null;
    }
    if (existing) {
      state.button = existing;
      return true;
    }
    var button = global.document.createElement("button");
    button.type = "button";
    button.className = "zoidium-save-reminder";
    button.setAttribute("aria-label", "Save reminder. Activate to save.");
    button.addEventListener("click", function () {
      runSave();
    });
    field.appendChild(button);
    state.button = button;
    state.lastText = null;
    state.lastOverdue = null;
    state.lastVisible = null;
    render(state, describe(state, Date.now()));
    return true;
  }

  function thresholdLabel(value) {
    return value === 0 ? "Off" : value + " minutes";
  }

  function notifySetting(value) {
    try {
      var parts = global.__zoidiumRestoreParts;
      var toasts = parts && parts.toasts;
      if (toasts && typeof toasts.showToast === "function") {
        toasts.showToast({ title: "Saved.", message: "Save reminder: " + thresholdLabel(value) + "." });
      }
    } catch (_error) {
      // The setting still applies without the confirmation toast.
    }
  }

  function onSettingChange(state, event) {
    var raw = event && event.target ? event.target.value : null;
    var value = Number(raw);
    if (value !== 0 && THRESHOLDS.indexOf(value) === -1) {
      if (event && event.target) event.target.value = String(state.thresholdMin);
      return;
    }
    state.thresholdMin = value;
    writeThreshold(storageOf(), value);
    notifySetting(value);
    state.lastText = null;
    state.lastOverdue = null;
    state.lastVisible = null;
    refresh(state, Date.now());
  }

  function ensureSetting(state) {
    if (!global.document || typeof global.document.querySelector !== "function") return false;
    if (state.setting) return true;
    var note = null;
    try {
      note = global.document.querySelector(".zoidium-restore-note");
    } catch (_error) {
      note = null;
    }
    if (!note) return false;
    var existing = null;
    try {
      existing = note.querySelector(".zoidium-save-reminder-setting select");
    } catch (_error) {
      existing = null;
    }
    if (existing) {
      state.setting = existing;
      return true;
    }
    var label = global.document.createElement("label");
    label.className = "zoidium-save-reminder-setting";
    var caption = global.document.createElement("span");
    caption.textContent = "Save reminder";
    label.appendChild(caption);
    var select = global.document.createElement("select");
    select.className = "pz-inputbox zoidium-save-reminder-threshold";
    select.setAttribute("aria-label", "Save reminder");
    [0].concat(THRESHOLDS).forEach(function (value) {
      var option = global.document.createElement("option");
      option.value = String(value);
      option.textContent = thresholdLabel(value);
      select.appendChild(option);
    });
    select.value = String(state.thresholdMin);
    select.addEventListener("change", function (event) {
      onSettingChange(state, event);
    });
    label.appendChild(select);
    note.appendChild(label);
    state.setting = select;
    return true;
  }

  function tryInstall(state) {
    return ensureButton(state) && ensureSetting(state);
  }

  function stop(state) {
    state.stopped = true;
    if (state.installTimer !== null && state.installTimer !== undefined) {
      global.clearInterval(state.installTimer);
      state.installTimer = null;
    }
    if (state.refreshTimer !== null && state.refreshTimer !== undefined) {
      global.clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (state.observer && typeof state.observer.disconnect === "function") {
      try {
        state.observer.disconnect();
      } catch (_error) {
        // Teardown must not fail the page unload.
      }
      state.observer = null;
    }
    rewatch(state, null);
    state.observedProject = null;
  }

  function install() {
    // project-files.js (a pre-init core script) always loads first; without
    // its revision tracking edits are invisible, so wait for it.
    if (!projectFilesOf()) return false;
    var editor = editorOf();
    if (!editor || !editor.project) return false;
    var state = createState(readThreshold(storageOf()));
    var snap = snapshotOf(editor);
    state.project = snap.project;
    state.revision = snap.revision;
    state.observedProject = snap.project;
    rewatch(state, editor);

    global.addEventListener("zoidium:project-changed", function (event) {
      var detail = detailOf(event);
      if (!forCurrentEditor(detail)) return;
      onProjectChanged(state, detail.reason, Date.now());
    });
    global.addEventListener("zoidium:project-saved", function (event) {
      if (!forCurrentEditor(detailOf(event))) return;
      onProjectSaved(state, Date.now());
    });
    global.addEventListener("zoidium:project-error", function (event) {
      if (!forCurrentEditor(detailOf(event))) return;
      // A failed save changes neither the baseline nor dirtySince; refresh
      // keeps the count running from the first unsaved change.
      refresh(state, Date.now());
    });

    state.refreshTimer = global.setInterval(function () {
      if (state.stopped) return;
      refresh(state, Date.now());
    }, REFRESH_MS);

    // The toolbar field and the Restore panel install on their own retry
    // loops, and CM3 can rebuild the toolbar later. Keep retrying until both
    // anchors exist; the observer then reinstalls the button after rebuilds.
    // steady-state mutations short-circuit on one querySelector each.
    if (tryInstall(state)) {
      state.installTimer = null;
    } else {
      state.installTimer = global.setInterval(function () {
        if (state.stopped) return;
        if (tryInstall(state)) {
          global.clearInterval(state.installTimer);
          state.installTimer = null;
        }
      }, INSTALL_RETRY_MS);
    }
    if (typeof global.MutationObserver === "function" && global.document && global.document.body &&
        typeof global.document.body === "object") {
      try {
        state.observer = new global.MutationObserver(function () {
          if (state.stopped) return;
          ensureButton(state);
        });
        state.observer.observe(global.document.body, { childList: true, subtree: true });
      } catch (_error) {
        state.observer = null;
      }
    }
    if (typeof global.addEventListener === "function") {
      global.addEventListener("pagehide", function () {
        stop(state);
      });
    }
    refresh(state, Date.now());
    return true;
  }

  if (!install() && typeof global.setInterval === "function" && typeof global.addEventListener === "function") {
    var retry = global.setInterval(function () {
      if (install()) global.clearInterval(retry);
    }, INSTALL_RETRY_MS);
    if (typeof global.addEventListener === "function") {
      global.addEventListener("pagehide", function () {
        global.clearInterval(retry);
      });
    }
  }
})(window);
