"use strict";

// Floating graph window and module-scope helper tests for Graph Editor 2 (plugins/graph-plus/).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { projectRoot, source, plain, loadModule, stubFn, makeHistory, makeFakePZ, makeContext, keyEl } = require("./graph-plus-harness.js");

function floatingHost() {
  const listeners = {};
  const body = {
    classList: { add() {} }, style: {},
    appendChild: stubFn(),
    addEventListener(type, fn, capture) { listeners[type + (capture ? ':capture' : '')] = fn; },
    removeEventListener(type, fn, capture) { delete listeners[type + (capture ? ':capture' : '')]; },
    ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 800,
      addEventListener(type, fn) { listeners['owner:' + type] = fn; },
      removeEventListener(type) { delete listeners['owner:' + type]; }, ResizeObserver: class {
      observe() {} disconnect() { body.disconnected = true; }
    } } },
  };
  const opens = [];
  const ui = { openWindow(options) {
    let open = true;
    const cleanups = [];
    const host = { focus: stubFn(), reveal: stubFn(), isOpen: () => open,
      element: { style: {}, ownerDocument: body.ownerDocument,
        addEventListener(type, fn, capture) { listeners['chrome:' + type + (capture ? ':capture' : '')] = fn; },
        removeEventListener(type, fn, capture) { delete listeners['chrome:' + type + (capture ? ':capture' : '')]; },
      },
      addCleanup(fn) { cleanups.push(fn); },
      close() { if (open) { open = false; cleanups.forEach(fn => fn()); cleanup(); } } };
    const cleanup = options.mount(body, host);
    opens.push({ options, host });
    return host;
  } };
  const panel = () => ({ enabled: false, objects: [],
    el: { style: {}, remove: stubFn() }, resize: stubFn(), unload: stubFn(),
    _right: { _spaceDown: false },
  });
  return { body, listeners, opens, ui, panel };
}

test('floating graph factory opens once, focuses, preserves panel and cleans up on close/disable', async () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const native = stubFn(() => 'native');
  const editor = { windows: [], createWindow: native, keydown: stubFn() };
  const host = floatingHost();
  const { context } = makeContext(PZ, editor);
  context.ui = host.ui;
  await GraphPlus.activate(context);
  assert.equal(editor.createWindow({ title: 'Other' }), 'native');
  const win = editor.createWindow({ title: 'Graph editor' });
  const panel = host.panel();
  win.setPanel(panel); win.enabled = true;
  assert.equal(editor.windows[0], win);
  assert.equal(panel.enabled, true);
  assert.equal(host.opens[0].options.persistKey, 'graph-editor');
  assert.equal(host.opens[0].options.placement, 'center');
  assert.equal(host.opens[0].options.maximizable, true);
  const again = editor.createWindow({ title: 'Graph editor' });
  const discarded = host.panel(); again.setPanel(discarded);
  assert.equal(again, win);
  assert.equal(host.opens.length, 1);
  assert.equal(host.opens[0].host.reveal.calls.length, 2, 'opening and reopening reveal the window');
  assert.equal(win.panel, panel);
  assert.equal(discarded.unload.calls.length, 1);
  const event = { code: 'Space', type: 'keydown', stopPropagation: stubFn() };
  host.listeners['keydown:capture'](event);
  assert.equal(panel._right._spaceDown, true);
  host.listeners['keyup:capture']({ code: 'Space', type: 'keyup' });
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: () => ({}) } }]) {
    host.listeners['keydown:capture']({ code: 'Space', type: 'keydown', ...extra });
    assert.equal(panel._right._spaceDown, false);
  }
  host.listeners.keydown(event);
  assert.equal(editor.keydown.calls.length, 1);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: () => ({}) } }]) {
    host.listeners.keydown({ key: 'n', ctrlKey: true, stopPropagation: stubFn(), ...extra });
    assert.equal(editor.keydown.calls.length, 1);
  }
  assert.equal(event.stopPropagation.calls.length, 1);
  for (const key of ['n', 'm', 'o', 's', 'z', 'y']) {
    host.listeners['chrome:keydown']({ key, ctrlKey: true, stopPropagation: stubFn() });
  }
  assert.equal(editor.keydown.calls.length, 7, 'chrome forwards every native popup editor command');
  host.listeners['chrome:keydown:capture']({ key: 'g', ctrlKey: true, preventDefault: stubFn(), stopPropagation: stubFn() });
  assert.ok(host.opens[0].host.reveal.calls.length >= 2, 'graph shortcut reveals the host');
  assert.equal(editor.keydown.calls.length, 7, 'graph shortcut restores the host without forwarding another native command');
  const revealCount = host.opens[0].host.reveal.calls.length;
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: () => ({}) } }]) {
    host.listeners['chrome:keydown:capture']({ key: 'g', ctrlKey: true, preventDefault: stubFn(), stopPropagation: stubFn(), ...extra });
    assert.equal(host.opens[0].host.reveal.calls.length, revealCount);
  }
  win.window.close(); win.window.close();
  assert.equal(panel.unload.calls.length, 1);
  assert.equal(panel.enabled, false);
  assert.equal(panel.objects, null);
  assert.equal(editor.windows.length, 0);
  assert.equal(host.body.disconnected, true);
  assert.deepEqual(host.listeners, {});
  const reopened = editor.createWindow({ title: 'Graph editor' });
  reopened.setPanel(host.panel());
  GraphPlus.deactivate();
  assert.equal(host.opens[1].host.isOpen(), false);
  assert.equal(editor.windows.length, 0);
  assert.equal(editor.createWindow, native);
  assert.equal(editor.createWindow({ title: 'Graph editor' }), 'native');
});

