"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const Q = commonJS ? require("./vendor/quickjs/quickjs") : root.ZoidiumQuickJS;
  const S = commonJS ? require("./community-safe-json") : root.ZoidiumCommunityJSON;
  let initialized;
  function source(code) {
    if (typeof code !== "string" || new TextEncoder().encode(code).length > 65536) S.fail("guest source limit exceeded");
    const tree = Q.parse(code, { ecmaVersion: 2022, sourceType: "script" });
    let nodes = 0;
    function walk(n, depth) {
      if (!n || typeof n !== "object") return;
      if (++nodes > 20000 || depth > 128) S.fail("guest syntax complexity limit exceeded");
      if (n.async || n.generator || ["ImportExpression", "AwaitExpression", "YieldExpression", "WithStatement"].includes(n.type)) S.fail("guest source must be synchronous and self-contained");
      for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1)); else if (v && typeof v === "object") walk(v, depth + 1);
    }
    walk(tree, 0);
    return code;
  }
  const PRELUDE = `"use strict";
    Object.defineProperty(Function.prototype, "constructor", {value:undefined});
    for (const name of ["Date","Promise","eval","Function","WebAssembly","SharedArrayBuffer","Atomics"]) globalThis[name]=undefined;
    Math.random=undefined;
    function freezeData(v){ if(v&&typeof v==="object"){Object.values(v).forEach(freezeData);Object.freeze(v);}return v; }
  `;
  async function evaluate(code, operation, input) {
    source(code); S.data(input);
    initialized ||= Q.create();
    const q = await initialized;
    const runtime = q.newRuntime();
    runtime.setMemoryLimit(8 * 1024 * 1024); runtime.setMaxStackSize(256 * 1024);
    let checkpoints = 0;
    runtime.setInterruptHandler(() => ++checkpoints > 1000);
    let context;
    try {
      context = runtime.newContext();
      const program = PRELUDE + '\n(function(){\n' + code + '\n;const input=freezeData(JSON.parse(' + JSON.stringify(JSON.stringify(input)) + '));\nreturn JSON.stringify(' + (operation === "prepareEffect" ? "prepare" : "uiEvent") + '(input));\n})()';
      const result = context.evalCode(program, "community-guest.js", { type: "global" });
      const handle = result.error || result.value;
      try {
        if (result.error) throw new Error("GUEST_EXECUTION_FAILED: " + context.getProp(handle, "message").consume(h => context.getString(h)).slice(0, 4096));
        if (context.typeof(handle) !== "string") throw new Error("Guest must return a JSON record");
        return { value: S.parse(context.getString(handle), 65536, 16), checkpoints };
      } finally { handle.dispose(); }
    } finally { if (context) context.dispose(); runtime.dispose(); }
  }
  async function initialize() { initialized ||= Q.create(); await initialized; }
  const api = { source, evaluate, initialize };
  if (commonJS) module.exports = api; else root.ZoidiumCommunityInterpreter = api;
})(globalThis);
