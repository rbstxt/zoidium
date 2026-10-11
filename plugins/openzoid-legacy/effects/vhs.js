// OpenZoid Legacy — VHS.
// Ported from the OpenZoid effect/vhs.js signal chain. All shaders are inline.
//
// Determinism: the tape, noise, tracking and chroma distortions are pure
// functions of time, seed-like hashes and properties. Persistence (trails) is
// the only temporal part. It averages earlier SOURCE frames requested through
// the frame sampler, so it never reads this effect's previous output.
// Trails sample earlier clip content or the composite below an Adjustment.
// The "Setup" row opens the VHS Setup floating window (vhs-setup.js).
// Split: shaders live in vhs-shaders.js, shared helpers in vhs-helpers.js
// and the VhsPass class in vhs-pass.js. They load from this plugin's bundle
// through the shared module loader; no runtime fetch is issued.

const vhsEffect = this;

const vhsParts = (function loadVhsParts() {
    const getAsset = vhsEffect && vhsEffect._zoidiumGetAsset;
    const apis = typeof ZoidiumPluginApis !== "undefined" ? ZoidiumPluginApis : null;
    const createRequire = apis && apis.modules && apis.modules.createRequire;
    if (typeof getAsset !== "function" || typeof createRequire !== "function") {
        throw new Error("VHS effect needs its bundle parts (this._zoidiumGetAsset and ZoidiumPluginApis.modules.createRequire).");
    }
    const scope = {};
    if (typeof PZ !== "undefined") scope.PZ = PZ;
    if (typeof THREE !== "undefined") scope.THREE = THREE;
    return createRequire(getAsset, { root: "./plugins/openzoid-legacy/", scope: scope });
})();

const vhsHelpers = vhsParts("./effects/vhs-helpers.js");
const VhsPass = vhsParts("./effects/vhs-pass.js").VhsPass;

ZoidiumPluginApis.defineFrameSampler.call(vhsEffect, {
    displayName: "VHS",
    properties: vhsHelpers.vhsProperties,
    // Trail taps are source frames at -1, -2, ... frames. Count grows with
    // Persistence; the host caps frame samples at 16 and we stay below 10.
    getRequest(effect, frame) {
        const amount = vhsHelpers.clamp01(vhsHelpers.readNumber(effect.properties.amount, frame, 1));
        const persistence = vhsHelpers.clamp01(vhsHelpers.readNumber(effect.properties.persistence, frame, 0.25));
        const interlace = vhsHelpers.clamp01(vhsHelpers.readNumber(effect.properties.interlace, frame, 0.4));
        const enabled = vhsHelpers.readNumber(effect.properties.enabled, frame, 1) === 1;
        return {
            enabled: enabled && vhsHelpers.vhsTrailMix(amount, persistence, interlace) > 0.001,
            count: 2 + Math.round(persistence * 8),
            offsetFrames: -1,
            startOpacity: 1,
            decay: vhsHelpers.VHS_TRAIL_DECAY,
        };
    },
    lifecycle: {
        load(data) {
            vhsEffect.pass = new VhsPass(vhsEffect);
            vhsEffect.pass.setSize(2, 2);
            vhsEffect.properties.load(data && data.properties);
            vhsHelpers.loadEffectTime(vhsEffect, data && data.properties);
        },
        update(e) {
            const pass = vhsEffect.pass;
            if (!pass) return;
            const props = vhsEffect.properties;
            const t = vhsHelpers.effectTime(vhsEffect, e);
            const amount = vhsHelpers.clamp01(props.amount.get(e));
            const s = pass.signalUniforms;
            s.time.value = t;
            s.amount.value = amount;
            s.persistence.value = vhsHelpers.clamp01(props.persistence.get(e));
            s.signalStrength.value = vhsHelpers.clamp01(props.signalStrength.get(e));
            s.colorStripes.value = vhsHelpers.clamp01(props.colorStripes.get(e));
            s.chromaCrawl.value = vhsHelpers.clamp01(props.chromaCrawl.get(e));
            s.chromaLoss.value = vhsHelpers.clamp01(props.chromaLoss.get(e));
            s.flicker.value = vhsHelpers.clamp01(props.flicker.get(e));
            s.vhsSharpen.value = vhsHelpers.clamp01(props.vhsSharpen.get(e));
            s.interlace.value = vhsHelpers.clamp01(props.interlace.get(e));
            s.staticWarp.value = vhsHelpers.clamp01(props.staticWarp.get(e));
            s.fastForward.value = vhsHelpers.clamp01(props.fastForward.get(e));
            s.tracking.value = vhsHelpers.clamp01(props.tracking.get(e));
            s.anisotropyWarp.value = vhsHelpers.clamp01(props.anisotropyWarp.get(e));
            s.rgbSplit.value = vhsHelpers.clamp01(props.rgbSplit.get(e));
            s.tear.value = vhsHelpers.clamp01(props.tear.get(e));
            s.humBar.value = vhsHelpers.clamp01(props.humBar.get(e));
            s.blueScreen.value = vhsHelpers.clamp01(props.blueScreen.get(e));
            s.skew.value = vhsHelpers.clamp01(props.skew.get(e));
            s.crease.value = vhsHelpers.clamp01(props.crease.get(e));
            s.ghost.value = vhsHelpers.clamp01(props.ghost.get(e));
            s.osd.value = vhsHelpers.clamp01(props.osd.get(e));
            s.noiseEvo.value = vhsHelpers.clamp01(props.noiseEvo.get(e));
            s.noiseOpacity.value = vhsHelpers.clamp01(props.noiseOpacity.get(e));
            s.blinds.value = vhsHelpers.clamp01(props.blinds.get(e));
            s.snowDots.value = vhsHelpers.clamp01(props.snowDots.get(e));
            s.speedDots.value = vhsHelpers.clamp01(props.speedDots.get(e));
            s.anisoSnow.value = vhsHelpers.clamp01(props.anisoSnow.get(e));
            s.jitterX.value = vhsHelpers.clamp01(props.jitterX.get(e));
            s.jitterY.value = vhsHelpers.clamp01(props.jitterY.get(e));
            s.roll.value = vhsHelpers.clamp01(props.roll.get(e));
            const rs = Number(props.rollSpeed.get(e));
            s.rollSpeed.value = isFinite(rs) ? Math.min(5, Math.max(0, rs)) : 0;

            pass.tubeUniforms.time.value = t;
            pass.tubeUniforms.amount.value = amount;
            pass.enabled = props.enabled.get(e) === 1 && amount !== 0;
        },
        unload() {
            if (vhsEffect.pass) {
                vhsEffect.pass.dispose();
            }
        },
        resize() {
            if (!vhsEffect.pass || !vhsEffect.parentLayer) {
                return;
            }
            const resolution = vhsEffect.parentLayer.properties.resolution.get();
            vhsEffect.pass.setSize(resolution[0], resolution[1]);
        },
    },
});

// CM3's layer prepare() does not forward its render context to effects.
// Lower-track media preparation still needs the sequence and project rate.
const prepareWithContext = this.prepare;
if (typeof prepareWithContext === "function") {
    this.prepare = function (frame, context) {
        if (!context || !context.sequence) {
            context = Object.assign({}, context, { sequence: this.parentProject.sequence });
        }
        return prepareWithContext.call(this, frame, context);
    };
}

