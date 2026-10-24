(() => {
  'use strict';
  const native=navigator.geolocation;
  if(!native) return;
  const original={getCurrentPosition:native.getCurrentPosition.bind(native),watchPosition:native.watchPosition.bind(native),clearWatch:native.clearWatch.bind(native)};
  let action='pending',position=null,expiresAt=null,nextId=1;
  const watches=new Map();
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const error=(code,message)=>Object.freeze({code,message,PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3});
  function allowed() {
    return window.isSecureContext && (!document.permissionsPolicy || document.permissionsPolicy.allowsFeature('geolocation'));
  }
  function usable(p) {
    return p?.type==='gps'&&p.version===1&&finite(p.latitude)&&Math.abs(p.latitude)<=90&&finite(p.longitude)&&Math.abs(p.longitude)<=180&&finite(p.timestamp)&&p.timestamp<=Date.now()+30000&&finite(p.accuracy)&&p.accuracy>0;
  }
  function fresh() {
    return action==='gps'&&usable(position)&&position.valid===true&&position.status==='fix'&&finite(expiresAt)&&Date.now()<=expiresAt;
  }
  function convert(p) {
    const coords=Object.freeze({latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,
      altitude:finite(p.altitude)?p.altitude:null,altitudeAccuracy:finite(p.altitudeAccuracy)?p.altitudeAccuracy:null,
      speed:finite(p.speed)&&p.speed>=0?p.speed:null,heading:finite(p.course)&&p.course>=0&&p.course<360?p.course:null});
    return Object.freeze({coords,timestamp:p.timestamp,toJSON(){return {coords:{...coords},timestamp:p.timestamp};}});
  }
  function options(o={}) {
    const duration=(v,otherwise)=>v===undefined?otherwise:Math.min(0xffffffff,Math.max(0,Number(v)||0));
    return {enableHighAccuracy:!!o?.enableHighAccuracy,timeout:duration(o?.timeout,Infinity),maximumAge:duration(o?.maximumAge,0)};
  }
  function callback(fn,value) {if(fn)setTimeout(()=>fn(value),0);}
  function stopNative(w) {if(w.nativeId!==undefined){original.clearWatch(w.nativeId);delete w.nativeId;}}
  function finish(w,p) {
    clearTimeout(w.timer);w.timer=null;w.last=p.timestamp;
    callback(value=>{if(!w.cancelled)w.success(value);},convert(p));
    if(!w.watch)watches.delete(w.id);
  }
  function fail(w,code,message) {
    clearTimeout(w.timer);w.timer=null;
    if(w.lastError!==code){callback(value=>{if(!w.cancelled&&w.failure)w.failure(value);},error(code,message));w.lastError=code;}
    if(!w.watch)watches.delete(w.id);
  }
  function fallback(w) {
    if(action==='last'&&usable(position)) {
      if(w.last!==position.timestamp)finish(w,position);
    } else fail(w,2,'Marine GPS position unavailable');
  }
  function arm(w) {
    if(w.timer||w.options.timeout===Infinity) return;
    w.timer=setTimeout(()=>{w.timer=null;fail(w,3,'Geolocation request timed out');},w.options.timeout);
  }
  function evaluate(w,incoming=false) {
    if(w.permissionPending)return;
    if(w.permissionDenied){fail(w,1,'Browser geolocation permission denied');return;}
    if(!allowed()){fail(w,1,'Geolocation is blocked by this document security policy');return;}
    if(action==='native') {
      if(w.nativeId===undefined){
        if(w.watch)w.nativeId=original.watchPosition(w.success,w.failure,w.options);
        else {watches.delete(w.id);original.getCurrentPosition(w.success,w.failure,w.options);}
      }
      return;
    }
    stopNative(w);
    if(fresh()&&(incoming||Date.now()-position.timestamp<=w.options.maximumAge)) {
      w.lastError=null;
      if(w.last!==position.timestamp)finish(w,position);
    } else if(!fresh()&&action!=='pending')fallback(w);
    if(watches.has(w.id)&&w.nativeId===undefined&&w.last===undefined)arm(w);
  }
  function request(success,failure,o,watch) {
    if(typeof success!=='function')throw new TypeError('Position callback must be a function');
    if(failure!=null&&typeof failure!=='function')throw new TypeError('Error callback must be a function');
    const id=nextId++,w={id,success,failure,options:options(o),watch};
    watches.set(id,w);
    // Respect an explicitly denied browser permission, as well as Permissions Policy.
    if(navigator.permissions?.query){
      w.permissionPending=true;
      navigator.permissions.query({name:'geolocation'}).then(permission=>{
        if(!watches.has(id))return;
        w.permissionPending=false;w.permissionDenied=permission.state==='denied';evaluate(w);
      }).catch(()=>{w.permissionPending=false;if(watches.has(id))evaluate(w);});
    }
    else evaluate(w);
    return id;
  }
  Object.defineProperties(native,{
    getCurrentPosition:{configurable:true,value:(s,e,o)=>{request(s,e,o,false);}},
    watchPosition:{configurable:true,value:(s,e,o)=>request(s,e,o,true)},
    clearWatch:{configurable:true,value:id=>{const w=watches.get(Number(id));if(w){w.cancelled=true;clearTimeout(w.timer);stopNative(w);watches.delete(w.id);}}}
  });
  let expiry;
  window.addEventListener('message',e=>{
    if(e.source!==window||e.data?.channel!=='marine-gps-v2')return;
    const m=e.data;
    if(!['gps','last','native','pending','unavailable'].includes(m.action))return;
    if(['gps','last'].includes(m.action)&&!usable(m.position))return;
    if(m.action==='gps'&&(!finite(m.expiresAt)||m.expiresAt>m.position.timestamp+3600000))return;
    const incoming=usable(m.position)&&m.position.timestamp!==position?.timestamp;
    action=m.action;position=usable(m.position)?m.position:null;expiresAt=m.expiresAt;
    for(const w of watches.values())evaluate(w,incoming);
    clearTimeout(expiry);
    if(fresh())expiry=setTimeout(()=>{for(const w of watches.values())evaluate(w);},Math.max(1,expiresAt-Date.now()+1));
  });
})();
