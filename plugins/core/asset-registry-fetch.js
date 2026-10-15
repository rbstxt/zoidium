(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts = global.ZoidiumAssetRegistryParts || {};
  const delays = [2000, 6000, 18000];
  function transient(error) {
    const status = error?.status || Number(/\bHTTP\s+(\d{3})\b/i.exec(error?.message || "")?.[1]);
    if (status) return status === 429 || status >= 500 && status <= 599;
    return error?.name === "TimeoutError" || error?.name === "AbortError" ||
      error?.name === "TypeError" || /network|fetch|timed?\s*out|timeout/i.test(error?.message || "");
  }
  function abortError() { return new Error("Asset loading was canceled."); }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const abort = () => { global.clearTimeout(timer); reject(abortError()); };
      const timer = global.setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  async function retry(task, { enabled = true, signal, onRetry } = {}) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      try { return await task(); }
      catch (error) {
        if (!enabled || signal?.aborted || attempt === delays.length || !transient(error)) throw error;
        onRetry?.(attempt + 1);
        await wait(delays[attempt], signal);
      }
    }
  }
  function urlOf(asset) {
    const url = asset?.url;
    return typeof url === "string" && url.startsWith("/assets/") ? url.slice(1) : url;
  }
  async function response(asset, { signal } = {}) {
    const controller = new global.AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = global.setTimeout(abort, 30000);
    try {
      const result = await global.fetch(urlOf(asset), { signal: controller.signal, cache: "no-cache" });
      if (!result.ok) throw Object.assign(new Error("HTTP " + result.status + " while fetching the asset."), { status: result.status });
      // Read inside the timeout, so stalled response bodies also retry.
      const bytes = await result.arrayBuffer();
      return bytes;
    } finally { global.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  function changed(asset) {
    for (const data of asset?.data?.values?.() || []) if (data && typeof data === "object") {
      data.zoidiumAssetRevision = (data.zoidiumAssetRevision || 0) + 1;
    }
    if (global.CustomEvent) {
      global.dispatchEvent?.(new global.CustomEvent("zoidium:asset-status", { detail: asset }));
      global.document?.dispatchEvent(new global.CustomEvent("zoidium:asset-reloaded", { detail: asset }));
    }
  }
  parts.fetch = { transient, retry, response, urlOf, changed };
})(globalThis);
