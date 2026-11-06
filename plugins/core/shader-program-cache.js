(function installShaderProgramCache(global) {
  "use strict";

  // r91 releases a program as soon as its last material changes keys. Keep a
  // bounded reference so undoing a light-count change can reuse that program.
  // Entries belong to one viewport and are released on project replacement.
  function install(renderer, revision, limit = 32) {
    if (String(revision) !== "91" || !Array.isArray(renderer?.info?.programs)) return null;
    // r91 replaces this array when a lost WebGL context is restored.
    let programs = renderer.info.programs;
    const retained = new Map();
    const originals = new Map();
    let clock = 0;
    let disposed = false;

    function release(program) {
      retained.delete(program);
      program.usedTimes -= 1;
      if (program.usedTimes !== 0) return;
      // Match r91 WebGLPrograms.releaseProgram's array removal. The public
      // info.programs array is the renderer's actual program cache in r91.
      const index = programs.indexOf(program);
      if (index < 0) return;
      programs[index] = programs[programs.length - 1];
      programs.pop();
      program.destroy();
    }

    function collect() {
      if (disposed) return;
      if (renderer.info.programs !== programs) {
        // A restored context has new programs. The retained ones are gone.
        programs = renderer.info.programs;
        retained.clear();
      }
      clock += 1;
      for (const program of programs) {
        // Diagnostics can retain the source material and its textures. Let
        // native disposal release those programs and report errors again.
        if (program.diagnostics) continue;
        if (typeof program.destroy !== "function" || !Number.isInteger(program.usedTimes) || program.usedTimes < 1) continue;
        if (!retained.has(program)) {
          program.usedTimes += 1;
          retained.set(program, clock);
        } else if (program.usedTimes > 1) retained.set(program, clock);
      }
      while (retained.size > limit) {
        let oldest;
        for (const [program, age] of retained) {
          // Prefer unused variants, then the least recently active program.
          const rank = (program.usedTimes > 1 ? clock + 1 : 0) + age;
          if (!oldest || rank < oldest.rank) oldest = { program, rank };
        }
        release(oldest.program);
      }
    }

    for (const method of ["render", "compile"]) {
      const original = renderer[method];
      if (typeof original !== "function") continue;
      function wrapped() {
        try { return original.apply(this, arguments); }
        finally { collect(); }
      }
      originals.set(method, { original, wrapped });
      renderer[method] = wrapped;
    }
    function clear() {
      for (const program of Array.from(retained.keys())) release(program);
    }
    return {
      clear,
      dispose() {
        disposed = true;
        clear();
        for (const [method, { original, wrapped }] of originals) {
          if (renderer[method] === wrapped) renderer[method] = original;
        }
      },
    };
  }

  const api = { install };
  if (typeof module === "object" && module.exports) module.exports = api;
  else global.ZoidiumShaderPrograms = api;
})(typeof window !== "undefined" ? window : globalThis);
