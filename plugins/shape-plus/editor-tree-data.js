"use strict";
const { clone, validate } = require("./model.js");
function find(contents, id, ancestors = []) {
  for (let index = 0; index < contents.length; index++) {
    const item = contents[index];
    if (item.id === id) return { item, list: contents, index, ancestors };
    const nested = item.contents && find(item.contents, id, [...ancestors, item]);
    if (nested) return nested;
  }
  return null;
}
function move(contents, ids, parentId, beforeId = null) {
  const target = parentId ? find(contents, parentId)?.item : null;
  if (parentId && target?.kind !== "group") throw Error("Drop into a group or between rows");
  const selected = new Set(ids), nodes = ids.map(id => find(contents,id)).filter(Boolean).filter(entry => !entry.ancestors.some(a=>selected.has(a.id)));
  if (target && nodes.some(e=>e.item === target || find(e.item.contents || [],parentId))) throw Error("A group cannot contain itself");
  if (beforeId && selected.has(beforeId)) return;
  for (const e of nodes) e.list.splice(e.list.indexOf(e.item),1);
  const list = target ? target.contents : contents;
  const index = beforeId ? list.findIndex(item=>item.id===beforeId) : list.length;
  list.splice(index < 0 ? list.length : index,0,...nodes.map(e=>e.item));
  validate(contents);
}
function group(contents, ids, id) {
  const selected = new Set(ids), entries = ids.map(key=>find(contents,key)).filter(Boolean).filter(e=>!e.ancestors.some(a=>selected.has(a.id)));
  if (!entries.length) return null;
  const list = entries[0].list;
  if (entries.some(e=>e.list!==list)) throw Error("Select sibling items to group");
  entries.sort((a,b)=>a.index-b.index);
  const item = {id,kind:"group",properties:{},contents:entries.map(e=>e.item)}, index=entries[0].index;
  for (const e of entries) list.splice(list.indexOf(e.item),1);
  list.splice(index,0,item);validate(contents);return item;
}
function ungroup(contents, id) {
  const entry=find(contents,id);
  if (entry?.item.kind!=="group") return [];
  const p=entry.item.properties;
  const identity={position:[0,0],anchor:[0,0],scale:[1,1],rotation:0,opacity:1};
  function unchanged(data, expected) {
    if (data === undefined) return true;
    if (data.expression || data.animated) return false;
    if (data.objects) return data.objects.every((v,i)=>unchanged(v,expected[i]));
    if (data.keyframes) return data.keyframes.every(k=>JSON.stringify(k.value)===JSON.stringify(expected));
    return JSON.stringify(data)===JSON.stringify(expected);
  }
  if (Object.entries(identity).some(([key,value])=>!unchanged(p[key],value))) throw Error("Reset group transforms and opacity before ungrouping");
  entry.list.splice(entry.index,1,...entry.item.contents);validate(contents);return entry.item.contents.map(item=>item.id);
}
function duplicate(contents, ids, nextId) {
  const selected=new Set(ids), entries=ids.map(id=>find(contents,id)).filter(Boolean).filter(e=>!e.ancestors.some(a=>selected.has(a.id))), copies=[];
  function fresh(item) {item.id=nextId();for(const child of item.contents || [])fresh(child);}
  for(const e of entries) {const copy=clone(e.item);fresh(copy);e.list.splice(e.list.indexOf(e.item)+1,0,copy);copies.push(copy.id);}
  validate(contents);return copies;
}
function remove(contents, ids) {
  for(const id of ids) {const e=find(contents,id);if(e)e.list.splice(e.index,1);}
}
module.exports={find,move,group,ungroup,duplicate,remove};
