"use strict";
module.exports = {
  activate(context) {
    const require = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/" });
    require("./shape-plus/runtime.js").install(context);
  },
};
