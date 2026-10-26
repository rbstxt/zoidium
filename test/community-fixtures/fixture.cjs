const http=require('node:http');
const dgram=require('node:dgram');
const {randomBytes}=require('node:crypto');

async function startFixture() {
  const requests=[],connections=[],datagrams=[];
  function server(name) {
    const s=http.createServer((req,res)=>{
      requests.push({server:name,url:req.url,method:req.method,origin:req.headers.origin||null});
      res.setHeader('Access-Control-Allow-Origin','*');
      if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="icon" href="data:,"><title>Community isolation tests</title>');return;}
      if(req.url.includes('redirect')) {res.writeHead(302,{Location:'/probe/redirect-target'});res.end();return;}
      res.setHeader('Content-Type','text/javascript');res.end('postMessage("SERVER_SCRIPT_EXECUTED")');
    });
    s.on('connection',socket=>{connections.push({server:name,remote:socket.remoteAddress});});
    s.on('upgrade',(req,socket)=>{requests.push({server:name,url:req.url,method:'UPGRADE'});socket.destroy();});
    s.on('clientError',(_err,socket)=>socket.destroy());
    return s;
  }
  const host=server('host'),sink=server('sink'),udp=dgram.createSocket('udp4');
  await Promise.all([host,sink].map(s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve))));
  udp.on('message',(message,remote)=>datagrams.push({bytes:message.length,remote}));
  // HTTP/3 uses UDP on the HTTPS URL's port. Observe that port as well as TCP.
  await new Promise(resolve=>udp.bind(sink.address().port,'127.0.0.1',resolve));
  const targets={host:'http://127.0.0.1:'+host.address().port,sink:'http://127.0.0.1:'+sink.address().port,port:sink.address().port,udpPort:udp.address().port};
  return {targets,requests,connections,datagrams,reset(){requests.length=connections.length=datagrams.length=0;},async close(){udp.close();for(const s of [host,sink]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}}};
}

function bootstrapDocument(scheme) {
  const nonce=randomBytes(24).toString('base64');
  const policy="default-src 'none'; connect-src 'none'; script-src 'nonce-"+nonce+"' 'wasm-unsafe-eval'; worker-src blob:"+(scheme==='data'?' data:':'')+"; img-src 'none'; font-src 'none'; style-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const source=`'use strict';
  addEventListener('message',function start(event){
    if(event.source!==parent||!event.data||event.data.type!=='start')return;
    removeEventListener('message',start);
    const port=event.ports[0],code=event.data.source;
    const url=event.data.scheme==='data'?'data:text/javascript,'+encodeURIComponent(code):URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    try {
      const worker=new Worker(url);
      worker.onmessage=e=>port.postMessage(e.data);
      worker.onerror=e=>{port.postMessage({fatal:e.message});};
      port.onmessage=e=>{if(e.data?.type==='terminate'){worker.terminate();port.postMessage({terminated:true});}else worker.postMessage(e.data);};
      port.start();
      if(event.data.scheme!=='data')URL.revokeObjectURL(url);
    }catch(error){port.postMessage({fatal:String(error)});}
  });
  parent.postMessage({type:'isolation-frame-ready'},'*');`;
  return {policy,html:'<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'"><script nonce="'+nonce+'">'+source+'</script>'};
}

async function runInFrame(options) {
  const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.hidden=true;
  const messages=[],jobs=options.jobs||[];
  const channel=new MessageChannel();
  return new Promise((resolve,reject)=>{
    const stop=setTimeout(()=>{frame.remove();reject(new Error('frame probe deadline'));},30000);
    function finish(value){clearTimeout(stop);channel.port1.close();frame.remove();resolve(value);}
    channel.port1.onmessage=e=>{
      messages.push(e.data);
      if(e.data?.fatal){finish({fatal:e.data.fatal,messages});return;}
      if(!jobs.length){finish(e.data);return;}
      if(messages.length===jobs.length)finish(messages);
      else channel.port1.postMessage(jobs[messages.length]);
    };
    addEventListener('message',function ready(e){
      if(e.source!==frame.contentWindow||e.data?.type!=='isolation-frame-ready')return;
      removeEventListener('message',ready);
      frame.contentWindow.postMessage({type:'start',source:options.source,scheme:options.scheme},'*',[channel.port2]);
      if(jobs.length)channel.port1.postMessage(jobs[0]);
    });
    frame.srcdoc=options.html;document.body.append(frame);
  });
}
module.exports={startFixture,bootstrapDocument,runInFrame};
