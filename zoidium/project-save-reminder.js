// Zoidium save reminder: a dot badge on the toolbar Save button.
// No dot when the project matches the file on disk, a muted dot when it has
// never been saved to a file or has unsaved changes, and an accent dot once
// unsaved changes are older than the configured threshold. The Save button's
// tooltip names the state ("Not saved to disk" or "Unsaved · N min") and
// explains that automatic restore points stay in this browser only. The badge
// is absolutely positioned inside the Save button, so no toolbar element
// moves. Clicks pass through to the Save button itself. Restore points and
// automatic backups never count as a disk save.
// Loads after project-restore.js (see zoidium/runtime-config.js), which owns
// the toolbar and the Restore panel this badge and its setting attach to.
// The refresh tick and the edit watcher only read the project revision
// and update the badge; they never touch project data, and no code here runs
// on export or rendering paths.
(function installProjectSaveReminder(global) {
  "use strict";

  var STORAGE_KEY = "zoidium.save-reminder";
  var THRESHOLDS = [5, 10, 20, 30];
  var DEFAULT_THRESHOLD = 10;
  var REFRESH_MS = 30000;
  var INSTALL_RETRY_MS = 250;
  var TEXT_NEVER = "Not saved to disk";
  var RESTORE_NOTE = "Automatic restore points stay in this browser only.";

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
      saveButton: null,
      badge: null,
      baseTitle: null,
      setting: null,
      lastDotVisible: null,
      lastOverdue: null,
      lastTitle: null,
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

  function statusLineOf(view) {
    if (view.kind === "never") return TEXT_NEVER;
    if (view.kind === "unsaved") return "Unsaved · " + view.minutes + " min";
    return "";
  }

  // The badge is absolutely positioned inside the Save button (see
  // ui-overrides.css), so showing, hiding, or recolouring it never changes
  // the button size or any toolbar position. DOM writes happen only when the
  // visible state actually changes, so the 30-second tick is the only
  // recurring update. The button keeps its own label and shortcut text; the
  // status line and the restore note are appended below it.
  function render(state, view) {
    var saveButton = state.saveButton;
    var badge = state.badge;
    if (!saveButton || !badge) return;
    var dotVisible = !view.hidden && view.kind !== "clean";
    var overdue = dotVisible && view.kind === "unsaved" && !!view.overdue;
    var title = state.baseTitle || "";
    if (dotVisible) title += "\n" + statusLineOf(view) + "\n" + RESTORE_NOTE;
    if (dotVisible === state.lastDotVisible && overdue === state.lastOverdue && title === state.lastTitle) return;
    state.lastDotVisible = dotVisible;
    state.lastOverdue = overdue;
    state.lastTitle = title;
    badge.style.display = dotVisible ? "" : "none";
    if (overdue) badge.classList.add("is-overdue");
    else badge.classList.remove("is-overdue");
    try {
      if (saveButton.title !== title) saveButton.title = title;
    } catch (_error) {
      // A read-only title must not break the status update.
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

  function onProjectSaved(state, detail, nowMs) {
    var editor = editorOf();
    if (detail.project && detail.project !== editor.project) return;
    state.everSaved = true;
    state.onDisk = true;
    if (detail.project && typeof detail.revision === "number") {
      state.project = detail.project;
      state.revision = detail.revision;
    } else {
      rebaseline(state, editor);
    }
    refresh(state, nowMs);
  }

  function detailOf(event) {
    return (event && event.detail) || {};
  }

  function forCurrentEditor(detail) {
    return !detail.editor || detail.editor === editorOf();
  }

  // CM3 builds the toolbar Save button with title "save (ctrl-s)" and moves
  // it into .zoidium-project-actions (see installProjectNameField in
  // project-restore.js). Match on that title prefix; the UI language is
  // English-only, so no locale variants apply.
  function findSaveButton() {
    if (!global.document || typeof global.document.querySelector !== "function") return null;
    var scope = null;
    try {
      scope = global.document.querySelector(".zoidium-project-actions");
    } catch (_error) {
      scope = null;
    }
    if (!scope) scope = global.document;
    if (typeof scope.querySelectorAll !== "function") return null;
    var buttons = null;
    try {
      buttons = scope.querySelectorAll("button[title]");
    } catch (_error) {
      return null;
    }
    for (var i = 0; i < buttons.length; i++) {
      var title = "";
      try {
        title = buttons[i].title || buttons[i].getAttribute("title") || "";
      } catch (_titleError) {
        title = "";
      }
      if (/^save(\s|\()/i.test(title)) return buttons[i];
    }
    return null;
  }

  // The badge must not change the button size or any toolbar position: it is
  // absolutely positioned (see ui-overrides.css), and the button only gains a
  // positioning context. position: relative with no offsets never moves
  // layout; the classList guard keeps the steady-state cost at one query.
  function ensureBadge(state) {
    var saveButton = findSaveButton();
    if (!saveButton || typeof global.document.createElement !== "function") return false;
    if (saveButton !== state.saveButton) {
      state.saveButton = saveButton;
      state.badge = null;
      state.baseTitle = null;
      state.lastDotVisible = null;
      state.lastOverdue = null;
      state.lastTitle = null;
    }
    if (state.baseTitle === null || state.baseTitle === undefined) {
      var base = "";
      try {
        base = saveButton.title || saveButton.getAttribute("title") || "";
      } catch (_error) {
        base = "";
      }
      // A previous install already extended the title; the first line is the
      // button's own label and shortcut text.
      state.baseTitle = String(base).split("\n")[0];
    }
    if (saveButton.classList && typeof saveButton.classList.add === "function") {
      try {
        if (!saveButton.classList.contains("zoidium-save-reminder-host")) {
          saveButton.classList.add("zoidium-save-reminder-host");
        }
      } catch (_error) {
        // The badge still positions against the button in most themes.
      }
    }
    var badge = null;
    try {
      badge = saveButton.querySelector(".zoidium-save-reminder-dot");
    } catch (_error) {
      badge = null;
    }
    if (!badge) {
      badge = global.document.createElement("span");
      badge.className = "zoidium-save-reminder-dot";
      badge.setAttribute("aria-hidden", "true");
      try {
        saveButton.appendChild(badge);
      } catch (_error) {
        return false;
      }
      // pointer-events stays in CSS so clicks reach the Save button itself.
    }
    state.badge = badge;
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
    state.lastDotVisible = null;
    state.lastOverdue = null;
    state.lastTitle = null;
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
    return ensureBadge(state) && ensureSetting(state);
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
      onProjectSaved(state, detailOf(event), Date.now());
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

    // The toolbar and the Restore panel install on their own retry
    // loops, and CM3 can rebuild the toolbar later. Keep retrying until both
    // anchors exist; the observer then reinstalls the badge after rebuilds.
    // Steady-state mutations short-circuit on one querySelector each.
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
          ensureBadge(state);
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
