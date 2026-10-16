"use strict";
const {parsePath}=require("./svg-path.js");
const {pathItem,d}=require("./svg-import.js");
const {primitivePath}=require("./primitives.js");
const {clone,validate}=require("./model.js");
const TYPE="zoidium:shape-plus/shape-layer";
function commandPaths(commands) {
  if(!Array.isArray(commands)||commands.length>4096)throw Error("Native path outlines are unavailable or too large");
  const text=commands.map(c=>{
    const number=k=>{if(!Number.isFinite(c[k]))throw Error("Invalid native outline coordinate");return c[k];};
    switch(c.type) {
      case "M":case "L":return c.type+number("x")+" "+number("y");
      case "Q":return "Q"+number("x1")+" "+number("y1")+" "+number("x")+" "+number("y");
      case "C":return "C"+number("x1")+" "+number("y1")+" "+number("x2")+" "+number("y2")+" "+number("x")+" "+number("y");
      case "Z":return "Z";
      default:throw Error("Unsupported native outline command");
    }
  }).join(" ");
  return text?parsePath(text):[];
}
function hasExpression(value) {
  return value&&typeof value==="object"&&(value.expression||Object.values(value).some(hasExpression));
}
function convertNative(layer,nextId) {
  if(![6,7,8].includes(layer.type))throw Error("Only native Shape, Text and Preset Shape layers can be converted");
  let seed=0;nextId=nextId||(()=>"converted-"+(++seed));
  const saved=clone(layer),properties=clone(saved.properties||{});
  if(hasExpression(properties)||hasExpression(saved.objects))throw Error("Expression-driven native shapes cannot be converted losslessly");
  const preset=layer.type===8?layer.shapeProperties?.preset?.get():null;
  if(layer.type===8&&![0,1].includes(preset))throw Error("Unsupported native shape preset");
  if(layer.type===7&&(!layer.font?.font2d||layer.fontNeedsUpdate||layer.shapesNeedUpdate))throw Error("Wait for native text glyph outlines to finish loading before converting");
  function paints(operations) {
    return Array.from(operations||[]).map(operation=>{
      const p=clone(operation.properties);
      if(operation.type===0)return {kind:"fill",id:nextId(),properties:{color:p.color,opacity:d(1),composite:"above"}};
      if(operation.type===1)return {kind:"stroke",id:nextId(),properties:{color:p.color,opacity:p.opacity,width:p.size,cap:"butt",join:"miter",miterLimit:d(10),composite:"above"}};
      throw Error("Unsupported native paint operation");
    });
  }
  function node(source,isPreset=false) {
    let contents=[];
    if(source.type===0) {
      contents=Array.from(source.objects||[]).map(child=>({kind:"group",id:nextId(),properties:{},contents:[node(child,isPreset),...paints(source.operations)]})).reverse();
    } else if(source.type===1) {
      let paths;
      if(isPreset)paths=[primitivePath({id:"preset",kind:preset===0?"ellipse":"rectangle",properties:{size:[200,200],position:[0,0],roundness:0}})];
      else paths=commandPaths(source.path?.commands);
      contents=paths.map(path=>pathItem({...path,vertices:path.vertices.map(v=>({point:[v.point[0],-v.point[1]],in:[v.in[0],-v.in[1]],out:[v.out[0],-v.out[1]]}))},nextId));
    } else throw Error("Unsupported native shape object");
    if(source.type!==0)contents.push(...paints(source.operations));
    const p=clone(source.properties);
    const group={kind:"group",id:nextId(),properties:{name:p.name,position:p.position,scale:p.scale,rotation:p.rotation,anchor:d([.5,-.5])},contents};
    // CM3 Canvas shape transforms pivot about the half-pixel offset. Keep its
    // exact affine map using static wrapper translation, without rewriting keys.
    return {kind:"group",id:nextId(),properties:{position:d([.5,-.5])},contents:[group]};
  }
  const contents=Array.from(layer.objects||[]).map(source=>node(source,layer.type===8)).reverse();
  if(!contents.length)throw Error("Native shape has no supported outlines");
  validate(contents);

  delete properties.childProperties;
  return {type:TYPE,schemaVersion:1,renderVersion:1,properties,effects:saved.effects||[],contents};
}
function install(context,Layer) {
  const PZ=window.PZ,editor=window.CM,proto=PZ.ui.edit.prototype,original=proto.generateItemCommands;
  const retained=new Set();
  function refresh() {
    for(const el of document.querySelectorAll(".editorpanel")) if(el.pz_panel instanceof PZ.ui.edit)el.pz_panel.objectsChanged();
  }
  function exchange({clip,next,history}) {
    const previous=clip.object,index=clip.children.indexOf(previous);
    clip.object=next;next.parent=clip;clip.children.splice(index,1,next);
    const track=clip.parentObject;if(track?.layer===previous)track.layer=next;
    retained.add(previous);retained.delete(next);
    history.pushCommand(exchange,{clip,next:previous,history});
    refresh();
  }
  async function convert(layer) {
    const clip=layer.parentObject,project=editor.project;
    if(!(clip instanceof PZ.clip)||clip.object!==layer)throw Error("Select a direct native shape clip to convert");
    await layer.loading;
    await layer.prepare(editor.playback.currentFrame-clip.start,{project,sequence:editor.sequence});
    layer.update(editor.playback.currentFrame-clip.start);
    const data=convertNative(layer,()=>"sp-"+crypto.randomUUID()),next=new Layer();
    next.parent=clip;
    try {next.loading=next.load(data);await next.loading;await next.prepare(0,{project,sequence:editor.sequence});}
    catch(error){next.unload();throw error;}
    if(editor.project!==project||clip.object!==layer||editor.history.operation!==null){next.unload();throw Error("The selected native shape changed during conversion");}
    editor.history.startOperation();exchange({clip,next,history:editor.history});editor.history.finishOperation();
  }
  function replacement(row,object) {
    const result=original.apply(this,arguments);
    if(object instanceof PZ.layer&&[6,7,8].includes(object.type)&&!this.options.hideAllListItemButtons) {
      const button=this.generateButton("change");button.title="Convert to Shape+";button.setAttribute("aria-label",button.title);
      button.onclick=event=>{event.stopPropagation();convert(object).catch(error=>context.ui.notify({title:"Shape+",message:error.message}));};
      row.children[1].prepend(button);
    }
    return result;
  }
  proto.generateItemCommands=replacement;
  const cleanup=()=>{for(const layer of retained){layer.unload();layer.parent=null;}retained.clear();};
  editor.onProjectChanged.watch(cleanup);
  context.lifecycle.onDispose(()=>{if(proto.generateItemCommands===replacement)proto.generateItemCommands=original;editor.onProjectChanged.unwatch(cleanup);cleanup();});
  return {convert};
}
module.exports={convertNative,commandPaths,hasExpression,install};
