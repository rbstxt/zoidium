"use strict";
// Strict f64 accumulation and f32 stores match the approved JavaScript filter.
// No SIMD reassociation, relaxed math, reduced kernels or precision changes.
function create() {
  if (typeof WebAssembly === "undefined") return null;
  const u = n => { const a = []; do { const b = n & 127; n >>>= 7; a.push(b | (n ? 128 : 0)); } while (n); return a; };
  const s = n => { const a = []; let more; do { const b = n & 127; n >>= 7; more = !((n === 0 && !(b & 64)) || (n === -1 && (b & 64))); a.push(b | (more ? 128 : 0)); } while (more); return a; };
  const section = (id, data) => [id, ...u(data.length), ...data];
  const str = x => [x.length, ...Array.from(x, c => c.charCodeAt(0))];
  const bodies=[];
  for(const ks of [5,11,15]){
    const code=[],emit=(...a)=>code.push(...a),get=n=>emit(0x20,...u(n)),set=n=>emit(0x21,...u(n)),constant=n=>emit(0x41,...s(n));
    const add=()=>emit(0x6a),mul=()=>emit(0x6c),loadF=()=>emit(0x2a,2,0,0xbb);
    get(6);get(7);mul();get(8);mul();set(11);
    for(let axis=0;axis<2;axis++){
      for(const local of [10,12,13,14]){constant(0);set(local);}
      emit(0x02,0x40,0x03,0x40);get(10);get(11);emit(0x4f,0x0d,1);
      // Hoist the source base and clamped-index row out of the tap loop.
      get(axis===0?0:1);
      if(axis===0){get(13);get(6);mul();get(8);mul();}else{get(12);get(8);mul();}
      get(14);add();constant(4);mul();add();set(18);
      get(axis===0?3:4);get(axis===0?12:13);constant(ks*4);mul();add();set(19);
      emit(0x44,0,0,0,0,0,0,0,0);set(17);
      for(let k=0;k<ks;k++){
        get(17);get(18);get(19);constant(k*4);add();emit(0x28,2,0);constant(4);mul();add();loadF();
        get(5);constant(k*4);add();loadF();emit(0xa2,0xa0);set(17);
      }
      get(axis===0?1:2);get(10);constant(4);mul();add();get(17);emit(0xb6,0x38,2,0);
      get(10);constant(1);add();set(10);
      get(14);constant(1);add();set(14);get(14);get(8);emit(0x46,0x04,0x40);
      constant(0);set(14);get(12);constant(1);add();set(12);get(12);get(6);emit(0x46,0x04,0x40);
      constant(0);set(12);get(13);constant(1);add();set(13);emit(0x0b,0x0b);
      emit(0x0c,0,0x0b,0x0b);
    }
    emit(0x0b);bodies.push([3,7,0x7f,1,0x7c,2,0x7f,...code]);
  }
  const binary=new Uint8Array([0,97,115,109,1,0,0,0,
    ...section(1,[1,0x60,10,...Array(10).fill(0x7f),0]),...section(3,[3,0,0,0]),...section(5,[1,0,1]),
    ...section(7,[4,...str("run5"),0,0,...str("run11"),0,1,...str("run15"),0,2,...str("memory"),2,0]),
    ...section(10,[3,...bodies.flatMap(body=>[...u(body.length),...body])])]);
  let instance;
  try { instance = new WebAssembly.Instance(new WebAssembly.Module(binary)); } catch (_error) { return null; }
  const { memory, run5, run11, run15 } = instance.exports;
  return {
    filter(a, w, h, kernel, channels, indices) {
      const n = a.length, xs = indices.xs, ys = indices.ys;
      const pTemp=n*4,pOut=n*8,pX=n*12,pY=pX+xs.byteLength,pK=pY+ys.byteLength,bytes=pK+kernel.byteLength;
      if (bytes > memory.buffer.byteLength) memory.grow(Math.ceil((bytes-memory.buffer.byteLength)/65536));
      new Float32Array(memory.buffer,0,n).set(a);
      new Int32Array(memory.buffer,pX,xs.length).set(xs);new Int32Array(memory.buffer,pY,ys.length).set(ys);
      new Float32Array(memory.buffer,pK,kernel.length).set(kernel);
      const run=kernel.length===5?run5:kernel.length===11?run11:run15;
      run(0,pTemp,pOut,pX,pY,pK,w,h,channels,kernel.length);
      return new Float32Array(new Float32Array(memory.buffer,pOut,n));
    },
  };
}
module.exports = { create };
