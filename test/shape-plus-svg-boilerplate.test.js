"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { importSVG } = require("../plugins/shape-plus/svg-import");

const boilerplate =
  "<!--leading editor comment-->" +
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"' +
  ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' +
  ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi.dtd"' +
  ' xml:space="preserve" xml:lang="en" width="100" height="100" viewBox="0 0 100 100">' +
  '<!--inside header comment-->' +
  '<sodipodi:namedview inkscape:zoom="2" inkscape:cx="50" sodipodi:docname="test.svg"/>' +
  "<metadata><rdf:RDF>editor metadata text</rdf:RDF></metadata>" +
  "<title>Test drawing</title>" +
  "<desc>A description with text</desc>" +
  '<defs id="defs4"/>' +
  '<path d="M0 0 L4.8e-8 3.5e-4 H1e2 V50 H0 Z"/>' +
  "</svg>" +
  "<!--rotationCenter:240:180-->";

const stripped =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
  '<path d="M0 0 L4.8e-8 3.5e-4 H1e2 V50 H0 Z"/>' +
  "</svg>";

test("editor boilerplate imports identically to the bare SVG", () => {
  assert.deepEqual(importSVG(boilerplate), importSVG(stripped));
});

test("svg-prefixed tags import as their unprefixed form", () => {
  const prefixed =
    '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:path d="M0 0h10v10H0Z"/></svg:svg>';
  assert.deepEqual(
    importSVG(prefixed),
    importSVG('<svg><path d="M0 0h10v10H0Z"/></svg>'),
  );
});

test("boilerplate bypasses stay rejected", () => {
  for (const text of [
    "<!DOCTYPE svg><svg/>",
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
    "<svg><![CDATA[x]]></svg>",
    "<svg><!-- unterminated",
    '<svg><image xlink:href="#a"/></svg>',
    '<svg onload="x()"/>',
    '<svg><path d="M0 0" style="fill:url(#x)"/></svg>',
    "<svg><text>Hello</text></svg>",
    "<svg><g>stray text</g></svg>",
    "<svg><metadata>" + "<g/>".repeat(513) + "</metadata></svg>",
    '<svg><path d="M0 0" inkscape:foo="url(#x)"/></svg>',
  ])
    assert.throws(() => importSVG(text), /SVG/, text.slice(0, 60));
});
