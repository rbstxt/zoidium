"use strict";
// Bilinear patch SSD, with the same f64 expression tree as the JS reference.
function create() {
  if (typeof WebAssembly === "undefined") return null;
  const u = n => { const a=[];do{const b=n&127;n>>>=7;a.push(b|(n?128:0));}while(n);return a; };
  const s = n => { const a=[];let more;do{const b=n&127;n>>=7;more=!((n===0&&!(b&64))||(n===-1&&(b&64)));a.push(b|(more?128:0));}while(more);return a; };
  const section=(id,a)=>[id,...u(a.length),...a],str=x=>[x.length,...Array.from(x,c=>c.charCodeAt(0))];
  let code=[];const e=(...a)=>code.push(...a),get=n=>e(0x20,...u(n)),set=n=>e(0x21,...u(n)),i=n=>e(0x41,...s(n));
  const f=n=>{const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,n,true);e(0x44,...b);};
  const add=()=>e(0x6a),mul=()=>e(0x6c),double=()=>e(0xb7),load=()=>e(0x2a,2,0,0xbb);
  // Params: current,previous,width,height,x,y,vx,vy. Locals: ix,iy,jx,jy,
  // qx,qy,sum,px,py,fx,fy,value,difference.
  get(4);double();get(6);e(0xa0);set(12);get(5);double();get(7);e(0xa0);set(13);
  get(12);f(1);e(0x66);get(13);f(1);e(0x66,0x71);
  get(12);get(2);i(1);e(0x6b);double();e(0x63,0x71);
  get(13);get(3);i(1);e(0x6b);double();e(0x63,0x71,0x45,0x04,0x40);f(Infinity);e(0x0f,0x0b);
  f(0);set(14);
  const clampPoint=(local,size)=>{
    get(local);f(0);e(0x63,0x04,0x40);f(0);set(local);e(0x0b);
    get(local);get(size);i(1);e(0x6b);double();e(0x64,0x04,0x40);get(size);i(1);e(0x6b);double();set(local);e(0x0b);
  };
  const nextIndex=(index,size,target)=>{
    get(index);i(1);add();get(size);e(0x48,0x04,0x7f);get(index);i(1);add();e(0x05);get(size);i(1);e(0x6b,0x0b);set(target);
  };
  const previous=(x,y)=>{get(1);get(y);get(2);mul();get(x);add();i(4);mul();add();load();};
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    get(12);f(dx);e(0xa0);set(15);get(13);f(dy);e(0xa0);set(16);clampPoint(15,2);clampPoint(16,3);
    get(15);e(0xaa);set(8);get(16);e(0xaa);set(9);nextIndex(8,2,10);nextIndex(9,3,11);
    get(15);get(8);double();e(0xa1);set(17);get(16);get(9);double();e(0xa1);set(18);
    f(1);get(18);e(0xa1);
    f(1);get(17);e(0xa1);previous(8,9);e(0xa2);get(17);previous(10,9);e(0xa2,0xa0,0xa2);
    get(18);f(1);get(17);e(0xa1);previous(8,11);e(0xa2);get(17);previous(10,11);e(0xa2,0xa0,0xa2,0xa0);set(19);
    get(0);get(5);i(dy);add();get(2);mul();get(4);i(dx);add();add();i(4);mul();add();load();get(19);e(0xa1);set(20);
    get(14);get(20);get(20);e(0xa2,0xa0);set(14);
  }
  get(14);e(0x0b);
  const body=[2,4,0x7f,9,0x7c,...code];
  // Run the four dependent scans inside the same module as score. This keeps
  // their original order and f64 comparisons without one JS/Wasm call per SSD.
  code=[];
  // Params current,previous,w,h,vectors,scores; locals x,y,i,j,pixel,before,after.
  const vector=(index,axis)=>{get(4);get(index);i(axis);add();i(4);mul();add();load();};
  const scoreAt=(index)=>{get(0);get(1);get(2);get(3);get(6);get(7);vector(index,0);vector(index,1);e(0x10,0);};
  const scoreAddress=()=>{get(5);get(10);i(8);mul();add();};
  const proposal=(dx,dy)=>{
    get(7);get(2);mul();get(6);add();set(10);get(10);i(2);mul();set(8);
    get(7);i(dy);add();get(2);mul();get(6);i(dx);add();add();i(2);mul();set(9);
    vector(8,0);vector(9,0);e(0x61);vector(8,1);vector(9,1);e(0x61,0x71,0x45,0x04,0x40);
    scoreAddress();e(0x2b,3,0);set(11);
    get(11);get(11);e(0x62,0x04,0x40);scoreAt(8);set(11);e(0x0b);
    scoreAt(9);set(12);get(12);get(11);e(0x63,0x04,0x40);
    for(let axis=0;axis<2;axis++){get(4);get(8);i(axis);add();i(4);mul();add();vector(9,axis);e(0xb6,0x38,2,0);}
    get(12);set(11);e(0x0b);scoreAddress();get(11);e(0x39,3,0,0x0b);
  };
  const loop=(local,size,reverse,callback)=>{
    if(reverse){get(size);i(2);e(0x6b);}else i(1);set(local);
    e(0x02,0x40,0x03,0x40);
    get(local);if(reverse){i(1);e(0x48);}else{get(size);i(1);e(0x6b,0x4e);}e(0x0d,1);
    callback();get(local);i(reverse?-1:1);add();set(local);e(0x0c,0,0x0b,0x0b);
  };
  loop(7,3,false,()=>loop(6,2,false,()=>proposal(-1,0)));
  loop(7,3,false,()=>loop(6,2,true,()=>proposal(1,0)));
  loop(6,2,false,()=>loop(7,3,false,()=>proposal(0,-1)));
  loop(6,2,false,()=>loop(7,3,true,()=>proposal(0,1)));
  e(0x0b);const sweepBody=[2,5,0x7f,2,0x7c,...code];
  const binary=new Uint8Array([0,97,115,109,1,0,0,0,
    ...section(1,[2,0x60,8,...Array(6).fill(0x7f),0x7c,0x7c,1,0x7c,0x60,6,...Array(6).fill(0x7f),0]),...section(3,[2,0,1]),...section(5,[1,0,1]),
    ...section(7,[3,...str("score"),0,0,...str("sweeps"),0,1,...str("memory"),2,0]),...section(10,[2,...u(body.length),...body,...u(sweepBody.length),...sweepBody])]);
  let instance;try{instance=new WebAssembly.Instance(new WebAssembly.Module(binary));}catch(_error){return null;}
  const {memory,score,sweeps}=instance.exports;
  const reserve=total=>{if(total>memory.buffer.byteLength)memory.grow(Math.ceil((total-memory.buffer.byteLength)/65536));};
  const runSweeps=(current,previous,w,h,v)=>{
    const prior=current.byteLength,vectors=prior+previous.byteLength,scores=(vectors+v.byteLength+7)&~7;
    reserve(scores+w*h*8);
    new Float32Array(memory.buffer,0,current.length).set(current);new Float32Array(memory.buffer,prior,previous.length).set(previous);
    const view=new Float32Array(memory.buffer,vectors,v.length);view.set(v);
    new Float64Array(memory.buffer,scores,w*h).fill(NaN);sweeps(0,prior,w,h,vectors,scores);v.set(view);
  };
  return {sweeps:runSweeps,bind(current,previous,w,h){
    const bytes=current.byteLength,total=bytes+previous.byteLength;
    if(total>memory.buffer.byteLength)memory.grow(Math.ceil((total-memory.buffer.byteLength)/65536));
    new Float32Array(memory.buffer,0,current.length).set(current);new Float32Array(memory.buffer,bytes,previous.length).set(previous);
    return (x,y,vx,vy)=>score(0,bytes,w,h,x,y,vx,vy);
  }};
}
module.exports={create};