test('floating graph factory restores only its own patch and rolls back a failed installation', async () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const host = floatingHost();
  const editor = { windows: [], createWindow: stubFn() };
  const { context } = makeContext(PZ, editor); context.ui = host.ui;
  await GraphPlus.activate(context);
  const foreign = stubFn(); editor.createWindow = foreign;
  GraphPlus.deactivate();
  assert.equal(editor.createWindow, foreign);
  const original = PZ.ui.graph;
  const broken = makeContext(PZ, editor).context;
  Object.defineProperty(broken, 'ui', { get() { throw new Error('UI unavailable'); } });
  await assert.rejects(GraphPlus.activate(broken), /UI unavailable/);
  assert.equal(PZ.ui.graph, original);
  assert.equal(editor.createWindow, foreign);
});

test('closing a graph panel ends active pointer capture before unloading its children', () => {
  const { GraphPlus } = loadModule();
  const calls = [];
  const root = { remove() { calls.push('remove'); } };
  const owner = { addEventListener() {}, removeEventListener() {} };
  const target = { closest: () => root, ownerDocument: { defaultView: owner, ...owner },
    setPointerCapture() {}, releasePointerCapture() { calls.push('release'); },
    addEventListener() {}, removeEventListener() {} };
  const panel = { el: root, enabled: true, objects: [],
    drag: { dragging: true, endfn_bound(event) { calls.push(event.type); } },
    panels: [{ enabled: true, unload() { calls.push('child-unload'); } }],
    unload() { calls.push('unload'); } };
  const drag = GraphPlus.__test.beginPointerDrag(target, { pointerId: 1 }, () => {}, () => calls.push('end'));
  GraphPlus.__test.disposePanel(panel);
  drag.finish(null);
  assert.deepEqual(calls, ['release', 'end', 'mouseup', 'child-unload', 'unload', 'remove']);
  assert.equal(panel.enabled, false);
  assert.equal(panel.objects, null);
});

test('disable removes the instance patch when the native factory is inherited', async () => {
  const { GraphPlus } = loadModule();
  const PZ = makeFakePZ();
  const native = stubFn();
  const prototype = { createWindow: native };
  const editor = Object.assign(Object.create(prototype), { windows: [] });
  const { context } = makeContext(PZ, editor); context.ui = floatingHost().ui;
  await GraphPlus.activate(context);
  assert.ok(Object.hasOwn(editor, 'createWindow'));
  const newerNative = stubFn(); prototype.createWindow = newerNative;
  GraphPlus.deactivate();
  assert.equal(Object.hasOwn(editor, 'createWindow'), false);
  assert.equal(editor.createWindow, newerNative);
});

test("empty-state note builder is reachable at module scope and prefers the shared builder", () => {
  const { GraphPlus } = loadModule();
  assert.equal(typeof GraphPlus.__test.sharedEmptyNote, "function");
  assert.equal(
    GraphPlus.__test.sharedEmptyNote(null, "No curves"),
    null,
    "without the kit the caller falls back to plain markup",
  );
  const seen = [];
  const { GraphPlus: withKit } = loadModule({
    ZoidiumUI: {
      controls: {
        note: (text) => {
          seen.push(text);
          return { element: { ownerDocument: null, text } };
        },
      },
    },
  });
  const built = withKit.__test.sharedEmptyNote(null, "No curves");
  assert.equal(built && built.text, "No curves");
  assert.deepEqual(seen, ["No curves"]);
});
