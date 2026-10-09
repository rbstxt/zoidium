var PZ = PZ || {};

// ---------------------------------------------------------------------------
// PZ.datamoshRender — render-time TRUE datamosh (byte-exact I-frame kills)
//
// The realtime Datamosh effect simulates motion-vector smear. This module does
// the real thing after export: it parses the rendered WebM/Matroska (VP8/VP9)
// file, finds video keyframes (I-frames) and deletes them at the container
// level, then rebuilds the file with corrected EBML sizes.
//
// Decoders then predict P-frames from whatever pixels came before the cut,
// which is exactly the classic datamosh bleed. Audio passes through untouched.
// Seeking inside a moshed file is imprecise (Cues are dropped) — expected,
// same as every datamosh tool.
//
// No dependencies. Works in the browser and in Node (for tests).
// ---------------------------------------------------------------------------

PZ.datamoshRender = (function () {
    "use strict";

    var ID = {
        EBML: 0x1a45dfa3,
        SEGMENT: 0x18538067,
        SEEKHEAD: 0x114d9b74,
        SEEK: 0x4dbb,
        SEEKID: 0x53ab,
        SEEKPOS: 0x53ac,
        INFO: 0x1549a966,
        TS_SCALE: 0x2ad7b1,
        DURATION: 0x4489,
        TRACKS: 0x1654ae6b,
        TRACKENTRY: 0xae,
        TRACKNUM: 0xd7,
        CODECID: 0x86,
        CLUSTER: 0x1f43b675,
        TIMECODE: 0xe7,
        SIMPLEBLOCK: 0xa3,
        BLOCKGROUP: 0xa0,
        BLOCK: 0xa1,
        BLOCKDUR: 0x9b,
        REFBLOCK: 0xfb,
        CUES: 0x1c53bb6b,
        VOID: 0xec
    };

    var CONTAINER_IDS = {};
    [ID.EBML, ID.SEGMENT, ID.SEEKHEAD, ID.SEEK, ID.INFO, ID.TRACKS,
     ID.TRACKENTRY, ID.CLUSTER, ID.BLOCKGROUP, ID.CUES].forEach(function (k) {
        CONTAINER_IDS[k] = true;
    });

    function idLength(firstByte) {
        var mask = 0x80;
        var len = 1;
        while (len <= 4 && !(firstByte & mask)) {
            mask >>= 1;
            len++;
        }
        return len;
    }

    function readID(bytes, pos) {
        var len = idLength(bytes[pos]);
        var id = 0;
        for (var i = 0; i < len; i++) {
            id = id * 256 + bytes[pos + i];
        }
        return { id: id >>> 0, len: len };
    }

    function vintLength(firstByte) {
        var mask = 0x80;
        var len = 1;
        while (len <= 8 && !(firstByte & mask)) {
            mask >>= 1;
            len++;
        }
        return len;
    }

    // Returns {value, len}. value === -1 means unknown size (all bits set).
    function readVint(bytes, pos) {
        var len = vintLength(bytes[pos]);
        var mask = 0x80 >> (len - 1);
        var value = bytes[pos] & (mask - 1);
        var allSet = (bytes[pos] & (mask - 1)) === (mask - 1);
        for (var i = 1; i < len; i++) {
            value = value * 256 + bytes[pos + i];
            if (bytes[pos + i] !== 0xff) allSet = false;
        }
        if (len === 8 && value > 9007199254740991) {
            return { value: -1, len: len };
        }
        return { value: allSet ? -1 : value, len: len };
    }

    function encodeVint(value) {
        var len = 1;
        while (len < 8 && value >= Math.pow(2, 7 * len) - 1) {
            len++;
        }
        var out = new Uint8Array(len);
        var v = value;
        for (var i = len - 1; i >= 0; i--) {
            out[i] = v & 0xff;
            v = Math.floor(v / 256);
        }
        out[0] |= 0x80 >> (len - 1);
        return out;
    }

    function readUint(bytes, pos, len) {
        var v = 0;
        for (var i = 0; i < len; i++) {
            v = v * 256 + bytes[pos + i];
        }
        return v;
    }

    function parseChildren(bytes, start, end) {
        var els = [];
        var pos = start;
        while (pos < end) {
            if (pos + 2 > bytes.length) break;
            var id = readID(bytes, pos);
            var sz = readVint(bytes, pos + id.len);
            var dataStart = pos + id.len + sz.len;
            var dataEnd = sz.value === -1 ? end : dataStart + sz.value;
            if (dataEnd > end) dataEnd = end;
            els.push({
                id: id.id,
                idStart: pos,
                idLen: id.len,
                sizeLen: sz.len,
                unknown: sz.value === -1,
                dataStart: dataStart,
                dataEnd: dataEnd,
                totalEnd: dataEnd
            });
            if (dataEnd <= pos) break;
            pos = dataEnd;
        }
        return els;
    }

    function findChild(bytes, els, id) {
        for (var i = 0; i < els.length; i++) {
            if (els[i].id === id) return els[i];
        }
        return null;
    }

    function readTrackVint(bytes, pos) {
        // Block-header track numbers use EBML vint width rules, but the value
        // excludes the length-marker bit (muxers write track 1 as 0x81).
        var v = readVint(bytes, pos);
        return { value: v.value, len: v.len };
    }

    function parseTracks(bytes, tracksEl) {
        var out = [];
        var entries = parseChildren(bytes, tracksEl.dataStart, tracksEl.dataEnd);
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].id !== ID.TRACKENTRY) continue;
            var fields = parseChildren(bytes, entries[i].dataStart, entries[i].dataEnd);
            var num = null;
            var codec = "";
            for (var j = 0; j < fields.length; j++) {
                if (fields[j].id === ID.TRACKNUM) {
                    num = readUint(bytes, fields[j].dataStart, fields[j].dataEnd - fields[j].dataStart);
                } else if (fields[j].id === ID.CODECID) {
                    var chars = [];
                    for (var k = fields[j].dataStart; k < fields[j].dataEnd; k++) {
                        chars.push(String.fromCharCode(bytes[k]));
                    }
                    codec = chars.join("").replace(/\0/g, "");
                }
            }
            if (num !== null) {
                out.push({
                    number: num,
                    codec: codec,
                    isVideo: codec === "V_VP8" || codec === "V_VP9"
                });
            }
        }
        return out;
    }

    function parseInfo(bytes, infoEl) {
        var scale = 1000000;
        var kids = parseChildren(bytes, infoEl.dataStart, infoEl.dataEnd);
        var sc = findChild(bytes, kids, ID.TS_SCALE);
        if (sc) {
            scale = readUint(bytes, sc.dataStart, sc.dataEnd - sc.dataStart) || 1000000;
        }
        return { timeScale: scale };
    }

    // Parse one SimpleBlock/Block payload header.
    // hasFlags is true for SimpleBlock (flags byte after timecode), false
    // for Block inside a BlockGroup (frames start right after timecode).
    // Returns {track, trackLen, rel, flags, framesStart} or null.
    function parseBlockHeader(bytes, dataStart, dataEnd, hasFlags) {
        var need = hasFlags ? 4 : 3;
        if (dataStart + need > dataEnd) return null;
        var t = readTrackVint(bytes, dataStart);
        if (t.value < 0 || dataStart + t.len + need - 1 > dataEnd) return null;
        var p = dataStart + t.len;
        var rel = (bytes[p] << 8) | bytes[p + 1];
        if (rel & 0x8000) rel -= 0x10000;
        var flags = hasFlags ? bytes[p + 2] : 0;
        return {
            track: t.value,
            trackLen: t.len,
            rel: rel,
            flags: flags,
            framesStart: p + (hasFlags ? 3 : 2)
        };
    }

    function lacingType(flags) {
        return (flags >> 1) & 0x03;
    }

    // Offset of the first frame's payload relative to framesStart, for the
    // payload-verification read. Returns -1 when it cannot be determined.
    function firstFrameOffset(bytes, framesStart, framesEnd, lace) {
        if (lace === 0) return 0;
        if (framesStart + 1 > framesEnd) return -1;
        var count = bytes[framesStart] + 1;
        var p = framesStart + 1;
        if (lace === 3) {
            // Fixed-size lacing: frames share the payload equally.
            return p - framesStart;
        }
        var i;
        if (lace === 1) {
            // Xiph lacing: (count-1) size bytes, continuation bit 0x80... in
            // Xiph each size is a series of 0xFF bytes + terminator.
            for (i = 0; i < count - 1; i++) {
                var done = false;
                while (p < framesEnd) {
                    var b = bytes[p++];
                    if (b !== 0xff) { done = true; break; }
                }
                if (!done) return -1;
            }
            return p - framesStart;
        }
        if (lace === 2) {
            // EBML lacing: first size is a vint, rest are biased vint diffs.
            if (p >= framesEnd) return -1;
            var first = readVint(bytes, p);
            p += first.len;
            for (i = 1; i < count - 1; i++) {
                if (p >= framesEnd) return -1;
                var d = readVint(bytes, p);
                p += d.len;
            }
            return p - framesStart;
        }
        return -1;
    }

    function vp8IsKeyframeByte(b) {
        return (b & 0x01) === 0;
    }

    function trackByNumber(tracks, num) {
        for (var i = 0; i < tracks.length; i++) {
            if (tracks[i].number === num) return tracks[i];
        }
        return null;
    }

    function inRanges(tsMs, ranges) {
        for (var i = 0; i < ranges.length; i++) {
            if (tsMs >= ranges[i][0] && tsMs <= ranges[i][1]) return true;
        }
        return false;
    }

    function concat(parts) {
        var total = 0;
        var i;
        for (i = 0; i < parts.length; i++) total += parts[i].length;
        var out = new Uint8Array(total);
        var off = 0;
        for (i = 0; i < parts.length; i++) {
            out.set(parts[i], off);
            off += parts[i].length;
        }
        return out;
    }

    function rawEl(bytes, el) {
        return bytes.subarray(el.idStart, el.totalEnd);
    }

    function buildElement(idBytes, payload) {
        return concat([idBytes, encodeVint(payload.length), payload]);
    }

    function idBytes(bytes, el) {
        return bytes.subarray(el.idStart, el.idStart + el.idLen);
    }

    function analyze(bytes) {
        var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        var top = parseChildren(u8, 0, u8.length);
        var seg = findChild(u8, top, ID.SEGMENT);
        if (!seg) throw new Error("No Segment found (not a WebM/Matroska file?)");
        var segKids = parseChildren(u8, seg.dataStart, seg.dataEnd);
        var tracksEl = findChild(u8, segKids, ID.TRACKS);
        var infoEl = findChild(u8, segKids, ID.INFO);
        var tracks = tracksEl ? parseTracks(u8, tracksEl) : [];
        var scale = infoEl ? parseInfo(u8, infoEl).timeScale : 1000000;
        return { u8: u8, top: top, seg: seg, segKids: segKids, tracks: tracks, scale: scale };
    }

    function collectFrames(ctx) {
        // Walk clusters in file order, return frame records for video blocks.
        var u8 = ctx.u8;
        var frames = [];
        var clusters = [];
        for (var i = 0; i < ctx.segKids.length; i++) {
            if (ctx.segKids[i].id === ID.CLUSTER) clusters.push(ctx.segKids[i]);
        }
        for (var c = 0; c < clusters.length; c++) {
            var kids = parseChildren(u8, clusters[c].dataStart, clusters[c].dataEnd);
            var tcEl = findChild(u8, kids, ID.TIMECODE);
            var base = tcEl ? readUint(u8, tcEl.dataStart, tcEl.dataEnd - tcEl.dataStart) : 0;
            for (var k = 0; k < kids.length; k++) {
                var el = kids[k];
                if (el.id === ID.SIMPLEBLOCK) {
                    var h = parseBlockHeader(u8, el.dataStart, el.dataEnd, true);
                    if (!h) continue;
                    var tr = trackByNumber(ctx.tracks, h.track);
                    if (!tr || !tr.isVideo) continue;
                    var keyFlag = (h.flags & 0x80) !== 0;
                    var verified = null;
                    if (tr.codec === "V_VP8") {
                        var off = firstFrameOffset(u8, h.framesStart, el.dataEnd, lacingType(h.flags));
                        if (off >= 0 && h.framesStart + off < el.dataEnd) {
                            verified = vp8IsKeyframeByte(u8[h.framesStart + off]);
                        }
                    }
                    frames.push({
                        kind: "simple", el: el, track: tr,
                        ts: (base + h.rel) * ctx.scale / 1000000,
                        keyFlag: keyFlag, verified: verified
                    });
                } else if (el.id === ID.BLOCKGROUP) {
                    var inner = parseChildren(u8, el.dataStart, el.dataEnd);
                    var blockEl = findChild(u8, inner, ID.BLOCK);
                    if (!blockEl) continue;
                    var bh = parseBlockHeader(u8, blockEl.dataStart, blockEl.dataEnd, false);
                    if (!bh) continue;
                    var btr = trackByNumber(ctx.tracks, bh.track);
                    if (!btr || !btr.isVideo) continue;
                    var hasRef = !!findChild(u8, inner, ID.REFBLOCK);
                    var bver = null;
                    var bframes = bh.framesStart;
                    if (btr.codec === "V_VP8" && bframes < blockEl.dataEnd) {
                        bver = vp8IsKeyframeByte(u8[bframes]);
                    }
                    frames.push({
                        kind: "group", el: el, track: btr,
                        ts: (base + bh.rel) * ctx.scale / 1000000,
                        keyFlag: !hasRef, verified: bver
                    });
                }
            }
        }
        return { frames: frames, clusters: clusters };
    }

    function isKeyframe(f) {
        if (f.verified !== null && f.verified !== undefined) {
            return f.keyFlag && f.verified;
        }
        return f.keyFlag;
    }

    function probe(input) {
        var ctx = analyze(input);
        var cf = collectFrames(ctx);
        var keys = [];
        for (var i = 0; i < cf.frames.length; i++) {
            if (isKeyframe(cf.frames[i])) {
                keys.push({ ts: cf.frames[i].ts, track: cf.frames[i].track.number });
            }
        }
        return {
            tracks: ctx.tracks.map(function (t) {
                return { number: t.number, codec: t.codec, isVideo: t.isVideo };
            }),
            videoFrames: cf.frames.length,
            keyframes: keys,
            clusters: cf.clusters.length
        };
    }

    function mosh(input, opts) {
        opts = opts || {};
        var ranges = opts.rangesMs || [[0, 9007199254740991]];
        var ctx = analyze(input);
        var u8 = ctx.u8;
        var cf = collectFrames(ctx);
        var frames = cf.frames;

        var drop = [];
        var keptFirst = false;
        var dropped = 0;
        var keptInRange = 0;
        var keyTotal = 0;
        for (var i = 0; i < frames.length; i++) {
            if (!isKeyframe(frames[i])) continue;
            keyTotal++;
            if (!keptFirst) {
                keptFirst = true;
                continue;
            }
            if (inRanges(frames[i].ts, ranges)) {
                drop.push(frames[i].el);
                dropped++;
            } else {
                keptInRange++;
            }
        }
        var dropSet = {};
        for (var d = 0; d < drop.length; d++) {
            dropSet[drop[d].idStart] = true;
        }

        // Rebuild clusters.
        var firstChanged = -1;
        var newSegParts = [];
        var segBase = ctx.seg.dataStart;
        var offset = 0; // segment-relative write cursor for offset math
        var out = [];
        var k;
        for (k = 0; k < ctx.segKids.length; k++) {
            var el = ctx.segKids[k];
            if (el.id === ID.CUES) {
                if (firstChanged < 0) firstChanged = el.idStart - segBase;
                continue; // stale seek index — drop (sequential playback unaffected)
            }
            if (el.id === ID.SEEKHEAD) {
                continue; // rebuilt below with corrected offsets
            }
            if (el.id === ID.CLUSTER) {
                var kids = parseChildren(u8, el.dataStart, el.dataEnd);
                var kept = [];
                var changed = false;
                for (var m = 0; m < kids.length; m++) {
                    if (dropSet[kids[m].idStart]) {
                        changed = true;
                        continue;
                    }
                    kept.push(rawEl(u8, kids[m]));
                }
                if (changed && firstChanged < 0) firstChanged = el.idStart - segBase;
                var payload = concat(kept);
                out.push(buildElement(idBytes(u8, el), payload));
                continue;
            }
            out.push(rawEl(u8, el));
        }

        // Rebuild SeekHead: keep entries for surviving elements with fixed offsets.
        var seekKids = null;
        for (k = 0; k < ctx.segKids.length; k++) {
            if (ctx.segKids[k].id === ID.SEEKHEAD) {
                seekKids = parseChildren(u8, ctx.segKids[k].dataStart, ctx.segKids[k].dataEnd);
                break;
            }
        }
        // Compute new segment-relative offsets of surviving top-level elements.
        var cursor = 0;
        var offsetOf = {};
        var order = [];
        for (k = 0; k < ctx.segKids.length; k++) {
            var e2 = ctx.segKids[k];
            if (e2.id === ID.CUES || e2.id === ID.SEEKHEAD) continue;
            order.push(e2);
        }
        // We need lengths: clusters rebuilt above; recompute in same order.
        var builtParts = [];
        var bi = 0;
        for (k = 0; k < ctx.segKids.length; k++) {
            var e3 = ctx.segKids[k];
            if (e3.id === ID.CUES || e3.id === ID.SEEKHEAD) continue;
            builtParts.push(out[bi++]);
        }
        for (k = 0; k < order.length; k++) {
            offsetOf[order[k].idStart] = cursor;
            cursor += builtParts[k].length;
        }
        var newSeeks = [];
        if (seekKids) {
            for (k = 0; k < seekKids.length; k++) {
                if (seekKids[k].id !== ID.SEEK) continue;
                var sk = parseChildren(u8, seekKids[k].dataStart, seekKids[k].dataEnd);
                var sidEl = findChild(u8, sk, ID.SEEKID);
                var sposEl = findChild(u8, sk, ID.SEEKPOS);
                if (!sidEl || !sposEl) continue;
                var targetId = readUint(u8, sidEl.dataStart, sidEl.dataEnd - sidEl.dataStart);
                if (targetId === ID.CUES) continue;
                var oldOff = readUint(u8, sposEl.dataStart, sposEl.dataEnd - sposEl.dataStart);
                // Find surviving element with matching id at/near old offset.
                var match = null;
                for (var q = 0; q < order.length; q++) {
                    if (order[q].id !== targetId) continue;
                    var oldRel = order[q].idStart - segBase;
                    if (firstChanged < 0 || oldRel < firstChanged || oldRel === oldOff) {
                        match = order[q];
                        if (oldRel === oldOff) break;
                    }
                }
                if (!match) continue;
                var newOff = offsetOf[match.idStart];
                var sidRaw = rawEl(u8, sidEl);
                var posPayload = encodePos(newOff, sposEl.dataEnd - sposEl.dataStart);
                var seekPayload = concat([sidRaw, buildElement(idBytes(u8, sposEl), posPayload)]);
                var seekHeadEntry = null;
                // wrap in Seek element with original id bytes
                newSeeks.push(buildElement(idBytes(u8, seekKids[k]), seekPayload));
            }
        }
        if (newSeeks.length) {
            var seekHeadPayload = concat(newSeeks);
            // Insert SeekHead right where the old one was (position among survivors).
            var insertAt = 0;
            for (k = 0; k < ctx.segKids.length; k++) {
                if (ctx.segKids[k].id === ID.SEEKHEAD) break;
                if (ctx.segKids[k].id === ID.CUES) continue;
                insertAt++;
            }
            var shId = null;
            for (k = 0; k < ctx.segKids.length; k++) {
                if (ctx.segKids[k].id === ID.SEEKHEAD) {
                    shId = idBytes(u8, ctx.segKids[k]);
                    break;
                }
            }
            if (!shId) {
                shId = new Uint8Array([0x11, 0x4d, 0x9b, 0x74]);
            }
            builtParts.splice(insertAt, 0, buildElement(shId, seekHeadPayload));
            // Recompute offsets after insertion (only used for nothing further — fine).
        }

        var segPayload = concat(builtParts);
        var segHead = concat([idBytes(u8, ctx.seg), encodeVint(segPayload.length)]);
        var head = u8.subarray(0, ctx.seg.idStart);
        var tail = [];
        for (k = 0; k < ctx.top.length; k++) {
            if (ctx.top[k].id === ID.SEGMENT || ctx.top[k].totalEnd <= ctx.seg.idStart) continue;
            tail.push(rawEl(u8, ctx.top[k]));
        }
        var result = concat([head, segHead, segPayload].concat(tail));
        return {
            bytes: result,
            stats: {
                videoFrames: frames.length,
                keyframes: keyTotal,
                dropped: dropped,
                keptKeyframes: keyTotal - dropped,
                outBytes: result.length,
                inBytes: u8.length
            }
        };
    }

    function encodePos(value, minLen) {
        var out = [];
        var v = value;
        var tmp = [];
        if (v === 0) tmp.push(0);
        while (v > 0) {
            tmp.unshift(v & 0xff);
            v = Math.floor(v / 256);
        }
        while (tmp.length < minLen) tmp.unshift(0);
        return new Uint8Array(tmp);
    }

    function cutTimesMs(sequence) {
        var times = {};
        try {
            var rate = sequence.properties.rate.get() || 30;
            var tracks = sequence.videoTracks;
            for (var i = 0; i < tracks.length; i++) {
                var clips = tracks[i].clips;
                if (!clips) continue;
                for (var j = 0; j < clips.length; j++) {
                    var c = clips[j];
                    if (!c) continue;
                    var s = Math.round(c.start / rate * 1000);
                    var e = Math.round((c.start + c.length) / rate * 1000);
                    times[s] = true;
                    times[e] = true;
                }
            }
        } catch (err) {
            return [];
        }
        var arr = Object.keys(times).map(function (k) { return Number(k); });
        arr.sort(function (a, b) { return a - b; });
        return arr;
    }

    function rangesAroundCuts(cutMs, windowMs) {
        var w = windowMs == null ? 300 : windowMs;
        return cutMs.map(function (t) {
            return [Math.max(0, t - w), t + w];
        });
    }

    return {
        probe: probe,
        mosh: mosh,
        cutTimesMs: cutTimesMs,
        rangesAroundCuts: rangesAroundCuts
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = PZ.datamoshRender;
}
