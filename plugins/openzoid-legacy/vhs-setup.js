"use strict";

// OpenZoid Legacy — VHS Setup window.
//
// Installs the OpenZoid VHS editor window on the active editor: preset data,
// slider/info catalogues, effect discovery, the fullscreen window itself, the
// "vhsSetup" property-button action, styles, and the logo. Ported from the
// OpenZoid clipmaker bootstrap and clipmaker.html styles.

const STYLE_ID = "zoidium-vhs-setup-style";
const STYLE_URL = "./plugins/openzoid-legacy/vhs-setup.css";
const FONT_STYLE_ID = "zoidium-vhs-font-style";
const FONT_URL = "./plugins/openzoid-legacy/tracery-font.css";
const LOGO_URL = "./plugins/openzoid-legacy/vhs-logo.jpg";

const state = {
  active: false,
  editor: null,
  getAsset: null,
  installedWrapper: null,
};

function installStyle(getAsset) {
  if (document.getElementById(STYLE_ID)) return;
  const bundled = getAsset ? getAsset("text", STYLE_URL) : undefined;
  if (typeof bundled === "string") {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = bundled;
    document.head.appendChild(style);
  }
}

function uninstallStyle() {
  // The Datamosh Setup module shares this stylesheet; only remove it when no
  // setup window needs it anymore.
  const CM = state.editor;
  const datamoshOpen = CM && CM.datamoshWindow;
  if (!datamoshOpen) {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }
}

// The SaaS-themed setups use Inter type from the bundled tracery-font.css
// asset, shared with the Tracery/ASCII setups. The Datamosh Setup module
// installs the same element; removal waits until neither window is open.
function installFont(getAsset) {
  if (document.getElementById(FONT_STYLE_ID)) return;
  const bundled = getAsset ? getAsset("text", FONT_URL) : undefined;
  if (typeof bundled === "string") {
    const style = document.createElement("style");
    style.id = FONT_STYLE_ID;
    style.textContent = bundled;
    document.head.appendChild(style);
  }
  try {
    if (document.fonts && typeof document.fonts.load === "function") {
      document.fonts.load("700 14px Inter");
      document.fonts.load("400 12px Inter");
    }
  } catch (_err) { /* font is decorative */ }
}

function uninstallFont() {
  const CM = state.editor;
  const vhsOpen = CM && CM.vhsWindow;
  const datamoshOpen = CM && CM.datamoshWindow;
  if (!vhsOpen && !datamoshOpen) {
    const el = document.getElementById(FONT_STYLE_ID);
    if (el) el.remove();
  }
}

