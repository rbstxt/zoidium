"use strict";

// This file is appended to fixed trusted runtime bytes. Guest source is data.
(function () {
  const S = globalThis.ZoidiumCommunityJSON, P = globalThis.ZoidiumCommunityPackage;
  const V = globalThis.ZoidiumCommunityProtocol, I = globalThis.ZoidiumCommunityInterpreter;
  let config, bundle, busy = false, lastRequest = null;
  self.onmessage = async event => {
    try {
      if (event.ports.length) throw new Error("Transferred handles are forbidden");
      if (!config) {
        S.data(event.data); S.keys(event.data, ["binding", "bundle"]);
        bundle = P.bundle(event.data.bundle); I.source(bundle.assets[bundle.manifest.entry]);
        config = event.data.binding;
        S.keys(config, ["packageId", "packageHash", "runnerGeneration"]);
        if (config.packageId !== bundle.manifest.id) throw new Error("Package binding mismatch");
        await I.initialize();
        self.postMessage({ booted: true }); return;
      }
      const m = V.message(event.data); V.binding(m, config);
      if (busy || m.requestId === lastRequest) throw new Error("Duplicate or concurrent request");
      busy = true; lastRequest = m.requestId;
      const effect = V.requestPayload(m, bundle);
      let operation, payload;
      try {
        if (m.operation === "initialize") { operation = "ready"; payload = {}; }
        else if (m.operation === "dispose") { operation = "disposed"; payload = {}; }
        else {
          const result = await I.evaluate(bundle.assets[bundle.manifest.entry], m.operation, m.payload.input);
          payload = V.result(result.value, effect, m.operation);
          operation = m.operation === "prepareEffect" ? "prepared" : "uiPatch";
        }
      } catch (error) { operation = "error"; payload = { code: "PREPARATION_FAILED", message: String(error.message).slice(0, 4096) }; }
      self.postMessage(V.message({ ...m, operation, payload }, true)); busy = false;
    } catch (error) {
      self.postMessage({ fatal: String(error.message).slice(0, 4096) }); self.close();
    }
  };
})();
