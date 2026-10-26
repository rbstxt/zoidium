"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const P = commonJS ? require("./community-package") : root.ZoidiumCommunityPackage;
  const V = commonJS ? require("./community-protocol") : root.ZoidiumCommunityProtocol;
  const U = commonJS ? require("./community-ui") : root.ZoidiumCommunityUI;
  const H = commonJS ? require("./community-effect-host") : root.ZoidiumCommunityEffectHost;
  const B = commonJS ? require("./community-bootstrap") : root.ZoidiumCommunityBootstrap;
  const previewEnabled = () => {
    try { return root.localStorage?.getItem("zoidium.community-preview") === "1"; } catch (_) { return false; }
  };
  const projectStates = new WeakMap();
  let nextProject = 0, nextInstance = 0, nextRunner = 0;
  function frameStamp(effect, frame) {
    P.finite(frame);
    const project = effect.parentProject;
    if (!project) throw new Error("Community effect has no project.");
    // This signature stays in host memory. The guest receives only its own
    // properties and numeric frame metadata, never project or asset data.
    const signature = JSON.stringify(project);
    if (signature.length > 16 * 1024 * 1024) throw new Error("Community preview project size limit exceeded.");
    let state = projectStates.get(project);
    if (!state) {
      state = { generation: ++nextProject, revision: 0 }; projectStates.set(project, state);
      // Native history publishes edits, undo, and redo here, including a
      // round trip back to identical authored bytes while a job is pending.
      project.ui?.onChanged?.watch(() => { state.revision++; });
    }
    if (signature !== state.signature) { state.signature = signature; state.revision++; }
    const sequence = project.sequence;
    const resolution = effect.parentLayer?.properties.resolution.get() || sequence.properties.resolution.get();
    const rate = sequence.properties.rate.get();
    const input = { properties: U.read(effect, effect._community.declaration), frame, time: frame / rate, frameRate: rate,
      width: resolution[0], height: resolution[1], pixelAspect: 1, seed: 1 };
    const frameKey = JSON.stringify([frame, rate, ...resolution]);
    return { project, projectGeneration: state.generation, revision: state.revision, frameKey, input };
  }
  function sameStamp(a, b) {
    return a.project === b.project && a.projectGeneration === b.projectGeneration && a.revision === b.revision && a.frameKey === b.frameKey;
  }
  function createController({ store, runtimeSource = root.ZoidiumCommunityRuntimeSource,
    createRunner = B.createRunner, PZ = root.PZ, ui = root.ZoidiumUI, stamp = frameStamp, makePass = H.makePass } = {}) {
    const sessions = new Map();
    let disposed = false;
    function valid(effect, session) {
      return !disposed && !session.closed && previewEnabled() && !effect._community?.unloaded &&
        !effect._communityOpaque && Boolean(effect.parent) && effect.parentProject === effect._community.project;
    }
    function fail(session, error) {
      if (session.closed) return;
      stop(session);
      void store.quarantine(session.id, String(error.message).slice(0, 4096), store.view().revision).catch(() => {});
    }
    function stop(session) {
      if (session.closed) return;
      session.closed = true; session.runner.dispose();
      for (const effect of session.effects) {
        effect._community.receipt = null; effect._community.window?.close();
        effect.pass?.release(); effect.pass = null;
      }
      const entries = PZ.ui.objectTypes.get(PZ.effect);
      for (const entry of session.entries) { const i = entries.indexOf(entry); if (i >= 0) entries.splice(i, 1); }
      for (const d of session.bundle.manifest.effects) {
        if (PZ.effect.fnList[d.id] === session.factories.get(d.id)) {
          const promise = Promise.resolve(H.placeholder(d.id)); promise._zoidiumCommunity = true;
          PZ.effect.fnList[d.id] = promise;
        }
      }
    }
    async function request(session, effect, operation, input, authority) {
      if (!valid(effect, session) || session.queued >= 8) throw new Error("Community preview is unavailable or busy.");
      const instance = effect._community;
      const message = { protocolVersion: V.VERSION, interpreterVersion: V.INTERPRETER, ...session.runner.binding,
        instanceId: instance.id, instanceGeneration: instance.generation,
        projectGeneration: authority.projectGeneration, revision: authority.revision, frameKey: authority.frameKey,
        requestId: "request-" + (++session.requests), operation, payload: { effectId: instance.declaration.id, input } };
      V.message(message); V.requestPayload(message, session.bundle);
      session.queued++;
      const work = session.tail.then(async () => {
        if (!valid(effect, session) || !sameStamp(authority, stamp(effect, authority.input.frame))) return null;
        if (!await store.authorized(session.id, session.hash)) { stop(session); return null; }
        const reply = await session.runner.request(message);
        V.matches(reply, message);
        if (reply.operation === "error") throw new Error("Community guest failed.");
        V.result(reply.payload, instance.declaration, operation);
        if (!valid(effect, session) || !sameStamp(authority, stamp(effect, authority.input.frame)) ||
            !await store.authorized(session.id, session.hash)) return null;
        return H.clone(reply.payload);
      });
      session.tail = work.catch(error => { fail(session, error); }).finally(() => { session.queued--; });
      return work;
    }
    function factory(session, declaration) {
      return function () {
        const effect = this;
        effect.defaultName = "Community effect";
        effect.properties.addAll(U.definitions(declaration, PZ.property.type));
        effect.properties.add("community-setup", { name: "Community setup", readOnly: true, type: PZ.property.type.TEXT,
          value: "", zoidiumControl: "community-setup-v1" });
        const instance = effect._community = { id: "instance-" + (++nextInstance), generation: 1, declaration,
          frame: 0, receipt: null, project: null, unloaded: false };
        effect._communityOpen = editor => {
          if (!valid(effect, session) || editor.project !== instance.project) return;
          instance.window = ui.openWindow({ id: instance.id, title: "Community effect setup", width: 360, height: 400,
            isValid: () => valid(effect, session) && editor.project === instance.project,
            mount: body => U.mount({ body, effect, declaration, editor, ui,
              valid: () => valid(effect, session) && editor.project === instance.project,
              dispatch: async event => {
                const frame = editor.playback.currentFrame - (effect.frameOffset || 0);
                const authority = stamp(effect, frame);
                const state = { ...authority.input.properties };
                if (event.property) state[event.property] = event.value;
                const patch = await request(session, effect, "uiEvent", { ...event, state }, authority);
                return patch && editor.playback.currentFrame - (effect.frameOffset || 0) === frame ? { ...state, ...patch.state } : null;
              } }),
          });
        };
        effect.load = async data => {
          instance.project = effect.parentProject; instance.receipt = null;
          const record = data || { type: effect.type };
          H.instances.add(effect); session.effects.add(effect);
          try {
            if (!previewEnabled() || session.closed) throw new Error("Community package is disabled or unavailable.");
            H.loadValues(effect, declaration, record, session.runner.binding);
            effect.pass = makePass(declaration.template, () => {
              if (!valid(effect, session) || !instance.receipt) return 1;
              try {
                const now = stamp(effect, instance.frame);
                return sameStamp(instance.receipt.authority, now) ? instance.receipt.result.uniforms.gain ?? 1 : 1;
              } catch (_) { return 1; }
            });
          } catch (error) { H.unavailable(effect, record, error.message); }
        };
        effect.toJSON = () => H.serialize(effect, declaration, session.runner.binding);
        effect.prepare = async (frame, context) => {
          instance.receipt = null;
          if (context?.exportPolicy || context instanceof (PZ.export || class {})) throw new Error(H.EXPORT_ERROR);
          if (!valid(effect, session)) return;
          const authority = stamp(effect, frame);
          const result = await request(session, effect, "prepareEffect", authority.input, authority);
          if (result && valid(effect, session) && sameStamp(authority, stamp(effect, frame))) instance.receipt = { authority, result };
        };
        effect.update = frame => { instance.frame = frame; };
        effect.resize = () => { instance.receipt = null; };
        effect.unload = () => {
          if (instance.unloaded) return;
          instance.unloaded = true; instance.generation++; instance.receipt = null; instance.window?.close();
          effect.pass?.release(); effect.pass = null; session.effects.delete(effect); H.instances.delete(effect);
        };
      };
    }
    function register(session) {
      const entries = PZ.ui.objectTypes.get(PZ.effect);
      for (const d of session.bundle.manifest.effects) {
        U.validate(d);
        const promise = Promise.resolve(factory(session, d)); promise._zoidiumCommunity = true;
        session.factories.set(d.id, promise); PZ.effect.fnList[d.id] = promise;
        // Native picker implementations may interpret names as markup. Keep
        // package labels exclusively in the text-only host UI.
        const entry = { name: "Community " + (d.template === "gain-v1" ? "Gain" : "Identity") + " " + d.id.slice(-8),
          type: d.id, desc: "Isolated developer preview. Video and image export are unavailable." };
        entries.push(entry); session.entries.push(entry);
      }
    }
    async function activate(id) {
      if (disposed || !previewEnabled()) return false;
      if (sessions.has(id)) return !sessions.get(id).closed;
      const item = store.view().packages.find(p => p.id === id);
      if (!item?.enabled || !item.selected || item.quarantine) return false;
      if (typeof runtimeSource !== "string" || !runtimeSource.length) throw new Error("Trusted community runtime is unavailable. Rebuild the runtime stage.");
      const { bytes, hash } = await store.beforeEvaluation(id, item.selected);
      const bundle = P.parse(bytes);
      let runner;
      try {
        runner = await createRunner({ bytes, approvedHash: hash, runtimeSource, runnerGeneration: ++nextRunner });
        if (disposed || !previewEnabled() || !await store.authorized(id, hash)) throw new Error("Community selection changed during activation.");
        const session = { id, hash, bundle, runner, requests: 0, queued: 0, tail: Promise.resolve(),
          effects: new Set(), entries: [], factories: new Map(), closed: false };
        sessions.set(id, session);
        await store.completeActivation(id, hash, store.view().revision);
        register(session); return true;
      } catch (error) {
        runner?.dispose();
        const session = sessions.get(id); if (session) stop(session);
        await store.quarantine(id, error.message, store.view().revision).catch(() => {});
        throw error;
      }
    }
    const unregister = PZ && root.ZoidiumPluginApis?.propertyControls.register("community-setup-v1", {
      type: PZ.property.type.TEXT,
      create(property) {
        return ui.controls.button({ title: "Open community setup", onClick: () => property.parentObject._communityOpen?.(this.editor) }).element;
      },
    });
    return {
      activate,
      async reconcile() {
        for (const s of sessions.values()) if (!await store.authorized(s.id, s.hash)) stop(s);
        for (const p of store.view().packages) if (p.enabled && !p.quarantine) await activate(p.id);
      },
      dispose() { if (disposed) return; disposed = true; for (const s of sessions.values()) stop(s); unregister?.(); },
    };
  }
  const api = { createController, frameStamp, sameStamp, previewEnabled };
  if (commonJS) module.exports = api; else root.ZoidiumCommunityEffects = api;
})(globalThis);
