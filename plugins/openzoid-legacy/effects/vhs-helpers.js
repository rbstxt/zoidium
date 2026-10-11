// OpenZoid Legacy — VHS helpers (split from vhs.js).
// Property definitions, the clip-local clock and the persistence mix factor.
// Loaded through the shared bundle module loader.

// Persistence ("trails") is an explicit weighted average of earlier SOURCE
// frames. The frame sampler evaluates those frames at fixed one-frame offsets,
// and the averaging passes below blend them into one texture. Nothing reads
// this effect's previous output, so a frame renders the same in any order.
const VHS_TRAIL_DECAY = 0.6;
// New effects use a clip-local clock plus an offset. Older explicit clocks
// retain their absolute value, including custom expressions and keyframes.
function effectTime(effect, frame) {
    const props = effect.properties;
    const rate = Number(effect.parentProject?.sequence?.properties?.rate?.get?.()) || 30;
    const value = Number(props.time.get(frame));
    const clock = Number.isFinite(value) ? value : 0;
    return props.timeMode.get() === 0 ? clock : Number(frame || 0) / rate + clock;
}

function loadEffectTime(effect, saved) {
    if (!saved || saved.time === undefined || saved.timeMode !== undefined) return;
    const entry = saved.time;
    const expression = entry && entry.expression;
    const source = typeof expression === "string" ? expression : expression?.source;
    const customKeys = Array.isArray(entry?.keyframes) && entry.keyframes.some((key) =>
        Number(key.value || 0) !== 0 || Number(key.frame || 0) !== 0);
    if (source?.trim() === "time" && !customKeys) {
        const property = effect.properties.time;
        property.expression = null;
        property.animated = false;
        // The donor expression default serialized an empty keyframe list.
        if (property.keyframes?.length === 0) property.keyframes.push(new PZ.keyframe(0, 0));
        property.set(0, 0);
    } else {
        effect.properties.timeMode.set(0);
    }
}

// Matches the mix factor applied by VHS_SIGNAL_SHADER (frameMix).
function vhsTrailMix(amount, persistence, interlace) {
    return Math.min(0.85, Math.max(0, (0.25 + persistence) * interlace * amount));
}

function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

function readNumber(property, frame, fallback) {
    try {
        const value = Number(property && property.get ? property.get(frame) : NaN);
        return Number.isFinite(value) ? value : fallback;
    } catch (_error) {
        return fallback;
    }
}

function vhsNum(name, value, min, max, step, decimals) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: step,
        decimals: decimals,
    };
}

const vhsProperties = {
    enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    setup: {
        visible: false,
        name: "Setup",
        type: PZ.property.type.TEXT,
        value: "",
    },
    timeMode: { visible: false, name: "Time mode", type: PZ.property.type.NUMBER, value: 1 },
    time: {
        dynamic: true, name: "Time Offset", type: PZ.property.type.NUMBER,
        value: 0, step: 0.01, decimals: 2,
    },
    amount: vhsNum("Amount", 1, 0, 1, 0.01, 2),
    signalStrength: vhsNum("Signal Strength", 0.25, 0, 1, 0.01, 2),
    colorStripes: vhsNum("Color Stripes", 0.25, 0, 1, 0.01, 2),
    chromaCrawl: vhsNum("Chroma Crawl", 0.2, 0, 1, 0.01, 2),
    chromaLoss: vhsNum("Chroma Loss", 0.05, 0, 1, 0.01, 2),
    flicker: vhsNum("Flicker", 0.08, 0, 1, 0.01, 2),
    vhsSharpen: vhsNum("VHS Sharpen", 0.35, 0, 1, 0.01, 2),
    interlace: vhsNum("Interlace", 0.4, 0, 1, 0.01, 2),
    staticWarp: vhsNum("Static Warp", 0.2, 0, 1, 0.01, 2),
    fastForward: vhsNum("Fast Forward", 0, 0, 1, 0.01, 2),
    tracking: vhsNum("Tracking", 0.25, 0, 1, 0.01, 2),
    anisotropyWarp: vhsNum("Anisotropy Warp", 0, 0, 1, 0.01, 2),
    rgbSplit: vhsNum("RGB Split", 0.12, 0, 1, 0.01, 2),
    tear: vhsNum("Tear", 0.12, 0, 1, 0.01, 2),
    humBar: vhsNum("Hum Bar", 0.1, 0, 1, 0.01, 2),
    blueScreen: vhsNum("Blue Screen", 0, 0, 1, 0.01, 2),
    skew: vhsNum("Skew", 0.25, 0, 1, 0.01, 2),
    crease: vhsNum("Crease", 0, 0, 1, 0.01, 2),
    ghost: vhsNum("Ghost", 0.08, 0, 1, 0.01, 2),
    osd: vhsNum("OSD Timecode", 0, 0, 1, 0.01, 2),
    noiseEvo: vhsNum("Noise Evolution", 0.5, 0, 1, 0.01, 2),
    noiseOpacity: vhsNum("Noise Opacity", 0.4, 0, 1, 0.01, 2),
    blinds: vhsNum("Blinds", 0, 0, 1, 0.01, 2),
    snowDots: vhsNum("Snow Dots", 0, 0, 1, 0.01, 2),
    speedDots: vhsNum("Speed Dots", 0, 0, 1, 0.01, 2),
    anisoSnow: vhsNum("Anisotropy Snow Dots", 0, 0, 1, 0.01, 2),
    jitterX: vhsNum("Jitter X", 0.3, 0, 1, 0.01, 2),
    jitterY: vhsNum("Jitter Y", 0.3, 0, 1, 0.01, 2),
    roll: vhsNum("Roll", 0, 0, 1, 0.01, 2),
    rollSpeed: {
        dynamic: true,
        name: "Roll Speed",
        type: PZ.property.type.NUMBER,
        value: 1.5,
        min: 0,
        max: 5,
        step: 0.1,
        decimals: 1,
    },
    persistence: vhsNum("Persistence", 0.25, 0, 1, 0.01, 2),
    // Stored seed for the seeded Glitch! button in the setup window. Hidden
    // from the property panel; the button reads and advances it, and every
    // randomized value derives from it, so the result is reproducible.
    glitchSeed: {
        name: "Glitch Seed",
        type: PZ.property.type.NUMBER,
        value: 0,
        min: 0,
        max: 9999,
        step: 1,
        decimals: 0,
        visible: false,
    },
};

module.exports = {
  VHS_TRAIL_DECAY,
  effectTime,
  loadEffectTime,
  vhsTrailMix,
  clamp01,
  readNumber,
  vhsNum,
  vhsProperties,
};

