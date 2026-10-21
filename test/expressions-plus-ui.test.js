"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {installControlsUI}=require('../plugins/expressions-plus/controls-ui');
test('Graph Editor 2 keeps its command and gains the compatible control link action',()=>{
 class Property{}Property.dynamic=class extends Property{};
 const sequence={},p=Object.assign(new Property.dynamic(),{definition:{type:0},tryGetParentOfType:()=>sequence});
 const row={pz_object:p,closest:()=>row},control={name:'Amount'};let received,extension,dispose; 
 const kit=Object.freeze({registerMenuExtension(value){extension=value;return()=>{};},openMenu(options){received={...options,items:[...options.items,...extension.items(options)]};return 'menu';}});
 const PZ={property:Property,sequence:class{},ui:{edit:class{generatePropertyList(){}generateListItem(){}}}};
 const store={isControl:()=>false,list:()=>[control],compatible:()=>true,label:c=>c.name};
 installControlsUI({context:{PZ,editor:{},document:{},window:{ZoidiumUI:kit},ui:kit,lifecycle:{onDispose:fn=>{dispose=fn;}}},store,patch:(h,k,f)=>{h[k]=f(h[k]);}});
 assert.equal(kit.openMenu({owner:row,x:1,y:2,items:[{label:'Show in Graph Editor'}]}),'menu');
 assert.deepEqual(received.items.filter(i=>i.label).map(i=>i.label),['Show in Graph Editor','Link to control…']);
 assert.equal(received.items.at(-1).disabled,false);assert.equal(typeof dispose,'function');
});
