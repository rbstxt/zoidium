"use strict";
const { importSVG } = require("./svg-import.js");
const { pathText } = require("./svg-path.js");
const { primitivePath } = require("./primitives.js");
const { find } = require("./editor-tree-data.js");
const { clone, validate } = require("./model.js");
const { replaceContents } = require("./editor-model.js");
const { createGesture } = require("./editor-history.js");
const { findObjectsPanel } = require("./native-ui.js");
const FORMAT = "zoidium-shape-plus-contents";
function reidentify(contents, nextId) {
  for (const item of contents) {
    item.id = nextId();
    if (item.kind === "path") {
      const modes = item.vertexModes || {},
        next = {};
      item.vertexIds = item.vertexIds.map((id) => {
        const fresh = nextId();
        if (modes[id]) next[fresh] = modes[id];
        return fresh;
      });
      item.vertexModes = next;
    }
    if (item.contents) reidentify(item.contents, nextId);
  }
  return contents;
}
function decode(text, nextId) {
  if (text.length > 262144)
    throw Error("Shape+ clipboard text budget exceeded");
  if (text.trim().startsWith("{")) {
    const data = JSON.parse(text);
    if (data.format !== FORMAT || data.version !== 1) return null;
    validate(data.contents);
    return reidentify(data.contents, nextId);
  }
  if (/^\s*(?:<|[Mm]\s*[-+.\d])/.test(text)) return importSVG(text, nextId);
  return null;
}
function install(context, Layer, Content) {
  const PZ = window.PZ,
    editor = window.CM,
    viewport = editor.mainViewport;
  const panels = findObjectsPanel(PZ, editor, document),
    nextId = () => "sp-" + crypto.randomUUID();
  const notify = (error) =>
    context.ui.notify({
      title: "Shape+",
      message: error.message || String(error),
    });
  const owns = (target) =>
    !target?.closest?.(
      "input,textarea,select,[contenteditable='true'],.editbox",
    ) &&
    [viewport.el, panels.top.el, panels.bottom.el].some((el) =>
      el.contains(target),
    );
  function selected() {
    const clips = viewport.objects,
      layer = clips?.length === 1 ? clips[0].object : null;
    if (!(layer instanceof Layer)) return null;
    const items = Array.from(panels.top.selection).filter(
      (item) => item instanceof Content,
    );
    return {
      layer,
      items,
      project: editor.project,
      ids: items.map((item) => item.id),
    };
  }
  function current(state) {
    const now = selected();
    return (
      now &&
      now.project === state.project &&
      now.layer === state.layer &&
      JSON.stringify(now.ids) === JSON.stringify(state.ids)
    );
  }
  function transaction(state, work) {
    if (!current(state)) return false;
    const address = state.layer.getAddress();
    const resolve = () => {
      try {
        return state.project.addressLookup(address);
      } catch (_error) {
        return null;
      }
    };
    const read = () =>
      resolve() instanceof Layer ? clone(resolve().contents) : null;
    const write = (data) => {
      const layer = resolve();
      if (layer instanceof Layer) replaceContents(layer, data, Content);
    };
    const gesture = createGesture(editor.history, read, write);
    return gesture.run(() => {
      const contents = read();
      work(contents);
      validate(contents);
      write(contents);
    });
  }
  function insert(state, items) {
    return transaction(state, (contents) => {
      const entry = find(contents, state.ids[0]),
        list =
          entry?.item.kind === "group"
            ? entry.item.contents
            : entry?.list || contents;
      const index =
        entry?.item.kind === "group"
          ? list.length
          : entry
            ? entry.index + 1
            : list.length;
      list.splice(index, 0, ...items);
    });
  }
  function payload(state) {
    // Do not include a descendant twice when a group is also selected.
    const ids = new Set(state.ids),
      contents = state.items
        .filter(
          (item) =>
            !find(state.layer.contents, item.id)?.ancestors.some((parent) =>
              ids.has(parent.id),
            ),
        )
        .map(clone);
    return JSON.stringify({ format: FORMAT, version: 1, contents });
  }
  async function paste(state, text) {
    const items = decode(text, nextId);
    if (!items) return false;
    if (current(state)) insert(state, items);
    return true;
  }
  const forwarded = new WeakSet();
  async function keydown(event) {
    if (forwarded.has(event)) return;
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      !owns(event.target)
    )
      return;
    const key = event.key.toLowerCase(),
      state = selected();
    if (
      !state ||
      !["c", "x", "v"].includes(key) ||
      (key !== "v" && !state.items.length)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (key === "v") {
        const text = await navigator.clipboard.readText();
        if (!(await paste(state, text)) && current(state)) {
          // Native packages still take the host path when the text is neither
          // SVG nor our contents envelope. Other panels never enter this hook.
          const nativeEvent = new KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            bubbles: true,
            cancelable: true,
          });
          forwarded.add(nativeEvent);
          event.target.dispatchEvent(nativeEvent);
        }
      } else {
        await navigator.clipboard.writeText(payload(state));
        if (key === "x")
          transaction(state, (contents) => {
            const ids = new Set(state.ids);
            const remove = (list) => {
              for (let i = list.length - 1; i >= 0; i--)
                if (ids.has(list[i].id)) list.splice(i, 1);
                else if (list[i].contents) remove(list[i].contents);
            };
            remove(contents);
          });
      }
    } catch (error) {
      notify(error);
    }
  }
  function onPaste(event) {
    if (!owns(event.target)) return;
    const state = selected();
    if (!state) return;
    const text = event.clipboardData?.getData("text/plain") || "";
    if (
      !/^\s*(?:<|[Mm]\s*[-+.\d]|\{\s*"format"\s*:\s*"zoidium-shape-plus-contents")/.test(
        text,
      )
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    paste(state, text).catch(notify);
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".svg,.txt,image/svg+xml";
  input.hidden = true;
  document.body.append(input);
  let importState = null;
  input.onchange = async () => {
    const file = input.files[0],
      state = importState;
    input.value = "";
    importState = null;
    if (!file || !state) return;
    try {
      if (file.size > 262144) throw Error("SVG file budget exceeded");
      const text = await file.text();
      const items = importSVG(text, nextId);
      if (current(state)) insert(state, items);
    } catch (error) {
      notify(error);
    }
  };
  const proto = PZ.ui.edit.prototype,
    original = proto.generateItemCommands;
  function replacement(row, object) {
    const result = original.apply(this, arguments);
    if (this.options.hideAllListItemButtons) return result;
    if (
      object instanceof Layer ||
      (object instanceof PZ.objectList &&
        object.type === Content &&
        object.parentObject instanceof Layer)
    ) {
      const button = this.generateButton("add");
      button.title = "Import SVG…";
      button.setAttribute("aria-label", button.title);
      button.onclick = (event) => {
        event.stopPropagation();
        importState = selected();
        if (importState) input.click();
      };
      row.children[1].prepend(button);
    }
    if (
      object instanceof Content &&
      ["path", "rectangle", "ellipse", "polystar"].includes(object.kind)
    ) {
      const button = this.generateButton("duplicate");
      button.title = "Copy SVG path data";
      button.setAttribute("aria-label", button.title);
      button.onclick = (event) => {
        event.stopPropagation();
        try {
          const frame = editor.playback.currentFrame - object.frameOffset;
          const path = primitivePath(object.evaluate(frame));
          const text = pathText({
            ...path,
            vertices: path.vertices.map((v) => ({
              point: [v.point[0], -v.point[1]],
              in: [v.in[0], -v.in[1]],
              out: [v.out[0], -v.out[1]],
            })),
          });
          navigator.clipboard.writeText(text).catch(notify);
        } catch (error) {
          notify(error);
        }
      };
      row.children[1].prepend(button);
    }
    return result;
  }
  proto.generateItemCommands = replacement;
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("paste", onPaste, true);
  context.lifecycle.onDispose(() => {
    if (proto.generateItemCommands === replacement)
      proto.generateItemCommands = original;
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("paste", onPaste, true);
    input.remove();
  });
  return { paste, selected, insert };
}
module.exports = { install, reidentify, decode, FORMAT };
