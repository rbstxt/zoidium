// Camera+ focus tools: a property-row button in the Depth of Field group opens
// a floating window that picks a target object in the same scene. The window
// links the focus distance to that object (live expression) or sets it once
// at the playhead as a keyframe. Edits go through the CM3 property operations
// and history, so undo/redo works.
//
// CM3 expressions cannot name the owning object, so a link stores both object
// addresses as literal arrays: focusDistanceTo([camera], [target]).
//
// Evaluated with (PZ, THREE, parts) by camera-runtime.js; publishes parts.focus.
parts.focus = (function () {
  const METHOD_NAME = "focusDistanceTo";
  const WINDOW_PREFIX = "focus:";

  function ownerObject(PZ, property) {
    let node = property;
    for (let depth = 0; node && depth < 16; depth++) {
      if (node instanceof PZ.object3d) return node;
      node = node.parent;
    }
    return null;
  }

  function resolveEditor(getEditor) {
    // No editor is open yet, or the host getter threw; callers treat null as unavailable.
    try {
      return (getEditor && getEditor()) || null;
    } catch (_error) {
      return null;
    }
  }

  // options: PZ, THREE, ui (context.ui), getEditor, objectType (Camera+ type id),
  // worldDistance(THREE, from, to).
  function createFocusTools(options, camera) {
    const PZ = options.PZ;
    const THREE = options.THREE;
    const ui = options.ui;
    const focusProperty = camera.properties.depthOfField.focusDistance;

    function notify(message) {
      try {
        if (ui && typeof ui.notify === "function") ui.notify({ title: "Focus Tools", message: message });
      } catch (_error) { /* notification is best-effort */ }
    }

    // Targets are limited to the camera's scene. Their transforms are updated
    // in the same scene pass as the camera, so a link reads current values.
    function listTargets() {
      const scene = camera.tryGetParentOfType(PZ.layer);
      const items = [];
      const byId = new Map();
      if (!scene) return { items: items, byId: byId };
      scene.forEachItemOfType(PZ.object3d, function (object) {
        if (object === camera || !object.threeObj || object._zoidiumMissingObject) return;
        if (object instanceof PZ.object3d.camera || object.type === options.objectType) return;
        const id = JSON.stringify(object.getAddress());
        let name = "3D Object";
        try {
          name = object.properties.name.get() || name;
        } catch (_error) { /* keep fallback */ }
        items.push({ id: id, title: name, detail: scene.properties.name.get() || "" });
        byId.set(id, object);
      });
      return { items: items, byId: byId };
    }

    // Every button is one history operation, so it undoes in a single step.
    function edit(label, run) {
      const editor = resolveEditor(options.getEditor);
      if (!editor || !editor.history || !editor.project || !editor.playback) {
        notify("No active editor to " + label + ".");
        return;
      }
      const ops = new PZ.ui.properties(editor);
      editor.history.startOperation();
      try {
        run(editor, ops);
      } catch (error) {
        console.error("Camera+ focus tools could not " + label + ".", error);
        notify("Could not " + label + ".");
      } finally {
        editor.history.finishOperation();
      }
    }

    function clearExpression(ops) {
      if (focusProperty.expression) {
        ops.setExpression({ property: focusProperty.getAddress(), expression: null });
      }
    }

    function link(target) {
      edit("link the focus distance", function (editor, ops) {
        const source = METHOD_NAME + "(" + JSON.stringify(camera.getAddress()) + ", " +
          JSON.stringify(target.getAddress()) + ")";
        ops.setExpression({ property: focusProperty.getAddress(), expression: source });
      });
    }

    function setOnce(target) {
      edit("set the focus distance", function (editor, ops) {
        const distance = options.worldDistance(THREE, camera, target);
        clearExpression(ops);
        const frame = editor.playback.currentFrame - focusProperty.frameOffset;
        // setValue changes the nearest existing key, so create the playhead
        // key explicitly before writing. Animation and expression removal
        // stay in the same history operation.
        if (typeof focusProperty.getKeyframe === "function" && !focusProperty.getKeyframe(frame)) {
          ops.createKeyframe({ property: focusProperty.getAddress(), data: { frame: frame, value: distance, tween: focusProperty.defaultTween } });
        } else {
          ops.setValue({ property: focusProperty.getAddress(), frame: frame, value: distance });
        }
        if (!focusProperty.animated && typeof ops.toggleAnimation === "function") {
          ops.toggleAnimation(focusProperty, frame, false, true);
        }
      });
    }

    // Unlink always clears the expression, even when none is read back.
    function unlink() {
      edit("unlink the focus distance", function (editor, ops) {
        ops.setExpression({ property: focusProperty.getAddress(), expression: null });
      });
    }

    function openTargetWindow(mode) {
      if (!ui || typeof ui.openWindow !== "function") return null;
      if (!camera._focusWindowKey) camera._focusWindowKey = options.nextKey();
      const current = listTargets();
      let win;
      win = ui.openWindow({
        id: WINDOW_PREFIX + camera._focusWindowKey + ":" + mode,
        title: mode === "link" ? "Link focus distance to..." : "Set focus distance to...",
        width: 320,
        height: 280,
        isValid: () => camera.parent != null,
        mount(body) {
          body.appendChild(ui.controls.list({
            items: current.items,
            emptyText: "No other 3D objects in this scene.",
            onSelect(id) {
              const target = current.byId.get(id);
              if (!target || target.tryGetParentOfType(PZ.layer) !== camera.tryGetParentOfType(PZ.layer)) return;
              if (mode === "link") link(target);
              else setOnce(target);
              win.close();
            },
          }).element);
        },
      });
      return win;
    }

    function openWindow() {
      if (!ui || typeof ui.openWindow !== "function") {
        notify("The floating window API is unavailable.");
        return null;
      }
      if (!camera._focusWindowKey) camera._focusWindowKey = options.nextKey();
      let selectedId = null;
      let current = listTargets();
      function selectedObject() {
        return selectedId !== null ? current.byId.get(selectedId) || null : null;
      }
      const controls = ui.controls;
      return ui.openWindow({
        id: WINDOW_PREFIX + camera._focusWindowKey,
        title: "Focus Tools",
        subtitle: camera.properties.name.get(),
        persistKey: "focus-tools",
        width: 320,
        height: 380,
        mount(body) {
          const section = controls.section("Target object");
          const picker = controls.list({
            items: current.items,
            emptyText: "No other 3D objects in this scene.",
            onSelect(id) {
              selectedId = id;
            },
          });
          section.body.appendChild(picker.element);
          body.appendChild(section.element);
          body.appendChild(controls.note(
            "Link keeps the focus distance following the target. Set Once writes the current distance at the playhead.",
          ).element);
          // The list is captured when the window opens, but objects can be
          // added or removed while it stays open (reopening the same id only
          // focuses the window). Refresh on every scene-object change and on
          // every validity poll so the list never goes stale.
          function refresh() {
            const fresh = listTargets();
            current = fresh;
            if (picker && typeof picker.setItems === "function") picker.setItems(fresh.items);
            if (selectedId !== null && !fresh.byId.has(selectedId)) {
              selectedId = null;
              if (picker && typeof picker.set === "function") picker.set(null);
            }
          }
          let unwatch = null;
          try {
            const scene = camera.tryGetParentOfType(PZ.layer);
            const list = scene && scene.objects;
            if (list && list.onListChanged && typeof list.onListChanged.watch === "function") {
              const onChange = function () {
                refresh();
              };
              list.onListChanged.watch(onChange);
              unwatch = function () {
                if (typeof list.onListChanged.unwatch === "function") list.onListChanged.unwatch(onChange);
              };
            }
          } catch (_error) {
            console.warn("[Zoidium] camera-plus: focus target watcher failed; the list still refreshes on poll", _error);
            unwatch = null;
          }
          camera._focusRefreshTargets = refresh;
          return function cleanup() {
            selectedId = null;
            if (camera._focusRefreshTargets === refresh) camera._focusRefreshTargets = null;
            if (unwatch) unwatch();
          };
        },
        isValid: () => {
          if (typeof camera._focusRefreshTargets === "function") {
            try {
              camera._focusRefreshTargets();
            } catch (_error) { /* a stale list is better than a closed window */ }
          }
          return camera.parent != null;
        },
        footer: [
          {
            title: "Link",
            variant: "primary",
            onClick: () => {
              const target = selectedObject();
              if (target) link(target);
              else notify("Select a target object first.");
            },
          },
          {
            title: "Set Once",
            onClick: () => {
              const target = selectedObject();
              if (target) setOnce(target);
              else notify("Select a target object first.");
            },
          },
          { title: "Unlink", onClick: () => unlink() },
        ],
      });
    }

    return { openWindow: openWindow, openTargetWindow: openTargetWindow, unlink: unlink, listTargets: listTargets };
  }

  // Property-row control factory for the focus entry in the Depth of Field
  // group. `zoidiumUI` supplies the shared button builder; `openFor(object)`
  // opens the window for the owning camera.
  //
  // The same row carries the 3D-track guidance: while the project has no
  // video track with 3D enabled, a note explains that Camera+ only drives
  // 3D tracks, with a one-click button that enables 3D on the first such
  // track through the track header's own undoable toggle. The note is
  // DOM-only (no new property, no saved data) and rebuilds with the panel,
  // so it disappears once a 3D track exists. The first panel built per
  // project also fires one toast through options.hint.notify.
  function createControl(options, property, context) {
    const owner = ownerObject(options.PZ, property);
    const document = context && context.document;
    if (!owner || !document || !options.zoidiumUI) return null;
    const row = options.zoidiumUI.controls.buttonRow([
      { title: "Link", hint: "Link focus distance to...", onClick: () => options.openFor(owner, "link") },
      { title: "Set", hint: "Set focus distance to...", onClick: () => options.openFor(owner, "set") },
      { title: "Unlink", hint: "Remove the focus distance expression", onClick: () => options.openFor(owner, "unlink") },
      {
        title: "Focus Tools...",
        hint: "Link or set the focus distance to another object in this scene",
        onClick: function () {
          options.openFor(owner);
        },
      },
    ]);
    const wrap = document.createElement("div");
    if (!wrap || typeof wrap.appendChild !== "function") return null;
    wrap.className = "editbox zoidium-camera-focus-tools";
    const hint = options.hint && options.hint.api ? options.hint : null;
    let hintBox = null;
    function currentProject() {
      try {
        return hint && typeof hint.getProject === "function" ? hint.getProject() : null;
      } catch (_error) {
        return null;
      }
    }
    function notifyOnce(project) {
      if (!hint || !project) return;
      try {
        hint.api.maybeNotify({
          getProject: () => project,
          notify: hint.notify,
          notified: hint.notified,
        });
      } catch (_error) { /* guidance is best-effort */ }
    }
    function enable3d(target) {
      try {
        const editor = hint && typeof hint.getEditor === "function" ? hint.getEditor() : null;
        if (!editor || typeof hint.toggleTrack3d !== "function") return false;
        hint.toggleTrack3d(target.track, editor);
        return true;
      } catch (error) {
        console.error("Camera+ could not enable 3D tracking.", error);
        return false;
      }
    }
    function buildHintBox(project) {
      try {
        const box = document.createElement("div");
        if (!box || typeof box.appendChild !== "function") return null;
        box.className = "zoidium-camera-track-hint";
        // CM3 property rows set white-space: nowrap on the editbox; the hint
        // must wrap inside the panel instead of running past its edge.
        try {
          if (box.style) box.style.whiteSpace = "normal";
        } catch (_error) { /* inline style is best-effort */ }
        const controls = options.zoidiumUI.controls;
        if (!controls || typeof controls.note !== "function") return null;
        box.appendChild(controls.note(hint.api.MESSAGE).element);
        const target = hint.api.firstTrackWithout3D(project);
        if (target && typeof hint.toggleTrack3d === "function" && typeof controls.buttonRow === "function") {
          const enable = controls.buttonRow([
            {
              title: hint.api.enableLabel(target),
              hint: hint.api.enableHint(target),
              onClick: function () {
                if (enable3d(target)) renderHint();
                else if (typeof hint.notify === "function") hint.notify({ title: hint.api.TITLE, message: hint.api.ENABLE_FAILED });
              },
            },
          ]);
          if (enable && enable.element) box.appendChild(enable.element);
        }
        return box;
      } catch (_error) {
        return null;
      }
    }
    function renderHint() {
      try {
        if (hintBox && hintBox.parentNode === wrap && typeof wrap.removeChild === "function") wrap.removeChild(hintBox);
      } catch (_error) { /* a stale box is better than a broken row */ }
      hintBox = null;
      if (!hint) return;
      const project = currentProject();
      if (!project || !hint.api.needsHint(project)) return;
      notifyOnce(project);
      const box = buildHintBox(project);
      if (!box) return;
      hintBox = box;
      try {
        if (typeof wrap.insertBefore === "function" && wrap.firstChild) wrap.insertBefore(hintBox, wrap.firstChild);
        else wrap.appendChild(hintBox);
      } catch (_error) {
        hintBox = null;
      }
    }
    renderHint();
    wrap.appendChild(row.element);
    // CM3 refreshes property rows through pz_update; re-evaluate the hint so
    // enabling 3D hides the note without reselecting the camera.
    try {
      wrap.pz_refresh = renderHint;
    } catch (_error) { /* refresh is best-effort */ }
    return wrap;
  }

  // Expression method. Arguments are object addresses in the active project;
  // the result is the world distance between the two current transforms.
  function createExpressionMethod(options) {
    return function focusDistanceTo(cameraAddress, targetAddress) {
      const editor = resolveEditor(options.getEditor);
      const project = editor && editor.project;
      if (!project || typeof project.addressLookup !== "function") return 0;
      const from = project.addressLookup(cameraAddress);
      const to = project.addressLookup(targetAddress);
      if (!from || !from.threeObj || !to || !to.threeObj) return 0;
      return options.worldDistance(options.THREE, from, to);
    };
  }

  return {
    METHOD_NAME: METHOD_NAME,
    createFocusTools: createFocusTools,
    createControl: createControl,
    createExpressionMethod: createExpressionMethod,
  };
})();
