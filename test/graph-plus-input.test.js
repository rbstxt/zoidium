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
  assert.ok(Math.abs(next.centerX+(point.x-50)*next.zoomX-(view.centerX+(point.x-50)*view.zoomX))<1e-10);
  assert.equal(next.centerY+(point.y-50)*next.zoomY,view.centerY+(point.y-50)*view.zoomY);
  const pan=wheelView(view,{deltaX:2,deltaY:3},{kind:"pan"},point);
  assert.equal(pan.centerX,52);assert.equal(pan.centerY,6);
  const y=wheelView(view,{deltaY:100,altKey:true},{kind:"zoom"},point);
  assert.equal(y.zoomX,view.zoomX);assert.ok(y.zoomY>view.zoomY);
  const ruler=wheelView(view,{deltaY:100,ctrlKey:true},{kind:"zoom"},point,true);
  assert.equal(ruler.zoomY,view.zoomY);assert.equal(ruler.centerY,view.centerY);
  const windows=wheelView(view,{deltaY:-120,ctrlKey:true},{kind:"zoom"},point);
  assert.ok(windows.zoomX/view.zoomX>.7 && windows.zoomX/view.zoomX<1);
  const extreme=wheelView(view,{deltaY:1e99,ctrlKey:true},{kind:"zoom"},point);
  assert.ok(Object.values(extreme).every(Number.isFinite));
  assert.ok(extreme.zoomX>0 && extreme.zoomY>0);
});
const { nearestTarget, visibleHandle, constrainHandle } = require("../plugins/graph-plus/targets.js");
test("selected handles win overlapping key hit areas and short handles stay visible", () => {
  const key={x:0,y:0}, handle={x:3,y:0,handle:true};
  assert.equal(nearestTarget([key,handle],0,0,12),handle);
  assert.equal(nearestTarget([key],20,0,12),undefined);
  assert.deepEqual(visibleHandle([0,0],2,3,1,0),[-48,0]);
  const cp=[1,1], before=cp.slice();
  const shown=visibleHandle(cp,1,1,1,1);
  assert.ok(Math.abs(Math.hypot(...shown)-24)<1e-9);
  assert.deepEqual(cp,before);
});
test("Shift constrains angles and Ctrl or Cmd snaps to flat or neighbour slope", () => {
  assert.deepEqual(constrainHandle([10,.1],{ctrlKey:true},2),[10,0]);
  assert.deepEqual(constrainHandle([10,19.9],{metaKey:true},2),[10,20]);
  const shift=constrainHandle([10,8],{shiftKey:true},0);
  assert.ok(Math.abs(shift[0]-shift[1])<1e-9);
});
