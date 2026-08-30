(function () {
  "use strict";

  var STORAGE_KEY = "zoidium.welcome-tour.completed";
  var DESKTOP_API = "zoidiumDesktop";
  var translations = {
    en: {
      ariaLabel: "Zoidium welcome tour",
      progressLabel: "Tour progress",
      back: "Back",
      skip: "Skip",
      next: "Next",
      done: "Done",
      steps: [
        {
          title: "Welcome to Zoidium!",
          copy:
            "Zoidium is an open-source collection of tools that extends the CM3 experience through plugins and an external extension layer.",
        },
        {
          title: "Customize with plugins",
          copy:
            "Zoidium has a plugin system, so you can customize Zoidium to your liking!",
        },
        {
          title: "Let's get started!",
          copyParts: [
            { text: "Please read the " },
            { text: "Terms of Use", href: "/about/terms" },
            { text: ", " },
            { text: "Privacy Policy", href: "/about/privacy" },
            { text: ", and " },
            { text: "Copyright Notice", href: "/about/copyright" },
            { text: "." },
          ],
        },
      ],
    },
    ja: {
      ariaLabel: "Zoidium のウェルカムツアー",
      progressLabel: "ツアーの進行状況",
      back: "戻る",
      skip: "スキップ",
      next: "次へ",
      done: "完了",
      steps: [
        {
          title: "Zoidiumへようこそ！",
          copy:
            "Zoidiumは、プラグインと外部拡張レイヤーでCM3の体験を拡張するオープンソースツール集です。",
        },
        {
          title: "プラグインで拡張",
          copy:
            "Zoidiumにはプラグインシステムがあり、お好みでZoidiumをカスタマイズできます！日本語化プラグインもあります。",
        },
        {
          title: "始めましょう！",
          copyParts: [
            { text: "利用規約", href: "/about/terms/ja" },
            { text: "、" },
            { text: "プライバシー", href: "/about/privacy/ja" },
            { text: "、" },
            { text: "著作権に関する注意書き", href: "/about/copyright/ja" },
            { text: "をお読みください。" },
          ],
        },
      ],
    },
  };

  function detectLocale() {
    var language =
      Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages[0]
        : navigator.language;
    return /^ja(?:[-_]|$)/i.test(String(language || "")) ? "ja" : "en";
  }

  var state = {
    active: false,
    completed: false,
    locale: detectLocale(),
    step: 0,
    root: null,
    dialog: null,
    target: null,
    targetObserver: null,
    resizeHandler: null,
    keydownHandler: null,
    outsideClickHandler: null,
    previousActiveElement: null,
    previousOverflow: "",
    pane: null,
    paneWasInert: false,
    paneHadInertAttribute: false,
  };

  function readLocalCompletion() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch (_error) {
      return false;
    }
  }

  function writeLocalCompletion() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch (_error) {
      // The desktop preference below still persists the choice in Electron.
    }
  }

  function desktopPreference() {
    var api = window[DESKTOP_API];
    if (!api || typeof api.getWelcomeTourCompleted !== "function") return null;
    return api;
  }

  function persistCompletion() {
    writeLocalCompletion();
    var api = desktopPreference();
    if (!api || typeof api.setWelcomeTourCompleted !== "function") return;
    try {
      var result = api.setWelcomeTourCompleted();
      if (result && typeof result.catch === "function") result.catch(function () {});
    } catch (_error) {
      // The tour is still dismissed for the current session.
    }
  }

  function createMarkup() {
    var root = document.createElement("div");
    root.className = "zoidium-welcome-tour";
    root.setAttribute("aria-label", translations[state.locale].ariaLabel);
    root.setAttribute("lang", state.locale);
    root.innerHTML =
      '<div class="zoidium-welcome-tour__backdrop"></div>' +
      '<div class="zoidium-welcome-tour__backdrop zoidium-welcome-tour__backdrop--top" aria-hidden="true"></div>' +
      '<div class="zoidium-welcome-tour__backdrop zoidium-welcome-tour__backdrop--bottom" aria-hidden="true"></div>' +
      '<div class="zoidium-welcome-tour__backdrop zoidium-welcome-tour__backdrop--left" aria-hidden="true"></div>' +
      '<div class="zoidium-welcome-tour__backdrop zoidium-welcome-tour__backdrop--right" aria-hidden="true"></div>' +
      '<div class="zoidium-welcome-tour__spotlight" aria-hidden="true"></div>' +
      '<section class="zoidium-welcome-tour__dialog" role="dialog" aria-modal="true" aria-labelledby="zoidium-welcome-tour-title" aria-describedby="zoidium-welcome-tour-copy">' +
      '  <div class="zoidium-welcome-tour__content">' +
      '    <h2 class="zoidium-welcome-tour__title" id="zoidium-welcome-tour-title" data-tour-title></h2>' +
      '    <p class="zoidium-welcome-tour__copy" id="zoidium-welcome-tour-copy" data-tour-copy></p>' +
      '    <div class="zoidium-welcome-tour__footer">' +
      '      <div class="zoidium-welcome-tour__progress">' +
      '        <div class="zoidium-welcome-tour__progress-dots" aria-hidden="true">' +
      '          <span class="zoidium-welcome-tour__progress-dot"></span>' +
      '          <span class="zoidium-welcome-tour__progress-dot"></span>' +
      '          <span class="zoidium-welcome-tour__progress-dot"></span>' +
      "        </div>" +
      '        <span data-tour-progress></span>' +
      "      </div>" +
      '      <div class="zoidium-welcome-tour__actions">' +
      '        <button class="zoidium-welcome-tour__button zoidium-welcome-tour__button--back" type="button" data-tour-back hidden><span data-tour-back-label>戻る</span></button>' +
      '        <button class="zoidium-welcome-tour__button zoidium-welcome-tour__button--skip" type="button" data-tour-skip>スキップ</button>' +
      '        <button class="zoidium-welcome-tour__button zoidium-welcome-tour__button--next" type="button" data-tour-next><span data-tour-next-label>次へ</span><span class="zoidium-welcome-tour__button-arrow" aria-hidden="true">→</span></button>' +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</section>";
    return root;
  }

  function findPluginTarget() {
    var exact = document.querySelector(".zoidium-plugin-tab");
    if (exact && isVisible(exact)) return exact;
    var tabs = document.querySelector(".elevatortabs");
    if (tabs && isVisible(tabs)) return tabs;
    return null;
  }

  function isVisible(element) {
    if (!element) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setText(selector, text) {
    var element = state.root.querySelector(selector);
    if (element) element.textContent = text;
  }

  function renderCopy(current) {
    var copy = state.root.querySelector("[data-tour-copy]");
    if (!copy) return;
    copy.textContent = "";
    if (!Array.isArray(current.copyParts)) {
      copy.textContent = current.copy;
      return;
    }

    current.copyParts.forEach(function (part) {
      if (part.href) {
        var link = document.createElement("a");
        link.href = part.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = part.text;
        copy.appendChild(link);
      } else {
        copy.appendChild(document.createTextNode(part.text));
      }
    });
  }

  function renderStep() {
    var content = translations[state.locale];
    var current = content.steps[state.step];
    state.root.classList.toggle("zoidium-welcome-tour--targeted", state.step === 1);
    setText("[data-tour-title]", current.title);
    renderCopy(current);
    setText(
      "[data-tour-progress]",
      String(state.step + 1) + " / " + String(content.steps.length)
    );
    setText("[data-tour-back-label]", content.back);
    setText("[data-tour-next-label]", state.step === content.steps.length - 1 ? content.done : content.next);
    setText("[data-tour-skip]", content.skip);
    state.root.setAttribute("aria-label", content.ariaLabel);
    state.root.setAttribute("lang", state.locale);
    state.root.querySelector(".zoidium-welcome-tour__progress").setAttribute("aria-label", content.progressLabel);
    state.root.querySelector("[data-tour-back]").hidden = state.step === 0;

    var dots = state.root.querySelectorAll(".zoidium-welcome-tour__progress-dot");
    Array.prototype.forEach.call(dots, function (dot, index) {
      dot.classList.toggle("is-active", index === state.step);
    });

    if (state.step === 1) {
      positionTarget();
      observeTarget();
    } else {
      if (state.targetObserver) {
        state.targetObserver.disconnect();
        state.targetObserver = null;
      }
      state.dialog.removeAttribute("data-placement");
      state.root.style.removeProperty("--zoidium-tour-dialog-top");
      state.root.style.removeProperty("--zoidium-tour-dialog-left");
      state.root.style.removeProperty("--zoidium-tour-arrow-top");
    }
  }

  function positionTarget() {
    if (!state.active || state.step !== 1) return;
    var target = findPluginTarget();
    state.target = target;
    if (!target) {
      state.root.classList.remove("zoidium-welcome-tour--targeted");
      state.dialog.removeAttribute("data-placement");
      return;
    }

    state.root.classList.add("zoidium-welcome-tour--targeted");
    var targetRect = target.getBoundingClientRect();
    var dialogRect = state.dialog.getBoundingClientRect();
    var gap = 24;
    var viewportPadding = 16;
    var placement = "right";
    var left = targetRect.right + gap;

    if (left + dialogRect.width > window.innerWidth - viewportPadding) {
      placement = "left";
      left = targetRect.left - gap - dialogRect.width;
    }
    if (left < viewportPadding) {
      placement = "right";
      left = Math.max(viewportPadding, targetRect.right + gap);
    }

    var top = targetRect.top + targetRect.height / 2 - dialogRect.height / 2;
    top = Math.max(viewportPadding, Math.min(top, window.innerHeight - dialogRect.height - viewportPadding));
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - dialogRect.width - viewportPadding));

    state.root.style.setProperty("--zoidium-tour-target-top", Math.max(0, targetRect.top - 7) + "px");
    state.root.style.setProperty("--zoidium-tour-target-left", Math.max(0, targetRect.left - 7) + "px");
    state.root.style.setProperty("--zoidium-tour-target-width", targetRect.width + 14 + "px");
    state.root.style.setProperty("--zoidium-tour-target-height", targetRect.height + 14 + "px");
    state.root.style.setProperty(
      "--zoidium-tour-target-right",
      Math.min(window.innerWidth, targetRect.right + 7) + "px"
    );
    state.root.style.setProperty(
      "--zoidium-tour-target-bottom",
      Math.min(window.innerHeight, targetRect.bottom + 7) + "px"
    );
    state.root.style.setProperty("--zoidium-tour-dialog-top", top + "px");
    state.root.style.setProperty("--zoidium-tour-dialog-left", left + "px");
    state.root.style.setProperty(
      "--zoidium-tour-arrow-top",
      Math.max(18, Math.min(dialogRect.height - 18, targetRect.top + targetRect.height / 2 - top)) + "px"
    );
    state.dialog.setAttribute("data-placement", placement);
  }

  function observeTarget() {
    if (state.targetObserver || typeof MutationObserver !== "function") return;
    state.targetObserver = new MutationObserver(function () {
      positionTarget();
    });
    state.targetObserver.observe(document.body, { childList: true, subtree: true });
  }

  function focusFirstControl() {
    var next = state.root.querySelector("[data-tour-next]");
    if (next) next.focus();
  }

  function handleNext() {
    if (state.step < translations[state.locale].steps.length - 1) {
      state.step += 1;
      renderStep();
      focusFirstControl();
      return;
    }
    finish();
  }

  function handleBack() {
    if (state.step === 0) return;
    state.step -= 1;
    renderStep();
    focusFirstControl();
  }

  function finish() {
    if (!state.active || state.completed) return;
    state.completed = true;
    persistCompletion();
    close();
  }

  function handleKeydown(event) {
    if (!state.active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key !== "Tab") return;
    var focusable = state.root.querySelectorAll(
      "button:not([disabled]):not([hidden]), a[href]"
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleOutsideClick(event) {
    if (state.dialog && state.dialog.contains(event.target)) return;
    finish();
  }

  function close() {
    if (!state.active) return;
    state.active = false;
    if (state.targetObserver) state.targetObserver.disconnect();
    state.targetObserver = null;
    if (state.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
    if (state.keydownHandler) document.removeEventListener("keydown", state.keydownHandler, true);
    if (state.root && state.outsideClickHandler) {
      state.root.removeEventListener("click", state.outsideClickHandler);
    }
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    if (state.pane) {
      if (state.paneHadInertAttribute) state.pane.setAttribute("inert", "");
      else state.pane.removeAttribute("inert");
      state.pane.inert = state.paneWasInert;
    }
    document.body.style.overflow = state.previousOverflow;
    if (state.previousActiveElement && typeof state.previousActiveElement.focus === "function") {
      state.previousActiveElement.focus();
    }
    state.root = null;
    state.dialog = null;
    state.target = null;
    state.outsideClickHandler = null;
  }

  function open() {
    if (state.active || state.completed) return;
    state.active = true;
    state.step = 0;
    state.previousActiveElement = document.activeElement;
    state.previousOverflow = document.body.style.overflow;
    state.pane = document.getElementById("panecontainer");
    if (state.pane) {
      state.paneHadInertAttribute = state.pane.hasAttribute("inert");
      state.paneWasInert = state.pane.inert;
      state.pane.setAttribute("inert", "");
    }
    document.body.style.overflow = "hidden";
    state.root = createMarkup();
    state.dialog = state.root.querySelector(".zoidium-welcome-tour__dialog");
    document.body.appendChild(state.root);
    state.resizeHandler = function () {
      positionTarget();
    };
    state.keydownHandler = handleKeydown;
    state.outsideClickHandler = handleOutsideClick;
    window.addEventListener("resize", state.resizeHandler);
    document.addEventListener("keydown", state.keydownHandler, true);
    state.root.addEventListener("click", state.outsideClickHandler);
    state.root.querySelector("[data-tour-back]").addEventListener("click", handleBack);
    state.root.querySelector("[data-tour-next]").addEventListener("click", handleNext);
    state.root.querySelector("[data-tour-skip]").addEventListener("click", finish);
    renderStep();
    focusFirstControl();
  }

  async function shouldShow() {
    if (readLocalCompletion()) return false;
    var api = desktopPreference();
    if (!api || typeof api.getWelcomeTourCompleted !== "function") return true;
    try {
      var completed = await api.getWelcomeTourCompleted();
      if (completed) writeLocalCompletion();
      return completed !== true;
    } catch (_error) {
      return true;
    }
  }

  function start() {
    shouldShow().then(function (show) {
      if (show) open();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
