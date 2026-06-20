// Zoidium Bezier Easing Editor
// Replaces Panzoid's minified "Easing" dropdown (`PZ.editor.easeDropDown`)
// with a richer floating panel that includes:
//   - Preset buttons (CSS, Material, Panzoid built-in, default linear)
//   - Direct numeric input of Bezier controlPoints [[cp1x,cp1y],[cp2x,cp2y]]
//   - continuousTangent toggle
//
// Strategy: Panzoid's minified code is NOT modified. We hook into
// the existing `pz-tweens` buttons (both via MutationObserver on the DOM
// and by monkey-patching `PZ.editor.showEaseDropDown`) and intercept clicks
// on `title="easing"` buttons. All writes go through the public API
// `PZ.ui.properties.prototype.{setTween, setControlPoints, setContinuousTangent}`,
// which handles history/undo/redo and notifies the timeline UI.

(function () {
  if (window.ZOIDIUM_BEZIER_EDITOR_LOADED) return;
  window.ZOIDIUM_BEZIER_EDITOR_LOADED = true;

  // ----- 1. Wait for Panzoid to be ready ---------------------------------

  function whenReady(fn) {
    if (typeof PZ !== "undefined" && PZ.editor && PZ.editor.showEaseDropDown) {
      fn();
    } else {
      setTimeout(function () { whenReady(fn); }, 50);
    }
  }

  whenReady(init);

  function init() {
    if (!window.ZOIDIUM_BEZIER_PRESETS) {
      console.warn("[Zoidium bezier editor] presets.js not loaded");
      return;
    }
    monkeyPatchEaseDropDown();
    observePzTweens();
    console.log("[Zoidium] bezier editor loaded (" +
      window.ZOIDIUM_BEZIER_PRESETS.length + " presets)");
  }

  // ----- 2. Monkey-patch the existing ease dropdown ---------------------
  // We wrap PZ.editor.showEaseDropDown so that:
  //   - it hides the legacy dropdown when our floating UI opens
  //   - it still works (returns silently) if our UI is also opening

  let activePanel = null;  // currently open floating panel (or null)

  function monkeyPatchEaseDropDown() {
    if (PZ.editor._zoidiumPatched) return;
    PZ.editor._zoidiumPatched = true;

    const original = PZ.editor.showEaseDropDown;
    PZ.editor.showEaseDropDown = function (button) {
      // Always close any open legacy dropdown first (no-op if not present)
      if (PZ.editor.easeDropDown && PZ.editor.easeDropDown.parentNode) {
        PZ.editor.easeDropDown.remove();
      }
      // Open our own panel instead.
      openBezierPanel(button);
    };
  }

  // ----- 3. MutationObserver for dynamically-created pz-tweens buttons ---

  function observePzTweens() {
    function check(node) {
      if (!(node instanceof HTMLElement)) return;
      if (node.classList && node.classList.contains("pz-tweens")) {
        wrapPzTween(node);
      }
      // Also recurse into children that might already be present
      if (node.querySelectorAll) {
        const buttons = node.querySelectorAll(".pz-tweens");
        for (let i = 0; i < buttons.length; i++) wrapPzTween(buttons[i]);
      }
    }

    // Initial pass
    check(document.body);

    // Observe future additions
    const obs = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        for (let j = 0; j < m.addedNodes.length; j++) {
          check(m.addedNodes[j]);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function wrapPzTween(btn) {
    if (btn._zoidiumBezWrapped) return;
    btn._zoidiumBezWrapped = true;

    // Only intercept the "easing" button (the one that calls showEaseDropDown).
    // Leave the "interpolation" button (Linear <-> Bezier toggle) untouched.
    if (btn.title !== "easing") return;

    // Replace the click handler. We add our own; the original onclick
    // (PZ.editor.showEaseDropDown) was assigned at creation and will also
    // fire if we don't preventDefault. Use capture phase + stopImmediatePropagation.
    btn.addEventListener(
      "click",
      function (e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        openBezierPanel(btn);
      },
      true  // capture
    );
  }

  // ----- 4. Floating UI --------------------------------------------------

  function openBezierPanel(anchorBtn) {
    // Close any existing panel
    closeBezierPanel();

    // Resolve the target keyframe: walk the DOM to find property + propertyOps
    const ctx = resolveContext(anchorBtn);
    if (!ctx) {
      console.warn("[Zoidium bezier editor] no keyframe context for this button");
      return;
    }

    const panel = buildPanel(ctx);
    document.body.appendChild(panel);
    activePanel = panel;

    // Position next to the anchor
    positionPanel(panel, anchorBtn);

    // Focus + close-on-outside
    panel.focus();
    setTimeout(function () {
      document.addEventListener("mousedown", outsideClose, true);
      document.addEventListener("keydown", escapeClose, true);
    }, 0);
  }

  function closeBezierPanel() {
    if (activePanel && activePanel.parentNode) {
      activePanel.parentNode.removeChild(activePanel);
    }
    activePanel = null;
    document.removeEventListener("mousedown", outsideClose, true);
    document.removeEventListener("keydown", escapeClose, true);
  }

  function outsideClose(e) {
    if (!activePanel) return;
    if (activePanel.contains(e.target)) return;
    closeBezierPanel();
  }

  function escapeClose(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeBezierPanel();
    }
  }

  function positionPanel(panel, anchor) {
    const r = anchor.getBoundingClientRect();
    const panelW = 260;
    const panelH = 280;  // estimate; real height is set after build
    let top = r.bottom + 4;
    let left = r.left;
    // Clamp to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + panelW > vw - 8) left = Math.max(8, vw - panelW - 8);
    if (top + panelH > vh - 8) top = Math.max(8, r.top - panelH - 4);
    panel.style.left = (left + window.scrollX) + "px";
    panel.style.top = (top + window.scrollY) + "px";
  }

  // ----- 5. Resolve the keyframe context from the anchor button ---------
  //
  // Panzoid's createKeyframeControls (ui-1.0.72.js) builds the [interp] [easing]
  // buttons inside a property list <ul>. The DOM chain is:
  //   <ul>                          ← has .pz_controls (PZ.ui.properties instance)
  //     <li>                        ← has .pz_object (PZ.property)
  //       <div>  (children[0]: stopwatch + name)
  //       <div>  (children[1]: keyframe controls + value)
  //         <div>  (returned by createKeyframeControls)
  //           <button title="interpolation">
  //           <button title="easing">              ← (n)  anchor
  //
  // We walk up looking for the element with .pz_object (the <li>); the propertyOps
  // is on that element's parent (the <ul>). This is class-name-agnostic, so it
  // survives any CSS refactor in Panzoid's stylesheet.

  function resolveContext(btn) {
    let el = btn;
    let propEl = null;
    while (el) {
      if (el.pz_object) { propEl = el; break; }
      el = el.parentElement;
    }
    if (!propEl) return null;
    const prop = propEl.pz_object;
    if (!prop || !prop.getKeyframe) return null;

    const propRow = propEl.parentElement;  // <ul> with pz_controls
    if (!propRow || !propRow.pz_controls) return null;
    const propertyOps = propRow.pz_controls;

    const editor = propertyOps.editor;
    if (!editor || !editor.playback) return null;
    const frame = editor.playback.currentFrame - prop.frameOffset;
    const kf = prop.getKeyframe(frame);
    if (!kf) return null;

    return { prop, propertyOps, frame, keyframe: kf };
  }

  // ----- 6. Build the panel ----------------------------------------------

  function buildPanel(ctx) {
    const panel = document.createElement("div");
    panel.className = "zoidium-bez";
    panel.tabIndex = -1;

    // Title
    const title = document.createElement("div");
    title.className = "zoidium-bez__title";
    title.innerHTML = '<span>Bezier Easing</span>';
    const closeBtn = document.createElement("button");
    closeBtn.className = "zoidium-bez__close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.onclick = function (e) { e.stopPropagation(); closeBezierPanel(); };
    title.appendChild(closeBtn);
    panel.appendChild(title);

    // Presets
    const psetLabel = document.createElement("div");
    psetLabel.className = "zoidium-bez__section-label";
    psetLabel.textContent = "Presets";
    panel.appendChild(psetLabel);

    const presetsBox = document.createElement("div");
    presetsBox.className = "zoidium-bez__presets";
    const presets = window.ZOIDIUM_BEZIER_PRESETS;
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i];
      const b = document.createElement("button");
      b.className = "zoidium-bez__preset";
      b.textContent = p.label;
      b.title = p.desc;
      if (p.controlPoints) b.classList.add("zoidium-bez__preset--bezier");
      b.onclick = function (e) {
        e.stopPropagation();
        applyPreset(ctx, p, panel);
      };
      presetsBox.appendChild(b);
    }
    panel.appendChild(presetsBox);

    // Control points editor
    const cpDivider = document.createElement("div");
    cpDivider.className = "zoidium-bez__divider";
    panel.appendChild(cpDivider);

    const cpLabel = document.createElement("div");
    cpLabel.className = "zoidium-bez__section-label";
    cpLabel.textContent = "Control Points (Bezier)";
    panel.appendChild(cpLabel);

    const inputs = document.createElement("div");
    inputs.className = "zoidium-bez__inputs";

    function makeInput(label, get, set) {
      const lab = document.createElement("label");
      lab.textContent = label;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = "any";
      inp.value = get();
      inp.addEventListener("change", function () {
        const v = parseFloat(inp.value);
        if (!isNaN(v)) set(v);
      });
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { inp.blur(); e.preventDefault(); }
        if (e.key === "Escape") { e.stopPropagation(); }
      });
      return { lab, inp };
    }

    const kf = ctx.keyframe;
    const cp = kf.controlPoints || [[-10, 0], [10, 0]];

    // IMPORTANT: each setter reads the current keyframe freshly (not from the
    // captured `cp` above), so that back-to-back edits don't clobber each other
    // when one input was changed in between.
    function readCP() {
      const k = ctx.prop.getKeyframe(ctx.frame);
      return (k && k.controlPoints) ? k.controlPoints : [[-10, 0], [10, 0]];
    }

    const cp1x = makeInput("cp1 x", function () { return cp[0][0]; },
                            function (v) { const c = readCP(); writeCP(ctx, [[v, c[0][1]], [c[1][0], c[1][1]]]); refreshAll(panel, ctx); });
    const cp1y = makeInput("cp1 y", function () { return cp[0][1]; },
                            function (v) { const c = readCP(); writeCP(ctx, [[c[0][0], v], [c[1][0], c[1][1]]]); refreshAll(panel, ctx); });
    const cp2x = makeInput("cp2 x", function () { return cp[1][0]; },
                            function (v) { const c = readCP(); writeCP(ctx, [[c[0][0], c[0][1]], [v, c[1][1]]]); refreshAll(panel, ctx); });
    const cp2y = makeInput("cp2 y", function () { return cp[1][1]; },
                            function (v) { const c = readCP(); writeCP(ctx, [[c[0][0], c[0][1]], [c[1][0], v]]); refreshAll(panel, ctx); });

    inputs.appendChild(cp1x.lab); inputs.appendChild(cp1x.inp);
    inputs.appendChild(cp2x.lab); inputs.appendChild(cp2x.inp);
    inputs.appendChild(cp1y.lab); inputs.appendChild(cp1y.inp);
    inputs.appendChild(cp2y.lab); inputs.appendChild(cp2y.inp);
    panel.appendChild(inputs);

    // Continuous tangent toggle
    const tangRow = document.createElement("label");
    tangRow.className = "zoidium-bez__row-toggle";
    const tangBox = document.createElement("input");
    tangBox.type = "checkbox";
    tangBox.checked = !!kf.continuousTangent;
    tangBox.onchange = function () {
      ctx.propertyOps.setContinuousTangent({
        property: ctx.prop.getAddress(),
        frame: ctx.frame,
        continuous: tangBox.checked,
      });
      refreshAll(panel, ctx);
    };
    tangRow.appendChild(tangBox);
    tangRow.appendChild(document.createTextNode("continuous tangent (mirror handle)"));
    panel.appendChild(tangRow);

    // Hint
    const hint = document.createElement("div");
    hint.className = "zoidium-bez__hint";
    hint.textContent = "Numeric values are Panzoid's raw controlPoints. " +
      "Editing the inputs also switches the keyframe to Bezier (tween=256).";
    panel.appendChild(hint);

    // Store input references for refresh
    panel._zoidiumRefs = { cp1x, cp1y, cp2x, cp2y, tangBox };

    // Mark the active preset on first paint
    highlightActivePreset(panel, ctx);

    return panel;
  }

  // ----- 7. Write helpers -----------------------------------------------

  function writeCP(ctx, controlPoints) {
    // Switching to Bezier mode ensures controlPoints take effect.
    // Use 256 (interp=1, ease=none). Existing tween is preserved for history
    // (setTween pushes to history as well).
    ctx.propertyOps.setTween({
      property: ctx.prop.getAddress(),
      frame: ctx.frame,
      tween: 256,
    });
    ctx.propertyOps.setControlPoints({
      property: ctx.prop.getAddress(),
      frame: ctx.frame,
      controlPoints: controlPoints,
    });
  }

  function applyPreset(ctx, preset, panel) {
    if (preset.tween !== null && preset.tween !== undefined) {
      ctx.propertyOps.setTween({
        property: ctx.prop.getAddress(),
        frame: ctx.frame,
        tween: preset.tween,
      });
    }
    if (preset.controlPoints) {
      ctx.propertyOps.setControlPoints({
        property: ctx.prop.getAddress(),
        frame: ctx.frame,
        controlPoints: preset.controlPoints,
      });
    }
    refreshAll(panel, ctx);
  }

  // Re-read the keyframe from the model (it may have been mutated by the
  // write above, and other operations may also have changed it).
  function refreshAll(panel, ctx) {
    const kf = ctx.prop.getKeyframe(ctx.frame);
    if (!kf) return;
    ctx.keyframe = kf;
    const refs = panel._zoidiumRefs;
    if (!refs) return;
    const cp = kf.controlPoints || [[-10, 0], [10, 0]];
    refs.cp1x.inp.value = cp[0][0];
    refs.cp1y.inp.value = cp[0][1];
    refs.cp2x.inp.value = cp[1][0];
    refs.cp2y.inp.value = cp[1][1];
    refs.tangBox.checked = !!kf.continuousTangent;
    highlightActivePreset(panel, ctx);
  }

  function highlightActivePreset(panel, ctx) {
    const kf = ctx.keyframe;
    const tween = kf.tween;
    const cp = kf.controlPoints || [[-10, 0], [10, 0]];
    const presets = window.ZOIDIUM_BEZIER_PRESETS;
    const buttons = panel.querySelectorAll(".zoidium-bez__preset");
    for (let i = 0; i < buttons.length; i++) {
      const p = presets[i];
      const tweenMatch = p.tween === tween;
      const cpMatch = p.controlPoints &&
        approxEq(p.controlPoints[0][0], cp[0][0]) &&
        approxEq(p.controlPoints[0][1], cp[0][1]) &&
        approxEq(p.controlPoints[1][0], cp[1][0]) &&
        approxEq(p.controlPoints[1][1], cp[1][1]);
      const match = tweenMatch && (p.controlPoints ? cpMatch : !p.controlPoints);
      buttons[i].classList.toggle("zoidium-bez__preset--active", match);
    }
  }

  function approxEq(a, b) { return Math.abs(a - b) < 1e-3; }
})();
