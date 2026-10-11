(function (global) {
  "use strict";

  // Assembler for the Zoidium UI kit: toast notifications, the shared confirm
  // dialog, and the frozen ZoidiumUI surface built from the split part files
  // (ui-kit-panels.js, ui-kit-skins.js, ui-kit-windows.js and
  // ui-kit-controls.js, loaded before this file; see postInitScripts in
  // zoidium/runtime-config.js). Larger UI components (embedded property
  // editors, editor launchers, the node editor) live in their own files,
  // loaded before the kit parts. Each queues { name, install(api) } on
  // ZoidiumUIModules; install receives the surface built so far and returns
  // the members it adds. ZoidiumUI is then frozen, so the public surface is
  // fixed once startup finishes.
  //
  // Usage:
  //   global.ZoidiumUI.notify({ title: "Saved.", message: "Done." });
  //
  //   var approved = await global.ZoidiumUI.confirm({
  //     title: "Delete themed windows?",
  //     message: "Delete them?",
  //     confirmLabel: "Delete",
  //     danger: true,
  //   });

  // Sends a toast notification through the shared renderer in
  // project-restore.js. Keeps feature files free of direct CustomEvent
  // construction for the common case.
  function notify(detail) {
    global.dispatchEvent(new CustomEvent("zoidium:notification", {
      detail: detail || {},
    }));
  }

  function call(fn, value) {
    if (typeof fn === "function") fn(value);
  }

  var confirmCounter = 0;
  // Small centered modal-like question dialog built on openWindow and the
  // shared footer buttons. options: { title, message, confirmLabel ("Delete"
  // at destructive call sites), cancelLabel, danger, onConfirm, onCancel }.
  // Enter confirms, Escape and the close button cancel, and a danger dialog
  // focuses the safe (cancel) button. Returns a Promise<boolean> and also
  // calls onConfirm/onCancel. Theme tokens only (see ui-window.css).
  function confirm(options) {
    var config = options || {};
    var title = config.title || "Confirm";
    var message = config.message || "";
    var confirmLabel = config.confirmLabel || "Confirm";
    var cancelLabel = config.cancelLabel || "Cancel";
    var danger = Boolean(config.danger);
    var settled = false;
    var win = null;
    var resolvePromise = function () {};
    var promise = new Promise(function (resolve) { resolvePromise = resolve; });
    function done(value) {
      if (settled) return;
      settled = true;
      call(value ? config.onConfirm : config.onCancel, value);
      resolvePromise(value);
      if (win) win.close();
    }
    confirmCounter += 1;
    win = openWindow({
      id: "confirm-" + confirmCounter + "-" + Date.now().toString(36),
      title: title,
      placement: "center",
      width: 380,
      height: 180,
      minWidth: 320,
      minHeight: 100,
      resizable: false,
      maximizable: false,
      collapsible: false,
      className: "zoidium-confirm",
      mount: function (body, mounted) {
        var text = note(message).element;
        text.classList.add("zoidium-confirm-message");
        body.appendChild(text);
        mounted.setFooter([
          { title: cancelLabel, onClick: function () { done(false); } },
          { title: confirmLabel, variant: danger ? "danger" : "primary", onClick: function () { done(true); } },
        ]);
        var buttons = mounted.footer.querySelectorAll("button");
        var cancelButton = buttons[0];
        var confirmButton = buttons[1];
        function onKey(event) {
          if (!event || event.key !== "Enter" || event.defaultPrevented) return;
          // A focused button activates itself; anything else confirms.
          if (event.target && event.target !== confirmButton
            && event.target.tagName === "BUTTON") {
            return;
          }
          event.preventDefault();
          done(true);
        }
        mounted.element.addEventListener("keydown", onKey);
        var safe = danger ? cancelButton : confirmButton;
        if (safe && typeof safe.focus === "function") {
          if (global.requestAnimationFrame) {
            global.requestAnimationFrame(function () {
              // preventScroll is not supported everywhere; focus still moves.
              try { safe.focus({ preventScroll: true }); } catch (_error) { safe.focus(); }
            });
          } else {
            safe.focus();
          }
        }
        return function () { mounted.element.removeEventListener("keydown", onKey); };
      },
      onClose: function () { done(false); },
    });
    if (!win) {
      done(false);
      return promise;
    }
    // Size the window to its content: a one-line question stays a compact
    // title + message + footer instead of leaving a tall empty body. The
    // height is re-fitted after every clamp (e.g. browser resize) so the
    // dialog never drifts back to its initial height. The body itself is
    // measured through its children: once the window has a fixed height the
    // flex-filled body reports that height as its scroll height, which would
    // make the fit a no-op.
    function fitConfirm() {
      if (!win.isOpen()) return;
      var content = 0;
      var kids = win.body.children || [];
      for (var index = 0; index < kids.length; index += 1) {
        var childHeight = kids[index].offsetHeight;
        if (!Number.isFinite(childHeight)) return;
        content += childHeight;
      }
      if (typeof global.getComputedStyle === "function") {
        try {
          var bodyStyle = global.getComputedStyle(win.body);
          content += parseFloat(bodyStyle.paddingTop) || 0;
          content += parseFloat(bodyStyle.paddingBottom) || 0;
        } catch (_styleError) { /* keep the unpadded sum */ }
      }
      var height = win.titlebar.offsetHeight + content
        + (win.footer.hidden ? 0 : win.footer.offsetHeight) + 2;
      if (!Number.isFinite(height)) return;
      var viewport = global.innerHeight || 720;
      height = Math.max(96, Math.min(height, Math.max(96, viewport - 16)));
      win.element.style.height = Math.round(height) + "px";
    }
    var baseClamp = win._clamp.bind(win);
    win._clamp = function () { baseClamp(); fitConfirm(); };
    if (global.requestAnimationFrame) global.requestAnimationFrame(fitConfirm);
    else fitConfirm();
    return promise;
  }

  // Every part is required: a missing part is a fatal startup error, just
  // like a missing UI kit was before the split.
  var builder = global.ZoidiumUIBuilder || {};
  ["panels", "skins", "windows", "controls"].forEach(function (name) {
    if (!builder[name]) {
      throw new Error("ZoidiumUI is missing its " + name + " part; refusing to start with a partial UI kit");
    }
  });
  // The window manager reports open failures through notify(), which lives
  // in this file.
  builder.notify = notify;
  var openWindow = builder.windows.openWindow;
  var note = builder.controls.note;

  var api = {
    getElevator: builder.panels.getElevator,
    createMenubarTab: builder.panels.createMenubarTab,
    removeMenubarTab: builder.panels.removeMenubarTab,
    createSidePanel: builder.panels.createSidePanel,
    acquirePreview: builder.panels.acquirePreview,
    createPageHeader: builder.panels.createPageHeader,
    notify: notify,
    createSearchBox: builder.panels.createSearchBox,
    attachSearchFilter: builder.panels.attachSearchFilter,
    createButton: builder.panels.createButton,
    confirm: confirm,
    openWindow: builder.windows.openWindow,
    getWindow: builder.windows.getWindow,
    closeWindows: builder.windows.closeWindows,
    registerSkin: builder.skins.registerSkin,
    controls: builder.controls,
  };

  var modules = Array.isArray(global.ZoidiumUIModules) ? global.ZoidiumUIModules : [];
  modules.forEach(function (module) {
    if (!module || typeof module.install !== "function") return;
    var members = module.install(Object.assign({}, api)) || {};
    Object.keys(members).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(api, key)) {
        throw new Error("ZoidiumUI module " + module.name + " redefines " + key);
      }
      api[key] = members[key];
    });
  });
  try { delete global.ZoidiumUIModules; } catch (_error) {
    // A non-configurable global keeps the stale registry undefined instead.
    global.ZoidiumUIModules = undefined;
  }

  global.ZoidiumUI = Object.freeze(api);
})(window);
