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

  // Shared extension namespace. Every Zoidium-owned integration registers
  // here through define() instead of assigning properties directly, so a
  // collision is reported with both owners instead of silently overwriting.
  // This layer loads before every other Zoidium script, so define() is
  // always available to later files.
  var zoidiumNamespaceOwners = {};
  PZ.zoidium = PZ.zoidium || {};
  function zoidiumOwnerLabel(owner) {
    return owner ? " (" + owner + ")" : "";
  }
  if (typeof PZ.zoidium.define !== "function") {
    PZ.zoidium.define = function (name, api, owner) {
      if (typeof name !== "string" || !name) {
        throw new Error("Zoidium namespace name must be a non-empty string");
      }
      if (
        Object.prototype.hasOwnProperty.call(PZ.zoidium, name) &&
        PZ.zoidium[name] !== api
      ) {
        console.warn(
          "[Zoidium] namespace collision on PZ.zoidium." + name +
          ": previously registered" + zoidiumOwnerLabel(zoidiumNamespaceOwners[name]) +
          ", now overwritten" + zoidiumOwnerLabel(owner)
        );
      }
      zoidiumNamespaceOwners[name] = owner || null;
      PZ.zoidium[name] = api;
      return api;
    };
  }
  if (typeof PZ.zoidium.ownerOf !== "function") {
    PZ.zoidium.ownerOf = function (name) {
      return Object.prototype.hasOwnProperty.call(zoidiumNamespaceOwners, name)
        ? zoidiumNamespaceOwners[name]
        : null;
    };
  }

  global.__ZOIDIUM_AD_BLOCK__ = true;
})(window);
