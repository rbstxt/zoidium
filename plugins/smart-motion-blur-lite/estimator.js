"use strict";

// Independent scalar reference reconstruction from the recorded method audit.
// Native scan dependencies are intentional; do not replace sweeps with Jacobi
// neighbor jumps. Border convolution uses clamping pending native edge parity.
const F = Float32Array;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const binomial = new F([1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]);

function sample(a, w, h, x, y, channels = 1, channel = 0) {
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const jx = Math.min(ix + 1, w - 1), jy = Math.min(iy + 1, h - 1);
  return (1 - fy) * ((1 - fx) * a[(iy * w + ix) * channels + channel]
    + fx * a[(iy * w + jx) * channels + channel])
    + fy * ((1 - fx) * a[(jy * w + ix) * channels + channel]
    + fx * a[(jy * w + jx) * channels + channel]);
}

const filterIndices=new Map();
const fastFilter=require("./fast-filter.js").create();
const fastScore=require("./fast-score.js").create();
function filter(a,w,h,kernel,channels=1){
  const radius=(kernel.length-1)/2,ks=kernel.length,key=[w,h,ks,channels].join(":");
  let indices=filterIndices.get(key);
  if(!indices){
    const xs=new Int32Array(w*ks),ys=new Int32Array(h*ks);
    for(let x=0;x<w;x++)for(let k=0;k<ks;k++)xs[x*ks+k]=clamp(x+k-radius,0,w-1)*channels;
    for(let y=0;y<h;y++)for(let k=0;k<ks;k++)ys[y*ks+k]=clamp(y+k-radius,0,h-1)*w*channels;
    indices={xs,ys};if(filterIndices.size>=64)filterIndices.clear();filterIndices.set(key,indices);
  }
  if(fastFilter)return fastFilter.filter(a,w,h,kernel,channels,indices);
  const {xs,ys}=indices,temp=new F(a.length),out=new F(a.length),row=w*channels;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){
    let v=0;const base=y*row+c,offset=x*ks;
    for(let k=0;k<ks;k++)v+=a[base+xs[offset+k]]*kernel[k];
    temp[(y*w+x)*channels+c]=v;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++){
    let v=0;const base=x*channels+c,offset=y*ks;
    for(let k=0;k<ks;k++)v+=temp[ys[offset+k]+base]*kernel[k];
    out[(y*w+x)*channels+c]=v;
  }
  return out;
}

function gaussian(radius) {
  const k = new F(2 * radius + 1); let total = 0;
  for (let i = -radius; i <= radius; i++) { k[i + radius] = 2 ** (-9 * i * i / (radius * radius)); total += k[i + radius]; }
  for (let i = 0; i < k.length; i++) k[i] /= total;
  return k;
}
const g7 = gaussian(7), g5 = gaussian(5);

function resize(a, w, h, nw, nh, channels = 1, vector = false) {
  const out = new F(nw * nh * channels), sx = (w - 1) / Math.max(1, nw - 1), sy = (h - 1) / Math.max(1, nh - 1);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < channels; c++) {
    out[(y * nw + x) * channels + c] = sample(a, w, h, x * sx, y * sy, channels, c) / (vector ? (c === 0 ? sx : sy) : 1);
  }
  return out;
}

function pyramid(rgba, width, height) {
  const grey = new F(width * height);
  for (let i = 0; i < grey.length; i++) grey[i] = 0.3 * rgba[4 * i] + 0.59 * rgba[4 * i + 1] + 0.11 * rgba[4 * i + 2];
  let w = Math.max(3, Math.floor(width / 2)), h = Math.max(3, Math.floor(height / 2));
  let a = resize(filter(grey, width, height, binomial), width, height, w, h);
  const levels = [];
  for (;;) {
    const low = filter(a, w, h, binomial), band = new F(a.length);
    for (let i = 0; i < band.length; i++) band[i] = a[i] - low[i];
    levels.push({ w, h, image: band });
    const nw = Math.floor(w / 2), nh = Math.floor(h / 2);
    if (nw < 3 || nh < 3) break;
    a = resize(low, w, h, nw, nh); w = nw; h = nh;
  }
  return levels;
}

