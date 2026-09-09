(function installProjectRestore(global) {
  "use strict";

  var PZ = global.PZ;
  var editor = global.CM;
  var projectFiles = PZ && PZ.zoidium && PZ.zoidium.projectFiles;
  if (!PZ || !editor || !projectFiles) return;

  var DB_NAME = "zoidium-restore-points";
  var DB_VERSION = 1;
  var STORE_NAME = "snapshots";
  var MAX_AUTOMATIC_PER_TITLE = 12;
  var MAX_AUTOMATIC_TOTAL = 24;
  var HOUR_MS = 60 * 60 * 1000;
  var TIME_BUCKET_LIMITS = [4, 3, 2];
  var BACKUP_INTERVAL_MS = 5 * 60 * 1000;
  var BACKUP_INTERVAL_STORAGE_KEY = "zoidium.restore.interval";
  var BACKUP_INTERVAL_OPTIONS = [
    { value: 1 * 60 * 1000, label: "1 minute" },
    { value: 5 * 60 * 1000, label: "5 minutes" },
    { value: 10 * 60 * 1000, label: "10 minutes" },
    { value: 15 * 60 * 1000, label: "15 minutes" },
    { value: 30 * 60 * 1000, label: "30 minutes" },
    { value: 60 * 60 * 1000, label: "1 hour" },
    { value: 0, label: "Never" },
  ];
  var state = {
    dbPromise: null,
    snapshots: [],
    panel: null,
    list: null,
    toast: null,
    deleteAllButton: null,
    intervalSelect: null,
    backupIntervalMs: BACKUP_INTERVAL_MS,
    snapshotPromise: null,
    backupTimer: null,
    startupTimer: null,
  };

  function isBackupInterval(value) {
    return BACKUP_INTERVAL_OPTIONS.some(function (option) {
      return option.value === value;
    });
  }

  function readBackupInterval() {
    try {
      var stored = global.localStorage.getItem(BACKUP_INTERVAL_STORAGE_KEY);
      var value = stored === null ? NaN : Number(stored);
      return isBackupInterval(value) ? value : BACKUP_INTERVAL_MS;
    } catch (_error) {
      return BACKUP_INTERVAL_MS;
    }
  }

  function writeBackupInterval(value) {
    try {
      global.localStorage.setItem(BACKUP_INTERVAL_STORAGE_KEY, String(value));
    } catch (_error) {
      // A private browsing context may make localStorage unavailable.
    }
  }

  function backupIntervalLabel(value) {
    var option = BACKUP_INTERVAL_OPTIONS.find(function (item) {
      return item.value === value;
    });
    return option ? option.label : "5 minutes";
  }

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("IndexedDB request failed."));
      };
    });
  }

  function openDatabase() {
    if (state.dbPromise) return state.dbPromise;
    if (!global.indexedDB) {
      state.dbPromise = Promise.reject(new Error("IndexedDB is unavailable."));
      return state.dbPromise;
    }

    var databasePromise = new Promise(function (resolve, reject) {
      var request;
      try {
        request = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          var store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("Could not open restore-point storage."));
      };
    });
    state.dbPromise = databasePromise;
    databasePromise.catch(function () {
      if (state.dbPromise === databasePromise) state.dbPromise = null;
    });
    return databasePromise;
  }

  function compareSnapshots(left, right) {
    var timeDifference = (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0);
    if (timeDifference) return timeDifference;
    return String(right.id || "").localeCompare(String(left.id || ""));
  }

  function isAutomaticSnapshot(snapshot) {
    // Records created before automatic/manual tracking was added are kept as
    // automatic points for retention compatibility.
    return !snapshot || snapshot.automatic !== false;
  }

  async function listSnapshots() {
    var database = await openDatabase();
    var transaction = database.transaction(STORE_NAME, "readonly");
    var records = await requestPromise(transaction.objectStore(STORE_NAME).getAll());
    return records.sort(compareSnapshots);
  }

  function saveSnapshot(record) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = function () {
          resolve();
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not store the restore point."));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("Could not store the restore point."));
        };
      });
    });
  }

  function deleteSnapshot(id) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(id);
        transaction.oncomplete = resolve;
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not delete the restore point."));
        };
      });
    });
  }

  function deleteAllSnapshots() {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = resolve;
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not delete the restore points."));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("Could not delete the restore points."));
        };
      });
    });
  }

  function deleteSnapshots(ids) {
    if (!ids.length) return Promise.resolve();
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE_NAME, "readwrite");
        var store = transaction.objectStore(STORE_NAME);
        ids.forEach(function (id) {
          store.delete(id);
        });
        transaction.oncomplete = resolve;
        transaction.onerror = function () {
          reject(transaction.error || new Error("Could not organize the restore points."));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("Could not organize the restore points."));
        };
      });
    });
  }

  function automaticTimeBucket(snapshot, now) {
    var age = Math.max(0, now - (Number(snapshot.createdAt) || 0));
    return Math.floor(age / HOUR_MS);
  }

  async function pruneAutomaticSnapshots() {
    var records = await listSnapshots();
    var automatic = records.filter(isAutomaticSnapshot).sort(compareSnapshots);
    var titleCounts = Object.create(null);
    var bucketCounts = Object.create(null);
    var retainedCount = 0;
    var removedIds = [];
    var now = Date.now();

    automatic.forEach(function (snapshot) {
      var title = String(snapshot.projectName || "project");
      var bucket = automaticTimeBucket(snapshot, now);
      var bucketLimit = bucket < TIME_BUCKET_LIMITS.length
        ? TIME_BUCKET_LIMITS[bucket]
        : 1;
      var titleCount = titleCounts[title] || 0;
      var bucketCount = bucketCounts[bucket] || 0;

      if (
        retainedCount >= MAX_AUTOMATIC_TOTAL ||
        titleCount >= MAX_AUTOMATIC_PER_TITLE ||
        bucketCount >= bucketLimit
      ) {
        removedIds.push(snapshot.id);
        return;
      }

      titleCounts[title] = titleCount + 1;
      bucketCounts[bucket] = bucketCount + 1;
      retainedCount += 1;
    });

    if (!removedIds.length) return records;
    await deleteSnapshots(removedIds);
    return listSnapshots();
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + "B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(2) + "KB";
    return (value / (1024 * 1024)).toFixed(2) + "MB";
  }

  function formatAbsoluteTime(timestamp) {
    return new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function formatAge(timestamp) {
    var seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + " minute" + (minutes === 1 ? "" : "s") + " ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
    var days = Math.floor(hours / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function formatSnapshotTime(timestamp) {
    return formatAge(timestamp) + " (" + formatAbsoluteTime(timestamp) + ")";
  }

  function snapshotFilename(snapshot) {
    return projectFiles.fileNameForProject(snapshot.projectName);
  }

  async function matchesSnapshot(snapshot, fingerprint) {
    if (!snapshot) return false;
    if (snapshot.fingerprint) return snapshot.fingerprint === fingerprint;
    if (!snapshot.blob) return false;
    try {
      // Older restore points do not have a stored fingerprint. Rebuild their
      // archive index so they can still be compared to the current content.
      var archive = new PZ.archive();
      await archive.untar(snapshot.blob);
      return (await projectFiles.fingerprintArchive(archive)) === fingerprint;
    } catch (_error) {
      return false;
    }
  }

  function createButton(iconName, title, className) {
    var button = global.document.createElement("button");
    button.type = "button";
    button.className = className || "zoidium-restore-action";
    button.title = title;
    button.setAttribute("aria-label", title);
    var icon = PZ.ui.generateIcon(iconName);
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    return button;
  }

  function createToast() {
    var toast = global.document.createElement("aside");
    toast.className = "zoidium-project-toast";
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("role", "status");
    toast.innerHTML =
      '<div class="zoidium-project-toast-head">' +
      '<span class="zoidium-project-toast-title"></span>' +
      '<button type="button" class="zoidium-project-toast-close" aria-label="Dismiss notification">×</button>' +
      "</div>" +
      '<div class="zoidium-project-toast-message"></div>' +
      '<div class="zoidium-project-toast-actions">' +
      '<button type="button" class="proprow propbutton" data-toast-action="retry">Retry</button>' +
      '<button type="button" class="proprow propbutton" data-toast-action="download">Download</button>' +
      "</div>";
    global.document.body.appendChild(toast);
    toast.querySelector(".zoidium-project-toast-close").addEventListener("click", function () {
      hideToast();
    });
    toast.querySelector('[data-toast-action="retry"]').addEventListener("click", function () {
      runToastAction(toast._zoidiumRetry);
    });
    toast.querySelector('[data-toast-action="download"]').addEventListener("click", function () {
      runToastAction(toast._zoidiumDownload);
    });
    state.toast = toast;
    return toast;
  }

  function hideToast() {
    if (!state.toast) return;
    state.toast.classList.remove("is-visible");
    state.toast._zoidiumRetry = null;
    state.toast._zoidiumDownload = null;
  }

  function runToastAction(action) {
    if (typeof action !== "function") return;
    Promise.resolve()
      .then(action)
      .catch(function (error) {
        showToast({
          type: "error",
          message: error && error.message ? error.message : "The action failed.",
          retry: action,
        });
      });
  }

  var toastHideTimer = null;
  function showToast(detail) {
    var toast = state.toast || createToast();
    var isError = detail && detail.type === "error";
    toast.classList.toggle("is-error", isError);
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.querySelector(".zoidium-project-toast-title").textContent = isError
      ? "Error!"
      : detail.title || "Saved.";
    toast.querySelector(".zoidium-project-toast-message").textContent = detail.message || "";
    var actions = toast.querySelector(".zoidium-project-toast-actions");
    var retryButton = actions.querySelector('[data-toast-action="retry"]');
    var downloadButton = actions.querySelector('[data-toast-action="download"]');
    var hasActions = isError;
    actions.hidden = !hasActions;
    retryButton.disabled = typeof detail.retry !== "function";
    downloadButton.disabled = typeof detail.download !== "function";
    toast._zoidiumRetry = detail.retry || null;
    toast._zoidiumDownload = detail.download || null;
    toast.classList.add("is-visible");
    if (toastHideTimer) global.clearTimeout(toastHideTimer);
    if (!isError) {
      toastHideTimer = global.setTimeout(hideToast, 3000);
    }
  }

  function showProjectError(detail) {
    showToast({
      type: "error",
      message: detail.message || "The project operation failed.",
      retry: detail.retry,
      download: detail.download,
    });
  }

  function scheduleBackups(includeStartup) {
    if (state.startupTimer) {
      global.clearTimeout(state.startupTimer);
      state.startupTimer = null;
    }
    if (state.backupTimer) {
      global.clearInterval(state.backupTimer);
      state.backupTimer = null;
    }
    if (!state.backupIntervalMs) return;

    if (includeStartup) {
      state.startupTimer = global.setTimeout(function () {
        state.startupTimer = null;
        createSnapshot(false, true).catch(function () {});
      }, 2500);
    }
    state.backupTimer = global.setInterval(function () {
      createSnapshot(false, true).catch(function () {});
    }, state.backupIntervalMs);
  }

  function createPanel() {
    var panel = global.document.createElement("section");
    panel.className = "editorpanel zoidium-restore-panel";
    panel.setAttribute("aria-label", "Restore points");
    panel.tabIndex = 0;
    panel.style.display = "none";
    panel.innerHTML =
      '<div class="proprow proptitle noselect zoidium-restore-header">' +
      '<span class="proplabel zoidium-restore-title" title="Restore">Restore</span>' +
      "</div>" +
      '<div class="zoidium-restore-note">' +
      '<label class="zoidium-backup-setting">' +
      '<span>Automatic backup interval</span>' +
      '<select class="pz-inputbox zoidium-backup-interval" aria-label="Automatic backup interval"></select>' +
      '</label>' +
      '</div>' +
      '<div class="zoidium-restore-warning">' +
      'Restore is designed to prevent project data loss caused by unexpected crashes and is not intended as a location for permanent file storage. ' +
      'It may be easily lost over time, during computer cleanup, or through other actions.' +
      '</div>' +
      '<div class="zoidium-restore-backup-control">' +
      '<button type="button" class="proprow propbutton zoidium-backup-now">Backup now</button>' +
      '</div>' +
      '<div class="zoidium-restore-section-title noselect">RESTORE POINTS</div>' +
      '<div class="zoidium-restore-list" role="list"></div>' +
      '<div class="zoidium-restore-delete-footer">' +
      '<button type="button" class="proprow propbutton zoidium-delete-all">Delete all</button>' +
      '</div>';
    var intervalSelect = panel.querySelector(".zoidium-backup-interval");
    BACKUP_INTERVAL_OPTIONS.forEach(function (option) {
      var element = global.document.createElement("option");
      element.value = String(option.value);
      element.textContent = option.label;
      intervalSelect.appendChild(element);
    });
    intervalSelect.value = String(state.backupIntervalMs);
    intervalSelect.addEventListener("change", function () {
      var value = Number(intervalSelect.value);
      if (!isBackupInterval(value)) return;
      state.backupIntervalMs = value;
      writeBackupInterval(value);
      scheduleBackups(false);
      showToast({
        title: "Saved.",
        message: value ? "Automatic backup: " + backupIntervalLabel(value) + "." : "Automatic backup disabled.",
      });
    });
    state.intervalSelect = intervalSelect;
    state.deleteAllButton = panel.querySelector(".zoidium-delete-all");
    state.deleteAllButton.addEventListener("click", function () {
      removeAllSnapshots();
    });
    panel.querySelector(".zoidium-backup-now").addEventListener("click", function () {
      createSnapshot(true, false).catch(function () {});
    });
    state.panel = panel;
    state.list = panel.querySelector(".zoidium-restore-list");
    return panel;
  }

  function renderListError(error) {
    if (!state.list) return;
    if (state.deleteAllButton) state.deleteAllButton.disabled = true;
    state.list.innerHTML = "";
    var message = global.document.createElement("div");
    message.className = "zoidium-restore-empty is-error";
    message.textContent = error && error.message
      ? error.message
      : "Restore-point storage is unavailable.";
    state.list.appendChild(message);
  }

  function renderSnapshots() {
    if (!state.list) return;
    if (state.deleteAllButton) {
      state.deleteAllButton.disabled = state.snapshots.length === 0;
    }
    state.list.innerHTML = "";
    if (state.snapshots.length === 0) {
      var empty = global.document.createElement("div");
      empty.className = "zoidium-restore-empty";
      empty.textContent = "No restore points yet.";
      state.list.appendChild(empty);
      return;
    }

    state.snapshots.forEach(function (snapshot) {
      var entry = global.document.createElement("article");
      entry.className = "zoidium-restore-entry";
      entry.setAttribute("role", "listitem");

      var copy = global.document.createElement("div");
      copy.className = "zoidium-restore-copy";
      var name = global.document.createElement("div");
      name.className = "zoidium-restore-name";
      name.textContent = snapshot.projectName || "project";
      name.title = name.textContent;
      var time = global.document.createElement("div");
      time.className = "zoidium-restore-meta";
      time.textContent = formatSnapshotTime(snapshot.createdAt);
      var stats = global.document.createElement("div");
      stats.className = "zoidium-restore-meta";
      stats.textContent = formatBytes(snapshot.size) + ", " + snapshot.assetCount +
        " asset" + (snapshot.assetCount === 1 ? "" : "s");
      copy.appendChild(name);
      copy.appendChild(time);
      copy.appendChild(stats);

      var actions = global.document.createElement("div");
      actions.className = "zoidium-restore-actions";
      var restoreButton = createButton(
        "reset",
        "Restore " + (snapshot.projectName || "project"),
      );
      restoreButton.addEventListener("click", function () {
        restoreSnapshot(snapshot);
      });
      var downloadButton = createButton(
        "download",
        "Download " + (snapshot.projectName || "project"),
      );
      downloadButton.addEventListener("click", function () {
        projectFiles.triggerDownload(snapshot.blob, snapshotFilename(snapshot));
      });
      var deleteButton = createButton(
        "delete",
        "Delete " + (snapshot.projectName || "project"),
      );
      deleteButton.addEventListener("click", function () {
        removeSnapshot(snapshot);
      });
      actions.appendChild(restoreButton);
      actions.appendChild(downloadButton);
      actions.appendChild(deleteButton);
      entry.appendChild(copy);
      entry.appendChild(actions);
      state.list.appendChild(entry);
    });
  }

  async function refreshSnapshots() {
    try {
      state.snapshots = await listSnapshots();
      renderSnapshots();
    } catch (error) {
      renderListError(error);
    }
  }

  function createSnapshot(showResult, automatic) {
    if (state.snapshotPromise) return state.snapshotPromise;

    var isAutomatic = automatic !== false;

    var archiveResult = null;
    state.snapshotPromise = (async function () {
      // refreshSnapshots normally completes before this runs, but loading here
      // also covers a very fast startup timer or a delayed IndexedDB response.
      if (!state.snapshots.length) state.snapshots = await listSnapshots();
      archiveResult = await projectFiles.createArchive(editor);
      var fingerprint = archiveResult.fingerprint;
      var latest = state.snapshots[0] || null;
      if (await matchesSnapshot(latest, fingerprint)) {
        if (showResult) {
          showToast({ title: "No changes.", message: "Restore point not created." });
        }
        return null;
      }
      var record = {
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        createdAt: Date.now(),
        projectName: archiveResult.projectName,
        size: archiveResult.blob.size,
        assetCount: archiveResult.assetCount,
        blob: archiveResult.blob,
        fingerprint: fingerprint,
        automatic: isAutomatic,
      };
      await saveSnapshot(record);
      // Manual points are not counted toward the automatic retention limits,
      // but creating one still triggers cleanup of old automatic points.
      state.snapshots = await pruneAutomaticSnapshots();
      renderSnapshots();
      if (showResult) {
        showToast({ title: "Saved.", message: "Restore point created." });
      }
      return record;
    })()
      .catch(function (error) {
        var download = archiveResult && archiveResult.blob
          ? function () {
              projectFiles.triggerDownload(
                archiveResult.blob,
                projectFiles.fileNameForProject(archiveResult.projectName),
              );
            }
          : null;
        showProjectError({
          message: error && error.message ? error.message : "Could not create a restore point.",
          retry: function () {
            return createSnapshot(true, isAutomatic);
          },
          download: download,
        });
        throw error;
      })
      .finally(function () {
        state.snapshotPromise = null;
      });
    return state.snapshotPromise;
  }

  async function restoreSnapshot(snapshot) {
    if (!snapshot || !snapshot.blob) return;
    if (!editor.confirmIfDirty()) return;

    try {
      var archive = new PZ.archive();
      await archive.untar(snapshot.blob);
      var restoredProject = await editor.loadProject(archive);
      editor.project = restoredProject;
      editor._zoidiumSaveFileHandle = null;
      editor._zoidiumSaveFileName = null;
      projectFiles.setProjectName(editor, snapshot.projectName || "project");
      if (restoredProject.ui) restoredProject.ui.dirty = true;
      showToast({ title: "Restored.", message: snapshot.projectName || "project" });
    } catch (error) {
      showProjectError({
        message: error && error.message ? error.message : "Could not restore the project.",
        retry: function () {
          return restoreSnapshot(snapshot);
        },
        download: function () {
          projectFiles.triggerDownload(snapshot.blob, snapshotFilename(snapshot));
        },
      });
    }
  }

  async function removeSnapshot(snapshot) {
    if (!snapshot || !global.confirm("Delete this restore point?")) return;
    try {
      await deleteSnapshot(snapshot.id);
      state.snapshots = state.snapshots.filter(function (item) {
        return item.id !== snapshot.id;
      });
      renderSnapshots();
    } catch (error) {
      showProjectError({
        message: error && error.message ? error.message : "Could not delete the restore point.",
        retry: function () {
          return removeSnapshot(snapshot);
        },
        download: function () {
          projectFiles.triggerDownload(snapshot.blob, snapshotFilename(snapshot));
        },
      });
    }
  }

  async function removeAllSnapshots() {
    if (!state.snapshots.length || !global.confirm("Delete all restore points?")) return;
    if (!global.confirm("This will permanently remove every restore point. Continue?")) return;
    try {
      await deleteAllSnapshots();
      state.snapshots = [];
      renderSnapshots();
      showToast({ title: "Deleted.", message: "All restore points deleted." });
    } catch (error) {
      showProjectError({
        message: error && error.message ? error.message : "Could not delete the restore points.",
        retry: function () {
          return removeAllSnapshots();
        },
        download: null,
      });
    }
  }

  function createTab(panel) {
    var tabs = global.document.querySelector(".elevatortabs");
    var controls = global.document.querySelector(".elevatorcontrols");
    if (!tabs || !controls) return;
    var elevator = tabs.parentElement && tabs.parentElement.parentElement
      ? tabs.parentElement.parentElement.pz_panel
      : null;
    if (!elevator || typeof elevator.changeTab !== "function") return;

    // Dynamically-added elevator panels do not go through the CM3 layout
    // constructor, so give this panel the same full-area geometry explicitly.
    panel.style.top = "0";
    panel.style.left = "0";
    panel.style.width = "100%";
    panel.style.height = "100%";

    var restorePanel = {
      title: "Restore",
      icon: "reset",
      el: panel,
      editor: editor,
      enabled: false,
      needsResize: false,
      resize: function () {},
    };
    var tab = global.document.createElement("a");
    tab.className = "zoidium-restore-tab";
    tab.title = "Restore";
    tab.pz_tab = restorePanel;
    tab.pz_container = panel;
    tab.appendChild(PZ.ui.generateIcon("reset"));
    var label = global.document.createElement("span");
    label.textContent = "Restore";
    tab.appendChild(label);
    var aboutTab = Array.from(tabs.children).find(function (item) {
      return item.title === "About";
    });
    tabs.insertBefore(tab, aboutTab || null);
    controls.appendChild(panel);
    elevator.panels.push(restorePanel);
    tab.onclick = elevator.buttonClick.bind(elevator);
    tab.onkeydown = elevator.buttonKeyDown;
  }

  function installProjectNameField() {
    var toolbar = global.document.querySelector("#controls .toolbarpanel") ||
      global.document.querySelector(".toolbarpanel");
    if (!toolbar) return false;
    toolbar.classList.add("zoidium-project-toolbar");
    var field = toolbar.querySelector(".zoidium-project-name");

    if (!field) {
      field = global.document.createElement("label");
      field.className = "zoidium-project-name";
      field.title = "Project name";
      var input = global.document.createElement("input");
      input.type = "text";
      input.className = "pz-inputbox";
      input.name = "project-name";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 120;
      input.setAttribute("aria-label", "Project name");
      input.value = projectFiles.getProjectName(editor);
      input.title = input.value;
      input.addEventListener("input", function () {
        projectFiles.setRawProjectName(editor, input.value);
        input.title = input.value;
      });
      input.addEventListener("blur", function () {
        input.value = projectFiles.setProjectName(editor, input.value);
        input.title = input.value;
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          input.blur();
        }
        event.stopPropagation();
      });
      field.appendChild(input);
      toolbar.insertBefore(field, toolbar.firstElementChild);

      global.addEventListener("zoidium:project-name-changed", function (event) {
        var detail = event.detail || {};
        if (detail.editor !== editor || global.document.activeElement === input) return;
        input.value = detail.name || projectFiles.defaultProjectName;
        input.title = input.value;
      });
    }

    var actions = toolbar.querySelector(".zoidium-project-actions");
    if (!actions) {
      actions = global.document.createElement("div");
      actions.className = "zoidium-project-actions";
    }
    Array.from(toolbar.children).forEach(function (child) {
      if (child !== field && child !== actions) actions.appendChild(child);
    });
    if (toolbar.firstElementChild !== field || toolbar.lastElementChild !== actions) {
      toolbar.appendChild(field);
      toolbar.appendChild(actions);
    }
    return true;
  }

  global.addEventListener("zoidium:project-saved", function (event) {
    var detail = event.detail || {};
    if (detail.editor !== editor) return;
    showToast({ title: "Saved.", message: detail.filename || "Project file updated." });
  });
  global.addEventListener("zoidium:notification", function (event) {
    showToast(event.detail || {});
  });
  global.addEventListener("zoidium:project-error", function (event) {
    var detail = event.detail || {};
    if (detail.editor !== editor) return;
    showProjectError(detail);
  });

  var toolbarObserver;
  var toolbarTimer = global.setInterval(function () {
    if (installProjectNameField()) {
      global.clearInterval(toolbarTimer);
    }
  }, 100);
  toolbarObserver = new MutationObserver(function () {
    installProjectNameField();
  });
  toolbarObserver.observe(global.document.body, { childList: true, subtree: true });
  if (installProjectNameField()) {
    global.clearInterval(toolbarTimer);
  }

  var panel = createPanel();
  createTab(panel);
  state.backupIntervalMs = readBackupInterval();
  if (state.intervalSelect) state.intervalSelect.value = String(state.backupIntervalMs);
  refreshSnapshots();
  scheduleBackups(true);

  global.addEventListener("beforeunload", function () {
    if (state.backupTimer) global.clearInterval(state.backupTimer);
    if (state.startupTimer) global.clearTimeout(state.startupTimer);
    toolbarObserver.disconnect();
  });
})(window);
