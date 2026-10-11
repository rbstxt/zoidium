// OpenZoid Trapcode Suite — Trapcode expression-method upgrade.
/*
 * trapcode-expressions.js
 *
 * The OpenZoid expression upgrade stock CM3 lacks (wiggle and
 * friends), with install/uninstall wiring. Kept here so it
 * stays unit-testable; the suite runtime wires it into the
 * live PZ instance. Loaded after trapcode-common.js.
 */

var PZ = PZ || {};

(function () {
    PZ.trapcode = PZ.trapcode || {};
    var T = PZ.trapcode;

    // OpenZoid expression methods missing from stock CM3, transcribed
    // verbatim. Installed onto PZ.expression.methods (missing keys only)
    // by the suite runtime so wiggle() and friends work on any property,
    // including Trapcode Particular parameters.
    T.expressionMethods = {
        valueAtTime: function (e, t) {
            if (!e || !e.getBaseValue) {
                return e;
            }
            var r = Object.create(Object.getPrototypeOf(e));
            Object.assign(r, e);
            r.expression = null;
            return r.getBaseValue(t);
        },
        property: function (e) {
            return e;
        },
        wiggle: function (e, t, r, i, a) {
            return this._wiggle(e, t, r, i, a, false);
        },
        _wiggle: function (e, t, r, i, a, s) {
            var n = e === undefined ? 1 : e;
            var o = t === undefined ? 1 : t;
            var oct = r === undefined ? 2 : Math.max(1, Math.round(r));
            var ampMult = i === undefined ? 0.45 : i;
            var c = a === undefined ? (this.currentFrame === undefined ? 0 : this.currentFrame) : a;
            var seed = this._propertySeed(this.currentProperty);
            var s0 = seed * 0.001,
                s1 = seed * 0.003,
                s2 = seed * 0.007;
            var ax = 0,
                ay = 0,
                az = 0,
                norm = 0;
            for (var k = 0; k < oct; k++) {
                var amp = Math.pow(ampMult, k);
                var fm = 1 + k * 0.61 + 0.23 * this.random(seed * 0.01 + k);
                var f = n * fm;
                var ph0 = this.random(s0 + k * 1.7) * 6.2831853;
                var ph1 = this.random(s1 + k * 2.9) * 6.2831853;
                var ph2 = this.random(s2 + k * 4.3) * 6.2831853;
                ax += amp * Math.sin(c * f + ph0);
                ay += amp * Math.sin(c * f * 1.17 + ph1);
                az += amp * Math.sin(c * f * 1.41 + ph2);
                norm += amp;
            }
            var nx = ax / norm,
                ny = ay / norm,
                nz = az / norm;
            var g = this.currentValue;
            if (Array.isArray(o)) {
                var b = new Array(o.length);
                for (var x = 0; x < o.length; x++) {
                    var v = [nx, ny, nz][x];
                    var w = (v === undefined ? 0 : v) * o[x];
                    var kk = Array.isArray(g) ? (g[x] === undefined ? 0 : g[x]) : g === undefined ? 0 : g;
                    b[x] = kk + w;
                }
                return b;
            }
            var w2 = nx * o;
            var x2 = Array.isArray(g) ? g[0] || 0 : g === undefined ? 0 : g;
            return x2 + w2;
        },
        _propertySeed: function (e) {
            var i = e && e.getAddress ? e.getAddress().join(".") : "0";
            var a = 0;
            for (var s = 0; s < i.length; s++) {
                a = (a * 31 + i.charCodeAt(s)) | 0;
            }
            return Math.abs(a);
        },
        _wiggleVector: function (e, t, r) {
            var i = e && e.getAddress ? e.getAddress().join(".") : "0";
            var a = 0;
            for (var s = 0; s < i.length; s++) {
                a = (a * 31 + i.charCodeAt(s)) | 0;
            }
            var n = 1000 + (a % 9000) + (r === undefined ? 0 : r) * 7919;
            var o = [1, 3];
            return [
                this.random((n * 12.9898 + t * 78.233) * o[0]) * 2 - 1,
                this.random((n * 26.651 + t * 51.777) * o[1]) * 2 - 1,
                this.random((n * 39.346 + t * 11.135) * o[0] * o[1]) * 2 - 1,
            ];
        },
        loopIn: function (e, t, r, i) {
            return e;
        },
        loopOut: function (e, t, r, i) {
            return e;
        },
        pingPong: function (e, t, r, i) {
            return e;
        },
        toFixed: function (e, t) {
            return Number(e).toFixed(t === undefined ? 0 : t);
        },
        radiansToDegrees: function (e) {
            return (e * 180) / Math.PI;
        },
        degreesToRadians: function (e) {
            return (e * Math.PI) / 180;
        },
        easeIn: function (e, t, r) {
            return PZ.tween.easing.Quadratic.In(e);
        },
        easeOut: function (e, t, r) {
            return PZ.tween.easing.Quadratic.Out(e);
        },
        easeInOut: function (e, t, r) {
            return PZ.tween.easing.Quadratic.InOut(e);
        },
    };


    // OpenZoid getBaseValue implementations, transcribed verbatim: the
    // expression-free value of a property, backing currentValue and
    // valueAtTime(). Installed missing-only onto the dynamic property
    // prototypes alongside the expression methods.
    T.getBaseValueImpls = {
        dynamic: function (e) {
            return undefined;
        },
        group: function (e) {
            for (var t = 0; t < this.objects.length; t++) {
                this.value[t] = this.objects[t].getBaseValue(e);
            }
            return this.value;
        },
        keyframes: function (e) {
            var t,
                r = this.getClosestKeyframeIndex(e),
                i = this.keyframes[r];
            if (i.frame > e && r > 0) (t = i), (i = this.keyframes[--r]);
            else {
                if (!(i.frame < e)) return i.value;
                t = this.keyframes[r + 1];
            }
            if (!t || null === PZ.tween.easingList[255 & t.tween].fn) return i.value;
            var a = Math.max((e - i.frame) / (t.frame - i.frame), 0),
                s = PZ.tween.easingList[255 & t.tween].fn(a);
            if (t.tween >> 8 == 1) {
                var r2,
                    a2 = PZ.property.dynamic.keyframes.o,
                    s2 = PZ.tween.correctCurve(i, t);
                return (r2 = PZ.tween.findZero(
                    e,
                    i.frame,
                    i.controlPoints[1][0] * s2 + i.frame,
                    t.controlPoints[0][0] * s2 + t.frame,
                    t.frame,
                    a2
                )
                    ? PZ.tween.bezier(
                          i.value,
                          i.controlPoints[1][1] * s2 + i.value,
                          t.controlPoints[0][1] * s2 + t.value,
                          t.value,
                          a2[0]
                      )
                    : i.value);
            }
            return PZ.tween.linear(i.value, t.value, s);
        },
    };
    T._expressionWiring = null;

    // Installs the OpenZoid expression upgrade into a live PZ runtime:
    // missing expression methods plus the evaluation context and the
    // property passthrough it depends on. Methods install missing-only;
    // evaluate/getters chain with revive and restore on uninstall.
    T.installExpressionSupport = function (PZ) {
        var methods = PZ.expression && PZ.expression.methods;
        if (!methods) {
            throw new Error("Trapcode Suite needs PZ.expression.methods from the CM3 runtime.");
        }
        var wiring = { keys: [], evaluate: null, getters: [] };
        var table = T.expressionMethods || {};
        var key;
        for (key in table) {
            if (!Object.prototype.hasOwnProperty.call(table, key)) continue;
            try {
                if (typeof methods[key] !== "function") {
                    methods[key] = table[key];
                    wiring.keys.push(key);
                }
            } catch (err) { /* best effort per key */ }
        }
        var proto = PZ.expression && PZ.expression.prototype;
        if (!proto || typeof proto.evaluate !== "function") {
            throw new Error("Trapcode Suite needs PZ.expression.prototype.evaluate from the CM3 runtime.");
        }
        if (proto.evaluate.__trapcodeSuite) {
            proto.evaluate.__trapcodeSuiteAlive = true;
            wiring.evaluate = proto.evaluate;
        } else {
            var originalEvaluate = proto.evaluate;
            var patchedEvaluate = function (e, t, r) {
                if (patchedEvaluate.__trapcodeSuiteAlive === false) {
                    return originalEvaluate.apply(this, arguments);
                }
                try {
                    var live = PZ.expression.methods;
                    var n;
                    try {
                        n = r && typeof r.getBaseValue === "function" ? r.getBaseValue(e) : undefined;
                    } catch (_e) {
                        // Unreadable base value: the context carries undefined.
                        n = undefined;
                    }
                    if (live) {
                        try {
                            live.currentFrame = e;
                            live.currentProperty = r || null;
                            live.currentValue = n;
                        } catch (_e) { /* context is best effort */ }
                    }
                    // OpenZoid call shape (frame, time, methods, custom,
                    // parentObject, property, baseValue). Functions compiled
                    // by the stock parser only declare the first four
                    // parameters and ignore the rest.
                    var time = 0;
                    try {
                        var clip = t && t.tryGetParentOfType && PZ.clip
                            ? T.findParent(t, PZ.clip)
                            : null;
                        time = clip ? clip.properties.time.get(e) : 0;
                    } catch (_e) { /* keep default */ }
                    var custom = {};
                    try {
                        custom = this.getCustomProperties(e, t);
                    } catch (_e) { /* keep default */ }
                    var parentObject = null;
                    try {
                        parentObject = t ? t.parentObject : null;
                    } catch (_e) { /* keep default */ }
                    return this.fn(e, time, live, custom, parentObject, r, n);
                } catch (_err) { /* fall through to stock */ }
                return originalEvaluate.apply(this, arguments);
            };
            patchedEvaluate.__trapcodeSuite = true;
            patchedEvaluate.__trapcodeSuiteAlive = true;
            patchedEvaluate.__trapcodeSuiteOriginal = originalEvaluate;
            proto.evaluate = patchedEvaluate;
            wiring.evaluate = patchedEvaluate;
        }
        var getterProtos = [];
        var baseProtos = [];
        try {
            if (PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype &&
                typeof PZ.property.dynamic.prototype.get === "function") {
                getterProtos.push(PZ.property.dynamic.prototype);
            }
            if (PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                PZ.property.dynamic.group.prototype &&
                typeof PZ.property.dynamic.group.prototype.get === "function") {
                getterProtos.push(PZ.property.dynamic.group.prototype);
            }
            if (PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                PZ.property.dynamic.keyframes.prototype &&
                typeof PZ.property.dynamic.keyframes.prototype.get === "function") {
                getterProtos.push(PZ.property.dynamic.keyframes.prototype);
            }
        } catch (_err) { /* missing subtree: throws below when no getters were found */ }
        if (!getterProtos.length) {
            throw new Error("Trapcode Suite needs dynamic property getters from the CM3 runtime.");
        }
        for (var g = 0; g < getterProtos.length; g++) {
            (function (target) {
                try {
                    if (target.get.__trapcodeSuite) {
                        target.get.__trapcodeSuiteAlive = true;
                        wiring.getters.push(target.get);
                        return;
                    }
                    var originalGet = target.get;
                    var patchedGet = function (e) {
                        if (patchedGet.__trapcodeSuiteAlive !== false &&
                            this.expression !== null && this.expression) {
                            try {
                                return this.expression.evaluate(e, this.parentObject, this);
                            } catch (_err) { /* fall through to stock */ }
                        }
                        return originalGet.call(this, e);
                    };
                    patchedGet.__trapcodeSuite = true;
                    patchedGet.__trapcodeSuiteAlive = true;
                    patchedGet.__trapcodeSuiteOriginal = originalGet;
                    target.get = patchedGet;
                    wiring.getters.push(patchedGet);
                } catch (_err) { /* best effort per getter */ }
            })(getterProtos[g]);
        }
        // Expression-free base values backing currentValue/valueAtTime.
        var baseImpls = T.getBaseValueImpls || {};
        var baseKinds = ["dynamic", "group", "keyframes"];
        var baseHolders = [
            PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype,
            PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                PZ.property.dynamic.group.prototype,
            PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                PZ.property.dynamic.keyframes.prototype,
        ];
        wiring.baseValues = [];
        for (var b = 0; b < baseHolders.length; b++) {
            try {
                // Own-property check: subclasses inherit the base
                // implementation, which must not shadow their own.
                if (baseHolders[b] && !Object.prototype.hasOwnProperty.call(baseHolders[b], "getBaseValue") &&
                    typeof baseImpls[baseKinds[b]] === "function") {
                    baseHolders[b].getBaseValue = baseImpls[baseKinds[b]];
                    wiring.baseValues.push(baseKinds[b]);
                }
            } catch (_err) { /* best effort per prototype */ }
        }
        T._expressionWiring = wiring;
    };

    T.uninstallExpressionSupport = function (PZ) {
        var wiring = T._expressionWiring;
        T._expressionWiring = null;
        if (!wiring) return;
        var i, ref;
        var refs = [wiring.evaluate].concat(wiring.getters || []);
        for (i = 0; i < refs.length; i++) {
            try {
                if (refs[i]) refs[i].__trapcodeSuiteAlive = false;
            } catch (_error) { /* best effort */ }
        }
        try {
            if (PZ && PZ.expression && PZ.expression.prototype &&
                wiring.evaluate && PZ.expression.prototype.evaluate === wiring.evaluate &&
                wiring.evaluate.__trapcodeSuiteOriginal) {
                PZ.expression.prototype.evaluate = wiring.evaluate.__trapcodeSuiteOriginal;
            }
        } catch (_error) { /* best effort */ }
        var protos = [];
        try {
            if (PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype) {
                protos.push(PZ.property.dynamic.prototype);
            }
            if (PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                PZ.property.dynamic.group.prototype) {
                protos.push(PZ.property.dynamic.group.prototype);
            }
            if (PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                PZ.property.dynamic.keyframes.prototype) {
                protos.push(PZ.property.dynamic.keyframes.prototype);
            }
        } catch (_error) { /* best effort */ }
        for (i = 0; i < protos.length; i++) {
            try {
                for (var g = 0; g < (wiring.getters || []).length; g++) {
                    ref = wiring.getters[g];
                    if (protos[i].get === ref && ref.__trapcodeSuiteOriginal) {
                        protos[i].get = ref.__trapcodeSuiteOriginal;
                        break;
                    }
                }
            } catch (_error) { /* best effort */ }
        }
        try {
            var methods = PZ && PZ.expression && PZ.expression.methods;
            var table = T.expressionMethods || {};
            for (i = 0; i < (wiring.keys || []).length; i++) {
                try {
                    if (methods && methods[wiring.keys[i]] === table[wiring.keys[i]]) {
                        delete methods[wiring.keys[i]];
                    }
                } catch (_error) { /* best effort per key */ }
            }
        } catch (_error) { /* best effort */ }
        try {
            var impls = T.getBaseValueImpls || {};
            var kinds = ["dynamic", "group", "keyframes"];
            var holders = [
                PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.prototype,
                PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.group &&
                    PZ.property.dynamic.group.prototype,
                PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes &&
                    PZ.property.dynamic.keyframes.prototype,
            ];
            for (i = 0; i < kinds.length; i++) {
                try {
                    if ((wiring.baseValues || []).indexOf(kinds[i]) >= 0 &&
                        holders[i] && holders[i].getBaseValue === impls[kinds[i]]) {
                        delete holders[i].getBaseValue;
                    }
                } catch (_error) { /* best effort per prototype */ }
            }
        } catch (_error) { /* best effort */ }
    };
})();