function installData(CM) {
  if (CM.vhsPresets) return;
  CM.vhsColors = [
    { key: "signalStrength", name: "Signal Strength", hint: "Chroma dots / color tears beside other colors" },
    { key: "colorStripes", name: "Color Stripes", hint: "Moving color-shift line bars (WTTW)" },
    { key: "chromaCrawl", name: "Chroma Crawl", hint: "Finer crawling color shift on edges" },
    { key: "chromaLoss", name: "Chroma Loss", hint: "Desaturation mono, loses colors" },
    { key: "flicker", name: "Flicker", hint: "Black / white diffusion exposure" },
    { key: "rgbSplit", name: "RGB Split", hint: "Red/blue split around green (YT aberration)" },
    { key: "blueScreen", name: "Blue Screen", hint: "Signal-loss blue field over picture ghost" },
  ];

  CM.vhsImages = [
    { key: "vhsSharpen", name: "VHS Sharpen", hint: "One-side directional blur + left-side sharpen" },
    { key: "interlace", name: "Interlace", hint: "-1 frame offset + tiny venetian blinds" },
    { key: "staticWarp", name: "Static Warp", hint: "One-side static warp + white dots, spreads as quality drops" },
    { key: "fastForward", name: "Fast Forward", hint: "Sine warp apparition + white dots" },
    { key: "tracking", name: "Tracking", hint: "Displaced clip + black bar sides" },
    { key: "anisotropyWarp", name: "Anisotropy Warp", hint: "Offset warp + color loss + white dots" },
    { key: "tear", name: "Tear", hint: "Random horizontal slice tears (YT tracking lines)" },
    { key: "humBar", name: "Hum Bar", hint: "Slow AC hum brightness band" },
    { key: "crease", name: "Crease", hint: "Diagonal tape-crease band (YT wrinkle)" },
    { key: "ghost", name: "Ghost", hint: "Displaced RGB echo (YT ghosting)" },
    { key: "blinds", name: "Blinds", hint: "Tiny venetian slats at 0.5 opacity (off by default)" },
    { key: "snowDots", name: "Snow Dots", hint: "Chunky white dots that spawn denser when raised" },
    { key: "speedDots", name: "Speed Dots", hint: "Fast horizontal dot streaks" },
    { key: "anisoSnow", name: "Anisotropy Snow Dots", hint: "Comet dots on thin travelling lines" },
  ];

  CM.vhsMotion = [
    { key: "jitterX", name: "Jitter X", hint: "Horizontal micro offset, anti-stiffness" },
    { key: "jitterY", name: "Jitter Y", hint: "Vertical micro offset, anti-stiffness" },
    { key: "roll", name: "Roll", hint: "Vertical roll / rewind amount" },
    { key: "rollSpeed", name: "Roll Speed", hint: "Roll travel speed", min: 0, max: 5, step: 0.1, decimals: 1 },
    { key: "persistence", name: "Persistence", hint: "Interlace frame-decay amount", min: 0, max: 0.9, step: 0.01, decimals: 2 },
    { key: "skew", name: "Skew", hint: "Top-edge flagwave bend amount", min: 0, max: 1, step: 0.01, decimals: 2 },
  ];

  CM.vhsOverlay = [
    { key: "osd", name: "OSD Timecode", hint: "Camcorder PLAY + SP timecode (YT date stamp)" },
  ];

  CM.vhsNoise = [
    { key: "noiseEvo", name: "Noise Evolution", hint: "Scroll + boil speed of band noise" },
    { key: "noiseOpacity", name: "Noise Opacity", hint: "Scrolling noise mix amount" },
  ];

  CM.vhsPresets = {
    clean: {
      label: "Clean VHS",
      values: { amount: 1, signalStrength: 0.12, colorStripes: 0.1, chromaCrawl: 0.08, chromaLoss: 0, flicker: 0.03, vhsSharpen: 0.3, interlace: 0.35, staticWarp: 0.05, fastForward: 0, tracking: 0.08, anisotropyWarp: 0, jitterX: 0.2, jitterY: 0.2, roll: 0, rollSpeed: 1.5, persistence: 0.2, rgbSplit: 0.08, tear: 0.05, humBar: 0.05, blueScreen: 0, skew: 0.2, crease: 0, ghost: 0.05, osd: 0 },
    },
    broadcast: {
      label: "Broadcast",
      values: { amount: 1, signalStrength: 0.25, colorStripes: 0.3, chromaCrawl: 0.22, chromaLoss: 0.02, flicker: 0.06, vhsSharpen: 0.35, interlace: 0.45, staticWarp: 0.12, fastForward: 0, tracking: 0.18, anisotropyWarp: 0, jitterX: 0.3, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.12, tear: 0.12, humBar: 0.1, blueScreen: 0, skew: 0.25, crease: 0, ghost: 0.08, osd: 0 },
    },
    damaged: {
      label: "Damaged Tape",
      values: { amount: 1, signalStrength: 0.7, colorStripes: 0.55, chromaCrawl: 0.5, chromaLoss: 0.35, flicker: 0.3, vhsSharpen: 0.5, interlace: 0.6, staticWarp: 0.65, fastForward: 0, tracking: 0.6, anisotropyWarp: 0.4, jitterX: 0.6, jitterY: 0.6, roll: 0.25, rollSpeed: 1.5, persistence: 0.35, rgbSplit: 0.4, tear: 0.6, humBar: 0.4, blueScreen: 0, skew: 0.6, crease: 0.5, ghost: 0.4, osd: 0 },
    },
    fastfwd: {
      label: "Fast Forward",
      values: { amount: 1, signalStrength: 0.35, colorStripes: 0.4, chromaCrawl: 0.3, chromaLoss: 0.15, flicker: 0.15, vhsSharpen: 0.4, interlace: 0.55, staticWarp: 0.25, fastForward: 0.8, tracking: 0.35, anisotropyWarp: 0.15, jitterX: 0.4, jitterY: 0.5, roll: 0.35, rollSpeed: 2.5, persistence: 0.4, rgbSplit: 0.3, tear: 0.35, humBar: 0.25, blueScreen: 0, skew: 0.4, crease: 0.2, ghost: 0.25, osd: 0 },
    },
    trackingErr: {
      label: "Tracking Error",
      values: { amount: 1, signalStrength: 0.5, colorStripes: 0.35, chromaCrawl: 0.35, chromaLoss: 0.2, flicker: 0.2, vhsSharpen: 0.4, interlace: 0.5, staticWarp: 0.4, fastForward: 0, tracking: 0.9, anisotropyWarp: 0.3, jitterX: 0.5, jitterY: 0.5, roll: 0.15, rollSpeed: 1.2, persistence: 0.3, rgbSplit: 0.35, tear: 0.5, humBar: 0.3, blueScreen: 0, skew: 0.5, crease: 0.35, ghost: 0.3, osd: 0 },
    },
    shot01: {
      label: "Shot 01 · MESECAM tears",
      values: { amount: 1, signalStrength: 0.8, colorStripes: 0.15, chromaCrawl: 0.3, chromaLoss: 0.05, flicker: 0.05, vhsSharpen: 0.55, interlace: 0.4, staticWarp: 0.25, fastForward: 0, tracking: 0.15, anisotropyWarp: 0, jitterX: 0.45, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.25, tear: 0.15, humBar: 0.08, blueScreen: 0, skew: 0.25, crease: 0, ghost: 0.08, osd: 0 },
    },
    shot02: {
      label: "Shot 02 · WTTW stripes",
      values: { amount: 1, signalStrength: 0.3, colorStripes: 0.85, chromaCrawl: 0.3, chromaLoss: 0.05, flicker: 0.08, vhsSharpen: 0.35, interlace: 0.45, staticWarp: 0.15, fastForward: 0, tracking: 0.25, anisotropyWarp: 0, jitterX: 0.35, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.3, rgbSplit: 0.3, tear: 0.15, humBar: 0.12, blueScreen: 0, skew: 0.3, crease: 0.05, ghost: 0.12, osd: 1 },
    },
    shot03: {
      label: "Shot 03 · WTTW clean",
      values: { amount: 1, signalStrength: 0.15, colorStripes: 0.15, chromaCrawl: 0.15, chromaLoss: 0.02, flicker: 0.04, vhsSharpen: 0.5, interlace: 0.4, staticWarp: 0.08, fastForward: 0, tracking: 0.12, anisotropyWarp: 0, jitterX: 0.25, jitterY: 0.25, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.1, tear: 0.06, humBar: 0.06, blueScreen: 0, skew: 0.2, crease: 0, ghost: 0.05, osd: 1 },
    },
    shot04: {
      label: "Shot 04 · Pattern blur",
      values: { amount: 1, signalStrength: 0.3, colorStripes: 0.4, chromaCrawl: 0.7, chromaLoss: 0.08, flicker: 0.08, vhsSharpen: 0.4, interlace: 0.7, staticWarp: 0.15, fastForward: 0, tracking: 0.2, anisotropyWarp: 0, jitterX: 0.3, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.45, rgbSplit: 0.35, tear: 0.2, humBar: 0.1, blueScreen: 0, skew: 0.3, crease: 0.1, ghost: 0.15, osd: 0 },
    },
    shot05: {
      label: "Shot 05 · Streak strip",
      values: { amount: 1, signalStrength: 0.5, colorStripes: 0.4, chromaCrawl: 0.4, chromaLoss: 0.2, flicker: 0.2, vhsSharpen: 0.3, interlace: 0.5, staticWarp: 0.9, fastForward: 0, tracking: 0.7, anisotropyWarp: 0.2, jitterX: 0.7, jitterY: 0.5, roll: 0, rollSpeed: 1.5, persistence: 0.3, rgbSplit: 0.35, tear: 0.7, humBar: 0.3, blueScreen: 0, skew: 0.5, crease: 0.5, ghost: 0.3, osd: 0 },
    },
    shot06: {
      label: "Shot 06 · Desat mono",
      values: { amount: 1, signalStrength: 0.2, colorStripes: 0.2, chromaCrawl: 0.1, chromaLoss: 0.95, flicker: 0.06, vhsSharpen: 0.35, interlace: 0.45, staticWarp: 0.12, fastForward: 0, tracking: 0.15, anisotropyWarp: 0, jitterX: 0.3, jitterY: 0.3, roll: 0, rollSpeed: 1.5, persistence: 0.25, rgbSplit: 0.1, tear: 0.08, humBar: 0.06, blueScreen: 0, skew: 0.2, crease: 0, ghost: 0.05, osd: 0 },
    },
    shot07: {
      label: "Shot 07 · Fast forward",
      values: { amount: 1, signalStrength: 0.35, colorStripes: 0.35, chromaCrawl: 0.3, chromaLoss: 0.55, flicker: 0.12, vhsSharpen: 0.35, interlace: 0.5, staticWarp: 0.35, fastForward: 0.7, tracking: 0.3, anisotropyWarp: 0.1, jitterX: 0.4, jitterY: 0.45, roll: 0.2, rollSpeed: 2.2, persistence: 0.35, rgbSplit: 0.25, tear: 0.4, humBar: 0.2, blueScreen: 0, skew: 0.45, crease: 0.3, ghost: 0.2, osd: 0 },
    },
    shot08: {
      label: "Shot 08 · Blue blowout",
      values: { amount: 1, signalStrength: 0.4, colorStripes: 0.45, chromaCrawl: 0.4, chromaLoss: 0.1, flicker: 0.85, vhsSharpen: 0.35, interlace: 0.5, staticWarp: 0.3, fastForward: 0, tracking: 0.5, anisotropyWarp: 0.1, jitterX: 0.5, jitterY: 0.4, roll: 0, rollSpeed: 1.5, persistence: 0.3, rgbSplit: 0.3, tear: 0.3, humBar: 0.35, blueScreen: 0.15, skew: 0.35, crease: 0.1, ghost: 0.15, osd: 0 },
    },
    shot09: {
      label: "Shot 09 · Tracking bars",
      values: { amount: 1, signalStrength: 0.4, colorStripes: 0.35, chromaCrawl: 0.35, chromaLoss: 0.25, flicker: 0.3, vhsSharpen: 0.35, interlace: 0.5, staticWarp: 0.35, fastForward: 0, tracking: 0.95, anisotropyWarp: 0.2, jitterX: 0.55, jitterY: 0.45, roll: 0.1, rollSpeed: 1.2, persistence: 0.3, rgbSplit: 0.4, tear: 0.55, humBar: 0.3, blueScreen: 0.1, skew: 0.55, crease: 0.4, ghost: 0.3, osd: 0 },
    },
    shot10: {
      label: "Shot 10 · Aniso split",
      values: { amount: 1, signalStrength: 0.45, colorStripes: 0.4, chromaCrawl: 0.4, chromaLoss: 0.45, flicker: 0.2, vhsSharpen: 0.35, interlace: 0.55, staticWarp: 0.25, fastForward: 0, tracking: 0.4, anisotropyWarp: 0.9, jitterX: 0.5, jitterY: 0.45, roll: 0, rollSpeed: 1.5, persistence: 0.35, rgbSplit: 0.35, tear: 0.4, humBar: 0.25, blueScreen: 0.1, skew: 0.4, crease: 0.6, ghost: 0.25, osd: 0 },
    },
  };

  CM.vhsClean = CM.vhsPresets.clean.values;

  const noiseVals = {
    clean: { noiseEvo: 0.4, noiseOpacity: 0.3 },
    broadcast: { noiseEvo: 0.5, noiseOpacity: 0.4 },
    damaged: { noiseEvo: 0.7, noiseOpacity: 0.6 },
    fastfwd: { noiseEvo: 0.8, noiseOpacity: 0.45 },
    trackingErr: { noiseEvo: 0.7, noiseOpacity: 0.6 },
    shot01: { noiseEvo: 0.5, noiseOpacity: 0.4 },
    shot02: { noiseEvo: 0.5, noiseOpacity: 0.4 },
    shot03: { noiseEvo: 0.4, noiseOpacity: 0.3 },
    shot04: { noiseEvo: 0.5, noiseOpacity: 0.4 },
    shot05: { noiseEvo: 0.7, noiseOpacity: 0.6 },
    shot06: { noiseEvo: 0.4, noiseOpacity: 0.3 },
    shot07: { noiseEvo: 0.8, noiseOpacity: 0.45 },
    shot08: { noiseEvo: 0.5, noiseOpacity: 0.45 },
    shot09: { noiseEvo: 0.7, noiseOpacity: 0.6 },
    shot10: { noiseEvo: 0.6, noiseOpacity: 0.5 },
  };
  Object.keys(noiseVals).forEach(function (k) {
    if (CM.vhsPresets[k]) Object.assign(CM.vhsPresets[k].values, noiseVals[k], { blinds: 0 });
  });

  const dotsVals = {
    clean: { snowDots: 0, speedDots: 0 },
    broadcast: { snowDots: 0, speedDots: 0 },
    damaged: { snowDots: 0.5, speedDots: 0.4 },
    fastfwd: { snowDots: 0.35, speedDots: 0.7 },
    trackingErr: { snowDots: 0.35, speedDots: 0.3 },
    shot01: { snowDots: 0.1, speedDots: 0 },
    shot02: { snowDots: 0, speedDots: 0 },
    shot03: { snowDots: 0, speedDots: 0 },
    shot04: { snowDots: 0.1, speedDots: 0.15 },
    shot05: { snowDots: 0.6, speedDots: 0.4 },
    shot06: { snowDots: 0, speedDots: 0 },
    shot07: { snowDots: 0.4, speedDots: 0.55 },
    shot08: { snowDots: 0.15, speedDots: 0.2 },
    shot09: { snowDots: 0.35, speedDots: 0.3 },
    shot10: { snowDots: 0.4, speedDots: 0.3 },
  };
  Object.keys(dotsVals).forEach(function (k) {
    if (CM.vhsPresets[k]) Object.assign(CM.vhsPresets[k].values, dotsVals[k]);
  });

  const anisoVals = {
    clean: { anisoSnow: 0 },
    broadcast: { anisoSnow: 0 },
    damaged: { anisoSnow: 0.45 },
    fastfwd: { anisoSnow: 0.3 },
    trackingErr: { anisoSnow: 0.3 },
    shot01: { anisoSnow: 0.15 },
    shot02: { anisoSnow: 0 },
    shot03: { anisoSnow: 0 },
    shot04: { anisoSnow: 0.1 },
    shot05: { anisoSnow: 0.5 },
    shot06: { anisoSnow: 0 },
    shot07: { anisoSnow: 0.35 },
    shot08: { anisoSnow: 0.2 },
    shot09: { anisoSnow: 0.3 },
    shot10: { anisoSnow: 0.55 },
  };
  Object.keys(anisoVals).forEach(function (k) {
    if (CM.vhsPresets[k]) Object.assign(CM.vhsPresets[k].values, anisoVals[k]);
  });

  CM.vhsSliders = [
    { key: "amount", name: "Amount", min: 0, max: 1, step: 0.01, decimals: 2, group: "Master" },
    { key: "signalStrength", name: "Signal Strength", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Color" },
    { key: "colorStripes", name: "Color Stripes", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Color" },
    { key: "chromaCrawl", name: "Chroma Crawl", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Color" },
    { key: "chromaLoss", name: "Chroma Loss", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Color" },
    { key: "flicker", name: "Flicker", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Color" },
    { key: "rgbSplit", name: "RGB Split", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Color" },
    { key: "blueScreen", name: "Blue Screen", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Color" },
    { key: "vhsSharpen", name: "VHS Sharpen", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "interlace", name: "Interlace", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "staticWarp", name: "Static Warp", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "fastForward", name: "Fast Forward", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "tracking", name: "Tracking", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "anisotropyWarp", name: "Anisotropy Warp", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "tear", name: "Tear", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "humBar", name: "Hum Bar", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "crease", name: "Crease", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "ghost", name: "Ghost", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "blinds", name: "Blinds", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "snowDots", name: "Snow Dots", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "speedDots", name: "Speed Dots", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "anisoSnow", name: "Anisotropy Snow Dots", min: 0, max: 1, step: 0.01, decimals: 2, group: "Quality — Image" },
    { key: "jitterX", name: "Jitter X", min: 0, max: 1, step: 0.01, decimals: 2, group: "Motion" },
    { key: "jitterY", name: "Jitter Y", min: 0, max: 1, step: 0.01, decimals: 2, group: "Motion" },
    { key: "roll", name: "Roll", min: 0, max: 1, step: 0.01, decimals: 2, group: "Motion" },
    { key: "rollSpeed", name: "Roll Speed", min: 0, max: 5, step: 0.1, decimals: 1, group: "Motion" },
    { key: "persistence", name: "Persistence", min: 0, max: 0.9, step: 0.01, decimals: 2, group: "Motion" },
    { key: "skew", name: "Skew", min: 0, max: 1, step: 0.01, decimals: 2, group: "Motion" },
    { key: "osd", name: "OSD Timecode", min: 0, max: 1, step: 0.01, decimals: 2, group: "Overlay" },
    { key: "noiseEvo", name: "Noise Evolution", min: 0, max: 1, step: 0.01, decimals: 2, group: "Noise" },
    { key: "noiseOpacity", name: "Noise Opacity", min: 0, max: 1, step: 0.01, decimals: 2, group: "Noise" },
  ];
}

function installWindow(CM, logoUrl) {
  if (CM.openVhsSetup) return;

  CM.vhsEffectList = function () {
    const found = [];
    const walk = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e) continue;
        if (e.type === "vhs") found.push(e);
        if (e.objects) walk(e.objects);
      }
    };
    const selection = CM.timelineSelection;
    if (selection) {
      for (let i = 0; i < selection.length; i++) {
        const clip = selection[i];
        const layer = clip && (clip.object || clip);
        if (layer && layer.effects) walk(layer.effects);
      }
    }
    if (!found.length && CM.project) {
      CM.project.traverse(function (e) { if (e.type === "vhs") found.push(e); });
    }
    return found;
  };

  CM.addVhsToSelection = function () {
    const selection = CM.timelineSelection;
    if (!selection || !selection.length) return null;
    for (let i = 0; i < selection.length; i++) {
      const clip = selection[i];
      const layer = clip && clip.object;
      if (layer && layer.effects) {
        const PZ = globalThis.PZ;
        const effect = PZ.effect.create("vhs");
        layer.effects.push(effect);
        effect.loading = effect.load({});
        return effect;
      }
    }
    return null;
  };

  CM.openVhsSetup = function (effect) {
    if (CM.vhsWindow) {
      if (effect) CM.vhsWindow.setEffect(effect);
      CM.vhsWindow.refresh();
      return;
    }
    const state = {
      effect: effect || null,
      interval: null,
      viewport: CM.mainViewport || null,
      viewportParent: null,
      viewportStyle: null,
      wasEdit: null,
    };
    const make = function (tag, cls, text) {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const frame = function () { return CM.playback ? CM.playback.currentFrame : 0; };
    const setProp = function (key, value) {
      const e = state.effect;
      if (!e) return;
      const p = e.properties[key];
      if (!p) return;
      value = Number(value);
      if (!isFinite(value)) return;
      p.set(value, frame() - p.frameOffset);
    };
    const getProp = function (key) {
      const e = state.effect;
      if (!e) return undefined;
      const p = e.properties[key];
      return p ? p.get(frame()) : undefined;
    };
    const approx = function (a, b) { return Math.abs(Number(a) - Number(b)) < 0.015; };
    const isCleanPreset = function (preset) {
      if (!state.effect) return false;
      const vals = preset.values;
      return Object.keys(vals).every(function (k) {
        const cur = getProp(k);
        return cur !== undefined && approx(cur, vals[k]);
      });
    };

    const root = make("div", "vhs-window");
    const titlebar = make("div", "vhs-titlebar");
    const titleLeft = make("div", "vhs-title-left");
    titleLeft.appendChild(make("div", "vhs-title", "VHS SETUP"));
    titleLeft.appendChild(make("div", "vhs-subtitle", "Quality · Color + Image"));
    titlebar.appendChild(titleLeft);
    const liveBadge = make("div", "vhs-live", "● LIVE");
    titlebar.appendChild(liveBadge);
    const statusEl = make("div", "vhs-status", "No VHS effect");
    titlebar.appendChild(statusEl);
    const closeButton = make("button", "vhs-close", "✕");
    closeButton.title = "Close (Esc)";
    titlebar.appendChild(closeButton);
    const body = make("div", "vhs-body");
    const sidebar = make("div", "vhs-sidebar");
    const main = make("div", "vhs-main");
    const screen = make("div", "vhs-screen");
    const placeholder = make("div", "vhs-screen-placeholder", "{ screen / render to put }");
    screen.appendChild(placeholder);
    const controls = make("div", "vhs-controls");

    const logo = make("div", "vhs-logo");
    const logoImg = make("img", "vhs-logo-cover");
    logoImg.src = logoUrl;
    logoImg.alt = "VHS";
    logo.appendChild(logoImg);
    sidebar.appendChild(logo);

    const emptyEl = make("div", "vhs-empty", "No VHS effect found. Select a clip and add one below.");
    sidebar.appendChild(emptyEl);

    const section = function (title, sub) {
      const s = make("div", "vhs-section");
      s.appendChild(make("div", "vhs-section-title", title));
      if (sub) s.appendChild(make("div", "vhs-section-sub", sub));
      return s;
    };

    // ---- Presets (sidebar) ----
    sidebar.appendChild(section("Presets", "One-click Quality looks"));
    const presetList = make("div", "vhs-presets");
    const presetItems = [];
    Object.keys(CM.vhsPresets).forEach(function (pkey) {
      const preset = CM.vhsPresets[pkey];
      const btn = make("button", "vhs-preset", preset.label);
      btn.title = "Apply preset: " + preset.label;
      btn.onclick = function () {
        if (!state.effect) return;
        Object.keys(preset.values).forEach(function (k) { setProp(k, preset.values[k]); });
        refresh();
      };
      presetList.appendChild(btn);
      presetItems.push({ el: btn, key: pkey, preset: preset });
    });
    sidebar.appendChild(presetList);

    // ---- Quality map (sidebar info, mirrors the 10 screenshots) ----
    const infoGroups = [
      { title: "Quality — Color", items: CM.vhsColors },
      { title: "Quality — Image", items: CM.vhsImages },
      { title: "Motion", items: CM.vhsMotion },
      { title: "Overlay", items: CM.vhsOverlay },
      { title: "Noise", items: CM.vhsNoise },
    ];
    infoGroups.forEach(function (g) {
      const gsub = { "Quality — Color": "7 color artifacts", "Quality — Image": "14 image artifacts", "Motion": "6 motion offsets", "Overlay": "Camcorder overlay", "Noise": "Evolving scroll + opacity" }[g.title] || "";
      sidebar.appendChild(section(g.title, gsub));
      const ul = make("ul", "vhs-list vhs-info-list");
      g.items.forEach(function (item) {
        const li = make("li", "vhs-item vhs-info");
        const wrap = make("div", "vhs-info-wrap");
        wrap.appendChild(make("div", "vhs-name", item.name));
        wrap.appendChild(make("div", "vhs-hint", item.hint));
        li.appendChild(wrap);
        ul.appendChild(li);
      });
      sidebar.appendChild(ul);
    });

    // ---- Sliders (main panel, grouped) ----
    const sliderRows = [];
    const groups = ["Master", "Quality — Color", "Quality — Image", "Motion", "Overlay", "Noise"];
    const groupHint = {
      "Master": "Overall mix",
      "Quality — Color": "Signal strength · stripes · crawl · loss · flicker",
      "Quality — Image": "Sharpen · interlace · static · FF · tracking · anisotropy · blinds · snow · speed · aniso",
      "Motion": "Jitter X/Y · roll · speed · persistence",
      "Overlay": "Camcorder PLAY + SP timecode",
      "Noise": "Evolving scroll · opacity",
    };
    groups.forEach(function (gname) {
      const specs = CM.vhsSliders.filter(function (sp) { return sp.group === gname; });
      if (!specs.length) return;
      const gdiv = make("div", "vhs-group");
      const head = make("div", "vhs-group-head");
      head.appendChild(make("div", "vhs-group-title", gname));
      head.appendChild(make("div", "vhs-group-sub", groupHint[gname] || ""));
      gdiv.appendChild(head);
      specs.forEach(function (spec) {
        let hintObj = null;
        [CM.vhsColors, CM.vhsImages, CM.vhsMotion, CM.vhsOverlay, CM.vhsNoise].forEach(function (arr) {
          arr.forEach(function (it) { if (it.key === spec.key) hintObj = it; });
        });
        const row = make("div", "vhs-slider");
        const labWrap = make("div", "vhs-label-wrap");
        labWrap.appendChild(make("label", "", spec.name));
        if (hintObj) labWrap.appendChild(make("div", "vhs-hint", hintObj.hint));
        row.appendChild(labWrap);
        const input = make("input");
        input.type = "range";
        input.min = spec.min;
        input.max = spec.max;
        input.step = spec.step;
        input.dataset.key = spec.key;
        const valueEl = make("span", "vhs-value", "");
        input.oninput = function () {
          setProp(spec.key, parseFloat(input.value));
          valueEl.textContent = parseFloat(input.value).toFixed(spec.decimals);
          refreshPresetState();
        };
        row.appendChild(input);
        row.appendChild(valueEl);
        gdiv.appendChild(row);
        sliderRows.push({ spec: spec, input: input, valueEl: valueEl });
      });
      controls.appendChild(gdiv);
    });

    const statusRow = make("div", "vhs-status-row");
    const statusDot = make("span", "vhs-dot", "");
    const statusText = make("span", "vhs-status-text", "No VHS effect");
    statusRow.appendChild(statusDot);
    statusRow.appendChild(statusText);
    controls.appendChild(statusRow);

    const buttonRow = make("div", "vhs-buttons");
    const cleanButton = make("button", "", "Clean VHS");
    cleanButton.title = "Reset to clean Quality preset";
    cleanButton.onclick = function () {
      if (!state.effect) return;
      Object.keys(CM.vhsClean).forEach(function (k) { setProp(k, CM.vhsClean[k]); });
      refresh();
    };
    const glitchButton = make("button", "vhs-glitch-btn", "Glitch!");
    glitchButton.title = "Random damaged Quality burst";
    glitchButton.onclick = function () {
      if (!state.effect) return;
      const random = function (a, b) { return a + Math.random() * (b - a); };
      setProp("amount", 1);
      setProp("signalStrength", random(0.4, 1));
      setProp("colorStripes", random(0.3, 0.9));
      setProp("chromaCrawl", random(0.3, 0.9));
      setProp("chromaLoss", random(0.1, 0.6));
      setProp("flicker", random(0.1, 0.5));
      setProp("vhsSharpen", random(0.2, 0.7));
      setProp("interlace", random(0.3, 0.8));
      setProp("staticWarp", random(0.4, 1));
      setProp("fastForward", Math.random() < 0.35 ? random(0.4, 1) : 0);
      setProp("tracking", random(0.4, 1));
      setProp("anisotropyWarp", Math.random() < 0.5 ? random(0.2, 0.8) : 0);
      setProp("jitterX", random(0.3, 0.9));
      setProp("jitterY", random(0.3, 0.9));
      setProp("roll", Math.random() < 0.4 ? random(0.2, 0.8) : 0);
      setProp("rgbSplit", random(0.1, 0.6));
      setProp("tear", random(0.2, 0.8));
      setProp("humBar", random(0.1, 0.5));
      setProp("blueScreen", Math.random() < 0.12 ? random(0.4, 1) : 0);
      setProp("skew", random(0.2, 0.8));
      setProp("crease", Math.random() < 0.4 ? random(0.2, 0.7) : 0);
      setProp("ghost", random(0.1, 0.5));
      setProp("noiseEvo", random(0.3, 1));
      setProp("noiseOpacity", random(0.3, 0.8));
      setProp("blinds", Math.random() < 0.3 ? random(0.2, 0.6) : 0);
      setProp("snowDots", random(0.2, 0.7));
      setProp("speedDots", random(0.2, 0.7));
      setProp("anisoSnow", random(0.2, 0.6));
      refresh();
    };
    const addButton = make("button", "", "Add VHS to selected clip");
    addButton.onclick = function () {
      const added = CM.addVhsToSelection();
      if (added) {
        state.effect = added;
        if (added.loading && added.loading.then) added.loading.then(refresh);
        refresh();
      } else {
        emptyEl.textContent = "Select a clip first, then add the VHS effect.";
      }
    };
    buttonRow.appendChild(cleanButton);
    buttonRow.appendChild(glitchButton);
    buttonRow.appendChild(addButton);
    controls.appendChild(buttonRow);

    const refreshPresetState = function () {
      presetItems.forEach(function (item) {
        item.el.classList.toggle("active", isCleanPreset(item.preset));
      });
    };

    const refresh = function () {
      const has = !!state.effect;
      emptyEl.style.display = has ? "none" : "";
      sliderRows.forEach(function (row) {
        let value = has ? getProp(row.spec.key) : undefined;
        if (value === undefined || !isFinite(Number(value))) value = row.spec.min;
        value = Number(value);
        row.valueEl.textContent = value.toFixed(row.spec.decimals);
        if (document.activeElement !== row.input) row.input.value = value;
        row.input.disabled = !has;
      });
      refreshPresetState();
      let label = "No VHS effect";
      if (has) {
        const active = presetItems.filter(function (it) { return isCleanPreset(it.preset); });
        label = active.length ? active[0].preset.label : "Custom Quality";
      }
      statusEl.textContent = label;
      statusText.textContent = has ? ("Active · " + label) : "No VHS effect — add one below";
      statusDot.classList.toggle("on", has);
      liveBadge.classList.toggle("on", has);
    };

    main.appendChild(screen);
    main.appendChild(controls);
    body.appendChild(sidebar);
    body.appendChild(main);
    root.appendChild(titlebar);
    root.appendChild(body);
    document.body.appendChild(root);

    if (state.viewport && state.viewport.el) {
      state.viewportParent = state.viewport.el.parentElement;
      state.viewportStyle = state.viewport.el.getAttribute("style");
      state.wasEdit = state.viewport.edit;
      state.viewport.edit = false;
      screen.appendChild(state.viewport.el);
      placeholder.remove();
      requestAnimationFrame(function () { state.viewport.resize(); });
    }

    const close = function () {
      if (state.interval) { clearInterval(state.interval); state.interval = null; }
      if (state.viewport && state.viewportParent) {
        state.viewport.el.setAttribute("style", state.viewportStyle || "");
        state.viewportParent.appendChild(state.viewport.el);
        state.viewport.edit = state.wasEdit;
        state.viewport.resize();
      }
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKeydown);
      root.remove();
      CM.vhsWindow = null;
    };
    const onResize = function () { if (state.viewport) state.viewport.resize(); };
    const onKeydown = function (e) { if (e.key === "Escape") close(); };
    closeButton.onclick = close;
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKeydown);

    if (!state.effect) {
      const found = CM.vhsEffectList();
      if (found.length) state.effect = found[0];
    }
    refresh();
    state.interval = setInterval(refresh, 250);
    CM.vhsWindow = {
      refresh: refresh,
      close: close,
      setEffect: function (e) { state.effect = e; refresh(); },
    };
  };
}

function routeSetupAction(action, list, target) {
  const editor = (list && list.editor) || state.editor || globalThis.CM;
  if (!editor) return false;
  if (action === "vhsSetup" && typeof editor.openVhsSetup === "function") {
    editor.openVhsSetup(target && target.parentObject);
    return true;
  }
  if (action === "datamoshSetup" && typeof editor.openDatamoshSetup === "function") {
    editor.openDatamoshSetup(target && target.parentObject);
    return true;
  }
  return false;
}

// Upstream CM3 has neither the property-button dispatcher nor the button
// renderer (both are OpenZoid additions), so this pack ships compatible
// versions. They are additive and inert without our effects: buttons only
// render for property definitions that declare them, and the dispatcher
// only routes the two setup actions.
function ensureDispatcher(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls) {
    throw new Error("Setup windows need PZ.ui.controls from the CM3 runtime.");
  }
  if (typeof controls.runPropertyAction === "function") return controls;
  controls.runPropertyAction = function (list, target, action, el) {
    routeSetupAction(action, list, target);
  };
  controls.runPropertyAction.__openzoidLegacyCompat = true;
  return controls;
}

function wrapDispatcher(PZ) {
  // An OpenZoid-style runtime ships its own dispatcher with extra cases:
  // wrap it so our actions route first and everything else delegates.
  // The compat dispatcher installed above already covers both actions.
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.runPropertyAction !== "function") return;
  if (controls.runPropertyAction.__openzoidLegacyCompat) return;
  if (state.installedWrapper) return;
  const original = controls.runPropertyAction;
  const patched = function (list, target, action, el) {
    if (patched.__openzoidLegacyDead) {
      return original.call(this, list, target, action, el);
    }
    if (routeSetupAction(action, list, target)) return;
    return original.call(this, list, target, action, el);
  };
  patched.__openzoidLegacyOriginal = original;
  controls.runPropertyAction = patched;
  state.installedWrapper = patched;
}

function unpatchDispatcher(PZ) {
  if (state.installedWrapper) {
    state.installedWrapper.__openzoidLegacyDead = true;
    const controls = PZ && PZ.ui && PZ.ui.controls;
    if (controls && controls.runPropertyAction === state.installedWrapper) {
      controls.runPropertyAction = controls.runPropertyAction.__openzoidLegacyOriginal || controls.runPropertyAction;
    }
    state.installedWrapper = null;
  }
}

function buildActionButtons(buttonDefs) {
  const wrap = document.createElement("div");
  wrap.className = "vhs-setup-buttons";
  wrap.style = "display: flex; gap: 3px; margin-top: 3px; flex-wrap: wrap;";
  buttonDefs.forEach(function (spec) {
    const n = document.createElement("button");
    n.classList.add("propbutton", "noselect");
    n.style = "font-size: 10px; padding: 1px 6px;";
    n.innerText = spec.name;
    n.title = spec.title || spec.name;
    n.onmousedown = (ev) => ev.stopPropagation();
    n.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest("li");
      const list = li && li.parentElement ? li.parentElement.pz_controls : null;
      if (!list) return;
      const live = globalThis.PZ;
      const dispatch = live && live.ui && live.ui.controls && live.ui.controls.runPropertyAction;
      if (typeof dispatch === "function") {
        dispatch.call(live.ui.controls, list, li.pz_object, spec.action, ev.currentTarget);
      }
    };
    wrap.appendChild(n);
  });
  return wrap;
}

