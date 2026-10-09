"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { patchIndexHtml } = require("../tools/runtime-resources");

const basePage = (head = "") =>
  [
    "<!doctype html>",
    "<head>",
    head,
    '<script src="core-1.0.0.js"></script>',
    '<script src="clipmaker-1.0.0.js"></script>',
    "<script>PZ.ui.ads.init(); initTool();</script>",
    "</head>",
  ].join("\n");

const PLACEHOLDER = '<link rel="icon" href="data:,">';

test("the staged page gets an empty data: icon when the source declares none", () => {
  const patched = patchIndexHtml(basePage());
  assert.equal(patched.split(PLACEHOLDER).length - 1, 1);
  assert.ok(patched.indexOf(PLACEHOLDER) < patched.indexOf("</head>"));
});

test("a source page with its own rel=icon link keeps its icon and gets no placeholder", () => {
  const patched = patchIndexHtml(basePage('<link rel="icon" href="favicon.png">'));
  assert.doesNotMatch(patched, /data:,/);
  assert.match(patched, /<link rel="icon" href="favicon\.png">/);
});

test("shortcut icon and multi-token rel values count as an icon link", () => {
  const shortcut = patchIndexHtml(basePage("<link rel='shortcut icon' href='/x.ico'>"));
  assert.doesNotMatch(shortcut, /data:,/);
  const unquoted = patchIndexHtml(basePage("<link rel=icon href=/x.ico>"));
  assert.doesNotMatch(unquoted, /data:,/);
});

test("apple-touch-icon alone does not suppress the placeholder", () => {
  const patched = patchIndexHtml(basePage('<link rel="apple-touch-icon" href="/touch.png">'));
  assert.equal(patched.split(PLACEHOLDER).length - 1, 1);
});
