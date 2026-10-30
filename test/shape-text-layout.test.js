"use strict";
const { test, before } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { createLoader } = require("../plugins/shape-plus/text-engine"), { layoutText, tokens } = require("../plugins/shape-plus/text-layout");
let engine, latin, japanese;
before(async () => {
  engine = await createLoader((_, name) => fs.readFileSync(name, "utf8"), name => require("../plugins/shape-plus/" + name))();
  function open(file) { const b = fs.readFileSync("test/fixtures/shape-text/" + file); return engine.open(b.buffer.slice(b.byteOffset,b.byteOffset+b.length), file); }
  latin = open("RobotoFlex-subset.ttf"); japanese = open("NotoSansJP-subset.ttf");
});
const p = { sourceText: "AV office", fontSize: 100, horizontalScale:100, verticalScale:100, leading:120 };
test("alignment, tracking, leading, baseline and scaling use font-unit geometry", () => {
  const left = layoutText(latin,null,p), center = layoutText(latin,null,{...p,alignment:"center"}), right = layoutText(latin,null,{...p,alignment:"right"});
  assert.equal(center.glyphs[0].x,left.glyphs[0].x-left.rows[0].width/2);
  assert.equal(right.glyphs[0].x,left.glyphs[0].x-left.rows[0].width);
  const tracked = layoutText(latin,null,{...p,tracking:100});
  assert.equal(tracked.rows[0].width-left.rows[0].width,(left.glyphs.length-1)*10);
  const lines = layoutText(latin,null,{...p,sourceText:"A\nV",baselineShift:10,spaceBefore:5,spaceAfter:7});
  assert.equal(lines.rows[1].baseline,-137); assert.equal(lines.glyphs[0].y,5);
  assert.equal(layoutText(latin,null,{...p,horizontalScale:200}).rows[0].width,left.rows[0].width*2);
});
test("box wrap keeps Latin words and breaks Japanese per grapheme", () => {
  assert.deepEqual(tokens("AV office 日本語"),["AV"," ","office"," ","日","本","語"]);
  const width = layoutText(latin,null,{...p,sourceText:"office"}).rows[0].width;
  const wrapped=layoutText(latin,null,{...p,sourceText:"AV office",textMode:"box",boxSize:[width+1,400]});
  assert.deepEqual(wrapped.rows.map(r=>r.text),["AV","office"]);
  const jp=layoutText(japanese,null,{...p,sourceText:"日本語日本語",textMode:"box",boxSize:[201,600]});
  assert.deepEqual(jp.rows.map(r=>r.text),["日本","語日","本語"]);
  const mixed=layoutText(latin,japanese,{...p,sourceText:"AV日本語"}); assert.ok(mixed.glyphs.every(g=>g.g>0));
});
test("justify, indentation, caps, empty lines and box overflow remain deterministic", () => {
  const settings={...p,textMode:"box",sourceText:"AV AV",alignment:"justifyAll",boxSize:[600,400],firstLineIndent:20};
  const a=layoutText(latin,null,settings), b=layoutText(latin,null,settings);
  assert.deepEqual(a,b); assert.equal(a.glyphs[0].x,20);
  assert.ok(a.glyphs.at(-1).x > 500);
  const caps=layoutText(latin,null,{...p,sourceText:"office",caps:"all"}); assert.equal(caps.glyphs[0].character,"O");
  const small=layoutText(latin,null,{...p,sourceText:"office",caps:"small"}); assert.ok(small.glyphs.every(g=>g.small===.75));
  const empty=layoutText(latin,null,{...p,sourceText:"\n\n",textMode:"box",boxSize:[200,100]});
  assert.equal(empty.rows.length,3); assert.equal(empty.glyphs.length,0); assert.equal(empty.rows[1].visible,false);
});
