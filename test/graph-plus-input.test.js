"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyWheel, wheelView } = require("../plugins/graph-plus/input.js");
const view = { centerX: 50, centerY: 0, zoomX: 1, zoomY: 2, width: 100, height: 100 };
const point = { x: 20, y: 30 };
test("wheel classifier recognizes mouse steps, trackpad, pinch and inertial tails", () => {
  for (const e of [{deltaMode:1,deltaY:3},{deltaY:100},{deltaY:-120},{deltaY:3,ctrlKey:true}])
    assert.equal(classifyWheel(e, null, 0).kind, "zoom");
  for (const e of [{deltaX:2,deltaY:10},{deltaY:1.25},{deltaY:2}])
    assert.equal(classifyWheel(e, null, 0).kind, "pan");
  const pan=classifyWheel({deltaX:5,deltaY:10},null,0);
  assert.equal(classifyWheel({deltaY:120},pan,50).kind,"pan");
  const mouse=classifyWheel({deltaY:120},null,0);
  assert.equal(classifyWheel({deltaY:1},mouse,50).kind,"zoom");
  assert.equal(classifyWheel({deltaY:1},mouse,300).kind,"pan");
});
test("wheel math anchors zoom, pans both axes, and limits extreme input", () => {
  const next=wheelView(view,{deltaY:-1.25,ctrlKey:true},{kind:"zoom"},point);
  assert.ok(next.zoomX<view.zoomX && next.zoomY<view.zoomY);
  assert.equal(next.centerX+(point.x-50)*next.zoomX,view.centerX+(point.x-50)*view.zoomX);
  assert.equal(next.centerY+(point.y-50)*next.zoomY,view.centerY+(point.y-50)*view.zoomY);
  const pan=wheelView(view,{deltaX:2,deltaY:3},{kind:"pan"},point);
  assert.equal(pan.centerX,52);assert.equal(pan.centerY,6);
  const y=wheelView(view,{deltaY:100,altKey:true},{kind:"zoom"},point);
  assert.equal(y.zoomX,view.zoomX);assert.ok(y.zoomY>view.zoomY);
  const ruler=wheelView(view,{deltaY:100,ctrlKey:true},{kind:"zoom"},point,true);
  assert.equal(ruler.zoomY,view.zoomY);assert.equal(ruler.centerY,view.centerY);
  const extreme=wheelView(view,{deltaY:1e99,ctrlKey:true},{kind:"zoom"},point);
  assert.ok(Object.values(extreme).every(Number.isFinite));
  assert.ok(extreme.zoomX>0 && extreme.zoomY>0);
});
