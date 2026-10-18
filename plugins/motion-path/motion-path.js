"use strict";
module.exports = {
  activate(context) {
    const require = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/motion-path/" });
    require("./runtime.js").install(context);
  },
};
