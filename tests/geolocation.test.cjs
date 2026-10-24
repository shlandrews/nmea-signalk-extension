const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('chromium-extension/geolocation.js','utf8');
function setup(secure=true,permission){
  let listener,now=100000,timers=new Map(),next=0,nativeCalls=0,nativeCleared=0;
  const geo={getCurrentPosition(){nativeCalls++},watchPosition(){nativeCalls++;return 888},clearWatch(){nativeCleared++}};
  const win={isSecureContext:secure,addEventListener(type,fn){listener=fn},postMessage(){}};
  const ctx={navigator:{geolocation:geo,...(permission?{permissions:{query:()=>Promise.resolve({state:permission})}}:{})},window:win,
    document:{permissionsPolicy:{allowsFeature:()=>true}},location:{hostname:'example.test'},Date:{now:()=>now},
    setTimeout(fn,delay=0){const id=++next;timers.set(id,{fn,at:now+delay});return id},clearTimeout(id){timers.delete(id)}};
  vm.runInNewContext(source,ctx);
  function tick(ms=0){now+=ms;let n=0;while(true){const entry=[...timers].find(([id,t])=>t.at<=now);if(!entry)break;timers.delete(entry[0]);entry[1].fn();if(++n>1000)throw Error('timer loop');}}
  function send(action,position=null,ttl=10000){listener({source:win,data:{channel:'marine-gps-v2',action,position,expiresAt:position?position.timestamp+ttl:null}});}
  const fix=(overrides={})=>({type:'gps',version:1,status:'fix',valid:true,latitude:-31.95,longitude:115.86,timestamp:now,accuracy:20,speed:2,course:90,...overrides});
  return {geo,send,tick,fix,nativeCalls:()=>nativeCalls,nativeCleared:()=>nativeCleared};
}
test('multiple watches update, no duplicate callbacks, clearWatch cancels',()=>{
  const s=setup(),a=[],b=[];const id=s.geo.watchPosition(p=>a.push(p)),other=s.geo.watchPosition(p=>b.push(p));
  s.send('gps',s.fix());s.tick();s.send('gps',s.fix());s.tick();assert.equal(a.length,1);assert.equal(b.length,1);
  s.geo.clearWatch(id);s.tick(10);s.send('gps',s.fix({latitude:1}));s.tick();assert.equal(a.length,1);assert.equal(b.length,2);s.geo.clearWatch(other);
});
test('single request maximumAge and original timestamp, SI optional coordinates',()=>{
  const s=setup(),p=s.fix();s.send('gps',p);s.tick(100);let result;
  s.geo.getCurrentPosition(x=>result=x,null,{maximumAge:1000});s.tick();assert.equal(result.timestamp,p.timestamp);assert.equal(result.coords.heading,90);assert.equal(result.coords.speed,2);assert.equal(result.coords.altitude,null);
});
test('timeout, maximumAge zero and no duplicate single callback',()=>{
  const s=setup();let errors=[],calls=0;s.geo.getCurrentPosition(()=>calls++,e=>errors.push(e),{timeout:25});s.tick(25);s.tick();assert.equal(errors[0].code,3);
  s.send('gps',s.fix());s.tick();assert.equal(calls,0);s.tick(10);s.geo.getCurrentPosition(()=>assert.fail(),e=>errors.push(e),{timeout:0});s.tick();assert.equal(errors[1].code,3);
});
test('unavailable, native and explicit stale last result',()=>{
  const s=setup();let errors=[];s.geo.watchPosition(()=>{},e=>errors.push(e));s.send('unavailable');s.tick();assert.equal(errors[0].code,2);
  const n=setup();n.send('native');n.geo.getCurrentPosition(()=>{});assert.equal(n.nativeCalls(),1);
  const l=setup(),p=l.fix();l.tick(20000);l.send('last',p);let result;l.geo.getCurrentPosition(x=>result=x);l.tick();assert.equal(result.timestamp,p.timestamp);
});
test('secure context and explicitly denied browser permission are respected',async()=>{
  const s=setup(false);let err;s.geo.getCurrentPosition(()=>{},e=>err=e);s.tick();assert.equal(err.code,1);
  const d=setup(true,'denied');let denied;d.geo.watchPosition(()=>assert.fail(),e=>denied=e);d.send('gps',d.fix());await Promise.resolve();d.tick();assert.equal(denied.code,1);d.tick(1);d.send('gps',d.fix());d.tick();
});
test('expiry reports error and new data recovers after native fallback',()=>{
  const s=setup();let positions=[],errors=[];s.geo.watchPosition(p=>positions.push(p),e=>errors.push(e));s.send('gps',s.fix(),1000);s.tick();s.tick(1002);s.tick();assert.equal(errors[0].code,2);
  s.send('native');assert.equal(s.nativeCalls(),1);s.tick(10);s.send('gps',s.fix());s.tick();assert.equal(positions.length,2);assert.equal(s.nativeCleared(),1);
});
test('clearWatch prevents queued callbacks',()=>{
  const s=setup();let calls=0;const id=s.geo.watchPosition(()=>calls++);s.send('gps',s.fix());s.geo.clearWatch(id);s.tick();assert.equal(calls,0);
});
test('changing native fallback to last/unavailable cancels the native watch',()=>{
  const s=setup();s.send('native');s.geo.watchPosition(()=>{});assert.equal(s.nativeCalls(),1);
  s.send('last',s.fix());assert.equal(s.nativeCleared(),1);s.send('native');s.send('unavailable');assert.equal(s.nativeCleared(),2);
});
test('malformed, future and out-of-range page messages cannot supply GPS',()=>{
  const s=setup();let calls=0,errors=[];s.geo.watchPosition(()=>calls++,e=>errors.push(e),{timeout:20});
  s.send('gps',s.fix({latitude:100}));s.send('gps',s.fix({timestamp:200000}));s.send('execute',s.fix());s.tick(20);s.tick();assert.equal(calls,0);assert.equal(errors[0].code,3);
});
test('isolated relay hides credentials/settings, resolves site policy and retains only valid last fix',()=>{
  const sent=[],privileged=[],timers=new Map();let onMessage,subscribe,now=100000,id=0;
  const chrome={runtime:{id:'own',lastError:null,onMessage:{addListener(fn){onMessage=fn}},sendMessage(message,reply){privileged.push(message);subscribe=reply;}}};
  vm.runInNewContext(fs.readFileSync('chromium-extension/relay.js','utf8'),{chrome,location:{hostname:'example.test'},Date:{now:()=>now},
    window:{postMessage(m){sent.push(m)}},setTimeout(fn){timers.set(++id,fn);return id},clearTimeout(i){timers.delete(i)}});
  const p={type:'gps',version:1,status:'fix',valid:true,latitude:1,longitude:2,accuracy:20,timestamp:now,source:'signalk',diagnostic:'secret',token:'secret'};
  const policy={enabled:true,disabledSites:['other.test'],fallback:'last',stale:1};subscribe({policy,position:p});
  assert.equal(sent.at(-1).action,'gps');assert(!JSON.stringify(sent).includes('secret'));assert(!JSON.stringify(sent).includes('disabledSites'));assert(!JSON.stringify(sent).includes('other.test'));
  now+=10;onMessage({type:'gps-state',policy,position:{...p,status:'no-fix',valid:false,latitude:40}},{id:'own'});assert.equal(sent.at(-1).action,'last');assert.equal(sent.at(-1).position.latitude,1);
  onMessage({type:'gps-state',policy:{...policy,disabledSites:['example.test']}},{id:'own'});assert.equal(sent.at(-1).action,'native');assert.equal(privileged.length,1);
});
