(function (global) {
  "use strict";

  // The policy layer is loaded around the CM3 runtime and supplies the
  // local-first account, community, and advertising behavior.
  var PZ = (global.PZ = global.PZ || {});

  PZ.stringHash = PZ.stringHash || function (str) {
    var hash = 0;
    for (var i = 0; i < str.length; i += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  };

  PZ.apiOrigin = "";
  PZ.blobOrigin = "";
  PZ.account = PZ.account || {};
  PZ.account.currentUser = null;
  PZ.account.csrf = null;
  PZ.account.getCurrent = async function () {
    return null;
  };
  PZ.account.update = async function () {
    PZ.account.currentUser = null;
    PZ.account.csrf = null;
  };
  PZ.api = async function () {
    return new Response(null, { status: 204 });
  };

  PZ.ui = PZ.ui || {};
  if (typeof PZ.ui.ad !== "function") {
    PZ.ui.ad = function () {
      this.el = document.createElement("div");
      this.el.style.display = "none";
    };
  }
  PZ.ui.ads = {
    loaded: false,
    adsReady: Promise.resolve(),
  };
  PZ.ui.ads.init = async function () {
    this.loaded = false;
    this.adsReady = Promise.resolve();
  };
  PZ.ui.ads.show = async function () {
    return undefined;
  };

  global.__ZOIDIUM_AD_BLOCK__ = true;
})(window);
