"use strict";

// The first-run notice opens as a standard Zoidium floating window. These
// tests cover that path, persistence on close, and the rules for its styling
// and copy (English only, CM3 chrome, no Inter font or gradients).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const scriptSource = fs.readFileSync(path.join(projectRoot, "zoidium-welcome-tour.js"), "utf8");
const styleSource = fs.readFileSync(path.join(projectRoot, "zoidium-welcome-tour.css"), "utf8");

function fakeElement(tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    children: [],
    className: "",
    textContent: "",
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute() {},
  };
}

function loadTour({ completed = false, zoidiumUi = true } = {}) {
  const stored = new Map(completed ? [["zoidium.welcome-tour.completed", "true"]] : []);
  const windows = [];
  const document = {
    readyState: "complete",
    createElement: fakeElement,
    createTextNode: (text) => ({ nodeType: 3, text }),
    addEventListener() {},
  };
  const context = {
    console,
    document,
    innerHeight: 900,
    innerWidth: 1440,
    localStorage: {
      getItem: (key) => (stored.has(key) ? stored.get(key) : null),
      setItem: (key, value) => stored.set(key, String(value)),
    },
    window: null,
  };
  if (zoidiumUi) {
    context.ZoidiumUI = {
      openWindow(config) {
        const footer = [];
        const win = {
          config,
          title: config.title,
          subtitle: "",
          footer,
          closed: false,
          setTitle(value) { this.title = value; },
          setSubtitle(value) { this.subtitle = value; },
          setFooter(buttons) { this.footer = buttons; },
          close() {
            if (this.closed) return;
            this.closed = true;
            if (config.onClose) config.onClose();
          },
        };
        const body = fakeElement("div");
        windows.push({ win, body });
        config.mount(body, win);
        return win;
      },
    };
  }
  context.window = context;
  vm.runInNewContext(scriptSource, context);
  return { stored, windows, context };
}

// Array.from copies out of the vm realm so strict deep equality compares plain arrays.
function titles(win) {
  return Array.from(win.footer, (item) => item.title);
}

function press(win, title) {
  const button = win.footer.find((item) => item.title === title);
  assert.ok(button, `footer has a ${title} button`);
  button.onClick();
}

test("the notice opens once as a shared Zoidium window with three steps", () => {
  const { windows } = loadTour();
  assert.equal(windows.length, 1);
  const { win, body } = windows[0];
  assert.equal(win.config.id, "zoidium:welcome-tour");
  assert.equal(win.title, "Welcome to Zoidium");
  assert.equal(win.subtitle, "1 / 3");
  assert.ok(body.children.length >= 1, "step copy is rendered into the window body");
  assert.deepEqual(titles(win), ["Skip", "Next"]);

  press(win, "Next");
  assert.equal(win.title, "Customize with plugins");
  assert.equal(win.subtitle, "2 / 3");
  assert.deepEqual(titles(win), ["Back", "Skip", "Next"]);

  press(win, "Next");
  assert.equal(win.title, "Before you start");
  assert.deepEqual(titles(win), ["Back", "Skip", "Done"]);
});

test("closing the notice by any route marks it completed", () => {
  const first = loadTour();
  first.windows[0].win.close();
  assert.equal(first.stored.get("zoidium.welcome-tour.completed"), "true");

  const second = loadTour({ completed: true });
  assert.equal(second.windows.length, 0, "a completed notice never reopens");
});

test("Done on the last step closes and persists the completion", () => {
  const tour = loadTour();
  const { win } = tour.windows[0];
  press(win, "Next");
  press(win, "Next");
  press(win, "Done");
  assert.equal(win.closed, true);
  assert.equal(tour.stored.get("zoidium.welcome-tour.completed"), "true");
});

test("the notice logs and does nothing when the window API is unavailable", () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const tour = loadTour({ zoidiumUi: false });
    assert.equal(tour.windows.length, 0);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^\[Zoidium\] welcome notice skipped/);
});

test("notice code and styles stay English with no theme, locale or Inter font", () => {
  for (const source of [scriptSource, styleSource]) {
    assert.doesNotMatch(source, /\bInter\b/);
    assert.doesNotMatch(source, /gradient/i);
    assert.doesNotMatch(source, /translations|locale|ZoidiumI18n/i);
  }
  assert.doesNotMatch(styleSource, /font-family/i);
  assert.doesNotMatch(scriptSource, /MutationObserver|setInterval/);
});
