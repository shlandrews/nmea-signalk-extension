import {settings,validateSettings} from './settings.js';
const $=id=>document.getElementById(id);
let c=await settings(),hostname='';
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
try{const u=new URL(tab.url);if(['http:','https:'].includes(u.protocol))hostname=u.hostname;}catch{}
$('site').textContent=hostname||'an open website';$('siteEnabled').disabled=!hostname;
const textKeys=['source','protocol','host','port','path','authMode','token','format','sourceAddress','stale','uere','fallback'];
for(const key of textKeys)$(key).value=c[key]??'';
$('enabled').checked=c.enabled;$('accuracyEstimate').value=c.accuracy;
$('siteEnabled').checked=!c.disabledSites.includes(hostname);
document.querySelectorAll('[name=pgn]').forEach(el=>el.checked=c.pgns.includes(+el.value));
function visibility(){
  document.querySelectorAll('[data-for]').forEach(el=>el.hidden=!el.dataset.for.split(' ').includes($('source').value));
  $('sourceHelp').textContent=$('source').value==='signalk'?'Connects directly to the vessel’s Signal K server. Default path: /signalk/v1/stream.':
    'A real WebSocket-capable gateway is required. Changing a raw TCP/UDP URL to ws:// does not convert its protocol.';
}
$('source').onchange=()=>{
  if($('source').value==='signalk'){$('path').value='/signalk/v1/stream';if($('port').value==='80')$('port').value=3000;}
  visibility();
};visibility();
$('settings').onsubmit=async e=>{
  e.preventDefault();
  try{
    const candidate={...c,enabled:$('enabled').checked};
    for(const key of textKeys)candidate[key]=$(key).value;
    for(const key of ['port','stale','uere'])candidate[key]=+candidate[key];
    candidate.accuracy=+$('accuracyEstimate').value;candidate.sourceAddress=candidate.sourceAddress===''?null:+candidate.sourceAddress;
    candidate.pgns=[...document.querySelectorAll('[name=pgn]:checked')].map(el=>+el.value);
    const disabled=new Set(c.disabledSites);
    if(hostname){if($('siteEnabled').checked)disabled.delete(hostname);else disabled.add(hostname);}
    candidate.disabledSites=[...disabled];
    const clean=validateSettings(candidate);
    await chrome.storage.local.set({config:clean});c=clean;
    $('notice').textContent=clean.enabled?'Saved. Connecting directly to the GPS server…':'Saved. GPS override disabled.';
  }catch(error){$('notice').textContent=error.message;}
};
let latest;
function render(p){
  if(!p)return;latest=p;
  const labels={fix:'Connected · valid position','no-fix':'Connected · no valid fix',stale:'Stale GPS data',connecting:'Connecting',disconnected:'Disconnected',error:'Connection error',disabled:'GPS override disabled'};
  $('status').textContent=labels[p.status]||'Waiting for GPS';
  const n=Number.isFinite;
  $('latitude').textContent=n(p.latitude)?`${p.latitude.toFixed(6)}° latitude`:'— latitude';
  $('longitude').textContent=n(p.longitude)?`${p.longitude.toFixed(6)}° longitude`:'— longitude';
  $('speed').textContent=n(p.speed)?`${(p.speed*3600/1852).toFixed(1)} kn`:'—';
  $('course').textContent=n(p.course)?`${p.course.toFixed(1)}°`:'—';
  $('accuracy').textContent=n(p.accuracy)?`~${p.accuracy.toFixed(0)} m`:'—';
  const age=n(p.timestamp)?`${Math.max(0,(Date.now()-p.timestamp)/1000).toFixed(0)}s ago`:'never';
  $('detail').textContent=`${p.source||c.source} · Position ${age} · Fix quality ${p.quality??'unknown'} · ${p.accuracyKind||'accuracy unknown'}`;
  $('n2kDetail').textContent=p.source==='nmea2000'?`Address ${p.sourceAddress??'unselected'} · Selected ${(p.selectedPgns||[]).join(', ')} · Seen ${(p.pgns||[]).join(', ')||'none'} · Received ${p.lastReceived?new Date(p.lastReceived).toLocaleTimeString():'never'}`:'';
  $('diagnostic').textContent=p.diagnostic||'';
  if(p.status==='fix')$('notice').textContent='Receiving live GPS directly from the server.';
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.latest)render(changes.latest.newValue);});
render((await chrome.storage.session.get('latest')).latest);
setInterval(()=>render(latest),1000);
chrome.runtime.sendMessage({type:'subscribe'}).catch(()=>{});