function gradients(a, w, h) {
  const g = new F(w * h * 2), tensor = new F(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = Math.max(0, x - 1), r = Math.min(w - 1, x + 1), b = Math.max(0, y - 1), t = Math.min(h - 1, y + 1);
    const gx = (a[y * w + r] - a[y * w + l]) / Math.max(1, r - l), gy = (a[t * w + x] - a[b * w + x]) / Math.max(1, t - b);
    g[2 * i] = gx; g[2 * i + 1] = gy;
    tensor[3 * i] = gx * gx; tensor[3 * i + 1] = gx * gy; tensor[3 * i + 2] = gy * gy;
  }
  return { g, tensor: filter(tensor, w, h, g7, 3) };
}

function iterate(current, previous, w, h, vector, gradient) {
  const b = new F(vector.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, qx = x + vector[2 * i], qy = y + vector[2 * i + 1];
    if (qx < 0 || qy < 0 || qx > w - 1 || qy > h - 1) continue;
    const residual = sample(previous, w, h, qx, qy) - current[i];
    b[2 * i] = residual * gradient.g[2 * i]; b[2 * i + 1] = residual * gradient.g[2 * i + 1];
  }
  const smooth = filter(b, w, h, g7, 2), a = gradient.tensor;
  for (let i = 0; i < w * h; i++) {
    const xx = a[3 * i], xy = a[3 * i + 1], yy = a[3 * i + 2], det = xx * yy - xy * xy;
    if (Math.abs(det) <= 40) continue;
    vector[2 * i] -= (yy * smooth[2 * i] - xy * smooth[2 * i + 1]) / det;
    vector[2 * i + 1] -= (xx * smooth[2 * i + 1] - xy * smooth[2 * i]) / det;
  }
  return filter(vector, w, h, g5, 2);
}

function sweeps(current, previous, w, h, v) {
  if(fastScore?.sweeps){fastScore.sweeps(current,previous,w,h,v);}
  else {
  // Cache each destination score; neighboring vector changes do not change
  // that score. Keep all in-place sweep dependencies and comparison order.
  const scores=new Float64Array(w*h);scores.fill(NaN);
  const score = fastScore?.bind(current,previous,w,h)||((x, y, vx, vy) => {
    const qx = x + vx, qy = y + vy;
    if (!(qx >= 1 && qy >= 1 && qx < w - 1 && qy < h - 1)) return Infinity;
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const d = current[(y + dy) * w + x + dx] - sample(previous, w, h, qx + dx, qy + dy);
      sum += d * d;
    }
    return sum;
  });
  const propose = (x, y, nx, ny) => {
    const i = 2 * (y * w + x), j = 2 * (ny * w + nx);
    if(v[i]===v[j]&&v[i+1]===v[j+1])return;
    const pixel=y*w+x;
    let before=scores[pixel];if(Number.isNaN(before))before=score(x,y,v[i],v[i+1]);
    const after=score(x,y,v[j],v[j+1]);
    if(after<before){v[i]=v[j];v[i+1]=v[j+1];scores[pixel]=after;}else scores[pixel]=before;
  };
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) propose(x, y, x - 1, y);
  for (let y = 1; y < h - 1; y++) for (let x = w - 2; x >= 1; x--) propose(x, y, x + 1, y);
  for (let x = 1; x < w - 1; x++) for (let y = 1; y < h - 1; y++) propose(x, y, x, y - 1);
  for (let x = 1; x < w - 1; x++) for (let y = h - 2; y >= 1; y--) propose(x, y, x, y + 1);
  }
  // Native GPU dispatches explicitly copy edge scanlines after matching.
  for (let x = 0; x < w; x++) for (const [y, ny] of [[0, 1], [h - 1, h - 2]]) {
    const i = 2 * (y * w + x), j = 2 * (ny * w + x); v[i] = v[j]; v[i + 1] = v[j + 1];
  }
  for (let y = 0; y < h; y++) for (const [x, nx] of [[0, 1], [w - 1, w - 2]]) {
    const i = 2 * (y * w + x), j = 2 * (y * w + nx); v[i] = v[j]; v[i + 1] = v[j + 1];
  }
}

