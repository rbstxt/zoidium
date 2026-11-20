// Persist the outer effect switch independently of effect properties.
(function installEffectBypass(global) {
  "use strict";
  const PZ = global.PZ;
  if (!PZ?.effect?.create || !PZ.ui?.edit?.prototype) return;
  const create = PZ.effect.create;
  const api = {
    bypassed(effect) {
      for (let node = effect; node instanceof PZ.effect; node = node.parent ? node.parentObject : null) {
        if (node.zoidiumBypassed === true) return true;
      }
      return false;
    },
  };
  PZ.zoidium ||= {};
  PZ.zoidium.effectBypass = api;
  function installPreparation(effect) {
    const prepare = effect.prepare;
    if (typeof prepare !== "function" || prepare.__zoidiumBypass) return;
    function guardedPrepare() {
      if (api.bypassed(this)) return;
      return prepare.apply(this, arguments);
    }
    guardedPrepare.__zoidiumBypass = true;
    effect.prepare = guardedPrepare;
  }
  function installSerialization(effect) {
    const toJSON = effect.toJSON;
    if (toJSON.__zoidiumBypass) return;
    function serialize() {
      const data = toJSON.apply(this, arguments);
      if (this.zoidiumBypassed === true) data.zoidiumBypassed = true;
      else delete data.zoidiumBypassed;
      return data;
    }
    serialize.__zoidiumBypass = true;
    effect.toJSON = serialize;
  }
  PZ.effect.create = function () {
    const effect = create.apply(this, arguments);
    const load = effect.load;
    effect.load = function (data) {
      this.zoidiumBypassed = data?.zoidiumBypassed === true;
      const result = load.apply(this, arguments);
      installSerialization(this);
      installPreparation(this);
      if (result && typeof result.then === "function") return result.then(value => {
        installSerialization(this);
        installPreparation(this);
        return value;
      });
      return result;
    };
    installSerialization(effect);
    installPreparation(effect);
    return effect;
  };
  function exchange(editor, command) {
    const effect = editor.project.addressLookup(command.address);
    const previous = effect.zoidiumBypassed === true;
    effect.zoidiumBypassed = command.value;
    editor.history.pushCommand(next => exchange(editor, next), { address: command.address, value: previous });
    global.ZoidiumEditSignals?.touch("effect-bypass");
    editor.project.ui?.onChanged?.update?.();
    api.refresh?.();
  }
  api.toggle = function (editor, effect) {
    if (editor.history.operation !== null) return false;
    editor.history.startOperation();
    exchange(editor, { address: effect.getAddress(), value: effect.zoidiumBypassed !== true });
    editor.history.finishOperation();
    return true;
  };
  const rows = new Set();
  api.refresh = function () {
    for (const ref of rows) {
      const row = ref.deref();
      if (!row) { rows.delete(ref); continue; }
      const button = row.querySelector(".zoidium-effect-bypass");
      if (!button) continue;
      const off = row.pz_object.zoidiumBypassed === true;
      button.textContent = off ? "◉̸" : "◉";
      button.title = off ? "Enable effect" : "Bypass effect";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(!off));
      button.style.opacity = off ? "0.45" : "1";
    }
  };
  const prototype = PZ.ui.edit.prototype, generate = prototype.generateListItem;
  prototype.generateListItem = function (parent, object) {
    const row = generate.apply(this, arguments);
    if (!(object instanceof PZ.effect) || this.options.hideAllListItemButtons) return row;
    const button = row.ownerDocument.createElement("button");
    button.className = "actionbutton zoidium-effect-bypass";
    button.type = "button";
    button.onclick = event => { event.stopPropagation(); api.toggle(this.editor, object); };
    row.children[1].prepend(button);
    rows.add(new WeakRef(row));
    api.refresh();
    return row;
  };
})(window);
