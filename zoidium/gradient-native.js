(function (global) {
  "use strict";
  const api = global.ZoidiumGradientEditor, M = global.ZoidiumGradientModel, C = global.PZ.ui.controls;
  const original = C.generateGradientInput;
  function propertyControl(property, options = {}) {
    const doc = global.document, box = doc.createElement("div"), anchor = doc.createElement("span");
    box.className = "editbox zge-property"; anchor.hidden = true; box.append(anchor);
    const read = options.read || (() => ({ stops: property.get() }));
    const write = options.write || (value => property.set(value.stops.map(s => ({ position: s.position, color: typeof s.color === "string" ? s.color : M.rgba(s.color) }))));
    let active = false, before, shown;
    const widget = api.create({ ...options, document: doc, value: read(), readOnly: !!(property.definition.readOnly || property.animated && property.expression),
      onStart() {
        const history = box.closest("ul")?.pz_controls?.editor.history;
        if (!history || history.operation !== null) return false;
        active = true; before = M.clone(property.get()); C.editStart.call(anchor, property); return true;
      },
      onInput(value) { if (active) { write(value, box.pz_frame); shown = JSON.stringify(read()); } },
      onFinish(cancel) {
        if (!active) return;
        if (cancel) property.set(before, box.pz_frame);
        active = false; C.editFinish.call(anchor, property, cancel); shown = JSON.stringify(read());
      },
    });
    box.append(widget.element);
    box.pz_update = () => {
      const value = read(), key = JSON.stringify(value);
      if (!active && key !== shown) { shown = key; widget.set(value); }
    };
    box.pz_update(); return box;
  }
  function replacement(property) { return classic ? original.apply(this, arguments) : propertyControl(property, { advanced: false, sampleColor: M.nativeSample }); }
  let classic;
  api.propertyControl = propertyControl;
  api.setClassic = flag => {
    flag = !!flag;
    if (classic === flag) return;
    classic = flag;

    global.ZoidiumUI.refreshEditors?.();
  };
  api.isClassic = () => classic;
  C.generateGradientInput = replacement;
  api.setClassic(false);
})(window);
