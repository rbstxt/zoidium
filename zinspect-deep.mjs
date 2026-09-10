import fs from 'fs';
import { execSync } from 'child_process';
const buf = fs.readFileSync('/tmp/user-proj.json');
const proj = JSON.parse(buf.toString('utf8'));
console.log('plugins:', JSON.stringify(proj.plugins).slice(0,2000));
const seq = proj.sequence;
seq.videoTracks.forEach((t,ti)=>{
  t.clips.forEach((c,ci)=>{
    const o=c.object; if(!o) return;
    console.log('TRACK',ti,'clip',ci,'objType',o.type,'fxCount',(o.effects||[]).length,'objCount',(o.objects||[]).length);
    (o.effects||[]).forEach((e,ei)=>{ console.log('  FX',ei,'type',e.type,'props',JSON.stringify(e.properties||{}).slice(0,500)); if(e.customProperties) console.log('   customProps:',JSON.stringify(e.customProperties).slice(0,2000)); if(e.objects) console.log('   subObjs:',e.objects.length); });
    (o.objects||[]).forEach((so,si)=>{ console.log('  OBJ',si,'type',so.type,'name',so.properties&&so.properties.name); if(so.effects) console.log('   objFx:',so.effects.length); });
  });
});
console.log('audio:', JSON.stringify(seq.audioTracks).slice(0,2000));
