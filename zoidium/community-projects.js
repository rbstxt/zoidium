"use strict";

(function (root) {
  const isCommunity = type => typeof type === "string" && /^community-[a-f0-9]{32}(?:-fx-|$)/.test(type);
  const enabled = () => {
    try { return root.localStorage?.getItem("zoidium.community-preview") === "1"; } catch (_) { return false; }
  };
  // Opaque project JSON never crosses the guest protocol or a native property
  // loader. Future keys, including keys forbidden by that protocol, stay data.
  const clone = value => JSON.parse(JSON.stringify(value));
  function records(value, found = [], seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return found;
    seen.add(value);
    if (isCommunity(value.type)) { found.push(value); return found; }
    for (const child of Object.values(value)) records(child, found, seen);
    return found;
  }
  function packageId(record) {
    return record.type?.match(/^(community-[a-f0-9]{32})-fx-/)?.[1] || null;
  }
  function normalizeRequirements(requirements) {
    const found = new Map();
    for (const requirement of Array.isArray(requirements) ? requirements : []) {
      if (!requirement || typeof requirement !== "object") continue;
      const entry = {};
      for (const key of ["effect", "packageHash", "dataSchema", "schemaVersion"]) {
        const value = requirement[key];
        if (typeof value === "string" || Number.isSafeInteger(value)) entry[key] = value;
      }
      if (typeof entry.effect === "string") found.set(JSON.stringify(entry), entry);
    }
    return [...found.values()];
  }
  function requirements(data, plugins) {
    for (const record of records(data)) {
      const id = packageId(record);
      if (!id) continue;
      let entry = plugins.find(plugin => plugin.id === id);
      if (!entry) {
        entry = { id, name: id, version: "", author: "", effects: [], materials: [], objects: [], sprites: [], features: [] };
        plugins.push(entry);
      }
      entry.effects = [...new Set([...entry.effects, record.type])].sort();
      entry.requirements = normalizeRequirements([...(entry.requirements || []), {
        effect: record.type, packageHash: record.community?.packageHash,
        dataSchema: record.community?.dataSchema, schemaVersion: record.community?.schemaVersion,
      }]);
    }
    return plugins;
  }
  function retained(data, tracked, previous) {
    const saved = data.plugins || [];
    const community = [...saved, ...(previous || [])].filter(plugin => isCommunity(plugin.id));
    return [...tracked, ...community];
  }
  function warning(plugin) {
    return `Community plugin "${plugin.name || plugin.id}" (${plugin.id}) requires its saved package hash and data schema. ` +
      "Missing, disabled, quarantined, updated, or incompatible packages remain opaque. Their project data is preserved. " +
      "Community effects cannot be exported in this preview. Export with missing or failed plugins bypasses all community effects for the entire export.";
  }
  const api = { isCommunity, enabled, clone, records, packageId, normalizeRequirements, requirements, retained, warning };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZoidiumCommunityProjects = api;
})(globalThis);
