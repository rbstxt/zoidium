(function () {
  "use strict";

  // A short first-run notice shown as a standard Zoidium floating window, so
  // it uses the same CM3 chrome, controls and keyboard behavior as every other
  // extension window. It does not dim or block the editor.
  var STORAGE_KEY = "zoidium.welcome-tour.completed";
  var WINDOW_ID = "zoidium:welcome-tour";

  var STEPS = [
    {
      title: "Welcome to Zoidium",
      paragraphs: [
        [{ text: "UNOFFICIAL PROJECT. Zoidium is not affiliated with or endorsed by Panzoid." }],
        [{
          text: "Zoidium is an open-source collection of tools that extends CM3 through plugins and an external extension layer.",
        }],
      ],
    },
    {
      title: "Customize with plugins",
      paragraphs: [
        [{
          text: "Open the Plugins tab in the sidebar to turn extensions on or off.",
        }],
      ],
    },
    {
      title: "Before you start",
      paragraphs: [
        [
          { text: "Please read the " },
          { text: "Terms of Use", href: "/about/terms" },
          { text: ", " },
          { text: "Privacy Policy", href: "/about/privacy" },
          { text: ", and " },
          { text: "Copyright Notice", href: "/about/copyright" },
          { text: "." },
        ],
        [{
          text: "Found a bug? Report it to @1zworks.com on Discord and attach the debug log from the Settings tab.",
        }],
      ],
    },
  ];

  function readCompleted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch (_error) {
      return false;
    }
  }

  function markCompleted() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch (_error) {
      // The notice simply appears again on a later load.
    }
  }

  function paragraph(parts) {
    var element = document.createElement("p");
    element.className = "zoidium-note zoidium-welcome-copy";
    parts.forEach(function (part) {
      if (part.href) {
        var link = document.createElement("a");
        link.className = "zoidium-welcome-link";
        link.href = part.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = part.text;
        element.appendChild(link);
      } else {
        element.appendChild(document.createTextNode(part.text));
      }
    });
    return element;
  }

  function renderStep(state) {
    var step = STEPS[state.index];
    var isLast = state.index === STEPS.length - 1;
    state.win.setTitle(step.title);
    state.win.setSubtitle(String(state.index + 1) + " / " + String(STEPS.length));
    state.body.textContent = "";
    step.paragraphs.forEach(function (parts) {
      state.body.appendChild(paragraph(parts));
    });

    var buttons = [];
    if (state.index > 0) {
      buttons.push({
        title: "Back",
        onClick: function () {
          state.index -= 1;
          renderStep(state);
        },
      });
    }
    buttons.push({ title: "Skip", onClick: function () { state.win.close(); } });
    buttons.push({
      title: isLast ? "Done" : "Next",
      variant: "primary",
      onClick: function () {
        if (isLast) {
          state.win.close();
          return;
        }
        state.index += 1;
        renderStep(state);
      },
    });
    state.win.setFooter(buttons);
  }

  function open() {
    var width = 380;
    var state = { index: 0, body: null, win: null };
    var win = window.ZoidiumUI.openWindow({
      id: WINDOW_ID,
      className: "zoidium-welcome-tour",
      title: STEPS[0].title,
      width: width,
      height: 250,
      x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(16, Math.round(window.innerHeight * 0.22)),
      // Closing by any route (Skip, Done, Escape, the title button) counts as seen.
      onClose: markCompleted,
      mount: function (body, win) {
        state.body = body;
        state.win = win;
        renderStep(state);
        return function () {};
      },
    });
    return win;
  }

  function start() {
    if (readCompleted()) return;
    if (!window.ZoidiumUI || typeof window.ZoidiumUI.openWindow !== "function") {
      console.error("[Zoidium] welcome notice skipped: the shared window API is unavailable.");
      return;
    }
    open();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
