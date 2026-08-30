(function (global) {
  "use strict";

  var originalOpen = global.open;

  function isDownloadPage(value) {
    if (typeof value !== "string") return false;
    try {
      var pathname = new URL(value, global.location.href).pathname;
      return /(?:^|\/)download(?:\/index)?\.html$|\/download\/?$/i.test(pathname);
    } catch (_error) {
      return false;
    }
  }

  function triggerDownload() {
    var pz = global.PZ || {};
    var blob = pz.downloadBlob;
    if (!(blob instanceof Blob)) return false;

    var filename = String(pz.downloadFilename || "zoidium-download");
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  }

  function openWithDownloadFallback() {
    if (isDownloadPage(arguments[0]) && triggerDownload()) return null;
    return originalOpen.apply(this, arguments);
  }

  global.open = openWithDownloadFallback;
  if (global.window) global.window.open = openWithDownloadFallback;
})(window);
