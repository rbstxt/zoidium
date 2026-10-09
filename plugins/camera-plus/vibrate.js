// Camera+ — camera shake engine (extracted verbatim from the OpenZoid core).
    (PZ.vibrate = function () {
        (this.properties = new PZ.propertyList(PZ.vibrate.propertyDefinitions)),
            Object.defineProperty(this.properties, "displayName", { value: "Vibrate", writable: true });
    }),
    (PZ.vibrate.prototype.rand = function (e, t) {
        var r = Math.sin((e + 1) * 12.9898 + t * 78.233) * 43758.5453;
        return (r - Math.floor(r)) * 2 - 1;
    }),
    (PZ.vibrate.prototype.sample = function (e, t, r) {
        var i = Math.floor(e),
            a = e - i;
        r && (a = Math.floor(a + 0.5)), (a = a * a * (3 - 2 * a));
        var s = this.rand(i, t),
            n = this.rand(i + 1, t);
        return s * (1 - a) + n * a;
    }),
    (PZ.vibrate.prototype.apply = function (e, t, r, i) {
        if (!this.properties.enabled.get()) {
            return;
        }
        var a = this.properties.seed.get(),
            s = 1 === this.properties.regularPulse.get(),
            n = 1 === this.properties.relative.get(),
            o = ["x", "y", "z"];
        if (this.properties.enablePosition.get()) {
            var p = this.properties.positionAmplitude.get(),
                l = this.properties.positionFrequency.get();
            for (var h = 0; h < 3; h++) {
                var c = this.sample(e * l, a + 17 * h, s),
                    u = p[h] || 0;
                n && (u = u * 0.01 * Math.abs(r[h])), (t.position[o[h]] += c * u);
            }
        }
        if (this.properties.enableRotation.get()) {
            var d = this.properties.rotationAmplitude.get(),
                m = this.properties.rotationFrequency.get();
            for (var f = 0; f < 3; f++) {
                var y = this.sample(e * m, a + 101 + 17 * f, s),
                    g = d[f] || 0;
                n && (g = g * 0.01 * Math.abs(i[f])), (t.rotation[o[f]] += y * g * (Math.PI / 180));
            }
        }
    }),
    (PZ.vibrate.propertyDefinitions = {
        enabled: { name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
        regularPulse: { name: "Regular Pulse", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
        relative: { name: "Relative", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
        seed: {
            name: "Seed",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: 0,
            max: 100000,
            step: 1,
            decimals: 0,
        },
        enablePosition: { name: "Enable Position", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
        positionAmplitude: {
            name: "Position Amplitude",
            type: PZ.property.type.VECTOR3,
            value: [0, 0, 0],
            min: 0,
            step: 1,
            decimals: 2,
        },
        positionFrequency: {
            name: "Position Frequency",
            type: PZ.property.type.NUMBER,
            value: 2,
            min: 0,
            step: 0.01,
            decimals: 2,
        },
        enableRotation: { name: "Enable Rotation", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
        rotationAmplitude: {
            name: "Rotation Amplitude",
            type: PZ.property.type.VECTOR3,
            value: [0, 0, 0],
            min: 0,
            step: 1,
            decimals: 1,
        },
        rotationFrequency: {
            name: "Rotation Frequency",
            type: PZ.property.type.NUMBER,
            value: 2,
            min: 0,
            step: 0.01,
            decimals: 2,
        },
    });
