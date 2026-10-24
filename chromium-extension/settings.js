import {PGNS,FORMATS} from './lib/nmea2000.js';
export const defaults = Object.freeze({schemaVersion:2,enabled:false,disabledSites:[],fallback:'unavailable',stale:10,uere:5,accuracy:100,
  source:'signalk',host:'192.168.0.109',port:3000,protocol:'ws',path:'/signalk/v1/stream',
  authMode:'none',token:'',format:'seasmart',sourceAddress:null,pgns:PGNS});
const keys=Object.keys(defaults);
export function validateSettings(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid settings');
  const c=Object.fromEntries(keys.map(key=>[key,raw[key]??defaults[key]]));
  c.schemaVersion=2;
  if(typeof c.enabled!=='boolean'||!['signalk','nmea0183','nmea2000'].includes(c.source))throw Error('Select a WebSocket source');
  if(!['ws','wss'].includes(c.protocol)||!['none','query'].includes(c.authMode))throw Error('Invalid WebSocket protocol or authentication');
  if(typeof c.host!=='string'||!c.host||c.host.length>253||/[\s/?#@\\]/.test(c.host))throw Error('Enter a hostname or IP address, without a scheme');
  if(!Number.isInteger(c.port)||c.port<1||c.port>65535)throw Error('Port must be 1–65535');
  if(typeof c.path!=='string'||!c.path.startsWith('/')||c.path.startsWith('//')||/[?#\s\\]/.test(c.path)||c.path.length>1024)throw Error('Enter a WebSocket path beginning with /, without query parameters');
  if(typeof c.token!=='string'||c.token.length>8192)throw Error('Invalid access token');
  for(const key of ['stale','uere','accuracy'])if(!Number.isFinite(c[key])||c[key]<=0||c[key]>3600)throw Error('Timeout and accuracy values must be positive and at most 3600');
  if(!Array.isArray(c.disabledSites)||c.disabledSites.length>1000||c.disabledSites.some(s=>typeof s!=='string'||s.length>253))throw Error('Invalid site exclusions');
  if(!Object.hasOwn(FORMATS,c.format))throw Error('Unsupported NMEA 2000 format');
  if(c.sourceAddress!==null&&(!Number.isInteger(c.sourceAddress)||c.sourceAddress<0||c.sourceAddress>253))throw Error('Source address must be 0–253 or blank');
  if(!Array.isArray(c.pgns)||!c.pgns.length||c.pgns.some(p=>!PGNS.includes(p))||!c.pgns.some(p=>[129025,129029].includes(p)))throw Error('Select at least one position PGN');
  endpoint(c);return c;
}
export function endpoint(c,authenticated=false){
  const host=c.host.includes(':')&&!c.host.startsWith('[')?`[${c.host}]`:c.host;
  const url=new URL(`${c.protocol}://${host}:${c.port}${c.path}`);
  if(c.source==='signalk'){url.searchParams.set('subscribe','none');url.searchParams.set('sendCachedValues','false');}
  if(authenticated&&c.authMode==='query'&&c.token)url.searchParams.set('token',c.token);
  return url;
}
export async function settings(){
  const {config}=await chrome.storage.local.get('config');
  if(config?.schemaVersion===2){try{return validateSettings(config);}catch{return {...defaults};}}
  // Drop bridge credentials and unsupported transports. Never reinterpret a TCP port.
  const migrated={...defaults,disabledSites:Array.isArray(config?.disabledSites)?config.disabledSites:[]};
  if(config?.input?.source==='signalk'){
    try{const u=new URL(config.input.signalkUrl);Object.assign(migrated,{host:u.hostname,port:Number(u.port)||(u.protocol==='wss:'?443:80),protocol:u.protocol.slice(0,-1),path:u.pathname,token:config.input.signalkToken||'',authMode:config.input.signalkToken?'query':'none'});}catch{}
  }
  let clean;try{clean=validateSettings(migrated);}catch{clean=validateSettings({...defaults});}
  await chrome.storage.local.set({config:clean});return clean;
}
// This policy remains in isolated extension contexts, never in page messages.
export function publicSettings(c){return {enabled:c.enabled,disabledSites:c.disabledSites,fallback:c.fallback,stale:c.stale};}