function ensureButtonsRenderer(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls || typeof controls.createControls !== "function") return;
  if (controls.createControls.__openzoidLegacyButtons) {
    controls.createControls.__openzoidLegacyRefs =
      (controls.createControls.__openzoidLegacyRefs || 1) + 1;
    return;
  }
  const original = controls.createControls;
  // Mirrors the OpenZoid block: e is the row element whose children[1] holds
  // the generated input, t is the property. Buttons append after the input.
  const patched = function (e, t, i) {
    const out = original.call(this, e, t, i);
    try {
      if (patched.__openzoidLegacyDead) return out;
      const def = t && t.definition;
      const host = e && e.children && e.children[1];
      if (def && Array.isArray(def.buttons) && def.buttons.length && host &&
          typeof host.querySelector === "function" &&
          !host.querySelector("div.vhs-setup-buttons")) {
        host.appendChild(buildActionButtons(def.buttons));
      }
    } catch (_err) { /* never break property rendering */ }
    return out;
  };
  patched.__openzoidLegacyButtons = true;
  patched.__openzoidLegacyRefs = 1;
  patched.__openzoidLegacyOriginal = original;
  controls.createControls = patched;
}

function releaseButtonsRenderer(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  const current = controls && controls.createControls;
  if (!current || !current.__openzoidLegacyButtons) return;
  current.__openzoidLegacyRefs = Math.max(0, (current.__openzoidLegacyRefs || 1) - 1);
  if (current.__openzoidLegacyRefs === 0) {
    current.__openzoidLegacyDead = true;
    if (controls.createControls === current && current.__openzoidLegacyOriginal) {
      controls.createControls = current.__openzoidLegacyOriginal;
    }
  }
}

