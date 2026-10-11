"use strict";

// Easing+ host patches: keyframe shape preservation, tween pick/display
// rewrites and the "Ez+" button labels. Created per activation with the
// plugin state; every host mutation registers its undo with the dispose
// registrar before it happens, so a failed activation rolls back fully.

function loadCurves() {
  if (typeof require === "function") return require("./easing-curves.js");
  throw new Error("Easing+ host patches need ./easing-curves.js.");
}

module.exports = function createHostPatch(state, options) {
  const curves = (options && options.curves) || loadCurves();
  const dispose = (options && options.dispose) || null;
  const later = (step) => {
    if (typeof dispose === "function") {
      try {
        dispose(step);
      } catch (error) {
        // A lifecycle registrar must never break the host patch itself.
      }
    }
  };

  function installShapePreservation() {
    const properties = window.PZ?.ui?.properties?.prototype;
    if (properties && typeof properties.moveKeyframe === "function" && !state.patchedMoveKeyframe) {
      state.originalMoveKeyframe = properties.moveKeyframe;
      state.patchedMoveKeyframe = function (argument) {
        const snapshots = curves.snapshotForAddress(this, argument?.property);
        const result = state.originalMoveKeyframe.apply(this, arguments);
        curves.restoreSnapshots(snapshots);
        return result;
      };
      later(() => {
        if (properties.moveKeyframe === state.patchedMoveKeyframe) {
          properties.moveKeyframe = state.originalMoveKeyframe;
        }
      });
      properties.moveKeyframe = state.patchedMoveKeyframe;
    }
    if (properties && typeof properties.setValue === "function" && !state.patchedSetValue) {
      state.originalSetValue = properties.setValue;
      state.patchedSetValue = function (argument) {
        const snapshots = curves.snapshotForAddress(this, argument?.property);
        const result = state.originalSetValue.apply(this, arguments);
        curves.restoreSnapshots(snapshots);
        return result;
      };
      later(() => {
        if (properties.setValue === state.patchedSetValue) {
          properties.setValue = state.originalSetValue;
        }
      });
      properties.setValue = state.patchedSetValue;
    }
    if (properties && typeof properties.startMove === "function" && !state.patchedStartMove) {
      state.originalStartMove = properties.startMove;
      state.patchedStartMove = function (channel, count) {
        try {
          for (const entry of curves.easingChannelsOf(channel)) {
            state.pendingDragShapes.set(entry, curves.snapshotChannelSegments(entry));
          }
        } catch (error) {
          // Never break a native drag for a snapshot failure.
        }
        return state.originalStartMove.apply(this, arguments);
      };
      later(() => {
        if (properties.startMove === state.patchedStartMove) {
          properties.startMove = state.originalStartMove;
        }
      });
      properties.startMove = state.patchedStartMove;
    }
    if (properties && typeof properties.finishMove === "function" && !state.patchedFinishMove) {
      state.originalFinishMove = properties.finishMove;
      state.patchedFinishMove = function (channel) {
        const result = state.originalFinishMove.apply(this, arguments);
        try {
          for (const entry of curves.easingChannelsOf(channel)) {
            const snapshot = state.pendingDragShapes.get(entry);
            if (snapshot) {
              curves.restoreChannelSegments(entry, snapshot);
              state.pendingDragShapes.delete(entry);
            }
          }
        } catch (error) {
          console.error("Easing+ could not preserve the curve shape.", error);
        }
        return result;
      };
      later(() => {
        if (properties.finishMove === state.patchedFinishMove) {
          properties.finishMove = state.originalFinishMove;
        }
      });
      properties.finishMove = state.patchedFinishMove;
    }
    const keyframesPrototype = window.PZ?.property?.dynamic?.keyframes?.prototype;
    if (
      keyframesPrototype &&
      typeof keyframesPrototype.scaleKeyframes === "function" &&
      !state.patchedScaleKeyframes
    ) {
      state.originalScaleKeyframes = keyframesPrototype.scaleKeyframes;
      state.patchedScaleKeyframes = function () {
        const snapshot = curves.snapshotChannelSegments(this);
        const result = state.originalScaleKeyframes.apply(this, arguments);
        try {
          curves.restoreChannelSegments(this, snapshot);
        } catch (error) {
          console.error("Easing+ could not preserve the curve shape.", error);
        }
        return result;
      };
      later(() => {
        if (keyframesPrototype.scaleKeyframes === state.patchedScaleKeyframes) {
          keyframesPrototype.scaleKeyframes = state.originalScaleKeyframes;
        }
      });
      keyframesPrototype.scaleKeyframes = state.patchedScaleKeyframes;
    }
  }

  function uninstallShapePreservation() {
    // Reads stay defensive: uninstall also runs after a failed activation,
    // where the host may be half-built or hostile.
    let properties = null;
    try {
      properties = window.PZ?.ui?.properties?.prototype;
    } catch (error) {
      properties = null;
    }
    if (properties && state.patchedMoveKeyframe && properties.moveKeyframe === state.patchedMoveKeyframe) {
      properties.moveKeyframe = state.originalMoveKeyframe;
    }
    if (properties && state.patchedSetValue && properties.setValue === state.patchedSetValue) {
      properties.setValue = state.originalSetValue;
    }
    if (properties && state.patchedStartMove && properties.startMove === state.patchedStartMove) {
      properties.startMove = state.originalStartMove;
    }
    if (properties && state.patchedFinishMove && properties.finishMove === state.patchedFinishMove) {
      properties.finishMove = state.originalFinishMove;
    }
    const keyframesPrototype = (() => {
      try {
        return window.PZ?.property?.dynamic?.keyframes?.prototype;
      } catch (error) {
        return null;
      }
    })();
    if (
      keyframesPrototype &&
      state.patchedScaleKeyframes &&
      keyframesPrototype.scaleKeyframes === state.patchedScaleKeyframes
    ) {
      keyframesPrototype.scaleKeyframes = state.originalScaleKeyframes;
    }
    state.originalMoveKeyframe = null;
    state.patchedMoveKeyframe = null;
    state.originalSetValue = null;
    state.patchedSetValue = null;
    state.originalStartMove = null;
    state.patchedStartMove = null;
    state.originalFinishMove = null;
    state.patchedFinishMove = null;
    state.originalScaleKeyframes = null;
    state.patchedScaleKeyframes = null;
    state.pendingDragShapes.clear();
  }

  function resolveTargets(button) {
    const controlRow = button.parentElement;
    const interpolationButton = controlRow?.querySelector("button.pz-tweens");
    const interpolationIcon =
      interpolationButton?.querySelector("use")?.getAttribute("xlink:href") ||
      interpolationButton?.querySelector("use")?.getAttribute("href") ||
      "";
    if (
      !interpolationButton ||
      (interpolationButton.pz_value !== 1 && !interpolationIcon.endsWith("#interp_1"))
    ) {
      return null;
    }
    const propertyRow = controlRow?.parentElement?.parentElement;
    const property = propertyRow?.pz_object;
    const controls = propertyRow?.parentElement?.pz_controls;
    const editor = controls?.editor;
    if (!property || !editor || !window.PZ) return null;
    const localFrame = editor.playback.currentFrame - property.frameOffset;
    const properties =
      property instanceof window.PZ.property.dynamic.group ? Array.from(property.objects) : [property];
    const targets = [];
    for (const channel of properties) {
      if (!(channel instanceof window.PZ.property.dynamic.keyframes)) continue;
      const current = channel.getKeyframe(localFrame);
      if (!current) continue;

      // Easing+ edits the incoming segment from the previous keyframe to the
      // current keyframe. The first keyframe has no incoming segment, so it
      // keeps the standard control.
      const previous = channel.getPreviousKeyframe(current.frame);
      if (
        !previous ||
        current.frame <= previous.frame ||
        !Number.isFinite(previous.value) ||
        !Number.isFinite(current.value)
      ) {
        continue;
      }
      targets.push({ property: channel, start: previous, end: current });
    }
    if (targets.length === 0) return null;
    return {
      editor,
      property,
      localFrame,
      targets,
    };
  }

  // The native easing control always keeps its SVG as children[0]; Panzoid's
  // refresh code calls PZ.ui.switchIcon(this.children[0], ...).  Easing+ only
  // changes the visual treatment with a pseudo-element, so those native
  // updates continue to work while the button clearly advertises the custom
  // editor as “Ez+”.
  function interpolationButtonFor(easeButton) {
    const row = easeButton?.parentElement;
    if (!row) return null;
    const buttons = row.querySelectorAll?.("button.pz-tweens") || [];
    for (const button of buttons) {
      if (button !== easeButton) return button;
    }
    return null;
  }

  // Native PZ.keyframe defaults: controlPoints[0] is the incoming handle and
  // controlPoints[1] is the outgoing handle.
  const NATIVE_INCOMING_DEFAULT = [-10, 0];
  const NATIVE_OUTGOING_DEFAULT = [10, 0];

  function siblingTweenButton(button) {
    const row = button?.parentElement;
    if (!row) return null;
    const buttons = row.querySelectorAll?.("button.pz-tweens") || [];
    for (const entry of buttons) {
      if (entry !== button) return entry;
    }
    return null;
  }

  function tweenButtonsInRow(row) {
    if (!row?.querySelectorAll) return {};
    const buttons = Array.from(row.querySelectorAll("button.pz-tweens"));
    return {
      interpolationButton:
        buttons.find((button) => button.title === "interpolation") || buttons[0] || null,
      easeButton: buttons.find((button) => button.title === "easing") || buttons[1] || null,
    };
  }

  // Native tween values belong to the incoming segment. A pick made while
  // the playhead is on a keyframe therefore edits the segment from the
  // previous keyframe to the current keyframe. The first keyframe has no
  // incoming segment, so its native write is kept as-is.
  function pickTargetForSet(current, previous) {
    return previous ? "incoming" : "current";
  }

  // Host keyframe getters may throw on half-built channels; callers treat
  // null as "nothing on the playhead" and keep the native behavior.
  function keyframesAround(channel, localFrame) {
    let current = null;
    try {
      current = channel.getKeyframe?.(localFrame) || null;
    } catch (error) {
      current = null;
    }
    if (!current) return { current: null, previous: null };
    let previous = null;
    try {
      previous = channel.getPreviousKeyframe?.(current.frame) || null;
    } catch (error) {
      previous = null;
    }
    if (!previous || !(previous.frame < current.frame)) previous = null;
    return { current, previous };
  }

  function resolveTweenWrites(context, channels) {
    const resolved = [];
    for (const channel of channels) {
      try {
        const { current, previous } = keyframesAround(channel, context.localFrame);
        if (!current) continue;
        let address = null;
        try {
          address = channel.getAddress();
        } catch (error) {
          address = null;
        }
        if (!address) continue;
        resolved.push({ channel, address, current, previous });
      } catch (error) {
        console.error("Easing+ could not resolve the edited keyframe.", error);
      }
    }
    return resolved;
  }

  function resetSegmentHandles(propertyOps, address, start, end) {
    const startIncoming = start.controlPoints?.[0];
    const endOutgoing = end.controlPoints?.[1];
    if (!Array.isArray(startIncoming) || !Array.isArray(endOutgoing)) return;
    propertyOps.setControlPoints({
      property: address,
      frame: start.frame,
      controlPoints: [startIncoming.slice(), NATIVE_OUTGOING_DEFAULT.slice()],
    });
    propertyOps.setControlPoints({
      property: address,
      frame: end.frame,
      controlPoints: [NATIVE_INCOMING_DEFAULT.slice(), endOutgoing.slice()],
    });
  }

  // Write one picked (interp, ease) pair for a single channel. Returns
  // "incoming" when the pick selects the segment ending at the current
  // keyframe and "current" for the first keyframe's native write. An
  // incoming pick normalizes the owned handles to the native defaults so a
  // stale custom curve can never resurface later; handles that already match
  // the defaults are left alone.
  function executeTweenWrite(propertyOps, address, localFrame, current, previous, newInterp, newEase) {
    const pickTween = (newInterp << 8) | newEase;
    if (pickTargetForSet(current, previous) === "incoming") {
      propertyOps.setTween({ property: address, frame: current.frame, tween: pickTween });
      if (!curves.hasNativeBezierDefaults(previous, current)) {
        resetSegmentHandles(propertyOps, address, previous, current);
      }
      return "incoming";
    }
    propertyOps.setTween({ property: address, frame: current.frame, tween: pickTween });
    return "current";
  }

  function tweenSetContext(button) {
    const rowDiv = button?.parentElement;
    const propertyRow = rowDiv?.parentElement?.parentElement;
    const property = propertyRow?.pz_object;
    const controls = propertyRow?.parentElement?.pz_controls;
    const editor = controls?.editor;
    const propertyOps = controls?.propertyOps;
    if (!property || !controls || !editor || !propertyOps || !window.PZ) return null;
    let localFrame;
    try {
      localFrame = editor.playback.currentFrame - property.frameOffset;
    } catch (error) {
      return null;
    }
    if (!Number.isFinite(localFrame)) return null;
    return { property, controls, editor, propertyOps, localFrame };
  }

  function channelsEditedAtFrame(property, localFrame) {
    const dynamic = window.PZ?.property?.dynamic;
    if (
      dynamic?.group &&
      property instanceof dynamic.group &&
      Array.isArray(property.objects)
    ) {
      return property.objects.filter((entry) => {
        try {
          return !!entry?.hasKeyframe?.(localFrame);
        } catch (error) {
          return false;
        }
      });
    }
    return [property];
  }

  function patchedInterpSet(value) {
    const sibling = siblingTweenButton(this);
    const context = sibling ? tweenSetContext(this) : null;
    if (!context || typeof sibling.pz_value === "undefined") {
      return this.__easingPlusOriginalInterpSet.call(this, value);
    }
    const channels = channelsEditedAtFrame(context.property, context.localFrame);
    const resolved = resolveTweenWrites(context, channels);
    if (resolved.length === 0) {
      return this.__easingPlusOriginalInterpSet.call(this, value);
    }
    const easeValue = Number.isFinite(sibling.pz_value) ? sibling.pz_value : 0;
    const { editor, propertyOps } = context;
    editor.history.startOperation();
    try {
      // The row displays the incoming segment (see applyIncomingDisplay), so
      // the picked value is always what the buttons should show afterwards.
      let wroteAny = false;
      for (const entry of resolved) {
        try {
          executeTweenWrite(
            propertyOps,
            entry.address,
            context.localFrame,
            entry.current,
            entry.previous,
            value,
            easeValue
          );
          wroteAny = true;
        } catch (error) {
          console.error("Easing+ could not apply the picked interpolation.", error);
        }
      }
      if (wroteAny) this.pz_update(value << 8, true);
    } finally {
      editor.history.finishOperation();
    }
  }

  function patchedEaseSet(value) {
    const sibling = siblingTweenButton(this);
    const context = sibling ? tweenSetContext(this) : null;
    if (!context || !Number.isFinite(sibling.pz_value)) {
      return this.__easingPlusOriginalEaseSet.call(this, value);
    }
    const channels = channelsEditedAtFrame(context.property, context.localFrame);
    const resolved = resolveTweenWrites(context, channels);
    if (resolved.length === 0) {
      return this.__easingPlusOriginalEaseSet.call(this, value);
    }
    const { editor, propertyOps } = context;
    editor.history.startOperation();
    try {
      let wroteAny = false;
      for (const entry of resolved) {
        try {
          executeTweenWrite(
            propertyOps,
            entry.address,
            context.localFrame,
            entry.current,
            entry.previous,
            sibling.pz_value,
            value
          );
          wroteAny = true;
        } catch (error) {
          console.error("Easing+ could not apply the picked easing.", error);
        }
      }
      if (wroteAny) this.pz_update(value, true);
    } finally {
      editor.history.finishOperation();
    }
  }

  // Collect the tween each channel would display under the incoming rule:
  // the current keyframe's tween, which controls the segment ending there.
  // Channels without a keyframe at the playhead are skipped, mirroring the
  // native row update. Returns null when nothing is on the playhead.
  function resolveDisplayTweens(channels, localFrame) {
    const shown = [];
    for (const channel of channels) {
      const { current } = keyframesAround(channel, localFrame);
      if (!current) continue;
      const candidate = current.tween;
      if (!Number.isFinite(candidate)) return null;
      shown.push(candidate);
    }
    return shown;
  }

  function isPropertyInterpolated(property) {
    if (typeof property?.interpolated === "boolean") {
      return property.interpolated;
    }
    return property?.definition?.interpolated === true;
  }

  // Reapply the incoming rule to a keyframe row after the native row update
  // ran. While the playhead is on a keyframe, the interpolation/easing
  // buttons show the segment ending at that keyframe so the display always
  // matches what a pick would edit. Between keyframes and on any mismatch
  // between grouped channels, the native result is kept (or the buttons are
  // hidden on mismatch, exactly like the native update does).
  // Returns true when the display was overridden.
  function applyIncomingDisplay(row) {
    try {
      const propertyRow = row?.parentElement?.parentElement;
      const property = propertyRow?.pz_object;
      const controls = propertyRow?.parentElement?.pz_controls;
      const editor = controls?.editor;
      if (!property || !editor || !window.PZ) return false;
      let localFrame;
      try {
        localFrame = editor.playback.currentFrame - property.frameOffset;
      } catch (error) {
        return false;
      }
      if (!Number.isFinite(localFrame)) return false;
      const dynamic = window.PZ.property?.dynamic;
      const grouped = !!dynamic?.group && property instanceof dynamic.group;
      const channels =
        grouped && Array.isArray(property.objects) ? property.objects : [property];
      const shown = resolveDisplayTweens(channels, localFrame);
      if (!shown || shown.length === 0) return false;
      const { interpolationButton, easeButton } = tweenButtonsInRow(row);
      if (!interpolationButton || !easeButton) return false;
      const first = shown[0];
      if (!shown.every((tween) => tween === first)) {
        interpolationButton.pz_update?.(-1, false);
        easeButton.pz_update?.(-1, false);
        return true;
      }
      let visible = true;
      if (!grouped) visible = isPropertyInterpolated(property);
      interpolationButton.pz_update?.(first, visible);
      easeButton.pz_update?.(first, visible);
      return true;
    } catch (error) {
      return false;
    }
  }

  function wrapRowDisplay(row) {
    if (!row || typeof row.pz_update !== "function" || row.__easingPlusOriginalRowUpdate) {
      return;
    }
    const original = row.pz_update;
    const patched = function () {
      const result = original.apply(this, arguments);
      try {
        applyIncomingDisplay(this);
      } catch (error) {
        console.error("Easing+ could not refresh the easing display.", error);
      }
      return result;
    };
    row.__easingPlusOriginalRowUpdate = original;
    row.__easingPlusPatchedRowUpdate = patched;
    row.pz_update = patched;
    state.displayRows.add(row);
  }

  function unwrapRowDisplay(row) {
    if (
      row?.__easingPlusPatchedRowUpdate &&
      row.pz_update === row.__easingPlusPatchedRowUpdate
    ) {
      row.pz_update = row.__easingPlusOriginalRowUpdate;
    }
    delete row?.__easingPlusOriginalRowUpdate;
    delete row?.__easingPlusPatchedRowUpdate;
  }

  function wrapTweenButtonSets(row) {
    const { interpolationButton, easeButton } = tweenButtonsInRow(row);
    if (!interpolationButton || !easeButton) return;
    wrapRowDisplay(row);
    if (
      typeof interpolationButton.pz_set === "function" &&
      !interpolationButton.__easingPlusPatchedInterpSet
    ) {
      interpolationButton.__easingPlusOriginalInterpSet = interpolationButton.pz_set;
      interpolationButton.__easingPlusPatchedInterpSet = patchedInterpSet;
      interpolationButton.pz_set = patchedInterpSet;
      state.easeButtons.add(interpolationButton);
    }
    if (
      typeof easeButton.pz_set === "function" &&
      !easeButton.__easingPlusPatchedEaseSet
    ) {
      easeButton.__easingPlusOriginalEaseSet = easeButton.pz_set;
      easeButton.__easingPlusPatchedEaseSet = patchedEaseSet;
      easeButton.pz_set = patchedEaseSet;
      state.easeButtons.add(easeButton);
    }
  }

  function wrapExistingTweenButtonSets(root = document) {
    if (!root?.querySelectorAll) return;
    const seen = new Set();
    root.querySelectorAll('button.pz-tweens[title="interpolation"]').forEach((button) => {
      const row = button.parentElement;
      if (row && !seen.has(row)) {
        seen.add(row);
        wrapTweenButtonSets(row);
      }
    });
  }

  function unwrapTweenButtonSets(button) {
    if (
      button.__easingPlusPatchedInterpSet &&
      button.pz_set === button.__easingPlusPatchedInterpSet
    ) {
      button.pz_set = button.__easingPlusOriginalInterpSet;
    }
    if (
      button.__easingPlusPatchedEaseSet &&
      button.pz_set === button.__easingPlusPatchedEaseSet
    ) {
      button.pz_set = button.__easingPlusOriginalEaseSet;
    }
    delete button.__easingPlusPatchedInterpSet;
    delete button.__easingPlusOriginalInterpSet;
    delete button.__easingPlusPatchedEaseSet;
    delete button.__easingPlusOriginalEaseSet;
  }

  function isBezierEaseButton(easeButton) {
    const interpolationButton = interpolationButtonFor(easeButton);
    if (!interpolationButton) return false;
    if (interpolationButton.pz_value === 1) return true;
    const interpolationIcon =
      interpolationButton.querySelector?.("use")?.getAttribute("xlink:href") ||
      interpolationButton.querySelector?.("use")?.getAttribute("href") ||
      "";
    return interpolationIcon.endsWith("#interp_1");
  }

  function updateEaseButtonLabel(easeButton) {
    if (!easeButton || !easeButton.classList) return;
    if (isBezierEaseButton(easeButton)) {
      easeButton.dataset.easingPlus = "true";
      easeButton.classList.add("easing-plus-ease-button");
      if (!Object.prototype.hasOwnProperty.call(easeButton, "__easingPlusAriaLabel")) {
        easeButton.__easingPlusAriaLabel = easeButton.getAttribute("aria-label");
      }
      easeButton.setAttribute("aria-label", "Easing+");
      return;
    }
    delete easeButton.dataset.easingPlus;
    easeButton.classList.remove("easing-plus-ease-button");
    if (Object.prototype.hasOwnProperty.call(easeButton, "__easingPlusAriaLabel")) {
      const originalAriaLabel = easeButton.__easingPlusAriaLabel;
      if (originalAriaLabel == null) easeButton.removeAttribute("aria-label");
      else easeButton.setAttribute("aria-label", originalAriaLabel);
      delete easeButton.__easingPlusAriaLabel;
    }
  }

  function decorateEaseButton(easeButton) {
    if (!easeButton || !easeButton.classList) return;
    state.easeButtons.add(easeButton);
    if (
      typeof easeButton.pz_update === "function" &&
      !easeButton.__easingPlusPatchedEaseUpdate
    ) {
      const originalUpdate = easeButton.pz_update;
      const patchedUpdate = function () {
        const result = originalUpdate.apply(this, arguments);
        updateEaseButtonLabel(this);
        return result;
      };
      easeButton.__easingPlusOriginalEaseUpdate = originalUpdate;
      easeButton.__easingPlusPatchedEaseUpdate = patchedUpdate;
      easeButton.pz_update = patchedUpdate;
    }

    const interpolationButton = interpolationButtonFor(easeButton);
    if (
      interpolationButton &&
      typeof interpolationButton.pz_update === "function" &&
      !interpolationButton.__easingPlusPatchedInterpolationUpdate
    ) {
      const originalUpdate = interpolationButton.pz_update;
      const patchedUpdate = function () {
        const result = originalUpdate.apply(this, arguments);
        updateEaseButtonLabel(easeButton);
        return result;
      };
      interpolationButton.__easingPlusOriginalInterpolationUpdate = originalUpdate;
      interpolationButton.__easingPlusPatchedInterpolationUpdate = patchedUpdate;
      interpolationButton.pz_update = patchedUpdate;
      state.easeButtons.add(interpolationButton);
    }
    updateEaseButtonLabel(easeButton);
  }

  function decorateEaseButtons(root = document) {
    if (!root?.querySelectorAll) return;
    root
      .querySelectorAll(
        'button.pz-tweens[title="easing"], button.pz-tweens[data-easing-plus="true"]'
      )
      .forEach(decorateEaseButton);
  }

  function installEaseButtonLabels() {
    later(uninstallEaseButtonLabels);
    decorateEaseButtons();
    wrapExistingTweenButtonSets();
    const controls = window.PZ?.ui?.controls;
    if (typeof controls?.createKeyframeControls !== "function") return;
    state.originalCreateKeyframeControls = controls.createKeyframeControls;
    state.patchedCreateKeyframeControls = function () {
      const row = state.originalCreateKeyframeControls.apply(this, arguments);
      decorateEaseButtons(row);
      wrapTweenButtonSets(row);
      return row;
    };
    later(() => {
      if (window.PZ?.ui?.controls?.createKeyframeControls === state.patchedCreateKeyframeControls) {
        window.PZ.ui.controls.createKeyframeControls = state.originalCreateKeyframeControls;
      }
    });
    controls.createKeyframeControls = state.patchedCreateKeyframeControls;
  }

  function uninstallEaseButtonLabels() {
    if (
      window.PZ?.ui?.controls?.createKeyframeControls === state.patchedCreateKeyframeControls
    ) {
      window.PZ.ui.controls.createKeyframeControls = state.originalCreateKeyframeControls;
    }
    state.easeButtons.forEach((button) => {
      unwrapTweenButtonSets(button);
      if (
        button.__easingPlusPatchedEaseUpdate &&
        button.pz_update === button.__easingPlusPatchedEaseUpdate
      ) {
        button.pz_update = button.__easingPlusOriginalEaseUpdate;
      }
      if (
        button.__easingPlusPatchedInterpolationUpdate &&
        button.pz_update === button.__easingPlusPatchedInterpolationUpdate
      ) {
        button.pz_update = button.__easingPlusOriginalInterpolationUpdate;
      }
      delete button.__easingPlusPatchedEaseUpdate;
      delete button.__easingPlusOriginalEaseUpdate;
      delete button.__easingPlusPatchedInterpolationUpdate;
      delete button.__easingPlusOriginalInterpolationUpdate;
      delete button.dataset.easingPlus;
      button.classList?.remove("easing-plus-ease-button");
      if (Object.prototype.hasOwnProperty.call(button, "__easingPlusAriaLabel")) {
        const originalAriaLabel = button.__easingPlusAriaLabel;
        if (originalAriaLabel == null) button.removeAttribute("aria-label");
        else button.setAttribute("aria-label", originalAriaLabel);
        delete button.__easingPlusAriaLabel;
      }
    });
    state.easeButtons.clear();
    state.displayRows.forEach((row) => {
      try {
        unwrapRowDisplay(row);
      } catch (error) {
        // A detached row simply skips the restore.
      }
    });
    state.displayRows.clear();
    state.originalCreateKeyframeControls = null;
    state.patchedCreateKeyframeControls = null;
  }

  function applyCurveToTarget(target, points, propertyOps) {
    const { property, start, end } = target;
    const plan = curves.planCurve(property, start, end, points);
    if (!plan) throw new Error("Easing+ cannot be applied to this keyframe range.");
    const address = property.getAddress();
    const startControlPoints = [start.controlPoints[0].slice(), plan.points[0].outgoing.slice()];
    const last = plan.points[plan.points.length - 1];
    const endControlPoints = [last.incoming.slice(), end.controlPoints[1].slice()];

    propertyOps.setControlPoints({
      property: address,
      frame: start.frame,
      controlPoints: startControlPoints,
    });

    propertyOps.setControlPoints({
      property: address,
      frame: end.frame,
      controlPoints: endControlPoints,
    });
    propertyOps.setTween({ property: address, frame: end.frame, tween: curves.BEZIER_TWEEN });
    return plan;
  }

  return {
    installShapePreservation,
    uninstallShapePreservation,
    installEaseButtonLabels,
    uninstallEaseButtonLabels,
    resolveTargets,
    applyCurveToTarget,
    applyIncomingDisplay,
    pickTargetForSet,
    keyframesAround,
    resolveTweenWrites,
    executeTweenWrite,
    resolveDisplayTweens,
    isPropertyInterpolated,
  };
};
