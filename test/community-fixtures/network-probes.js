async function networkProbes(targets) {
  const results = [], violations = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  addEventListener('securitypolicyviolation', event => violations.push({directive:event.effectiveDirective, blocked:event.blockedURI}));
  async function attempt(name, run) {
    try {
      const value = await Promise.race([Promise.resolve().then(run), delay(700).then(() => 'pending')]);
      results.push({name, outcome:'returned', value:value ?? null});
    } catch (error) { results.push({name, outcome:'rejected', error:String(error)}); }
  }
  function eventFailure(object) {
    return new Promise((resolve, reject) => {
      object.onerror = () => { object.close?.(); reject(new Error('network error event')); };
      object.onopen = () => { object.close?.(); resolve('opened'); };
    });
  }
  const http = targets.sink, https = targets.sink.replace('http:', 'https:');
  const target = path => http + '/probe/' + path;
  await attempt('fetch-second-origin', () => fetch(target('fetch')));
  await attempt('fetch-same-editor-origin', () => fetch(targets.host + '/probe/editor'));
  await attempt('fetch-no-cors-keepalive', () => fetch(target('no-cors'), {mode:'no-cors',keepalive:true}));
  await attempt('fetch-redirect', () => fetch(target('redirect')));
  await attempt('fetch-https', () => fetch(https + '/probe/https'));
  await attempt('fetch-dns-sentinel', () => fetch('https://zoidium-plugin-network-probe.invalid/probe/dns'));
  await attempt('xhr', () => new Promise((resolve,reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('GET',target('xhr')); xhr.onload=()=>resolve('loaded'); xhr.onerror=()=>reject(new Error('XHR network error')); xhr.send();
  }));
  await attempt('websocket', () => eventFailure(new WebSocket(http.replace('http:', 'ws:') + '/probe/ws')));
  await attempt('websocket-tls', () => eventFailure(new WebSocket(https.replace('https:', 'wss:') + '/probe/wss')));
  await attempt('websocket-stream', async () => { const socket = new WebSocketStream(http.replace('http:', 'ws:') + '/probe/wss-stream'); await socket.opened; return 'opened'; });
  await attempt('eventsource', () => eventFailure(new EventSource(target('sse'))));
  await attempt('importScripts-http', () => { importScripts(target('import.js')); return 'executed'; });
  await attempt('importScripts-blob', () => { const u=URL.createObjectURL(new Blob(['self.importProbe=true'],{type:'text/javascript'})); try { importScripts(u); return 'executed'; } finally {URL.revokeObjectURL(u);} });
  await attempt('dynamic-import-http', () => import(target('module.js')));
  await attempt('dynamic-import-data', () => import('data:text/javascript,export default 42'));
  await attempt('worker-http', () => new Promise((resolve,reject) => {
    const w=new Worker(target('worker.js')); w.onmessage=()=>{w.terminate();resolve('executed');}; w.onerror=()=>{w.terminate();reject(new Error('worker error'));};
  }));
  await attempt('worker-editor-origin', () => new Promise((resolve,reject) => {
    const w=new Worker(targets.host+'/probe/worker.js'); w.onmessage=()=>{w.terminate();resolve('executed');}; w.onerror=()=>{w.terminate();reject(new Error('worker error'));};
  }));
  for (const scheme of ['blob','data']) await attempt('nested-worker-'+scheme, () => new Promise((resolve,reject) => {
    const source='fetch('+JSON.stringify(target('nested-'+scheme))+').then(()=>postMessage("LEAK"),e=>postMessage(String(e)))';
    const u=scheme==='blob'?URL.createObjectURL(new Blob([source],{type:'text/javascript'})):'data:text/javascript,'+encodeURIComponent(source);
    const w=new Worker(u); const stop=()=>{w.terminate();if(scheme==='blob')URL.revokeObjectURL(u);};
    w.onmessage=e=>{stop();resolve(e.data);};w.onerror=()=>{stop();reject(new Error('nested worker error'));};
  }));
  await attempt('image-constructor', () => {const image=new Image();image.src=target('image.png');return 'created';});
  await attempt('font-face-url', () => new FontFace('NetworkProbe','url('+target('font.woff2')+')').load());
  await attempt('font-face-worker-fonts', async () => {const f=new FontFace('NetworkProbe2','url('+target('font2.woff2')+')');fonts.add(f);await f.load();return 'loaded';});
  await attempt('offscreen-font', () => {const c=new OffscreenCanvas(2,2);const ctx=c.getContext('2d');ctx.font='10px NetworkProbe';ctx.fillText('x',0,0);return 'local fallback only';});
  await attempt('image-bitmap-fetch', async () => createImageBitmap(await (await fetch(target('bitmap.png'))).blob()));
  await attempt('svg-external-image', async () => {const b=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="'+target('svg-image.png')+'" width="2" height="2"/></svg>'],{type:'image/svg+xml'});const i=await createImageBitmap(b);i.close();return 'decoded';});
  await attempt('webtransport', async () => {const t=new WebTransport(https+'/probe/wt');await t.ready;t.close();return 'opened';});
  await attempt('sendBeacon', () => navigator.sendBeacon(target('beacon'),'probe'));
  await attempt('rtcpeerconnection-stun', async () => {const p=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:'+targets.udpPort}]});p.createDataChannel('probe');await p.setLocalDescription(await p.createOffer());p.close();return 'started';});
  await attempt('rtcdatachannel-constructor', () => new RTCDataChannel());
  await attempt('broadcast-editor', () => {const b=new BroadcastChannel('zoidium-host-probe');b.postMessage('LEAK');b.close();return 'sent';});
  await attempt('serviceworker', () => navigator.serviceWorker.register(target('sw.js')));
  await attempt('sharedworker', () => {const w=new SharedWorker(target('shared.js'));w.port.close();return 'created';});
  await attempt('cache-add', () => caches.open('probe').then(cache=>cache.add(target('cache'))));
  await attempt('window-open', () => open(target('popup')));
  await attempt('dom-form', () => {const f=document.createElement('form');f.action=target('form');f.submit();});
  await attempt('dns-prefetch-dom', () => {const l=document.createElement('link');l.rel='dns-prefetch';l.href='https://zoidium-plugin-network-probe.invalid';document.head.append(l);});
  await attempt('location-navigate', () => {location.href=target('navigate');return location.href;});
  await attempt('tcp-socket', () => new TCPSocket('127.0.0.1',targets.port));
  await attempt('udp-socket', () => new UDPSocket({remoteAddress:'127.0.0.1',remotePort:targets.udpPort}));
  await attempt('eval-constructor', () => Function('return 42')());
  await delay(150);
  return {results,violations,globals:Object.fromEntries(['fetch','XMLHttpRequest','WebSocket','WebSocketStream','EventSource','Worker','SharedWorker','Image','FontFace','OffscreenCanvas','WebTransport','RTCPeerConnection','RTCDataChannel','document','open','BroadcastChannel','TCPSocket','UDPSocket'].map(k=>[k,typeof globalThis[k]])),origin:self.origin,location:location.href,secure:isSecureContext};
}
if (typeof module !== 'undefined') module.exports = {networkProbes};
