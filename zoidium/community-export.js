"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const Projects = commonJS ? require("./community-projects") : root.ZoidiumCommunityProjects;
  const grants = new WeakMap(), sessions = new WeakMap();
  const ERROR = "Community effect export is unavailable. Use Export with missing or failed plugins to bypass all community effects for one export.";
  const documentFor = project => JSON.parse(JSON.stringify(project));
  const signature = data => JSON.stringify(Projects.records(data));
  function requirements(project) {
    const data = documentFor(project);
    return { data, records: Projects.records(data), signature: signature(data) };
  }
  async function requestFallback(project, ui = root.ZoidiumUI) {
    if (!Projects.enabled() || !project) return false;
    // A declined replacement must also revoke an older unused choice.
    grants.delete(project);
    const before = requirements(project);
    if (!before.records.length) return false;
    const ids = [...new Set(before.records.map(Projects.packageId).filter(Boolean))];
    const names = ids.map(id => before.data.plugins?.find(plugin => plugin.id === id)?.name || id);
    const approved = await ui.confirm({ title: "Export with missing or failed plugins?",
      message: `Community effects cannot be exported in this preview.\n\n${names.join("\n")}\n\n` +
        "The next video or image export bypasses every community effect at every frame, including effects in closed compositions. " +
        "The output does not include their intended result. Project records stay unchanged. This choice applies to one export only.",
      confirmLabel: "Export with missing or failed plugins", cancelLabel: "Cancel" });
    if (!approved || !Projects.enabled() || requirements(project).signature !== before.signature) return false;
    grants.set(project, before.signature);
    try { root.localStorage?.setItem("zoidium.community-last-fallback-export", JSON.stringify({ mode: "bypass-all-community", packages: ids })); }
    catch (_) { /* The live one-export choice does not depend on storage. */ }
    return true;
  }
  function check(project, exporter) {
    const current = requirements(project);
    if (!current.records.length && !sessions.has(exporter)) return;
    if (!Projects.enabled() || !exporter || exporter.__zoidiumExportDisposed) throw new Error(ERROR);
    let session = sessions.get(exporter);
    if (!session) {
      if (!grants.has(project) || grants.get(project) !== current.signature) throw new Error(ERROR);
      grants.delete(project);
      session = { project, signature: current.signature };
      sessions.set(exporter, session);
    }
    if (session.project !== project || session.signature !== current.signature) {
      throw new Error("COMMUNITY_EXPORT_CHANGED: community project records changed. Start a new export.");
    }
    // This marker never enters project data, archives, or restore points.
    exporter.__zoidiumCommunityBypass = true;
    if (exporter.exportPolicy) exporter.exportPolicy.communityBypass = true;
  }
  function install(PZ = root.PZ) {
    const prototype = PZ.compositor?.prototype;
    const original = prototype?.renderEffects;
    if (!original || original.__zoidiumCommunityExport) return;
    const wrapped = function (effects) {
      const contexts = PZ.zoidium?.temporal?.contexts || [];
      const policy = this.__zoidiumExportPolicy || contexts[contexts.length - 1]?.exportPolicy;
      if (policy?.communityBypass) {
        policy.check?.();
        const args = Array.from(arguments);
        args[0] = Array.prototype.filter.call(effects, effect => !Projects.isCommunity(effect.type));
        return original.apply(this, args);
      }
      return original.apply(this, arguments);
    };
    wrapped.__zoidiumCommunityExport = true;
    prototype.renderEffects = wrapped;
  }
  const api = { ERROR, requestFallback, check, install };
  if (commonJS) module.exports = api;
  else root.ZoidiumCommunityExport = api;
})(globalThis);
