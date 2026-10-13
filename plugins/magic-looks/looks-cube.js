"use strict";

// Adobe/Resolve 3D .cube parser and WebGL1 byte atlases. Red varies fastest.
// Each output channel occupies a separate RGBA atlas containing IEEE float32
// bytes. This preserves negative/HDR outputs without requiring float textures.
var Looks = Looks || {};

(function (Looks) {
  var cube = { MIN_SIZE: 2, MAX_SIZE: 128, MAX_TEXT_LENGTH: 80 * 1024 * 1024, CUSTOM_NAME: "Custom" };
  function fail(line, message) {
    throw new Error("Invalid .cube LUT (line " + line + "): " + message + ".");
  }
  function number(token, line) {
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(token)) fail(line, "values must be finite numbers");
    var value = Math.fround(Number(token));
    if (!isFinite(value)) fail(line, "values must be finite and fit the GPU float range");
    return value;
  }
  function parseCubeLut(text) {
    if (typeof text !== "string") throw new Error("Invalid .cube LUT: the file is not text.");
    if (text.length > cube.MAX_TEXT_LENGTH) throw new Error("Invalid .cube LUT: the file is larger than 80 MB.");
    var title = "", size = 0, data = null, count = 0, lineNo = 0;
    var dmin = [0, 0, 0], dmax = [1, 1, 1], seen = {};
    // Walk lines without retaining an array of millions of row strings.
    var start = 0;
    while (start < text.length) {
      var end = start;
      while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end++;
      var line = text.slice(start, end).trim();
      start = end + (text[end] === "\r" && text[end + 1] === "\n" ? 2 : 1);
      lineNo++;
      if (!line || line[0] === "#") continue;
      if (/^TITLE(\s|$)/i.test(line)) {
        var match = /^TITLE\s+"([^"\r\n]*)"\s*(?:#.*)?$/i.exec(line);
        if (!match) fail(lineNo, 'TITLE must be a quoted string (TITLE "name")');
        if (seen.TITLE) fail(lineNo, "duplicate TITLE");
        seen.TITLE = true;
        title = match[1].slice(0, 256);
        continue;
      }
      line = line.split("#", 1)[0].trim();
      var tokens = line.split(/\s+/), head = tokens[0].toUpperCase();
      if (head === "LUT_1D_SIZE") {
        throw new Error("Invalid .cube LUT: 1D LUTs and combined 1D/3D LUTs are not supported. Import a 3D LUT with LUT_3D_SIZE.");
      }
      if (head === "LUT_3D_SIZE") {
        if (size) fail(lineNo, "duplicate LUT_3D_SIZE");
        if (tokens.length !== 2 || !/^\d+$/.test(tokens[1])) fail(lineNo, "LUT_3D_SIZE needs one integer");
        size = Number(tokens[1]);
        if (size < 2 || size > 128) fail(lineNo, "LUT_3D_SIZE must be an integer 2..128");
        data = new Float32Array(size * size * size * 3);
      } else if (head === "DOMAIN_MIN" || head === "DOMAIN_MAX") {
        if (seen[head]) fail(lineNo, "duplicate " + head);
        seen[head] = true;
        if (tokens.length !== 4 && tokens.length !== 2) fail(lineNo, head + " needs one or three numbers");
        var values = tokens.slice(1).map(function (v) { return number(v, lineNo); });
        if (values.length === 1) values = [values[0], values[0], values[0]];
        if (head === "DOMAIN_MIN") dmin = values; else dmax = values;
      } else {
        if (!size) fail(lineNo, "data rows need a LUT_3D_SIZE header first");
        if (tokens.length !== 3) fail(lineNo, "each data row must hold exactly three numbers");
        if (count >= size * size * size) fail(lineNo, "too many data rows");
        for (var c = 0; c < 3; c++) data[count * 3 + c] = number(tokens[c], lineNo);
        count++;
      }
    }
    if (!size) throw new Error("Invalid .cube LUT: the file has no LUT_3D_SIZE header.");
    for (var i = 0; i < 3; i++) {
      if (!(dmin[i] < dmax[i]) || !isFinite(Math.fround(dmax[i] - dmin[i]))) {
        throw new Error("Invalid .cube LUT: DOMAIN_MIN must be below DOMAIN_MAX with a finite GPU range.");
      }
    }
    if (count !== size * size * size) throw new Error("Invalid .cube LUT: a " + size + "^3 LUT holds " +
      size * size * size + " data rows but " + count + " were found.");
    return { title: title, size: size, dmin: dmin, dmax: dmax, data: data };
  }
  cube.parseCubeLut = parseCubeLut;
  function layoutFor(size) {
    var cols = Math.ceil(Math.sqrt(size)), rows = Math.ceil(size / cols);
    return { cols: cols, rows: rows, width: size * cols, height: size * rows };
  }
  cube.layoutFor = layoutFor;
  function buildAtlas(parsed) {
    var n = parsed.size, layout = layoutFor(n), views = [];
    var channels = [0, 1, 2].map(function () {
      var bytes = new Uint8Array(layout.width * layout.height * 4);
      views.push(new DataView(bytes.buffer));
      return bytes;
    });
    for (var b = 0; b < n; b++) for (var g = 0; g < n; g++) for (var r = 0; r < n; r++) {
      var src = ((b * n + g) * n + r) * 3;
      var x = (b % layout.cols) * n + r, y = Math.floor(b / layout.cols) * n + g;
      for (var c = 0; c < 3; c++) views[c].setFloat32((y * layout.width + x) * 4, parsed.data[src + c], true);
    }
    return { title: parsed.title, size: n, cols: layout.cols, rows: layout.rows,
      width: layout.width, height: layout.height, channels: channels, views: views,
      dmin: parsed.dmin.slice(), dmax: parsed.dmax.slice() };
  }
  cube.buildAtlas = buildAtlas;
  function sampleAtlas(atlas, r, g, b) {
    var n = atlas.size;
    var t = [r, g, b].map(function (v, c) {
      return Math.min(1, Math.max(0, (v - atlas.dmin[c]) / (atlas.dmax[c] - atlas.dmin[c]))) * (n - 1);
    });
    var lo = t.map(Math.floor), f = t.map(function (v, c) { return v - lo[c]; });
    var out = [0, 0, 0];
    for (var z = 0; z < 2; z++) for (var y = 0; y < 2; y++) for (var x = 0; x < 2; x++) {
      var ri = Math.min(n - 1, lo[0] + x), gi = Math.min(n - 1, lo[1] + y), bi = Math.min(n - 1, lo[2] + z);
      var ax = (bi % atlas.cols) * n + ri, ay = Math.floor(bi / atlas.cols) * n + gi;
      var weight = (x ? f[0] : 1 - f[0]) * (y ? f[1] : 1 - f[1]) * (z ? f[2] : 1 - f[2]);
      for (var c = 0; c < 3; c++) out[c] += atlas.views[c].getFloat32((ay * atlas.width + ax) * 4, true) * weight;
    }
    return out;
  }
  cube.sampleAtlas = sampleAtlas;
  cube.describe = function (atlas) {
    return atlas ? 'Custom LUT "' + (atlas.title || "Untitled") + '" (' +
      atlas.size + "x" + atlas.size + "x" + atlas.size + ")." : "No custom LUT imported.";
  };
  Looks.cube = cube;
})(Looks);
