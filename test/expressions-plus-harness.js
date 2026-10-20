"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {installEngine}=require("../plugins/expressions-plus/engine");
const cache=process.env.ZOIDIUM_RESOURCE_DIR||path.join(__dirname,"../.zoidium-resources");
const core=path.join(cache,"core-1.0.102.js");
function host(options={}){
 const c=vm.createContext({PZ:{},ISNODE:true,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,performance,TextEncoder,TextDecoder,URL});
 vm.runInContext(fs.readFileSync(path.join(cache,'three.r91.min.js'),'utf8'),c);vm.runInContext(fs.readFileSync(core,'utf8'),c);
 const PZ=c.PZ,originals=[];
 const document={body:{appendChild(){}},createElement(){const realm=vm.createContext({});return {setAttribute(){},remove(){},contentWindow:{Function:vm.runInContext('Function',realm)}};}};
 const engine=installEngine({...options,PZ,document,patch(holder,key,make){originals.push([holder,key,holder[key]]);holder[key]=make(holder[key]);}});
 const root=new PZ.object,owner=new PZ.object;owner.parent=root;owner.properties=new PZ.propertyList({a:{name:'A',dynamic:true,type:0,value:7},b:{name:'B',dynamic:true,type:0,value:11}},owner);owner.properties.load();
 return {PZ,THREE:c.THREE,engine,owner,a:owner.properties.a,b:owner.properties.b};
}
module.exports={host,cache,core};
