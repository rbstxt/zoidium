(function installRenderTimeGpu(global) {
  "use strict";

  function create(gl) {
    if (!gl?.getExtension) return null;
    const webgl2 = typeof gl.beginQuery === "function";
    const ext = gl.getExtension(webgl2 ? "EXT_disjoint_timer_query_webgl2" : "EXT_disjoint_timer_query");
    if (!ext) return null;

    const target = ext.TIME_ELAPSED_EXT;
    let epoch = 0;
    const current = () => webgl2
      ? gl.getQuery(target, gl.CURRENT_QUERY)
      : ext.getQueryEXT(target, ext.CURRENT_QUERY_EXT);
    return {
      get epoch() { return epoch; },
      check() {
        if (gl.isContextLost?.() || gl.getParameter(ext.GPU_DISJOINT_EXT)) epoch++;
      },
      active: () => !!current(),
      current,
      begin() {
        // Leave another extension's active query alone.
        if (current()) return null;
        const query = webgl2 ? gl.createQuery() : ext.createQueryEXT();
        if (query) {
          if (webgl2) gl.beginQuery(target, query);
          else ext.beginQueryEXT(target, query);
        }
        return query;
      },
      end() {
        if (webgl2) gl.endQuery(target);
        else ext.endQueryEXT(target);
      },
      ready(query) {
        return webgl2
          ? gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)
          : ext.getQueryObjectEXT(query, ext.QUERY_RESULT_AVAILABLE_EXT);
      },
      milliseconds(query) {
        const ns = webgl2
          ? gl.getQueryParameter(query, gl.QUERY_RESULT)
          : ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT);
        return ns / 1e6;
      },
      remove(query) {
        if (webgl2) gl.deleteQuery(query);
        else ext.deleteQueryEXT(query);
      },
    };
  }

  global.ZoidiumRenderTimeGpu = { create };
})(window);
