"use strict";
function activate(context) {
 const {PZ,editor:CM,window:win,document:doc}=context;
 const require=context.apis.modules.createRequire(context.getAsset,{root:"./plugins/node-effect/"});
 const {compile}=require("./compiler.js"),model=require("./model.js"),params=require("./parameters.js");
 const {types}=require("./catalogue.js");
 const shaderCheck=require("./shader-check.js").createShaderCheck(doc);
 context.lifecycle.onDispose(()=>shaderCheck.dispose());
 const ids=new WeakMap();let nextId=0;
 function graphOf(effect) {try{return effect?.type===1?model.extract(effect.properties.fragShader.get()):null;}catch{return null;}}
 function snapshot(effect) {return {shader:effect.properties.fragShader.get(),custom:JSON.parse(JSON.stringify(effect.customProperties))};}
 function apply(effect,data) {
  effect.properties.fragShader.set(data.shader);params.install(PZ,effect,data.custom);
  CM.project.ui?.onChanged?.update();CM.mainViewport?.requestRender?.();
  context.ui.refreshEditors();
 }
 function resolve(address) {try{return CM.project.addressLookup(address,0);}catch{return null;}}
 function exchange(command) {
  const effect=resolve(command.address);if(!effect)return;
  const current=snapshot(effect);apply(effect,command.data);
  CM.history.pushCommand(exchange,{...command,data:current});
 }
 function commit(effect,compiled) {
  const before=snapshot(effect),after={shader:compiled.shader,custom:params.records(compiled,before.custom)};
  if(JSON.stringify(before)===JSON.stringify(after))return;
  if(CM.history.operation!==null)throw new Error("Finish the current edit before changing the node graph.");
  CM.history.startOperation();
  try {apply(effect,after);CM.history.pushCommand(exchange,{address:effect.getAddress(),data:before});CM.history.finishOperation();}
  catch(error){try{apply(effect,before);}finally{CM.history.discardOperation();}throw error;}
 }
 function open(effect) {
  if(!ids.has(effect))ids.set(effect,++nextId);
  let editor;
  return context.ui.openWindow({id:"graph:"+ids.get(effect),title:"Node Editor",width:1000,height:620,placement:"center",persistKey:"node-editor",isValid:()=>{try{return !!effect.parent && effect.parentProject===CM.project;}catch{return false;}},mount(body){
   body.style.cssText="display:flex;flex-direction:column;min-height:0";
   const status=context.ui.controls.note("Connect a color and alpha to Output. The viewport previews the effect.").element;
   status.setAttribute("role","status");
   const host=doc.createElement("div");host.style.cssText="flex:1;min-height:0";
   body.append(status,host);
   let changing=false,lastShader=effect.properties.fragShader.get();
   function onChange(graph) {
    try {
     const compiled=compile(graph);
     shaderCheck.check(compiled.shader);
     changing=true;
     try {commit(effect,compiled);}finally{changing=false;}
     lastShader=effect.properties.fragShader.get();
     status.textContent="Graph compiled. Exposed parameters are available in the Effects panel.";
     status.style.color="";
    }catch(error){status.textContent="Node Effect: "+error.message;status.style.color="var(--zui-danger)";}
   }
   editor=win.ZoidiumUI.nodeEditor({nodeTypes:types,graph:graphOf(effect),canConnect:()=>true,onChange});
   host.append(editor.element);
   const sync=()=>{
    const shader=effect.properties.fragShader.get();
    if(changing||shader===lastShader)return;
    lastShader=shader;
    const graph=graphOf(effect);if(graph)editor.setGraph(graph);
   };
   const error=message=>{status.textContent="Node Effect shader error: "+String(message);status.style.color="var(--zui-danger)";};
   effect.properties.fragShader.onChanged.watch(sync);effect.onShaderError.watch(error);
   let frame=win.requestAnimationFrame(()=>{frame=win.requestAnimationFrame(()=>editor.frameAll());});
   return ()=>{win.cancelAnimationFrame(frame);effect.properties.fragShader.onChanged.unwatch(sync);effect.onShaderError.unwatch(error);editor.destroy();};
  }});
 }
 context.ui.registerEditor({title:"Node Editor",match:effect=>{
  const graph=graphOf(effect);if(!graph)return false;
  for(const p of effect.customProperties)params.label(p);
  return true;
 },open});
 // This API exposes authoring operations for inspection; rendering uses only
 // the native shader and properties, so disabling this module is safe.
 const api={compile,graphOf,open,commit,types,initialGraph:model.initialGraph};
 win.ZoidiumNodeEffect=api;
 context.lifecycle.onDispose(()=>{if(win.ZoidiumNodeEffect===api)delete win.ZoidiumNodeEffect;});
}
module.exports={activate};
