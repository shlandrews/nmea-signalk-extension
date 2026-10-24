import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GPS} from '../chromium-extension/lib/model.js';
import {SignalK} from '../chromium-extension/lib/signalk.js';
import {parseNmea,TextRecords,utc} from '../chromium-extension/lib/nmea0183.js';
import {Transport,YachtRaw,Actisense,SeaSmart,Receiver,decode,identifier} from '../chromium-extension/lib/nmea2000.js';
import {defaults,validateSettings,endpoint} from '../chromium-extension/settings.js';
import {validPosition} from '../chromium-extension/lib/messages.js';
import {payloads,frames,yachtLine,actisense,rmc,checksum,seasmart,delta} from './traffic.mjs';
function model(stale=2){let now=0;const wall=Date.now(),time={mono:()=>now,wall:()=>wall+now};return {gps:new GPS({...defaults,stale},time),time,tick:ms=>now+=ms};}
test('all GPS PGNs decode with SI units, true COG, UTC and HDOP',()=>{
  const fields=payloads().map(m=>[m.pgn,decode(m)]),d=Object.fromEntries(fields);
  assert.equal(d[129025].latitude,-31.95);assert.equal(d[129029].longitude,115.86);
  assert.equal(d[129029].altitude,2.5);assert.equal(d[129029].hdop,.9);assert.equal(d[129029].valid,true);
  assert.equal(d[129026].speed,2.5);assert(Math.abs(d[129026].course-90)<.01);assert(d[126992].gpsTime.endsWith('Z'));
});
test('N2K NA, invalid fix, integrity, magnetic course and short payload',()=>{
  assert.equal(decode({pgn:129026,data:new Uint8Array(8).fill(255)}).speed,null);
  const m=payloads()[2];m.data[1]=1;assert.equal(decode(m).course,null);
  const p=payloads({valid:false})[0];assert.equal(decode(p).valid,false);p.data[31]=16;p.data[32]=2;assert.equal(decode(p).valid,false);
  assert.equal(decode({pgn:129029,data:new Uint8Array(42)}),null);
  assert.equal(identifier(0x20000000),null);
});
test('fast packet interleaving isolates receiver and sequence',()=>{
  const {pgn,data}=payloads()[0],a=frames(pgn,data,23,2),b=frames(pgn,data,42,3),t=new Transport(),out=[];
  for(let i=0;i<a.length;i++)out.push(...t.feed(a[i].id,a[i].data,0),...t.feed(b[i].id,b[i].data,0));
  assert.deepEqual(out.map(m=>m.source),[23,42]);assert.deepEqual(out[0].data,data);
});
test('fast packet loss, duplication, timeout and restart',()=>{
  const {pgn,data}=payloads()[0],f=frames(pgn,data),t=new Transport();
  t.feed(f[0].id,f[0].data,0);assert.deepEqual(t.feed(f[2].id,f[2].data,1),[]);
  for(const frame of f.slice(1))assert.deepEqual(t.feed(frame.id,frame.data,2),[]);
  t.feed(f[0].id,f[0].data,0);assert.deepEqual(t.feed(f[1].id,f[1].data,751),[]);
  let out=[];for(const frame of f)out.push(...t.feed(frame.id,frame.data,1000));assert.equal(out.length,1);
});
test('passive ISO BAM and RTS transport validate sequences and abort',()=>{
  const {pgn,data}=payloads()[0];
  for(const control of [32,16]){
    const t=new Transport(),cid=(3<<26)|(60416<<8)|(255<<8)|23,dt=(3<<26)|(60160<<8)|(255<<8)|23;
    const cm=new Uint8Array([control,data.length,0,Math.ceil(data.length/7),255,pgn&255,pgn>>>8&255,pgn>>>16]);
    t.feed(cid,cm,0);const out=[];
    for(let offset=0,index=1;offset<data.length;offset+=7,index++){const d=new Uint8Array(8).fill(255);d[0]=index;d.set(data.slice(offset,offset+7),1);out.push(...t.feed(dt,d,100));}
    assert.deepEqual(out[0].data,data);
    t.feed(cid,cm,200);t.feed(cid,new Uint8Array(8).fill(255),201);assert.equal(t.tp.size,0);
  }
});
test('Yacht RAW text fragments, echoes and rejection of 0183',()=>{
  const adapter=new YachtRaw(),wire=payloads().flatMap(({pgn,data})=>frames(pgn,data)).map(yachtLine).join(''),out=[];
  for(let i=0;i<wire.length;i+=3)out.push(...adapter.feed(wire.slice(i,i+3),0));
  assert.equal(out.length,4);assert.deepEqual(adapter.feed(rmc()),[]);
  assert.deepEqual(adapter.feed(yachtLine(frames(129025,payloads()[1].data)[0]).replace(' R ',' T ')),[]);
});
test('Actisense binary escaping, fragmented messages, bad checksum and resync',()=>{
  const p={pgn:129025,data:new Uint8Array(8).fill(16)},wire=actisense(p),adapter=new Actisense(),out=[];
  for(const b of wire)out.push(...adapter.feed(new Uint8Array([b])));
  assert.deepEqual(out[0].data,p.data);const bad=wire.slice();bad[bad.length-3]^=1;assert.deepEqual(adapter.feed(bad),[]);
  assert.equal(adapter.feed(wire).length,1);
});
test('SeaSmart checksums and reassembled PGNs over text messages',()=>{
  const a=new SeaSmart();const wire=payloads().map(m=>seasmart(m)).join('\r\n');const out=a.feed(wire);
  assert.equal(out.length,4);assert.equal(decode(out[0]).valid,true);
  assert.deepEqual(a.feed('$PCDIN,01F801,00000000,17,0000000000000000*00'),[]);
});
test('receiver locks address, filters, switches only after expiry, clears cached motion',()=>{
  const {gps,tick}=model(),r=new Receiver(gps);const p=payloads();r.feed({...p[0],source:23});r.feed({...p[2],source:23});
  r.feed({...payloads({lat:1})[0],source:42});assert.equal(gps.sourceAddress,23);assert.equal(gps.values.speed,2.5);
  tick(2100);r.feed({...payloads({lat:1})[0],source:42});assert.equal(gps.sourceAddress,42);assert.equal(gps.values.speed,null);
  gps.config.sourceAddress=23;r.feed({...p[1],source:42});assert.equal(gps.values.latitude,1);
});
test('invalid and expired GNSS quality cannot be overwritten by rapid position',()=>{
  const {gps,tick}=model(),r=new Receiver(gps);r.feed({...payloads({valid:false})[0],source:23});r.feed({...payloads()[1],source:23});assert.equal(gps.valid,false);
  r.feed({...payloads()[0],source:23});assert.equal(gps.valid,true);tick(2100);r.feed({...payloads()[1],source:23});assert.equal(gps.valid,false);
});
test('model rejects invalid coordinates, old receiver timestamps and nonfinite data',()=>{
  const {gps}=model();gps.update({latitude:91,longitude:0});assert.equal(gps.valid,false);
  gps.update({latitude:1,longitude:2,gpsTime:'2000-01-01T00:00:00Z'});assert.equal(gps.valid,false);
  gps.update({latitude:NaN,longitude:2,speed:Infinity});assert.equal(gps.values.latitude,null);assert.equal(gps.values.speed,null);
});
test('monotonic stale/optional expiry keeps original UTC timestamp and accuracy estimates',()=>{
  const {gps,tick}=model();gps.connection='connected';gps.update({latitude:1,longitude:2,hdop:2,speed:3});const stamp=gps.snapshot().timestamp;
  assert.equal(gps.snapshot().accuracy,10);tick(2100);const s=gps.snapshot();assert.equal(s.status,'stale');assert.equal(s.timestamp,stamp);assert.equal(s.speed,null);assert.equal(s.accuracy,100);
});
test('0183 different talkers, S/W, checksum, invalid fixes, bounded record fragments',()=>{
  const raw=rmc(-31.95,-115.86);assert(Math.abs(parseNmea(raw).longitude+115.86)<1e-8);
  assert.equal(parseNmea(raw.slice(0,-2)+'00'),null);assert.equal(parseNmea('$GPRMC,120000,V,,,,,,,241026').valid,false);
  for(const talker of ['GP','GN','GA','GL'])assert.equal(parseNmea(`$${talker}GLL,3157.0,S,11551.6,E,120000,A`).valid,true);
  assert.equal(parseNmea('$GPGLL,3199.0,S,11551.6,E,120000,A'),null);
  const lines=new TextRecords(parseNmea);assert.deepEqual(lines.feed(raw.slice(0,9)),[]);assert.equal(lines.feed(raw.slice(9)).length,1);lines.feed('x'.repeat(9000));assert.equal(lines.buffer,'');
});
test('0183 GGA, VTG, units, UTC midnight rollover and malformed dates',()=>{
  const g=parseNmea('$GNGGA,120000,3157.0,S,11551.6,E,1,12,0.9,2.5,M,0,M,,');assert.equal(g.altitude,2.5);assert.equal(g.hdop,.9);
  assert.equal(parseNmea('$GNVTG,90.0,T,,M,10.0,N,18.5,K,A').speed,10*1852/3600);
  assert.equal(utc('235959',null,Date.UTC(2026,9,24,0,0,1)),'2026-10-23T23:59:59.000Z');assert.equal(utc('250000',null),null);assert.equal(utc('120000','321026'),null);
});
test('Signal K own context, source isolation, SI units, quality and old cached deltas',()=>{
  const {gps,time,tick}=model(),s=new SignalK(gps);s.feed({self:'vessels.own'});s.feed({...delta(),context:'vessels.other'});assert.equal(gps.received,null);
  s.feed(delta({now:time.wall()}));assert.equal(gps.valid,true);assert.equal(gps.values.speed,2.5);assert.equal(gps.values.course,90);
  s.feed(delta({lat:1,source:'gps.42',now:time.wall()}));assert.equal(gps.values.latitude,-31.95);
  s.feed(delta({quality:'No GNSS',now:time.wall()}));assert.equal(gps.valid,false);
  tick(2100);s.feed(delta({now:time.wall(),source:'gps.42',lat:1}));assert.equal(gps.values.latitude,1);
  s.feed(delta({now:time.wall()-60000,source:'gps.42'}));assert.equal(gps.valid,false);
  s.feed({context:'vessels.self',updates:[{$source:'gps.42',timestamp:new Date(time.wall()).toISOString(),values:[{path:'navigation.speedOverGround',value:2.5}]}]});assert.equal(gps.valid,false);
});
test('config rejects raw transports, malformed endpoints and invalid filter values',()=>{
  for(const v of [{source:'nmea-tcp'},{host:'tcp://host'},{protocol:'tcp'},{port:0},{sourceAddress:254},{pgns:[126992]},{stale:NaN}])assert.throws(()=>validateSettings({...defaults,...v}));
  const c=validateSettings({...defaults,token:'secret',authMode:'query'});assert.equal(endpoint(c).searchParams.has('token'),false);assert.equal(endpoint(c,true).searchParams.get('token'),'secret');
  assert.equal(endpoint({...c,host:'::1'}).hostname,'[::1]');
});
test('unsafe Signal K integrity cannot be masked by good method quality in any order',()=>{
  const {gps,time}=model(),s=new SignalK(gps),d=delta({now:time.wall()});
  d.updates[0].values.unshift({path:'navigation.gnss.integrity',value:'Unsafe'});s.feed(d);assert.equal(gps.valid,false);
  s.feed(delta({now:time.wall()}));assert.equal(gps.valid,false);
  const safe=delta({now:time.wall()});safe.updates[0].values.push({path:'navigation.gnss.integrity',value:'Safe'});s.feed(safe);assert.equal(gps.valid,true);
});
test('normalized messages reject malformed and fabricated future positions',()=>{
  const {gps}=model();gps.connection='connected';gps.update({latitude:1,longitude:2});const p=gps.snapshot();assert.equal(validPosition(p),true);
  assert.equal(validPosition({...p,latitude:Infinity}),false);assert.equal(validPosition({...p,timestamp:Date.now()+60000}),false);assert.equal(validPosition({...p,status:'execute'}),false);
});
