"use strict";

// Fracture diagnostics are editor state, never project or render state.
const fracture = require("./effector-fracture.js");
const CONTROL_ID = "repeater:fracture-status";
let unregister = null;
let owners = 0;

function installFractureStatus(owner, PZ) {
  owner._fractureStatusDisposed = false;
  owner._fracturePending = new Set();
  owner._fractureWarnings = new Set();
  owner._fractureStatusViews = new Set();
  owner._fractureStatus = "Ready";
  const api = globalThis.ZoidiumPluginApis?.propertyControls;
  if (api && globalThis.PZ === PZ && PZ.ui?.controls && globalThis.document && !unregister) unregister = api.register(CONTROL_ID, {
    type: PZ.property.type.TEXT,
    create(property, context) {
      const target = property.__zoidiumFractureOwner;
      const element = context.document.createElement("div");
      element.className = "editbox";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      element.style.whiteSpace = "normal";
      element.style.color = "var(--zui-text-muted)";
      element.pz_update = element.pz_refresh = () => {
        element.textContent = target?._fractureStatus || "Ready";
      };
      element.pz_update();
      target?._fractureStatusViews.add(new WeakRef(element));
      return element;
    },
  });
  owners++;
  owner.properties.addAll({ fractureStatus: {
    name: "Fracture status", type: PZ.property.type.TEXT, value: "", zoidiumControl: CONTROL_ID,
  } });
  owner.properties.fractureStatus.__zoidiumFractureOwner = owner;
}

function setFractureJobStatus(owner, consumer, pending, codes = [], cancelled = false) {
  if (owner._fractureStatusDisposed) return;
  if (pending) {
    if (!owner._fracturePending.size) owner._fractureWarnings.clear();
    owner._fracturePending.add(consumer);
  } else {
    owner._fracturePending.delete(consumer);
    if (!cancelled) for (const code of codes) owner._fractureWarnings.add(fracture.fractureErrorText(code));
  }
  const warning = Array.from(owner._fractureWarnings).join("; ");
  owner._fractureStatus = owner._fracturePending.size ? "Computing fracture..." : warning ? "Warning: " + warning : "Ready";
  for (const reference of owner._fractureStatusViews) {
    const element = reference.deref();
    if (!element || !element.isConnected) owner._fractureStatusViews.delete(reference);
    else element.pz_update();
  }
}

function disposeFractureStatus(owner) {
  if (owner._fractureStatusDisposed) return;
  owner._fractureStatusDisposed = true;
  owner._fracturePending.clear();
  owner._fractureStatusViews.clear();
  if (--owners === 0) { unregister?.(); unregister = null; }
}

module.exports = { installFractureStatus, setFractureJobStatus, disposeFractureStatus };
