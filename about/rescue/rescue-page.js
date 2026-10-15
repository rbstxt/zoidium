// Builds the rescue bookmarklet from project-rescue.js, so the page never
// carries a second copy of the script. Status texts come from data-*
// attributes on #rescue-tool, which keeps the English and Japanese pages on
// one script.
(function installRescuePage(global) {
  "use strict";
  var SCRIPT_URL = "/about/rescue/project-rescue.js";
  var root = global.document.getElementById("rescue-tool");
  if (!root) return;
  var text = root.dataset;
  var link = global.document.getElementById("rescue-bookmarklet");
  var status = global.document.getElementById("rescue-status");
  var copyButton = global.document.getElementById("rescue-copy");
  var openerButton = global.document.getElementById("rescue-opener");
  var source = null;

  // A javascript: URL is percent-decoded before it runs, and URL parsing
  // drops raw newlines and tabs. Escape only those characters, so the
  // bookmark stays close to the script's own size. Comment-only lines and
  // indentation are removed; the script has no multi-line strings.
  function bookmarklet(script) {
    var body = script.split("\n")
      .filter(function (line) { return !/^\s*\/\//.test(line); })
      .map(function (line) { return line.trim(); })
      .join("\n");
    return "javascript:" + ("void function(){" + body + "\n}();")
      .replace(/%/g, "%25")
      .replace(/\r/g, "")
      .replace(/\n/g, "%0A")
      .replace(/\t/g, "%09")
      .replace(/#/g, "%23");
  }

  // The editor tab that opened this page (from an error message) can run the
  // script directly. That also covers the desktop app, which has no bookmarks.
  function openerEditor() {
    try {
      var opener = global.opener;
      return opener && opener !== global && opener.PZ && opener.CM && opener.CM.project ? opener : null;
    } catch (_error) {
      return null;
    }
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }

  link.addEventListener("click", function (event) {
    // Clicking it here would rescue this help page, not the editor.
    event.preventDefault();
    setStatus(text.dragHint);
  });

  copyButton.addEventListener("click", function () {
    if (!source) return;
    global.navigator.clipboard.writeText(source).then(function () {
      setStatus(text.copied);
    }, function () {
      var area = global.document.getElementById("rescue-source");
      area.hidden = false;
      area.value = source;
      area.select();
      setStatus(text.copyFailed, true);
    });
  });

  openerButton.addEventListener("click", function () {
    var editor = openerEditor();
    if (!editor || !source) {
      setStatus(text.openerGone, true);
      return;
    }
    try {
      editor.eval(source);
      editor.focus();
      setStatus(text.openerStarted);
    } catch (error) {
      setStatus(text.openerFailed + " " + (error && error.message ? error.message : String(error)), true);
    }
  });

  global.fetch(SCRIPT_URL, { cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.text();
    })
    .then(function (script) {
      source = script;
      link.href = bookmarklet(script);
      link.classList.remove("is-loading");
      link.removeAttribute("aria-disabled");
      copyButton.disabled = false;
      if (openerEditor()) {
        openerButton.hidden = false;
        openerButton.disabled = false;
      }
      setStatus(text.ready.replace("{size}", Math.round(link.href.length / 1024) + " KB"));
    })
    .catch(function (error) {
      setStatus(text.loadFailed + " (" + (error && error.message ? error.message : String(error)) + ")", true);
    });
})(window);
