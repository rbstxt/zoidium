"use strict";

const { activate } = require("../plugins/mp4-export/mp4-export.js");
const { installAlphaOption } = require("../plugins/core/alpha-export-options.js");

function element() {
  return Object.assign(new EventTarget(), {
    style: {}, children: [],
    setAttribute(key, value) { this[key] = value; },
    append(...children) { this.children.push(...children); },
    querySelector() { return this.children.find(child => child.textContent); },
  });
}

function install({ alphaOrder } = {}) {
  const disposers = [];
  class Device {
    constructor() { this.DEVICE_FORMATS = alphaOrder ? ["mkv_vp8_opus", "webm_vp8_opus"] : ["mkv"]; }
    createOptionsPage() {
      this.params = { format: this.DEVICE_FORMATS[0] };
      const formatRow = { parentElement: element() };
      formatRow.parentElement.insertBefore = child => formatRow.parentElement.append(child);
      const owner = this;
      const format = Object.assign(element(), {
        options: this.DEVICE_FORMATS.map(value => ({ text: "." + value.split("_")[0] + " (VP8)" })),
        selectedIndex: 0,
        closest() { return formatRow; },
        onchange() {
          this.nativeChanges = (this.nativeChanges || 0) + 1;
          owner.params.format = owner.DEVICE_FORMATS[this.selectedIndex];
        },
        appendChild(option) {
          this.options.push(option);
          option.remove = () => { this.options.splice(this.options.indexOf(option), 1); };
        },
      });
      const quality = { options: Array.from({ length: 5 }, (_, i) => ({ text: i ? "quality " + i : "very low" })),
        disabled: false, title: "Native quality" };
      const page = { isConnected: true, ownerDocument: global.document,
        querySelectorAll: selector => selector === "select" ? [format, quality] : formatRow.parentElement.children,
        format, quality, alphaRows: formatRow.parentElement.children };
      this.page = page;
      return page;
    }
    createProgressPage() {}
    createFinishedPage() {}
  }
  const originalDocument = global.document;
  global.document = { createElement: element };
  function wrapAlpha() {
    const original = Device.prototype.createOptionsPage;
    Device.prototype.createOptionsPage = function () {
      const page = original.call(this);
      installAlphaOption(page, this, { document: page.ownerDocument, webp: () => true, video: () => ({ status: true }) });
      return page;
    };
  }
  if (alphaOrder === "first") wrapAlpha();
  activate({ PZ: { ui: { export: { device: Device } } },
    apis: { modules: { createRequire: () => file => require("../plugins/mp4-export/" + file) } },
    lifecycle: { onDispose(fn) { disposers.push(fn); } },
  });
  if (alphaOrder === "last") wrapAlpha();
  return {
    Device,
    deactivate() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
      global.document = originalDocument;
    },
  };
}

module.exports = { install };