module.exports = {
  activate(context) {
    if (state.active) return;
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const CM = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    if (!PZ) throw new Error("VHS Setup needs the CM3 runtime.");
    if (!CM) throw new Error("VHS Setup needs the active editor instance.");
    const getAsset = context && typeof context.getAsset === "function"
      ? context.getAsset.bind(context)
      : null;
    state.editor = CM;
    state.getAsset = getAsset;
    installStyle(getAsset);
    installFont(getAsset);
    installData(CM);
    const logo = (getAsset && getAsset("text", LOGO_URL)) || "./assets/vhs-logo.jpg";
    installWindow(CM, logo);
    ensureDispatcher(PZ);
    wrapDispatcher(PZ);
    ensureButtonsRenderer(PZ);
    state.active = true;
  },
  deactivate() {
    try {
      const PZ = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || null;
      const CM = state.editor;
      if (CM && CM.vhsWindow && typeof CM.vhsWindow.close === "function") {
        try { CM.vhsWindow.close(); } catch (_error) { /* best effort */ }
      }
      if (PZ) {
        try { unpatchDispatcher(PZ); } catch (_error) { /* best effort */ }
        try { releaseButtonsRenderer(PZ); } catch (_error) { /* best effort */ }
      }
      uninstallStyle();
      uninstallFont();
    } finally {
      state.active = false;
      state.editor = null;
      state.getAsset = null;
    }
  },
};
