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
  const buttons = new WeakMap();
  let drag = null;
  function setDragTarget(button) {
    const target = buttons.get(button);
    if (!drag || !target || target.list !== drag.list || target.editor !== drag.editor ||
        target.effect.zoidiumBypassed === drag.value) return;
    exchange(drag.editor, { address: target.effect.getAddress(), value: drag.value });
  }
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    current.document.removeEventListener("pointermove", moveDrag, true);
    current.document.removeEventListener("pointerup", endDrag, true);
    current.document.removeEventListener("pointercancel", endDrag, true);
    current.editor.history.finishOperation();
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const element = drag.document.elementFromPoint(event.clientX, event.clientY);
    setDragTarget(element?.closest?.(".zoidium-effect-bypass"));
  }
  function beginDrag(event, target) {
    if (drag || event.button !== 0 || target.editor.history.operation !== null) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.focus();
    const document = event.currentTarget.ownerDocument;
    drag = { ...target, document, pointerId: event.pointerId, value: target.effect.zoidiumBypassed !== true };
    target.editor.history.startOperation();
    setDragTarget(event.currentTarget);
    document.addEventListener("pointermove", moveDrag, true);
    document.addEventListener("pointerup", endDrag, true);
    document.addEventListener("pointercancel", endDrag, true);
  }
  api.refresh = function () {
    for (const ref of rows) {
      const row = ref.deref();
      if (!row) { rows.delete(ref); continue; }
      const button = row.querySelector(".zoidium-effect-bypass");
      if (!button) continue;
      const off = row.pz_object.zoidiumBypassed === true;
      button.textContent = "◉";
      button.style.textDecoration = off ? "line-through" : "none";
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
    const target = { editor: this.editor, effect: object, list: this.list };
    buttons.set(button, target);
    button.style.color = "inherit";
    button.style.touchAction = "none";
    button.onpointerdown = event => beginDrag(event, target);
    button.onclick = event => {
      event.stopPropagation();
      if (event.detail === 0) api.toggle(this.editor, object);
    };
    const actions = row.children[1];
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.alignItems = "center";
    actions.appendChild(button);
    rows.add(new WeakRef(row));
    api.refresh();
    return row;
  };
})(window);
