(() => {
  // Isolated-world code. No page event can invoke a privileged extension action.
  let policy={enabled:false,disabledSites:[],fallback:'unavailable',stale:10},position,lastValid,expiry;
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const usable=p=>p?.type==='gps'&&p.version===1&&finite(p.latitude)&&Math.abs(p.latitude)<=90&&finite(p.longitude)&&Math.abs(p.longitude)<=180&&finite(p.accuracy)&&p.accuracy>0&&finite(p.timestamp)&&p.timestamp<=Date.now()+30000;
  function publish(){
    clearTimeout(expiry);
    const enabled=policy.enabled&&!policy.disabledSites.includes(location.hostname);
    const fresh=usable(position)&&position.valid===true&&position.status==='fix'&&Date.now()-position.timestamp<=policy.stale*1000;
    if(fresh)lastValid=position;
    let action=!enabled?'native':fresh?'gps':position?.status==='connecting'?'pending':
      policy.fallback==='native'?'native':policy.fallback==='last'&&lastValid?'last':'unavailable';
    const selected=action==='last'?lastValid:position;
    // Only the result of the site's policy is public, never settings, server
    // addresses, site lists, tokens, PGNs, diagnostics or extension APIs.
    const p=usable(selected)?Object.fromEntries(['type','version','status','valid','latitude','longitude','altitude','altitudeAccuracy','speed','course','accuracy','timestamp'].map(k=>[k,selected[k]??null])):null;
    window.postMessage({channel:'marine-gps-v2',action,position:p,expiresAt:fresh?position.timestamp+policy.stale*1000:null},'*');
    if(fresh)expiry=setTimeout(publish,Math.max(1,position.timestamp+policy.stale*1000-Date.now()+1));
  }
  function receive(m){
    if(!m||typeof m!=='object')return;
    const p=m.policy;
    if(p&&typeof p.enabled==='boolean'&&Array.isArray(p.disabledSites)&&p.disabledSites.every(s=>typeof s==='string')&&
      ['native','unavailable','last'].includes(p.fallback)&&finite(p.stale)&&p.stale>0&&p.stale<=3600)policy=p;
    if(m.position&&typeof m.position==='object'&&typeof m.position.status==='string')position=m.position;
    publish();
  }
  chrome.runtime.onMessage.addListener((m,sender)=>{if(sender.id===chrome.runtime.id&&m?.type==='gps-state')receive(m);});
  chrome.runtime.sendMessage({type:'subscribe'},reply=>{if(!chrome.runtime.lastError&&reply)receive(reply);});
})();
