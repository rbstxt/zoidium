"use strict";
const {validate}=require("./model.js");
function recipe(label,nodes,links) {
 return {label,graph:validate({nodes:nodes.map(([id,type,params={}],i)=>({id,type,params,x:(i%4)*300,y:Math.floor(i/4)*300})),links:links.map(([from,fromPort,to,toPort])=>({from:{node:from,port:fromPort},to:{node:to,port:toPort}}))})};
}
module.exports=[
 recipe("Glow",[["layer","layer"],["blur","blur",{mode:1,taps:25,radius:16}],["mix","mix",{mode:1,factor:.8}],["alpha","math",{mode:0}],["output","output"]],[
  ["layer","color","mix","a"],["blur","color","mix","b"],["layer","alpha","alpha","a"],["blur","alpha","alpha","b"],["mix","color","output","color"],["alpha","out","output","alpha"],
 ]),
 recipe("Chromatic aberration",[["uv","uv"],["offset","parameter",{name:"Channel offset",kind:2,x:.005,y:0,min:-.1,max:.1}],["plus","vectorMath"],["minus","vectorMath",{mode:1}],["red","sample"],["green","layer"],["blue","sample"],["r","separateRGB"],["g","separateRGB"],["b","separateRGB"],["combine","combineRGB"],["output","output"]],[
  ["uv","out","plus","a"],["offset","out","plus","b"],["uv","out","minus","a"],["offset","out","minus","b"],["plus","out","red","uv"],["minus","out","blue","uv"],["red","color","r","color"],["green","color","g","color"],["blue","color","b","color"],["r","r","combine","r"],["g","g","combine","g"],["b","b","combine","b"],["combine","color","output","color"],["green","alpha","output","alpha"],
 ]),
 recipe("Displacement by noise",[["uv","uv"],["time","time"],["noise","noise",{scale:12}],["center","math",{mode:1,b:.5}],["strength","math",{mode:2,b:.04}],["offset","vectorMath"],["sample","sample"],["output","output"]],[
  ["time","out","noise","time"],["noise","out","center","a"],["center","out","strength","a"],["uv","out","offset","a"],["strength","out","offset","b"],["offset","out","sample","uv"],["sample","color","output","color"],["sample","alpha","output","alpha"],
 ]),
 recipe("Duotone",[["layer","layer"],["ramp","colorRamp",{stops:[[0,.025,.04,.12,1],[1,1,.65,.2,1]]}],["output","output"]],[
  ["layer","color","ramp","factor"],["ramp","color","output","color"],["layer","alpha","output","alpha"],
 ]),
];
