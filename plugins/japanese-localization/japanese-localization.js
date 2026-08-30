"use strict";

const JapaneseLocalization = (() => {
  const LOCALE = "ja";
  const CORE_CATALOG_URL = "./plugins/japanese-localization/locales/ja.json?v=25";
  const REGISTRY_URL = "./plugins/registry.json?v=11";
  const TRANSLATABLE_ATTRIBUTES = Object.freeze([
    "title",
    "aria-label",
    "aria-description",
    "aria-valuetext",
    "placeholder",
    "alt",
    "label",
    "data-tooltip",
    "data-title",
  ]);
  const TEXT_SKIP_TAGS = new Set([
    "CODE",
    "NOSCRIPT",
    "PRE",
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "TEXTAREA",
  ]);

  const state = {
    active: false,
    window: null,
    document: null,
    messages: new Map(),
    messagesByLowercase: new Map(),
    filterAliases: [],
    catalogSources: new Set(),
    localizers: new Set(),
    originalOpen: null,
    originalDialogs: new Map(),
    inputListener: null,
    searchRestoreTimers: new Set(),
    childWindows: new Set(),
    watchedWindows: new WeakSet(),
    i18nApi: null,
    hadPreviousI18n: false,
    previousI18n: undefined,
  };

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function preserveWhitespace(source, value) {
    const leading = String(source).match(/^\s*/)?.[0] || "";
    const trailing = String(source).match(/\s*$/)?.[0] || "";
    return `${leading}${value}${trailing}`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    return response.json();
  }

  function validateCatalog(catalog, source = "catalog") {
    if (
      !catalog ||
      catalog.schemaVersion !== 1 ||
      catalog.locale !== LOCALE ||
      !catalog.messages ||
      Array.isArray(catalog.messages) ||
      typeof catalog.messages !== "object"
    ) {
      throw new Error(`Invalid Japanese locale catalog: ${source}`);
    }
    for (const [message, translation] of Object.entries(catalog.messages)) {
      if (!normalize(message) || typeof translation !== "string" || !normalize(translation)) {
        throw new Error(`Invalid Japanese locale message in ${source}: ${message}`);
      }
    }
    return catalog;
  }

  function rebuildFilterAliases() {
    state.filterAliases = [...state.messages.entries()]
      .filter(([source, target]) => source.length >= 3 && target.length >= 2 && source !== target)
      .map(([source, target]) => [target, source])
      .sort((a, b) => b[0].length - a[0].length);
  }

  function registerCatalog(catalog, source = catalog?.namespace || "runtime") {
    validateCatalog(catalog, source);
    let added = 0;
    for (const [rawMessage, rawTranslation] of Object.entries(catalog.messages)) {
      const message = normalize(rawMessage);
      const translation = normalize(rawTranslation);
      const existing = state.messages.get(message);
      if (existing != null && existing !== translation) {
        console.warn(`[JapaneseLocalization] Conflicting translation kept for "${message}" (${source})`);
        continue;
      }
      if (existing == null) added += 1;
      state.messages.set(message, translation);
      const lowercase = message.toLowerCase();
      if (!state.messagesByLowercase.has(lowercase)) {
        state.messagesByLowercase.set(lowercase, translation);
      }
    }
    rebuildFilterAliases();
    return added;
  }

  async function loadCatalog(url, required = false) {
    if (!url || state.catalogSources.has(url)) return null;
    state.catalogSources.add(url);
    try {
      const catalog = validateCatalog(await fetchJson(url), url);
      registerCatalog(catalog, url);
      return catalog;
    } catch (error) {
      state.catalogSources.delete(url);
      if (required) throw error;
      console.warn(`[JapaneseLocalization] Could not load ${url}`, error);
      return null;
    }
  }

  function getLocaleSource(manifest) {
    const definition = manifest?.locales?.[LOCALE];
    if (typeof definition === "string") return definition;
    if (definition && typeof definition.source === "string") return definition.source;
    return null;
  }

  async function loadPluginCatalogs() {
    await loadCatalog(CORE_CATALOG_URL, true);
    let registry;
    try {
      registry = await fetchJson(REGISTRY_URL);
    } catch (error) {
      console.warn("[JapaneseLocalization] Could not load the plugin registry", error);
      return;
    }
    if (registry?.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
      console.warn("[JapaneseLocalization] Invalid plugin registry");
      return;
    }

    const definitions = await Promise.all(
      registry.plugins.map(async (plugin) => {
        if (typeof plugin?.locale === "string" && plugin.locale.trim()) {
          return { id: plugin.id, source: plugin.locale };
        }
        if (!plugin?.manifest) return null;
        try {
          const manifest = await fetchJson(plugin.manifest);
          return { id: plugin.id, source: getLocaleSource(manifest) };
        } catch (error) {
          console.warn(`[JapaneseLocalization] Could not inspect ${plugin.id}`, error);
          return null;
        }
      }),
    );
    await Promise.all(
      definitions
        .filter((definition) => definition?.source)
        .map((definition) => loadCatalog(definition.source))
    );
  }

  const PATTERNS = Object.freeze([
    [/^Enable\s+(.+)$/i, (_match, value) => `${translateText(value)}を有効化`],
    [/^Disable\s+(.+)$/i, (_match, value) => `${translateText(value)}を無効化`],
    [/^Toggle\s+(.+)$/i, (_match, value) => `${translateText(value)}を切り替え`],
    [/^Track\s+(\d+)(?:\s+—\s+(.*))?$/i, (_match, index, label) =>
      label ? `トラック ${index} — ${translateText(label)}` : `トラック ${index}`],
    [/^(\d+)\s+active$/i, (_match, count) => `${count}件を有効化`],
    [/^(\d+)\s+selected$/i, (_match, count) => `${count}件を選択中`],
    [/^Missing assets\s*\((.*)\)$/i, (_match, value) => `不足しているアセット（${value}）`],
    [/^Missing\s+([^:]+):\s*(.*)$/i, (_match, plugin, value) =>
      `不足している${translateText(plugin)}: ${translateText(value)}`],
    [/^Missing\s+(.+)$/i, (_match, value) => `不足している${translateText(value)}`],
    [/^Render credits:\s*(.*)$/i, (_match, value) => `レンダリングクレジット: ${value}`],
    [/^Time left:\s*(.*)$/i, (_match, value) => `残り時間: ${value}`],
    [/^Total:\s*(.*)$/i, (_match, value) => `合計: ${value}`],
    [/^(.+?) requires the (.+?) plugin\.$/i, (_match, value, plugin) =>
      `「${translateText(value)}」には${translateText(plugin)}プラグインが必要です。`],
  ]);

  function translateText(value) {
    const source = String(value ?? "");
    if (!source.trim()) return source;
    const message = normalize(source);
    let translation = state.messages.get(message);
    if (translation == null) translation = state.messagesByLowercase.get(message.toLowerCase());
    if (translation == null) {
      for (const [pattern, replacement] of PATTERNS) {
        const match = message.match(pattern);
        if (!match) continue;
        translation = replacement(...match);
        break;
      }
    }
    if (translation == null || translation === message) return source;
    return preserveWhitespace(source, translation);
  }

  function formatMessage(message, variables) {
    const translated = translateText(message);
    if (!variables || typeof variables !== "object") return translated;
    return translated.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match,
    );
  }

  function translateFilterValue(value) {
    let translated = String(value || "");
    for (const [japanese, english] of state.filterAliases) {
      translated = translated.split(japanese).join(english);
    }
    return translated;
  }

  function isElementSkipped(element) {
    if (!element || element.nodeType !== 1) return true;
    if (TEXT_SKIP_TAGS.has(element.tagName)) return true;
    if (element.closest?.("script, style, noscript, pre, code, template, textarea")) return true;
    if (element.closest?.('[contenteditable="true"], [contenteditable=""]')) return true;
    return false;
  }

  function isTextNodeSkipped(node) {
    return !node?.parentElement || isElementSkipped(node.parentElement);
  }

  function showTextNodes(document) {
    return document.defaultView?.NodeFilter?.SHOW_TEXT || 4;
  }

  function getAttributeRecords(localizer, element) {
    let records = localizer.attributeRecords.get(element);
    if (!records) {
      records = new Map();
      localizer.attributeRecords.set(element, records);
    }
    return records;
  }

  function forgetAttributeRecord(localizer, element, name) {
    const records = localizer.attributeRecords.get(element);
    const record = records?.get(name);
    if (!record) return;
    records.delete(name);
    localizer.trackedAttributes.delete(record);
  }

  function translateAttribute(localizer, element, name) {
    if (isElementSkipped(element)) return;
    const current = element.getAttribute(name);
    const records = getAttributeRecords(localizer, element);
    const previous = records.get(name);
    if (previous && current === previous.translated) return;
    if (previous) localizer.trackedAttributes.delete(previous);
    if (current == null) {
      forgetAttributeRecord(localizer, element, name);
      return;
    }
    const translated = translateText(current);
    if (translated === current) {
      forgetAttributeRecord(localizer, element, name);
      return;
    }
    const record = { element, name, source: current, translated };
    records.set(name, record);
    localizer.trackedAttributes.add(record);
    element.setAttribute(name, translated);
  }

  function labelFileInput(localizer, element) {
    if (element.tagName !== "INPUT" || element.getAttribute("type") !== "file") return;
    if (element.hasAttribute("aria-label")) return;
    const records = getAttributeRecords(localizer, element);
    const record = { element, name: "aria-label", source: null, translated: "ファイルを選択" };
    records.set("aria-label", record);
    localizer.trackedAttributes.add(record);
    element.setAttribute("aria-label", record.translated);
  }

  function translateElement(localizer, element) {
    if (isElementSkipped(element)) return;
    for (const name of TRANSLATABLE_ATTRIBUTES) translateAttribute(localizer, element, name);
    labelFileInput(localizer, element);
    if (
      element.tagName === "INPUT" &&
      /^(button|submit|reset)$/i.test(element.getAttribute("type") || "")
    ) {
      translateAttribute(localizer, element, "value");
    }
  }

  function translateTextNode(localizer, node) {
    if (isTextNodeSkipped(node)) return;
    const source = node.nodeValue || "";
    const previous = localizer.textRecords.get(node);
    if (previous && source === previous.translated) return;
    const translated = translateText(source);
    if (translated === source) {
      if (previous) {
        localizer.textRecords.delete(node);
        localizer.trackedTextNodes.delete(node);
      }
      return;
    }
    localizer.textRecords.set(node, { source, translated });
    localizer.trackedTextNodes.add(node);
    node.nodeValue = translated;
  }

  function translateSubtree(localizer, root) {
    if (!root) return;
    if (root.nodeType === 3) {
      translateTextNode(localizer, root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && isElementSkipped(root)) return;
    if (root.nodeType === 1) translateElement(localizer, root);
    const walker = localizer.document.createTreeWalker(root, showTextNodes(localizer.document));
    let node;
    while ((node = walker.nextNode())) translateTextNode(localizer, node);
    const elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const element of elements) translateElement(localizer, element);
  }

  function forgetSubtree(localizer, root) {
    if (!root) return;
    if (root.nodeType === 3) {
      localizer.textRecords.delete(root);
      localizer.trackedTextNodes.delete(root);
      return;
    }
    if (root.nodeType !== 1) return;
    const walker = localizer.document.createTreeWalker(root, showTextNodes(localizer.document));
    let node;
    while ((node = walker.nextNode())) {
      localizer.textRecords.delete(node);
      localizer.trackedTextNodes.delete(node);
    }
    const elements = [root, ...(root.querySelectorAll ? root.querySelectorAll("*") : [])];
    for (const element of elements) {
      const records = localizer.attributeRecords.get(element);
      if (!records) continue;
      for (const name of [...records.keys()]) forgetAttributeRecord(localizer, element, name);
      localizer.attributeRecords.delete(element);
    }
  }

  function scheduleRescan(localizer, delay) {
    const timer = localizer.window.setTimeout(() => {
      localizer.rescanTimers.delete(timer);
      if (!state.active || localizer.destroyed) return;
      translateSubtree(localizer, localizer.document.documentElement);
    }, delay);
    localizer.rescanTimers.add(timer);
  }

  function rescanAll() {
    for (const localizer of state.localizers) {
      if (!localizer.destroyed) translateSubtree(localizer, localizer.document.documentElement);
    }
  }

  function createLocalizer(targetWindow, targetDocument) {
    const localizer = {
      window: targetWindow,
      document: targetDocument,
      observer: null,
      textRecords: new WeakMap(),
      trackedTextNodes: new Set(),
      attributeRecords: new WeakMap(),
      trackedAttributes: new Set(),
      originalLang: null,
      hadLang: false,
      originalTitle: "",
      translatedTitle: "",
      rescanTimers: new Set(),
      clickListener: null,
      destroyed: false,
    };

    const root = targetDocument.documentElement;
    if (!root) return localizer;
    localizer.hadLang = root.hasAttribute("lang");
    localizer.originalLang = root.getAttribute("lang");
    root.setAttribute("lang", LOCALE);
    root.classList.add("zoidium-japanese");

    localizer.originalTitle = targetDocument.title;
    localizer.translatedTitle = translateText(localizer.originalTitle);
    if (localizer.translatedTitle !== localizer.originalTitle) {
      targetDocument.title = localizer.translatedTitle;
    }

    localizer.observer = new targetWindow.MutationObserver((records) => {
      if (!state.active || localizer.destroyed) return;
      for (const record of records) {
        if (record.type === "characterData") translateTextNode(localizer, record.target);
        if (record.type === "attributes") translateAttribute(localizer, record.target, record.attributeName);
        if (record.type === "childList") {
          for (const node of record.removedNodes) forgetSubtree(localizer, node);
          for (const node of record.addedNodes) translateSubtree(localizer, node);
        }
      }
    });
    localizer.observer.observe(root, {
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES, "value"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    localizer.clickListener = () => {
      if (!state.active || localizer.destroyed) return;
      scheduleRescan(localizer, 0);
      scheduleRescan(localizer, 300);
      scheduleRescan(localizer, 1200);
    };
    targetDocument.addEventListener("click", localizer.clickListener, true);
    translateSubtree(localizer, root);
    scheduleRescan(localizer, 0);
    scheduleRescan(localizer, 300);
    scheduleRescan(localizer, 1200);
    state.localizers.add(localizer);
    return localizer;
  }

  function attachWindow(targetWindow) {
    if (!targetWindow || targetWindow === state.window) return;
    let targetDocument;
    try {
      targetDocument = targetWindow.document;
    } catch (_error) {
      return;
    }
    if (!targetDocument) return;
    for (const existing of [...state.localizers]) {
      if (existing.window !== targetWindow) continue;
      if (existing.document === targetDocument) return;
      destroyLocalizer(existing);
    }
    if (targetDocument.documentElement) createLocalizer(targetWindow, targetDocument);
    if (state.watchedWindows.has(targetWindow)) return;
    state.watchedWindows.add(targetWindow);
    try {
      targetWindow.addEventListener("DOMContentLoaded", () => {
        if (state.active) attachWindow(targetWindow);
      });
      targetWindow.addEventListener("load", () => {
        if (state.active) attachWindow(targetWindow);
      });
    } catch (_error) {
      // A closed or cross-origin popup can no longer be observed.
    }
  }

  function destroyLocalizer(localizer) {
    if (!localizer || localizer.destroyed) return;
    localizer.destroyed = true;
    localizer.observer?.disconnect();
    if (localizer.clickListener) {
      localizer.document.removeEventListener("click", localizer.clickListener, true);
      localizer.clickListener = null;
    }
    for (const timer of localizer.rescanTimers) localizer.window.clearTimeout(timer);
    localizer.rescanTimers.clear();
    for (const node of localizer.trackedTextNodes) {
      const record = localizer.textRecords.get(node);
      if (record && node.nodeValue === record.translated) node.nodeValue = record.source;
    }
    for (const record of localizer.trackedAttributes) {
      if (record.element.getAttribute(record.name) === record.translated) {
        if (record.source == null) record.element.removeAttribute(record.name);
        else record.element.setAttribute(record.name, record.source);
      }
    }
    if (localizer.document.title === localizer.translatedTitle) {
      localizer.document.title = localizer.originalTitle;
    }
    const root = localizer.document.documentElement;
    if (root) {
      if (localizer.hadLang) root.setAttribute("lang", localizer.originalLang);
      else root.removeAttribute("lang");
      root.classList.remove("zoidium-japanese");
    }
    state.localizers.delete(localizer);
  }

  function handleSearchInput(event) {
    if (!state.active) return;
    const target = event.target;
    if (!target || target.nodeType !== 1 || !target.matches?.(".pz-filterbox")) return;
    const english = translateFilterValue(target.value);
    if (english === target.value) return;
    const japanese = target.value;
    target.value = english;
    const timer = state.window.setTimeout(() => {
      state.searchRestoreTimers.delete(timer);
      if (state.active && target.value === english) target.value = japanese;
    }, 0);
    state.searchRestoreTimers.add(timer);
  }

  function installWindowHooks() {
    const targetWindow = state.window;
    state.inputListener = handleSearchInput;
    state.document.addEventListener("input", state.inputListener, true);
    for (const name of ["alert", "confirm", "prompt"]) {
      const original = targetWindow[name];
      if (typeof original !== "function") continue;
      const wrapper = function (message, ...args) {
        const translated = typeof message === "string" ? translateText(message) : message;
        return original.apply(this, [translated, ...args]);
      };
      state.originalDialogs.set(name, { original, wrapper });
      try {
        targetWindow[name] = wrapper;
      } catch (_error) {
        state.originalDialogs.delete(name);
      }
    }

    const originalOpen = targetWindow.open;
    if (typeof originalOpen === "function") {
      const wrapper = function (...args) {
        const child = originalOpen.apply(this, args);
        if (child) {
          state.childWindows.add(child);
          attachWindow(child);
        }
        return child;
      };
      state.originalOpen = { original: originalOpen, wrapper };
      try {
        targetWindow.open = wrapper;
      } catch (_error) {
        state.originalOpen = null;
      }
    }
  }

  function restoreWindowHooks() {
    if (state.inputListener) state.document.removeEventListener("input", state.inputListener, true);
    state.inputListener = null;
    for (const timer of state.searchRestoreTimers) state.window.clearTimeout(timer);
    state.searchRestoreTimers.clear();
    for (const [name, entry] of state.originalDialogs) {
      if (state.window[name] === entry.wrapper) state.window[name] = entry.original;
    }
    state.originalDialogs.clear();
    if (state.originalOpen && state.window.open === state.originalOpen.wrapper) {
      state.window.open = state.originalOpen.original;
    }
    state.originalOpen = null;
  }

  function installI18nApi() {
    state.hadPreviousI18n = Object.prototype.hasOwnProperty.call(state.window, "ZoidiumI18n");
    state.previousI18n = state.window.ZoidiumI18n;
    state.i18nApi = Object.freeze({
      locale: LOCALE,
      t: formatMessage,
      has(message) {
        const normalized = normalize(message);
        return state.messages.has(normalized) || state.messagesByLowercase.has(normalized.toLowerCase());
      },
      registerCatalog(catalog, source) {
        const added = registerCatalog(catalog, source);
        if (state.active) rescanAll();
        return added;
      },
      rescan: rescanAll,
    });
    state.window.ZoidiumI18n = state.i18nApi;
  }

  function restoreI18nApi() {
    if (state.window?.ZoidiumI18n !== state.i18nApi) return;
    if (state.hadPreviousI18n) state.window.ZoidiumI18n = state.previousI18n;
    else delete state.window.ZoidiumI18n;
    state.i18nApi = null;
    state.previousI18n = undefined;
    state.hadPreviousI18n = false;
  }

  async function activate(context) {
    if (state.active) return;
    state.window = context.window || window;
    state.document = context.document || document;
    state.messages.clear();
    state.messagesByLowercase.clear();
    state.catalogSources.clear();
    state.filterAliases = [];
    try {
      await loadPluginCatalogs();
    } catch (error) {
      state.window = null;
      state.document = null;
      throw error;
    }
    state.active = true;
    installI18nApi();
    createLocalizer(state.window, state.document);
    for (const child of state.childWindows) attachWindow(child);
    installWindowHooks();
    state.document.dispatchEvent(new CustomEvent("zoidium:locale-change", { detail: { locale: LOCALE } }));
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    restoreWindowHooks();
    for (const localizer of [...state.localizers]) destroyLocalizer(localizer);
    restoreI18nApi();
    state.document.dispatchEvent(new CustomEvent("zoidium:locale-change", { detail: { locale: "en" } }));
    state.messages.clear();
    state.messagesByLowercase.clear();
    state.catalogSources.clear();
    state.filterAliases = [];
    state.window = null;
    state.document = null;
  }

  return { activate, deactivate };
})();

module.exports = JapaneseLocalization;
