"use strict";
const { test, before } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { createLoader } = require("../plugins/shape-plus/text-engine"), { layoutText } = require("../plugins/shape-plus/text-layout");
const { createShapes } = require("../plugins/shape-plus/text-convert"), { compile } = require("../plugins/shape-plus/compiler");
const { createModel } = require("../plugins/shape-plus/model"), { PZ } = require("./shape-plus-host");
let font;
before(async () => {
 const engine=await createLoader((_,name)=>fs.readFileSync(name,"utf8"),name=>require("../plugins/shape-plus/"+name))();
 const b=fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf");font=engine.open(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),"fixture");
});
test("Create Shapes preserves per-character groups, separate contours and six-channel editable paths",()=>{
 const item={id:"text",kind:"text",properties:{enabled:1},textLayout:layoutText(font,null,{sourceText:"A V",fontSize:100})};let sequence=0;
 const groups=createShapes(item,()=>"converted-"+sequence++);
 assert.deepEqual(groups.map(g=>g.properties.name),["A","V"]);assert.ok(groups[0].contents.length>1);
 for(const g of groups)for(const path of g.contents){assert.equal(path.kind,"path");assert.equal(path.properties.path.keyframes[0].value.length,path.vertexIds.length*6);assert.equal(path.properties.closed,1);}
});
test("live text and converted paths compile to identical Float32 paint triangles",()=>{
 const service={evaluate:(_,p)=>layoutText(font,null,p)};const {Content}=createModel(PZ,service);
 const text=new Content("text");text.load({id:"text",properties:{sourceText:{animated:false,keyframes:[{frame:0,value:"AV office",tween:0}]}}});
 const paints=[new Content("trim"),new Content("stroke"),new Content("fill")];for(const item of paints)item.load({});
 const frame=12.5,evaluated=text.evaluate(frame);let id=0;
 const converted=createShapes(evaluated,()=>"c"+id++).map(data=>{const item=new Content("group",data);item.load(data);return item;});
 for(const tolerance of [.125,.03125]){
  const before=compile([evaluated,...paints.map(item=>item.evaluate(frame))],tolerance);
  const after=compile([...converted.map(item=>item.evaluate(frame)),...paints.map(item=>item.evaluate(frame))],tolerance);
  const triangles=values=>{if(!values)return undefined;const result=[];for(let i=0;i<values.length;i+=9)result.push(Array.from(new Float32Array(values.slice(i,i+9))).join(","));return result.sort();};
  const normalizePaints=commands=>commands.map(({positions,coverage,...rest})=>({...rest,positions:triangles(positions),coverage:triangles(coverage)}));
  assert.deepEqual(normalizePaints(after.commands),normalizePaints(before.commands));
  const points=paths=>paths.map(p=>Array.from(new Float32Array(p.points.flat())));
  assert.deepEqual(points(after.paths),points(before.paths));
 }
});

test("ligature text still creates a named group for every source character",()=>{
 const item={id:"text",kind:"text",properties:{enabled:1},textLayout:layoutText(font,null,{sourceText:"office",fontSize:100})};let id=0;
 const groups=createShapes(item,()=>"ligature-"+id++);
 assert.deepEqual(groups.map(group=>group.properties.name),["o","f","f","i","c","e"]);
 assert.equal(groups.filter(group=>group.contents.length===0).length,2);
});
