"use strict";
// AE-style in-place editing for Shape+ text items.
//
// Double-clicking a text item enters edit mode on the rendered text itself:
// the real Shape+ render stays visible, and the overlay canvas draws only a
// caret and a selection highlight from the evaluated layout glyph positions.
// Input goes through a hidden 1 px textarea (kept at the caret's screen
// position so the OS IME candidate window opens next to the caret), and
// every change writes Source Text live, so the render re-lays out as you
// type. The whole session is one history step through the shared contents
// gesture. Escape or a click outside commits; only an error rolls back.
// See plugins/shape-plus/text-caret.js for the pure index math.
const caret = require("./text-caret.js");
const { holdValue } = require("./text-properties.js");
function install(s) {
  let session = null;
  function evaluatedOf(id) {
    const item = s.find(id);
    if (!item || item.kind !== "text") return null;
    const frame = session ? session.frame : s.localFrame();
    return { item, frame, evaluated: item.evaluate(frame) };
  }
  function lineHeightOf(evaluated) {
    const size = Number(evaluated.properties.fontSize) || 100;
    const leading = Number(evaluated.properties.leading);
    return Number.isFinite(leading) && leading > 0 ? leading : size * 1.2;
  }
  // Rebuild the layout, spans and metrics after any text change. Returns
  // false and ends the session when the item is gone.
  function resync() {
    const found = evaluatedOf(session.id);
    if (!found) {
      finish();
      return false;
    }
    session.layout = found.evaluated.textLayout;
    session.lineHeight = lineHeightOf(found.evaluated);
    session.caps = found.evaluated.properties.caps;
    session.spans = caret.rowSpans(session.text, session.layout.rows, session.caps);
    const length = caret.normalizeSource(session.text).length;
    session.caret = caret.snapCluster(session.text, Math.min(Math.max(session.caret, 0), length));
    session.anchor = caret.snapCluster(session.text, Math.min(Math.max(session.anchor, 0), length));
    return true;
  }
  function write(text) {
    session.text = text;
    const item = s.find(session.id);
    if (!item) return;
    s.setValue(item.properties.sourceText, text, session.frame);
  }
  function afterWrite() {
    s.refresh();
    if (resync()) placeInput();
  }
  function entryOf() {
    return s.canvasApi.entries().find(entry => entry.item.id === session.id);
  }
  function screenOf(layoutPoint) {
    const entry = entryOf();
    if (!entry) return null;
    return s.canvasApi.screen(layoutPoint, entry.matrix);
  }
  // Keep the hidden input at the caret's screen position so the OS IME
  // candidate window opens next to the caret.
  function placeInput() {
    if (!session) return;
    const x = caret.xForOffset(session.layout.rows, session.layout.glyphs, session.spans, session.caret);
    const row = session.layout.rows[caret.rowAtOffset(session.spans, session.caret)];
    const top = row ? caret.rowTop(row.baseline, session.lineHeight) : 0;
    const screen = screenOf([x, top]);
    if (!screen) return;
    const rect = s.canvas.getBoundingClientRect();
    const left = Math.round(rect.left + screen[0]) + "px", above = Math.round(rect.top + screen[1]) + "px";
    if (session.placedLeft !== left || session.placedTop !== above) {
      session.input.style.left = left;
      session.input.style.top = above;
      session.placedLeft = left;
      session.placedTop = above;
    }
  }
  function selectedRange() {
    return session.anchor <= session.caret ? [session.anchor, session.caret] : [session.caret, session.anchor];
  }
  function deleteSelection() {
    const [from, to] = selectedRange();
    if (to > from) {
      write(session.text.slice(0, from) + session.text.slice(to));
      session.caret = session.anchor = from;
      session.goalX = null;
    }
  }
  function insertAtCaret(data) {
    if (!data) return;
    deleteSelection();
    const at = session.caret;
    write(session.text.slice(0, at) + data + session.text.slice(at));
    session.caret = session.anchor = at + data.length;
    session.goalX = null;
    afterWrite();
  }
  function selectAll() {
    session.anchor = 0;
    session.caret = session.text.length;
    session.goalX = null;
    s.refresh();
  }
  function copySelection(cut) {
    const [from, to] = selectedRange();
    const text = session.text.slice(from, to);
    if (cut && to > from) {
      deleteSelection();
      afterWrite();
    } else s.refresh();
    if (text && s.window?.navigator?.clipboard) s.window.navigator.clipboard.writeText(text).catch(() => {});
  }
  function moveSide(event, direction) {
    if (!event.shiftKey && session.anchor !== session.caret) {
      const [from, to] = selectedRange();
      session.caret = session.anchor = direction < 0 ? from : to;
    } else {
      const next = caret.stepCluster(session.text, session.caret, direction);
      session.caret = next;
      if (!event.shiftKey) session.anchor = next;
    }
    session.goalX = null;
    s.refresh();
  }
  function moveVertical(event, direction) {
    const moved = caret.moveVertically(session.text, session.layout.rows, session.layout.glyphs, session.spans,
      session.caret, direction, session.goalX, session.lineHeight);
    session.goalX = session.goalX ?? moved.x;
    session.caret = moved.offset;
    if (!event.shiftKey) session.anchor = moved.offset;
    s.refresh();
  }
  function finish(cancel = false) {
    if (!session) return;
    const { input } = session;
    session = null;
    input.remove();
    if (s.canvas.style.cursor === "text") s.canvas.style.cursor = "";
    // Never steal focus: only return to the canvas when removing the
    // focused element.
    if (s.document.activeElement === input) s.canvas.focus({ preventScroll: true });
    if (cancel) s.gesture.finish(true);
    else s.gesture.finish();
    s.refresh();
  }
  function check() {
    if (!session) return;
    if (!s.valid() || s.localFrame() !== session.frame || !s.find(session.id)) {
      finish();
      return;
    }
    const item = s.find(session.id);
    if (item.properties.sourceText.expression) {
      finish();
      return;
    }
    // Adopt outside edits (panel field, undo, redo) and keep editing them.
    const live = String(holdValue(item.properties.sourceText, session.frame));
    if (live !== session.text) {
      if (session.composing) {
        finish();
        return;
      }
      session.text = live;
      session.anchor = session.caret;
      if (resync()) placeInput();
      s.refresh();
      return;
    }
    if (s.canvas.style.cursor !== "text") s.canvas.style.cursor = "text";
    placeInput();
  }
  function press(event, start) {
    if (!session) return null;
    const entry = s.canvasApi.itemAt(start);
    if (!entry || entry.item.kind !== "text" || entry.item.id !== session.id) {
      finish();
      return null;
    }
    const local = s.canvasApi.local(start, entry);
    if (!local) {
      finish();
      return null;
    }
    const at = caret.offsetForPoint(session.text, session.layout.rows, session.layout.glyphs,
      session.spans, local[0], local[1], session.lineHeight);
    if (event.shiftKey) session.caret = at;
    else session.anchor = session.caret = at;
    session.goalX = null;
    s.refresh();
    session.input.focus({ preventScroll: true });
    return {
      frame: session.frame,
      target: session.id,
      move(moveEvent) {
        if (!session) return;
        const rect = s.canvas.getBoundingClientRect();
        const point = s.canvasApi.local([moveEvent.clientX - rect.left, moveEvent.clientY - rect.top], entry);
        if (!point) return;
        session.caret = caret.offsetForPoint(session.text, session.layout.rows, session.layout.glyphs,
          session.spans, point[0], point[1], session.lineHeight);
        session.goalX = null;
        s.refresh();
      },
      end() {
        if (session) session.input.focus({ preventScroll: true });
        s.refresh();
      },
      cancel() {
        if (session) session.input.focus({ preventScroll: true });
      },
    };
  }
  function selectWord(point) {
    if (!session) return;
    const entry = entryOf();
    if (!entry) return;
    const local = s.canvasApi.local(point, entry);
    if (!local) return;
    const at = caret.offsetForPoint(session.text, session.layout.rows, session.layout.glyphs,
      session.spans, local[0], local[1], session.lineHeight);
    const word = caret.wordAt(session.text, at);
    if (!word) return;
    session.anchor = word.start;
    session.caret = word.end;
    session.goalX = null;
    session.input.focus({ preventScroll: true });
    placeInput();
    s.refresh();
  }
  s.editText = (item, point) => {
    finish();
    s.selectItem(item.id);
    if (item.properties.sourceText.expression) {
      s.message("Expression-driven text cannot be edited inline.");
      return;
    }
    s.finishNudge?.();
    if (!s.gesture.begin()) {
      s.message("Shape+ text edit could not start a history step.");
      return;
    }
    const frame = s.localFrame();
    const text = String(holdValue(item.properties.sourceText, frame));
    const evaluated = item.evaluate(frame);
    const input = s.document.createElement("textarea");
    input.setAttribute("aria-label", "Edit Shape+ text");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    // Transparent and 1 px: the render stays visible and only the OS IME
    // candidate window needs this position.
    input.style.cssText = "position:fixed;z-index:10000;width:1px;height:1px;opacity:0;border:0;padding:0;resize:none;overflow:hidden;pointer-events:none;left:0;top:0";
    session = {
      id: item.id, frame, text, caret: text.length, anchor: text.length, goalX: null,
      layout: evaluated.textLayout, lineHeight: 120, caps: evaluated.properties.caps,
      spans: [], composing: false, base: "", baseCaret: 0, compStart: 0, compEnd: 0,
      input, placedLeft: "", placedTop: "",
    };
    input.onkeydown = event => {
      if (!session) return;
      event.stopPropagation();
      if (event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key;
      const lower = key.length === 1 ? key.toLowerCase() : key;
      if (mod && lower === "a") {
        event.preventDefault();
        selectAll();
        return;
      }
      if (mod && (lower === "c" || lower === "x")) {
        event.preventDefault();
        copySelection(lower === "x");
        return;
      }
      // Paste flows through the input event below; every other modified
      // key is left to the host.
      if (mod) return;
      if (key === "Escape") {
        event.preventDefault();
        finish();
        return;
      }
      if (key === "Tab") {
        // Commit and let focus move on; blur after this is a no-op.
        finish();
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        moveSide(event, key === "ArrowLeft" ? -1 : 1);
        placeInput();
        return;
      }
      if (key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault();
        moveVertical(event, key === "ArrowUp" ? -1 : 1);
        placeInput();
        return;
      }
      if (key === "Home" || key === "End") {
        event.preventDefault();
        const next = key === "Home" ? caret.rowHome(session.spans, session.caret) : caret.rowEnd(session.spans, session.caret);
        session.caret = next;
        if (!event.shiftKey) session.anchor = next;
        session.goalX = null;
        s.refresh();
        placeInput();
        return;
      }
      if (key === "Backspace" || key === "Delete") {
        event.preventDefault();
        const [from, to] = selectedRange();
        if (to > from) deleteSelection();
        else if (key === "Backspace" && from > 0) {
          const prev = caret.stepCluster(session.text, from, -1);
          write(session.text.slice(0, prev) + session.text.slice(from));
          session.caret = session.anchor = prev;
        } else if (key === "Delete" && from < session.text.length) {
          const next = caret.stepCluster(session.text, from, 1);
          write(session.text.slice(0, from) + session.text.slice(next));
          session.caret = session.anchor = from;
        } else return;
        session.goalX = null;
        afterWrite();
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        insertAtCaret("\n");
        return;
      }
      // Printable keys, paste and IME insert through oninput below.
    };
    const previewComposition = data => {
      write(session.base.slice(0, session.baseCaret) + data + session.base.slice(session.baseCaret));
      session.caret = session.anchor = session.baseCaret + data.length;
      session.compStart = session.baseCaret;
      session.compEnd = session.caret;
      afterWrite();
    };
    input.oncompositionstart = () => {
      if (!session || session.composing) return;
      deleteSelection();
      session.composing = true;
      session.base = session.text;
      session.baseCaret = session.caret;
      session.compStart = session.caret;
      session.compEnd = session.caret;
      afterWrite();
    };
    input.oncompositionupdate = event => {
      if (session?.composing) previewComposition(event.data || "");
    };
    input.oncompositionend = event => {
      if (!session?.composing) return;
      const data = typeof event.data === "string" ? event.data : input.value;
      session.composing = false;
      write(session.base.slice(0, session.baseCaret) + data + session.base.slice(session.baseCaret));
      session.caret = session.anchor = session.baseCaret + data.length;
      session.compStart = session.compEnd = session.caret;
      input.value = "";
      afterWrite();
      input.focus({ preventScroll: true });
    };
    input.oninput = event => {
      if (!session) return;
      if (session.composing || event.isComposing) {
        previewComposition(input.value);
        return;
      }
      // Empty inputs (cut, formatting) carry no text; cut is handled above.
      const data = typeof event.data === "string" && event.data ? event.data : input.value;
      if (data) insertAtCaret(data);
      if (input.value) input.value = "";
    };
    // A blur with the canvas focused belongs to a press that already ran;
    // any other focus loss commits the session.
    input.onblur = () => {
      if (session && s.document.activeElement !== s.canvas) finish();
    };
    session.lineHeight = lineHeightOf(evaluated);
    session.spans = caret.rowSpans(text, session.layout.rows, session.caps);
    if (point) {
      const entry = s.canvasApi.entries().find(candidate => candidate.item.id === item.id);
      const local = entry && s.canvasApi.local(point, entry);
      if (local) {
        const at = caret.offsetForPoint(text, session.layout.rows, session.layout.glyphs,
          session.spans, local[0], local[1], session.lineHeight);
        session.caret = session.anchor = at;
      }
    }
    s.document.body.appendChild(input);
    input.focus({ preventScroll: true });
    placeInput();
    s.refresh();
  };
  s.textEdit = {
    get active() {
      return !!session;
    },
    activeOn: id => session?.id === id,
    press,
    selectWord,
  };
  s.finishTextEdit = () => finish();
  // The overlay draws only the caret and the selection on top of the real
  // render. Every point maps through the same screen transform as handles.
  s.drawTextEdit = context => {
    if (!session) return;
    const entry = entryOf();
    if (!entry) return;
    const toScreen = point => s.canvasApi.screen(point, entry.matrix);
    const trace = rect => {
      const corners = [
        [rect.x, rect.y], [rect.x + rect.width, rect.y],
        [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height],
      ].map(toScreen);
      context.beginPath();
      corners.forEach((corner, i) => (i ? context.lineTo(...corner) : context.moveTo(...corner)));
      context.closePath();
    };
    const [from, to] = session.anchor <= session.caret ? [session.anchor, session.caret] : [session.caret, session.anchor];
    if (to > from) {
      context.fillStyle = "rgba(88,166,255,.35)";
      for (const rect of caret.rectsForRange(session.layout.rows, session.layout.glyphs, session.spans, from, to, session.lineHeight)) {
        trace(rect);
        context.fill();
      }
    }
    if (session.composing && session.compEnd > session.compStart) {
      context.strokeStyle = "#58a6ff";
      context.lineWidth = 2;
      for (const rect of caret.rectsForRange(session.layout.rows, session.layout.glyphs, session.spans,
        session.compStart, session.compEnd, session.lineHeight)) {
        const [a, b] = [toScreen([rect.x, rect.y + rect.height]), toScreen([rect.x + rect.width, rect.y + rect.height])];
        context.beginPath();
        context.moveTo(...a);
        context.lineTo(...b);
        context.stroke();
      }
    }
    const now = s.window?.performance?.now?.() ?? 0;
    if (Math.floor(now / 530) % 2 === 0) {
      const x = caret.xForOffset(session.layout.rows, session.layout.glyphs, session.spans, session.caret);
      const row = session.layout.rows[caret.rowAtOffset(session.spans, session.caret)];
      const top = row ? caret.rowTop(row.baseline, session.lineHeight) : 0;
      const [a, b] = [toScreen([x, top]), toScreen([x, top + session.lineHeight])];
      context.strokeStyle = "rgba(0,0,0,.75)";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(...a);
      context.lineTo(...b);
      context.stroke();
      context.strokeStyle = "#58a6ff";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(...a);
      context.lineTo(...b);
      context.stroke();
    }
  };
  return {
    finish,
    check,
  };
}
module.exports = { install };
