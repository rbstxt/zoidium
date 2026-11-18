"use strict";

// Native property rows do not display definition.description themselves.
// Add hover text only for properties belonging to installed ZSMB instances.
function install(PZ,effect){
  const controls=PZ.ui?.controls,key="__zoidiumZsmbTooltips";
  if(!controls?.createControls)return {release(){}};
  let state=controls[key];
  if(!state){
    state={references:0,properties:new WeakSet(),original:controls.createControls};
    state.wrapped=function(row,property){
      const result=state.original.apply(this,arguments);
      const description=state.properties.has(property)&&property.definition?.description;
      if(description){
        row.title=description;
        const label=row.firstElementChild?.querySelector("span");if(label)label.title=description;
        for(const control of row.querySelectorAll(".editbox,input,select"))control.title=description;
      }
      return result;
    };
    controls.createControls=state.wrapped;controls[key]=state;
  }
  state.references++;
  const properties=Object.values(effect.properties).filter(p=>p&&typeof p==="object");
  for(const property of properties)state.properties.add(property);
  let released=false;
  return {release(){
    if(released)return;released=true;
    for(const property of properties)state.properties.delete(property);
    if(--state.references)return;
    if(controls.createControls===state.wrapped)controls.createControls=state.original;
    delete controls[key];
  }};
}
module.exports={install};
