"use strict";

const { activate } = require("../plugins/mp4-export/mp4-export.js");

function install() {
  const disposers = [];
  class Device {
    constructor() { this.params = { format: "mkv" }; this.DEVICE_FORMATS = ["mkv"]; }
    createOptionsPage() {
      const format = {
        options: [{ text: ".mkv (VP8)" }], selectedIndex: 0,
        onchange() { this.nativeChanges = (this.nativeChanges || 0) + 1; },
        appendChild(option) {
          this.options.push(option);
          option.remove = () => { this.options.splice(this.options.indexOf(option), 1); };
        },
      };
      const quality = { options: Array.from({ length: 5 }, (_, i) => ({ text: i ? "quality " + i : "very low" })),
        disabled: false, title: "Native quality" };
      const page = { isConnected: true, querySelectorAll: () => [format, quality], format, quality };
      this.page = page;
      return page;
    }
    createProgressPage() {}
    createFinishedPage() {}
  }
  const originalDocument = global.document;
  global.document = { createElement: () => ({}) };
  activate({ PZ: { ui: { export: { device: Device } } },
    apis: { modules: { createRequire: () => file => require("../plugins/mp4-export/" + file) } },
    lifecycle: { onDispose(fn) { disposers.push(fn); } },
  });
  return {
    Device,
    deactivate() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
      global.document = originalDocument;
    },
  };
}

module.exports = { install };
