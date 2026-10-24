import {settings,publicSettings} from './settings.js';
import {validPosition} from './lib/messages.js';
let creating;
async function ensureOffscreen(check=false){
  if(creating)return creating;
  creating=(async()=>{
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    if(await chrome.offscreen.hasDocument()){
      if(!check)return;
      let health;
      try{health=await Promise.race([chrome.runtime.sendMessage({type:'offscreen-health'}),new Promise(r=>setTimeout(r,3000))]);}catch{}
      if(health&&Date.now()-health.lastBeat<25000)return;
      await chrome.offscreen.closeDocument();
    }
    await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],
      justification:'Maintain a dedicated worker for direct marine GPS WebSocket connections while the popup is closed.'});
  })().finally(()=>creating=null);
  return creating;
}
async function broadcast(position){
  const policy=publicSettings(await settings());
  const tabs=await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'gps-state',position,policy})));
}
chrome.runtime.onInstalled.addListener(()=>ensureOffscreen().catch(()=>{}));
chrome.runtime.onStartup.addListener(()=>ensureOffscreen().catch(()=>{}));
chrome.alarms.create('gps-health',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='gps-health')ensureOffscreen(true).catch(()=>{});});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||!m||typeof m!=='object')return;
  const offscreen=sender.url===chrome.runtime.getURL('offscreen.html');
  if(m.type==='offscreen-settings'&&offscreen){settings().then(reply);return true;}
  if(m.type==='subscribe'){
    (async()=>{
      await ensureOffscreen();
      const c=await settings(),{latest}=await chrome.storage.session.get('latest');
      reply({policy:publicSettings(c),position:validPosition(latest)?latest:null});
    })().catch(()=>reply({}));return true;
  }
  if(m.type==='gps-update'&&offscreen&&validPosition(m.position)){
    chrome.storage.session.set({latest:m.position});broadcast(m.position).catch(()=>{});
  }
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.config)(async()=>{
    const config=await settings();await ensureOffscreen();
    await chrome.runtime.sendMessage({type:'offscreen-config',config});
    const {latest}=await chrome.storage.session.get('latest');await broadcast(latest??null);
  })().catch(()=>{});
});
ensureOffscreen().catch(()=>{});
