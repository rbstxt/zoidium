"use strict";

function g2doc(el) {
  try {
    if (el && el.ownerDocument) return el.ownerDocument;
  } catch (e) {}
  try {
    if (typeof document !== "undefined") return document;
  } catch (e2) {}
  return null;
}
// Empty-state messages reuse the shared note builder when it is reachable;
// otherwise a plain paragraph with the same wording.
function sharedEmptyNote(ownerDoc, text) {
  try {
    var w = (typeof window !== "undefined" && window.ZoidiumUI) ? window : null;
    var g = (!w && typeof globalThis !== "undefined") ? globalThis : null;
    var kit = (w && w.ZoidiumUI) || (g && g.ZoidiumUI);
    if (kit && kit.controls && typeof kit.controls.note === "function") {
      var built = kit.controls.note(text).element;
      if (built && ownerDoc && built.ownerDocument && built.ownerDocument !== ownerDoc
        && typeof ownerDoc.adoptNode === "function") {
        ownerDoc.adoptNode(built);
      }
      return built;
    }
  } catch (_error) { /* fall through to plain markup */ }
  return null;
}
function g2win(el) {
  var doc = g2doc(el);
  try {
    if (doc && doc.defaultView) return doc.defaultView;
  } catch (e) {}
  try {
    if (typeof window !== "undefined") return window;
  } catch (e2) {}
  return null;
}

/* Pointer-captured drag. ESSENTIAL here: the graph editor runs in a separate
   browser window, so once the cursor leaves it, window-level pointerup never
   fires and the drag sticks forever ("cursor wants to fill something").
   Pointer capture routes all events to the element; blur is a safety net. */
var gpPointerDrags = new WeakMap();
function beginPointerDrag(target, e, onMove, onEnd) {
  var root = target.closest ? target.closest(".g2-editor") : null;
  var drags = root ? gpPointerDrags.get(root) : null;
  if (root && !drags) { drags = new Set(); gpPointerDrags.set(root, drags); }
  var captured = false;
  var pid = e && e.pointerId;
  try {
    if (target.setPointerCapture && pid !== undefined && pid !== null) {
      target.setPointerCapture(pid);
      captured = true;
    }
  } catch (err) { captured = false; }
  // Listeners belong on the window/document that owns the target element:
  // the popup editor lives in a separate window whose events never reach
  // the main window. The main pair is kept as a backup for nodes that are
  // still being adopted between documents.
  function pairsFor(targetEl) {
    var pairs = [];
    var seen = [];
    function push(w, d) {
      if (!w && !d) return;
      for (var i = 0; i < seen.length; i++) {
        if (seen[i][0] === w && seen[i][1] === d) return;
      }
      seen.push([w, d]);
      pairs.push([w, d]);
    }
    var ownerDoc = g2doc(targetEl);
    var ownerWin = g2win(targetEl);
    push(ownerWin, ownerDoc);
    try {
      var mainWin = typeof window !== "undefined" ? window : null;
      var mainDoc = typeof document !== "undefined" ? document : null;
      push(mainWin, mainDoc);
    } catch (e2) {}
    return pairs;
  }
  var pairs = pairsFor(target);
  var finished = false;
  function move(ev) {
    if (finished) return;
    if (pid !== undefined && pid !== null && ev.pointerId !== undefined && ev.pointerId !== pid) return;
    onMove(ev);
  }
  function unlisten(pair, move, finish, onBlur) {
    var w = pair[0], d = pair[1];
    try {
      if (w && w.removeEventListener) {
        w.removeEventListener("pointermove", move);
        w.removeEventListener("pointerup", finish);
        w.removeEventListener("pointercancel", finish);
        w.removeEventListener("blur", onBlur);
      }
    } catch (err3) {}
    try {
      if (d && d.removeEventListener) d.removeEventListener("pointerup", finish);
    } catch (err4) {}
  }
  function finish(ev) {
    if (finished) return;
    finished = true;
    if (drags) drags.delete(finish);
    try { if (captured) target.releasePointerCapture(pid); } catch (err) {}
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", finish);
    for (var i = 0; i < pairs.length; i++) unlisten(pairs[i], move, finish, onBlur);
    if (onEnd) onEnd(ev || null);
  }
  function onBlur() { finish(null); }
  if (captured) {
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  } else {
    for (var j = 0; j < pairs.length; j++) {
      (function (pair) {
        var w = pair[0], d = pair[1];
        try {
          if (w && w.addEventListener) {
            w.addEventListener("pointermove", move);
            w.addEventListener("pointerup", finish);
            w.addEventListener("pointercancel", finish);
          }
        } catch (err5) {}
        try {
          if (d && d.addEventListener) d.addEventListener("pointerup", finish);
        } catch (err6) {}
      })(pairs[j]);
    }
  }
  for (var k = 0; k < pairs.length; k++) {
    try {
      var w = pairs[k][0];
      if (w && w.addEventListener) w.addEventListener("blur", onBlur);
    } catch (err7) {}
  }
  if (drags) drags.add(finish);
  return { finish: finish };
}

module.exports = { g2doc, g2win, sharedEmptyNote, beginPointerDrag, gpPointerDrags };
