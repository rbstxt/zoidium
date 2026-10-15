// Zoidium project-restore toasts (split from project-restore.js).
// Toast notifications and project error reporting. Loads after the store;
// the "Restore backup" recovery action resolves lazily because the panel
// part (which owns it) loads later.
(function installProjectRestoreToasts(global) {
  "use strict";

  var parts = global.__zoidiumRestoreParts || (global.__zoidiumRestoreParts = {});
  if (parts.toasts) return;
  var store = parts.store;
  if (!store) {
    throw new Error("[Zoidium] project-restore-store.js must load before project-restore-toasts.js.");
  }
  var state = store.state;
  var RESCUE_PAGE = "/about/rescue";
  var SUPPORT_URL = "https://discord.gg/PWAmY9m5bu";

  function helpLink(text, href, rel) {
    var link = global.document.createElement("a");
    link.textContent = text;
    link.href = href;
    link.target = "_blank";
    // The rescue page keeps its opener so it can start the rescue tool in
    // this editor tab; the external support link must not.
    link.rel = rel;
    return link;
  }

  function helpText(text) {
    var span = global.document.createElement("span");
    span.textContent = text;
    return span;
  }

  // Error toasts point to the rescue tool, then to bug reports on Discord.
  function createHelp() {
    var help = global.document.createElement("div");
    help.className = "zoidium-project-toast-help";
    help.appendChild(helpText("Can't save or restore? "));
    help.appendChild(helpLink("Try the rescue tool", RESCUE_PAGE, "opener"));
    help.appendChild(helpText(". Still stuck? "));
    help.appendChild(helpLink("Report the bug on Discord", SUPPORT_URL, "noopener noreferrer"));
    help.appendChild(helpText("."));
    return help;
  }

  function createToast() {
    var toast = global.document.createElement("aside");
    toast.className = "zoidium-project-toast";
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("role", "status");
    var head = global.document.createElement("div");
    head.className = "zoidium-project-toast-head";
    var title = global.document.createElement("span");
    title.className = "zoidium-project-toast-title";
    head.appendChild(title);
    var close = global.document.createElement("button");
    close.type = "button";
    close.className = "zoidium-project-toast-close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    close.addEventListener("click", function () {
      hideToast();
    });
    head.appendChild(close);
    toast.appendChild(head);
    var message = global.document.createElement("div");
    message.className = "zoidium-project-toast-message";
    toast.appendChild(message);
    toast.appendChild(createHelp());
    var actions = global.document.createElement("div");
    actions.className = "zoidium-project-toast-actions";
    [
      ["retry", "Retry"],
      ["download", "Download"],
      ["recover", "Restore backup"],
      ["reload", "Reload"],
    ].forEach(function (pair) {
      var key = pair[0];
      var label = pair[1];
      var actionButton = global.ZoidiumUI.createButton({
        title: label,
        onClick: function () {
          if (key === "reload") {
            hideToast();
            global.location.reload();
            return;
          }
          runToastAction(key === "retry"
            ? toast._zoidiumRetry
            : key === "download" ? toast._zoidiumDownload : toast._zoidiumRecover);
        },
      });
      actionButton.setAttribute("data-toast-action", key);
      actions.appendChild(actionButton);
    });
    toast.appendChild(actions);
    global.document.body.appendChild(toast);
    state.toast = toast;
    return toast;
  }

  function hideToast() {
    if (!state.toast) return;
    state.toast.classList.remove("is-visible");
    state.toast._zoidiumRetry = null;
    state.toast._zoidiumDownload = null;
    state.toast._zoidiumRecover = null;
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
    toast.querySelector(".zoidium-project-toast-help").hidden = !isError;
    var actions = toast.querySelector(".zoidium-project-toast-actions");
    var retryButton = actions.querySelector('[data-toast-action="retry"]');
    var downloadButton = actions.querySelector('[data-toast-action="download"]');
    var recoverButton = actions.querySelector('[data-toast-action="recover"]');
    var reloadButton = actions.querySelector('[data-toast-action="reload"]');
    // Each action button appears only when its handler exists. Retry and
    // Download apply to error toasts; Reload appears for reload prompts
    // such as the layout switch notice. Buttons without handlers stay
    // hidden instead of rendering as disabled controls.
    var hasRetry = isError && typeof detail.retry === "function";
    var hasDownload = isError && typeof detail.download === "function";
    var hasRecover = isError && typeof detail.recover === "function";
    var hasReload = !!detail.reload;
    retryButton.hidden = !hasRetry;
    downloadButton.hidden = !hasDownload;
    recoverButton.hidden = !hasRecover;
    reloadButton.hidden = !hasReload;
    retryButton.disabled = !hasRetry;
    downloadButton.disabled = !hasDownload;
    recoverButton.disabled = !hasRecover;
    actions.hidden = !hasRetry && !hasDownload && !hasRecover && !hasReload;
    toast._zoidiumRetry = detail.retry || null;
    toast._zoidiumDownload = detail.download || null;
    toast._zoidiumRecover = hasRecover ? detail.recover : null;
    toast.classList.add("is-visible");
    if (toastHideTimer) global.clearTimeout(toastHideTimer);
    // Reload prompts stay visible until dismissed so the action cannot be
    // missed while the user reads the message.
    if (!isError && !hasReload) {
      toastHideTimer = global.setTimeout(hideToast, 3000);
    }
  }

  function showProjectError(detail) {
    var panel = parts.panel;
    showToast({
      type: "error",
      message: detail.message || "The project operation failed.",
      retry: detail.retry,
      download: detail.download,
      recover: detail.recoverable && panel
        ? function () {
          return panel.recoverFromLatestBackup();
        }
        : null,
    });
  }

  parts.toasts = {
    showToast: showToast,
    showProjectError: showProjectError,
  };
  if (typeof module === "object" && module.exports) module.exports = parts.toasts;
})(window);

