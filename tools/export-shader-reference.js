"use strict";
// stdout only: node tools/export-shader-reference.js > /tmp/shader-reference.json
process.stdout.write(JSON.stringify(require("../plugins/shader-plus/reference.js"), null, 2) + "\n");
