// OpenZoid Trapcode Suite — Trapcode offline audio analysis.
/*
 * trapcode-audio.js
 *
 * Deterministic offline audio analysis for the audio reactors:
 * Hann-windowed FFT levels memoized per source and time bucket.
 * Loaded after trapcode-common.js.
 */

var PZ = PZ || {};

(function () {
    PZ.trapcode = PZ.trapcode || {};
    var T = PZ.trapcode;

    /* ------------------------------------------------------------------ */
    /* Offline audio analysis                                             */
    /* ------------------------------------------------------------------ */
    // Audio reactors read decoded PCM at an explicit media time instead of a
    // live AnalyserNode, so a value depends only on the file and the time.
    // A sample is the mean of a Hann-windowed FFT of AUDIO_FFT_SIZE mono samples
    // centred on the requested time (quantized to 1 ms). Bin magnitudes are
    // mapped to dB with the AnalyserNode range (-100..-30 dB) and averaged to
    // 0..1. Silence is 0. Samples are memoized per source and time bucket.
    var AUDIO_FFT_SIZE = 2048;
    var AUDIO_MIN_DB = -100;
    var AUDIO_MAX_DB = -30;
    var AUDIO_MEMO_LIMIT = 4096;
    var AUDIO_SOURCE_LIMIT = 8;
    var audioSources = new Map();
    var audioPending = new Map();

    function audioFft(re, im) {
        var n = re.length;
        for (var i = 1, j = 0; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var tr0 = re[i]; re[i] = re[j]; re[j] = tr0;
                var ti0 = im[i]; im[i] = im[j]; im[j] = ti0;
            }
        }
        for (var len = 2; len <= n; len <<= 1) {
            var ang = (-2 * Math.PI) / len;
            var wr = Math.cos(ang);
            var wi = Math.sin(ang);
            var half = len >> 1;
            for (var s = 0; s < n; s += len) {
                var cr = 1;
                var ci = 0;
                for (var k = 0; k < half; k++) {
                    var a = s + k;
                    var b = a + half;
                    var tr = re[b] * cr - im[b] * ci;
                    var ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                    var nr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = nr;
                }
            }
        }
    }

    function audioFrameLevel(samples) {
        var n = AUDIO_FFT_SIZE;
        var re = new Float64Array(n);
        var im = new Float64Array(n);
        var windowSum = 0;
        for (var i = 0; i < n; i++) {
            var w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
            re[i] = samples[i] * w;
            windowSum += w;
        }
        audioFft(re, im);
        var total = 0;
        for (var k = 0; k < n / 2; k++) {
            var mag = (Math.sqrt(re[k] * re[k] + im[k] * im[k]) * 2) / windowSum;
            var db = 20 * Math.log(mag + 1e-12) / Math.LN10;
            total += T.clamp((db - AUDIO_MIN_DB) / (AUDIO_MAX_DB - AUDIO_MIN_DB), 0, 1);
        }
        return total / (n / 2);
    }

    // Mono mix of AUDIO_FFT_SIZE samples centred on a sample index (zero outside the buffer).
    function audioReadWindow(buffer, centre, out) {
        var channels = buffer.numberOfChannels || 1;
        var length = buffer.length;
        var start = centre - (out.length >> 1);
        out.fill(0);
        for (var c = 0; c < channels; c++) {
            var data = buffer.getChannelData(c);
            for (var i = 0; i < out.length; i++) {
                var index = start + i;
                if (index >= 0 && index < length) out[i] += data[index] / channels;
            }
        }
    }

    function audioDecodeSource(project, source) {
        var asset = project && project.assets ? project.assets.load(source) : null;
        var bytes;
        if (asset && asset.file && typeof asset.file.arrayBuffer === "function") {
            bytes = asset.file.arrayBuffer();
        } else {
            var url = asset && asset.url ? asset.url : String(source);
            bytes = fetch(url).then(function (response) {
                if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
                return response.arrayBuffer();
            });
        }
        return Promise.resolve(bytes).then(function (data) {
            var Ctor = typeof window !== "undefined"
                ? window.OfflineAudioContext || window.webkitOfflineAudioContext
                : null;
            if (!Ctor) throw new Error("Web Audio is not available");
            var context = new Ctor(1, 1, 48000);
            return new Promise(function (resolve, reject) {
                context.decodeAudioData(data, resolve, reject);
            });
        });
    }

    T.audioClipTime = function (object, source, frame, fps) {
        var sequence = T.findParent(object, PZ.sequence);
        var sceneClip = T.findParent(object, PZ.clip);
        var projectFrame = frame + (sceneClip ? sceneClip.start : 0);
        var tracks = sequence && sequence.audioTracks;
        if (tracks) {
            var first = null;
            for (var i = 0; i < tracks.length; i++) {
                var clips = tracks[i].clips || [];
                for (var j = 0; j < clips.length; j++) {
                    var clip = clips[j];
                    if (!clip.properties.media || clip.properties.media.get(projectFrame) !== source) continue;
                    if (!first) first = clip;
                    if (projectFrame < clip.start || projectFrame >= clip.start + clip.length) continue;
                    return clip.properties.time ? clip.properties.time.get(projectFrame - clip.start) : (projectFrame - clip.start) / fps;
                }
            }
            if (first) return -1;
        }
        return frame / fps;
    };

    T.audioAnalysis = {
        fftSize: AUDIO_FFT_SIZE,
        has: function (source) {
            return audioSources.has(source);
        },
        // Registers decoded PCM (an AudioBuffer-like object) under a source key.
        register: function (source, buffer) {
            audioSources.delete(source);
            audioSources.set(source, { buffer: buffer, memo: new Map() });
            while (audioSources.size > AUDIO_SOURCE_LIMIT) {
                audioSources.delete(audioSources.keys().next().value);
            }
        },
        // Level 0..1 at a media time in seconds, or null when the source is not decoded.
        levelAt: function (source, seconds) {
            var entry = audioSources.get(source);
            if (!entry || !isFinite(seconds)) return entry ? 0 : null;
            var bucket = Math.round(seconds * 1000);
            if (entry.memo.has(bucket)) return entry.memo.get(bucket);
            var frame = new Float32Array(AUDIO_FFT_SIZE);
            var centre = Math.round((bucket / 1000) * entry.buffer.sampleRate);
            audioReadWindow(entry.buffer, centre, frame);
            var level = audioFrameLevel(frame);
            if (entry.memo.size >= AUDIO_MEMO_LIMIT) entry.memo.clear();
            entry.memo.set(bucket, level);
            return level;
        },
        // Decodes the asset once; concurrent callers share one promise.
        load: function (project, source) {
            if (audioSources.has(source)) return Promise.resolve(true);
            if (audioPending.has(source)) return audioPending.get(source);
            var promise = audioDecodeSource(project, source).then(
                function (buffer) {
                    audioPending.delete(source);
                    T.audioAnalysis.register(source, buffer);
                    return true;
                },
                function (error) {
                    audioPending.delete(source);
                    throw error;
                }
            );
            audioPending.set(source, promise);
            return promise;
        },
    };
})();