function estimate(currentRGBA, previousRGBA, width, height, sensitivity, cache) {
  const current=pyramid(currentRGBA,width,height);
  let reuse=cache&&cache.width===width&&cache.height===height&&cache.rgba?.length===previousRGBA.length;
  if(reuse)for(let i=0;i<previousRGBA.length;i++)if(cache.rgba[i]!==previousRGBA[i]){reuse=false;break;}
  const previous=reuse?cache.pyramid:pyramid(previousRGBA,width,height);
  if(cache){
    if(!cache.rgba||cache.rgba.length!==currentRGBA.length)cache.rgba=new Uint8Array(currentRGBA.length);
    cache.rgba.set(currentRGBA);cache.width=width;cache.height=height;cache.pyramid=current;
  }
  const depth = clamp(current.length + 2 * Math.log2(Math.max(1e-12, sensitivity)), 0, current.length);
  const start = Math.min(current.length - 1, Math.floor(depth)), fraction = depth >= current.length ? 1 : depth - start;
  let vector = null, oldW = 0, oldH = 0;
  for (let level = start; level >= 0; level--) {
    const { w, h, image } = current[level], other = previous[level].image;
    vector = vector ? resize(vector, oldW, oldH, w, h, 2, true) : new F(w * h * 2);
    const gradient = gradients(image, w, h);
    for (let iteration = 0; iteration < 3; iteration++) {
      vector = iterate(image, other, w, h, vector, gradient);
      if (level === 0 && iteration === 1) sweeps(image, other, w, h, vector);
    }
    if (level !== 0) sweeps(image, other, w, h, vector);
    if (level === start) for (let i = 0; i < vector.length; i++) vector[i] *= fraction;
    oldW = w; oldH = h;
  }
  const packed = new F(oldW * oldH * 4), sx = (width - 1) / (oldW - 1), sy = (height - 1) / (oldH - 1);
  for (let i = 0; i < vector.length / 2; i++) { packed[4 * i] = vector[2 * i] * sx; packed[4 * i + 1] = vector[2 * i + 1] * sy; packed[4 * i + 3] = 1; }
  return { data: packed, width: oldW, height: oldH };
}

function createEstimator(){const cache={};return {estimate:(a,b,w,h,s)=>estimate(a,b,w,h,s,cache)};}
function createSmoothEstimator(){
  let pair=null;const estimator=createEstimator();
  const equal=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>v===b[i]);
  return {estimate(a,b,w,h,s,nativeW=w,nativeH=h){
    if(!pair||pair.w!==w||pair.h!==h||!equal(pair.a,a)||!equal(pair.b,b))
      pair={a:a.slice(),b:b.slice(),w,h,fields:new Map()};
    const get=index=>{
      let field=pair.fields.get(index);
      if(!field){
        if(index===0){const fw=Math.max(3,Math.floor(w/2)),fh=Math.max(3,Math.floor(h/2)),data=new F(fw*fh*4);
          for(let i=3;i<data.length;i+=4)data[i]=1;field={data,width:fw,height:fh};}
        else field=estimator.estimate(a,b,w,h,index/40);
        pair.fields.set(index,field);
      }
      return field;
    };
    s=clamp(s,0,1);
    if(s>0&&nativeW>w){
      const levels=(width,height)=>{let n=1;width=Math.max(3,Math.floor(width/2));height=Math.max(3,Math.floor(height/2));while(Math.floor(width/2)>=3&&Math.floor(height/2)>=3){n++;width=Math.floor(width/2);height=Math.floor(height/2);}return n;};
      const fullFloor=2**(-levels(nativeW,nativeH)/2),halfFloor=2**(-levels(w,h)/2);
      const firstIndex=Math.min(40,Math.ceil(halfFloor*40+1e-9)),firstSensitivity=firstIndex/40;
      if(s<firstSensitivity){
        const base=get(firstIndex),weight=clamp((s-fullFloor)/(firstSensitivity-fullFloor),0,1),data=new F(base.data.length);
        for(let i=0;i<data.length;i+=4){data[i]=base.data[i]*weight;data[i+1]=base.data[i+1]*weight;data[i+3]=1;}
        return {data,width:base.width,height:base.height};
      }
    }
    const lo=Math.min(40,Math.floor(s*40+1e-10)),hi=Math.min(40,lo+1);
    const lower=get(lo),t=(s-lo/40)/.025;
    if(hi===lo||t<=1e-10)return {data:lower.data.slice(),width:lower.width,height:lower.height};
    const upper=get(hi),data=new F(lower.data.length);
    for(let i=0;i<data.length;i+=4){data[i]=lower.data[i]+t*(upper.data[i]-lower.data[i]);data[i+1]=lower.data[i+1]+t*(upper.data[i+1]-lower.data[i+1]);data[i+3]=1;}
    return {data,width:lower.width,height:lower.height};
  }};
}
module.exports = { estimate, createEstimator, createSmoothEstimator };
