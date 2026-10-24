import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Connection} from '../chromium-extension/lib/connection.js';
import {defaults,settings} from '../chromium-extension/settings.js';
import {delta,rmc,payloads,seasmart,actisense} from './traffic.mjs';
function harness(source='signalk',extra={}){
  const sockets=[],out=[],timers=new Map();let now=0,next=0;const wall=Date.now();
  class Socket{constructor(url){this.url=url;this.readyState=0;sockets.push(this)}send(message){this.sent=message}close(){this.readyState=3}open(){this.readyState=1;this.onopen?.()}message(data){this.onmessage?.({data})}disconnect(){this.readyState=3;this.onclose?.()}}
  const c=new Connection(p=>out.push(p),{Socket,time:{mono:()=>now,wall:()=>wall+now},random:()=>.5,setTimer(fn,ms){timers.set(++next,{fn,at:now+ms});return next},clearTimer(id){timers.delete(id)}});
  c.configure({...defaults,enabled:true,source,...extra});
  return {c,sockets,out,wall,tick(ms){now+=ms;c.tick();for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}}};
}
test('direct Signal K subscription, token isolation and valid live data',()=>{
  const h=harness('signalk',{authMode:'query',token:'private-token'}),ws=h.sockets[0];ws.open();
  assert.equal(new URL(ws.url).searchParams.get('token'),'private-token');assert.equal(new URL(ws.url).searchParams.get('subscribe'),'none');
  assert(JSON.parse(ws.sent).subscribe.some(s=>s.path==='navigation.position'));ws.message(JSON.stringify(delta({now:h.wall})));
  assert.equal(h.out.at(-1).status,'fix');assert(!JSON.stringify(h.out).includes('private-token'));
});
test('disconnect/reconnect backoff, stale expiry and disabled shutdown',()=>{
  const h=harness();h.sockets[0].open();h.sockets[0].message(JSON.stringify(delta({now:h.wall})));h.tick(11000);assert.equal(h.out.at(-1).status,'stale');
  h.sockets[0].disconnect();h.tick(999);assert.equal(h.sockets.length,1);h.tick(1);assert.equal(h.sockets.length,2);
  h.c.configure({...defaults,enabled:false});assert.equal(h.out.at(-1).status,'disabled');h.tick(60000);assert.equal(h.sockets.length,2);
});
test('silent half-open sockets and stalled handshakes reconnect',()=>{
  const h=harness();h.tick(15001);assert.equal(h.out.at(-1).status,'disconnected');h.tick(1000);const ws=h.sockets.at(-1);ws.open();h.tick(30001);assert.equal(h.out.at(-1).status,'disconnected');
});
test('malformed input and callbacks from old socket cannot affect replacement',()=>{
  const h=harness(),old=h.sockets[0];old.open();old.message('bad json');const callback=old.onmessage;
  h.c.configure({...defaults,enabled:true,source:'nmea0183'});callback({data:JSON.stringify(delta({now:h.wall}))});assert.equal(h.out.at(-1).latitude,null);
  const ws=h.sockets.at(-1);ws.open();ws.message(rmc(-31.95,115.86,h.wall));assert.equal(h.out.at(-1).status,'fix');
});
test('N2K text and binary WebSocket formats use the same normalized model',()=>{
  for(const format of ['seasmart','actisense-ngt']){
    const h=harness('nmea2000',{format}),ws=h.sockets[0];ws.open();
    for(const p of payloads({now:h.wall}))ws.message(format==='seasmart'?seasmart(p):actisense(p).buffer);
    assert.equal(h.out.at(-1).status,'fix');assert.equal(h.out.at(-1).sourceAddress,23);assert.deepEqual(h.out.at(-1).pgns,[126992,129025,129026,129029]);
  }
});
test('legacy bridge migration removes bridge secrets and disables unsupported sources',async()=>{
  let saved;globalThis.chrome={storage:{local:{get:async()=>({config:{enabled:true,bridgeToken:'old-secret',bridgeUrl:'ws://localhost:8765',input:{source:'nmea-tcp',host:'1.2.3.4'}}}),set:async value=>saved=value.config}}};
  try{const c=await settings();assert.equal(c.source,'signalk');assert.equal(c.enabled,false);assert(!JSON.stringify(saved).includes('old-secret'));assert(!Object.hasOwn(saved,'bridgeUrl'));}finally{delete globalThis.chrome;}
});
