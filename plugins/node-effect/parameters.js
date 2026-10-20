"use strict";
const {clone,parameters} = require("./model.js");
// Produce the native custom-property records. Identity is the node id encoded
// in the uniform name, never the editable display label.
function records(compiled,previous=[]) {
 const old=new Map(previous.map(p=>[p.properties?.name,p]));
 const specs=compiled.parameters.map(p=>({...p,type:[0,4,1][p.kind]}));
 if(compiled.time)specs.push({uniform:"ne_time",label:"Time",type:0,value:0,time:true});
 return specs.map(p=>{
  const found=old.get(p.uniform);
  if(found?.type?.type===p.type) {
   const saved=clone(found);
   saved.type.zoidiumLabel=p.label;
   if(!p.time && JSON.stringify(saved.type.zoidiumDefault)!==JSON.stringify(p.value)) {
    const leaves=saved.objects||[saved];
    if(leaves.every(v=>!v.expression&&!v.animated&&v.keyframes?.length===1)) {
     leaves.forEach((v,i)=>{v.keyframes[0].value=Array.isArray(p.value)?p.value[i]:p.value;});
    }
   }
   saved.type.zoidiumDefault=clone(p.value);
   if(!p.time) {saved.type.min=p.min;saved.type.max=p.max;}
   return saved;
  }
  const type={custom:true,dynamic:true,type:p.type,value:p.value,zoidiumDefault:clone(p.value),zoidiumLabel:p.label};
  if(p.time)type.visible=false;else {type.min=p.min;type.max=p.max;type.step=.01;}
  return {type,properties:{name:p.uniform},...(p.time?{expression:"time"}: {})};
 });
}
function label(property) {
 const value=property.definition.zoidiumLabel;
 if(property.properties?.name)property.properties.name.definition={...property.properties.name.definition,readOnly:true};
 if(value)Object.defineProperty(property.definition,"name",{value,writable:true,configurable:true,enumerable:false});
}
function install(PZ,effect,data) {
 effect.customProperties.splice(0,effect.customProperties.length);
 for(const record of data) {
  const definition=clone(record.type),p=PZ.property.create(definition);
  effect.customProperties.push(p);
  // New records need the native default keyframes before loading a name or
  // expression. Existing records include their complete key/tween metadata.
  p.load(record.keyframes || record.objects ? record : undefined);
  if(!record.keyframes && !record.objects) {if(record.type.zoidiumDefault!==undefined)p.set(clone(record.type.zoidiumDefault),0);p.properties.load(record.properties);if(record.expression)p.expression=new PZ.expression(record.expression);}
  label(p);
 }
 effect.fragmentShaderNeedsUpdate=true;
}
module.exports={records,install,label,parameters};
