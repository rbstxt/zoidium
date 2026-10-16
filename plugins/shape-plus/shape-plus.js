"use strict";
module.exports = {
  activate(context) {
    const require = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/shape-plus/" });
    require("./runtime.js").install(context);
  },
};
