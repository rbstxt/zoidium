"use strict";
const { constrainHandle } = require("./targets.js");

// Warn-once reporter for failure sites that run per layer on drop:
// the first failure is logged, repeats stay silent so the console stays readable.
var gpWarned = {};
function gpWarnOnce(key, message, error) {
  if (gpWarned[key]) return;
  gpWarned[key] = true;
  console.warn("[Zoidium] graph-plus: " + message, error);
}

module.exports = function (environment) {
const { PZ, focusNoScroll, currentFrame, beginPointerDrag } = environment;
/* ---------- snapping ---------- */
PZ.ui.graph.prototype.snapFrame = function (absFrame, excludeEls) {
  var f = Math.round(absFrame);
  if (!this.options.snap) return f;
  var threshPx = 8;
  var thresh = threshPx * this.zoomX;
  var best = f, bestD = thresh;
  var pf = currentFrame(this.editor);
  if (Math.abs(pf - f) < bestD) { best = pf; bestD = Math.abs(pf - f); }
  // exclude by keyframe identity so keys being dragged never snap to each other
  var excluded = null;
  try { excluded = new Set(); } catch (e) { excluded = null; }
  (excludeEls || []).forEach(function (el) { if (el.pz_object && excluded) excluded.add(el.pz_object); });
  var groups = this.propGroups();
  for (var gi = 0; gi < groups.length; gi++) {
    var gel = groups[gi];
    var off = gel.pz_frameOffset || 0;
    var keys = gel._keys ? gel._keys.children : [];
    for (var k = 0; k < keys.length; k++) {
      var kf = keys[k].pz_object;
      if (!kf) continue;
      if (excluded && excluded.has(kf)) continue;
      var ax = kf.frame + off;
      var d = Math.abs(ax - f);
      if (d < bestD && d > 0) { best = ax; bestD = d; }
    }
  }
  return best;
};

/* ---------- keyframe drag (pointer based) ---------- */
PZ.ui.graph.prototype.attachKeyframeHandlers = function (el) {
  var self = this;
  el._g2down = function (e) {
    if (e.button !== 0 || self._spaceDown || self.tool === "pan") return;
    e.stopPropagation();
    try { e.preventDefault(); } catch (err) { /* Synthetic host events may lack preventDefault. */ }
    focusNoScroll(self.bodyEl);
    var wasSelected = el.classList.contains("selected");
    if (!wasSelected) {
      if (!e.shiftKey) self.deselectAllKeyframes();
      self.selectKeyframe(el);
    }
    var rect = self.svg.getBoundingClientRect();
    var startPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    var startG = self.screenToGraph(startPx.x, startPx.y);
    var valueKeys = new Set(self.selectedKeys());
    var sel = self.timeKeys(Array.from(valueKeys));
    // snapshot
    var snap = sel.map(function (s) {
      var gel = s.parentElement.parentElement;
      return {
        el: s, gel: gel, kf: s.pz_object,
        oldFrame: s.pz_object.frame,
        oldValue: s.pz_object.value,
        scale: (gel && gel.pz_valueScale) || 1,
        off: (gel && gel.pz_frameOffset) || 0
      };
    });
    var primaryScale = el.parentElement.parentElement.pz_valueScale || 1;
    var curG = startG;
    var moved = false;
    self.editor.history.startOperation();
    var mv = function (ev) {
      var r2 = self.svg.getBoundingClientRect();
      curG = self.screenToGraph(ev.clientX - r2.left, ev.clientY - r2.top);
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true;
      self._dragging = "key";
      var updateFrame = !ev.ctrlKey;
      var updateValue = !ev.shiftKey;
      var dAbs = curG.x - startG.x;
      var dGraphY = curG.y - startG.y;
      for (var i = 0; i < snap.length; i++) {
        var s = snap[i];
        if (updateFrame) {
          var want = s.oldFrame + dAbs; // relative delta == absolute delta
          var absWant = want + s.off;
          var snapped = self.snapFrame(absWant, sel);
          s.kf.frame = Math.round(snapped - s.off);
        }
        if (updateValue && valueKeys.has(s.el)) {
          s.kf.value = s.oldValue + (-dGraphY) / primaryScale;
          try {
            if (s.gel.pz_object.definition && s.gel.pz_object.definition.min !== undefined)
              s.kf.value = Math.max(s.kf.value, s.gel.pz_object.definition.min);
            if (s.gel.pz_object.definition && s.gel.pz_object.definition.max !== undefined)
              s.kf.value = Math.min(s.kf.value, s.gel.pz_object.definition.max);
          } catch (err) { /* A property without limits keeps its dragged value. */ }
        }
        self.updateKeyframe(s.el);
        if (s.el.pz_handles) self.updateHandles(s.el.pz_handles);
        self.refreshAdjacentCurves(s.el);
      }
      self.updateStatus("Key · frame " + el.pz_object.frame + " · value " + el.pz_object.value);
    };
    var up = function (ev) {
      if (ev && ev.shiftKey && !moved && wasSelected) self.deselectKeyframe(el);
      if (moved) {
        for (var q = 0; q < snap.length; q++) {
          snap[q].el.pz_oldFrame = snap[q].oldFrame;
          snap[q].el.pz_oldValue = snap[q].oldValue;
        }
        self.selectNewKeyframes = true;
        self.finishMovingKeyframes(sel);
        self.selectNewKeyframes = false;
        // push value undo commands
        for (var i = 0; i < snap.length; i++) {
          var s = snap[i];
          var prop = s.gel.pz_object;
          self.editor.history.pushCommand(
            PZ.ui.properties.prototype.setValue.bind(self),
            { property: prop.getAddress(), value: s.oldValue, frame: s.kf.frame }
          );
        }
      }
      self._dragging = null;
      self.editor.history.finishOperation();
      self.updateStatus();
    };
    beginPointerDrag(el, e, mv, up);
  };
  el.addEventListener("pointerdown", el._g2down);
};
/* legacy shims: keep method names so old callers don't break */
PZ.ui.graph.prototype.keyframeDragStart = function () {};
PZ.ui.graph.prototype.keyframeDrag = function () {};
PZ.ui.graph.prototype.keyframeDragUpdate = function () {};
PZ.ui.graph.prototype.keyframeDragEnd = function () {};
PZ.ui.graph.prototype.finishMovingKeyframes = function (selEls) {
  var els = selEls || this.selectedKeys();
  // group by curve layer
  var byLayer = {};
  for (var i = 0; i < els.length; i++) {
    var gel = els[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var id = gel._gid;
    (byLayer[id] = byLayer[id] || { gel: gel, els: [] }).els.push(els[i]);
  }
  var self = this;
  Object.keys(byLayer).forEach(function (id) {
    var entry = byLayer[id];
    var prop = entry.gel.pz_object;
    var list = entry.els;
    // direction for stable collision handling
    list.sort(function (a, b) { return a.pz_object.frame - b.pz_object.frame; });
    var moves = self.propertyOps.startMove(prop, list.length);
    var map = new Map();
    for (var e = 0; e < list.length; e++) {
      var oldF = list[e].pz_oldFrame !== undefined ? list[e].pz_oldFrame : list[e].pz_object.frame;
      // pz_oldFrame was set in old code; in new code snapshot old from drag — fallback to current
      moves[e].oldFrame = list[e].pz_object.frame;
      moves[e].newFrame = oldF;
      map.set(moves[e], list[e].pz_object);
      delete list[e].pz_oldFrame;
      delete list[e].pz_oldValue;
    }
    // NOTE: startMove returns [{oldFrame:0,newFrame:0}]; we store undo = move back.
    // Our live mutation already applied; finishMove sorts, resolves collisions,
    // pushes undo commands and fires onKeyframeMoved for re-layout.
    try { self.propertyOps.finishMove(prop, new Set(list.map(function (x) { return x.pz_object; })), moves, map); }
    catch (err) { gpWarnOnce("finishMove:" + id, "committing the keyframe move failed", err); }
  });
  this.updateViewBox();
  this.updateLegend();
};

/* ---------- handle drag ---------- */
PZ.ui.graph.prototype.attachHandleHandlers = function (el, cpIdx, kfEl) {
  var self = this;
  el._g2down = function (e) {
    if (e.button !== 0 || self._spaceDown || self.tool === "pan") return;
    e.stopPropagation();
    try { e.preventDefault(); } catch (err) { /* Synthetic host events may lack preventDefault. */ }
    focusNoScroll(self.bodyEl);
    var gel = kfEl.parentElement.parentElement;
    var kf = kfEl.pz_object;
    var rect = self.svg.getBoundingClientRect();
    var startPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    var startG = self.screenToGraph(startPx.x, startPx.y);
    var sel = self.selectedKeys();
    if (!kfEl.classList.contains("selected")) sel = [kfEl];
    if (!kfEl.classList.contains("selected")) { self.deselectAllKeyframes(); self.selectKeyframe(kfEl); }
    var snaps = sel.map(function (s) {
      return { el: s, kf: s.pz_object, gel: s.parentElement.parentElement, oldCP: JSON.parse(JSON.stringify(s.pz_object.controlPoints)), continuous: e.altKey ? false : s.pz_object.continuousTangent };
    });
    snaps.forEach(function (sn) { sn.el.pz_oldControlPoints = JSON.parse(JSON.stringify(sn.oldCP)); });
    var lastAlt = !!e.altKey;
    var moved = false;
    self.editor.history.startOperation();
    var mv = function (ev) {
      var r2 = self.svg.getBoundingClientRect();
      var curG = self.screenToGraph(ev.clientX - r2.left, ev.clientY - r2.top);
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true;
      var dF = curG.x - startG.x;
      var dV = -(curG.y - startG.y) / (gel.pz_valueScale || 1);
      if (!!ev.altKey !== lastAlt) {
        lastAlt = !!ev.altKey;
        for (var snapshot of snaps) snapshot.continuous = !lastAlt;
      }
      if (!self._dragging) self._dragging = "handle";
      for (var i = 0; i < snaps.length; i++) {
        var sn = snaps[i];
        if (!sn.converted) {
          // The right key owns a segment's easing, including the outgoing handle.
          var owner = cpIdx === 1 ? sn.el.nextElementSibling : sn.el;
          if (owner && owner.pz_object.tween !== 257) self.propertyOps.setTween({
            property: sn.gel.pz_object.getAddress(), frame: owner.pz_object.frame, tween: 257 });
          sn.converted = true;
        }
        var cp = sn.kf.controlPoints[cpIdx];
        var wantF = sn.oldCP[cpIdx][0] + dF;
        if (cpIdx === 0) cp[0] = Math.min(wantF, 0);
        else cp[0] = Math.max(wantF, 0);
        cp[1] = sn.oldCP[cpIdx][1] + dV;
        var neighbour = cpIdx ? sn.el.nextElementSibling?.pz_object : sn.el.previousElementSibling?.pz_object;
        var slope = neighbour ? (neighbour.value - sn.kf.value) / (neighbour.frame - sn.kf.frame) : 0;
        var zx = self.zoomX || 1, zy = self.zoomY || 1;
        var sc = sn.gel.pz_valueScale || 1;
        var constrained = constrainHandle([cp[0] / zx, -cp[1] * sc / zy], ev, -slope * sc * zx / zy);
        cp[0] = constrained[0] * zx; cp[1] = -constrained[1] * zy / sc;
        if (sn.continuous) {
          var other = sn.kf.controlPoints[1 - cpIdx];
          // mirror: keep length of other? old code mirrors dragged length onto other
          var len = Math.sqrt(cp[0] * cp[0] + cp[1] * cp[1]);
          var ang = Math.atan2(cp[1], cp[0]) + Math.PI;
          // preserve other length? old code overwrote other with same length — keep that behavior
          other[0] = len * Math.cos(ang);
          other[1] = len * Math.sin(ang);
        }
        self.updateHandles(sn.el.pz_handles);
        self.refreshAdjacentCurves(sn.el);
      }
      self.updateStatus("Handle · frame " + kf.frame + " · " + kf.controlPoints[cpIdx].map(v => Math.round(v * 100) / 100).join(", "));
    };
    var up = function (ev) {
      if (moved) {
        self.finishMovingHandles(false);
        for (var sn of snaps) {
          if (sn.kf.continuousTangent === sn.continuous) continue;
          var finalCP = sn.kf.controlPoints.map(point => point.slice());
          self.setContinuousTangentExact(sn.gel.pz_object, sn.kf, sn.continuous);
          // Native linking mirrors the incoming tangent. Keep the dragged side
          // and its paired coordinates exact, including roundoff.
          self.propertyOps.setControlPoints({ property: sn.gel.pz_object.getAddress(), frame: sn.kf.frame, controlPoints: finalCP });
        }
      }
      self._dragging = null;
      self.updateStatus();
      self.editor.history.finishOperation();
    };
    beginPointerDrag(el, e, mv, up);
  };
  el.addEventListener("pointerdown", el._g2down);
  el._g2double = function (e) {
    e.stopPropagation(); e.preventDefault();
    self.editor.history.startOperation();
    var gel = kfEl.parentElement.parentElement;
    self.propertyOps.setControlPoints({ property: gel.pz_object.getAddress(), frame: kfEl.pz_object.frame,
      controlPoints: [[-10, 0], [10, 0]] });
    self.editor.history.finishOperation();
  };
  el.addEventListener("dblclick", el._g2double);
};
PZ.ui.graph.prototype.handleDragStart = function () {};
PZ.ui.graph.prototype.handleDrag = function () {};
PZ.ui.graph.prototype.handleDragUpdate = function () {};
PZ.ui.graph.prototype.handleDragEnd = function () {};
PZ.ui.graph.prototype.finishMovingHandles = function (brokeTangent) {
  var sel = this.selectedKeys();
  var byLayer = {};
  for (var i = 0; i < sel.length; i++) {
    var gel = sel[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    (byLayer[gel._gid] = byLayer[gel._gid] || { gel: gel, els: [] }).els.push(sel[i]);
  }
  var self = this;
  Object.keys(byLayer).forEach(function (id) {
    var entry = byLayer[id];
    var addr = entry.gel.pz_object.getAddress();
    entry.els.forEach(function (kfel) {
      var kf = kfel.pz_object;
      var oldCP = kfel.pz_oldControlPoints;
      if (!oldCP) {
        // fallback: push current as undo (no-op) — still need to fire changed
        try { entry.gel.pz_object.onKeyframeChanged.update(kf); } catch (e) { console.warn("[Zoidium] graph-plus: notifying the keyframe change failed", e); }
        return;
      }
      self.editor.history.pushCommand(
        PZ.ui.properties.prototype.setControlPoints.bind(self),
        { property: addr, frame: kf.frame, controlPoints: oldCP }
      );
      if (brokeTangent && kf.continuousTangent) {
        self.setContinuousTangentExact(entry.gel.pz_object, kf, false);
      }
      delete kfel.pz_oldControlPoints;
    });
  });
  // snapshot oldCP for next drag
  this.updateViewBox();
};
// store oldCP on selection for undo of handles
PZ.ui.graph.prototype.snapshotHandleUndo = function () {
  var sel = this.selectedKeys();
  sel.forEach(function (el) {
    el.pz_oldControlPoints = JSON.parse(JSON.stringify(el.pz_object.controlPoints));
  });
};
};
