"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const Policy = commonJS ? require("./community-resource-policy") : root.ZoidiumCommunityResourcePolicy;
  const Host = commonJS ? require("./community-effect-host") : root.ZoidiumCommunityEffectHost;
  const clone = value => JSON.parse(JSON.stringify(value));
  function freeze(value) {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function install({ effect, instance, stamp, sameStamp, valid, compute, PZ = root.PZ }) {
    const receipts = new Map(), pending = new Map();
    let generation = 0;
    const policy = Policy.create({ PZ });
    const key = authority => JSON.stringify([authority.projectGeneration, authority.revision, authority.frameKey,
      authority.assetKey, authority.contextKey]);
    function current(frame, context = {}) { return stamp(effect, frame, context); }
    function lookup(frame, context = {}) {
      if (!valid()) return null;
      try {
        const authority = current(frame, context), receipt = receipts.get(key(authority));
        return receipt && sameStamp(receipt.authority, authority) ? receipt : null;
      } catch (_) { return null; }
    }
    function clear() { generation++; receipts.clear(); pending.clear(); instance.receipt = null; }
    async function preflight(_effect, frame, context = {}) {
      if (context.exportPolicy?.communityBypass) return;
      if (!valid()) { clear(); return; }
      const authority = current(frame, context), cacheKey = key(authority);
      const cached = lookup(frame, context);
      if (cached) { instance.receipt = cached; return; }
      // Results from another exact time remain in the bounded cache, but can
      // never become the current draw's uniforms while its request is pending.
      instance.receipt = null;
      if (effect.properties?.add) Host.status(effect, "COMMUNITY_PREPARATION_PENDING: waiting for the exact frame");
      if (pending.has(cacheKey)) return pending.get(cacheKey);
      const epoch = generation;
      const work = (async () => {
        const result = await compute(authority);
        if (!result || epoch !== generation || !valid() || !sameStamp(authority, current(frame, context))) return;
        const receipt = Object.freeze({ authority: Object.freeze(authority), result: freeze(clone(result)) });
        receipts.set(cacheKey, receipt); instance.receipt = receipt; if (effect.properties?.add) Host.status(effect, null);
        while (receipts.size > 64) receipts.delete(receipts.keys().next().value);
      })().catch(error => {
        clear(); if (effect.properties?.add) Host.status(effect, String(error.message).slice(0, 4096)); throw error;
      }).finally(() => { if (pending.get(cacheKey) === work) pending.delete(cacheKey); });
      pending.set(cacheKey, work);
      return work;
    }
    function getRequest(_effect, frame, context = {}) {
      if (context.exportPolicy?.communityBypass) return null;
      const receipt = lookup(frame, context), temporal = receipt?.result.temporal;
      return temporal ? { frames: temporal.offsets, preserveInputRGB: true } : null;
    }
    function drawReceipt() {
      const temporal = PZ.zoidium?.temporal;
      const authority = root.__zoidiumTemporalParts?.sampler?.drawAuthority(temporal, effect);
      const receipt = authority ? lookup(authority.controlFrame, authority) : lookup(instance.frame);
      if (!receipt && valid() && !effect._communityError && effect.properties?.add) {
        Host.status(effect, "COMMUNITY_PREPARATION_PENDING: exact frame receipt is unavailable");
      }
      return receipt;
    }
    effect._zoidiumFrameSampler = { preflight, getRequest, resourcePolicy: policy };
    return { clear, preflight, lookup, drawReceipt, policy };
  }
  const api = { install, freeze };
  if (commonJS) module.exports = api; else root.ZoidiumCommunityTemporal = api;
})(globalThis);
