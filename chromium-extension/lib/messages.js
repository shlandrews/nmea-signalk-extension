import {finite,coordinates} from './model.js';
const statuses=['fix','no-fix','stale','connecting','disconnected','error','disabled'];
const numeric=['latitude','longitude','altitude','altitudeAccuracy','speed','course','hdop','accuracy','timestamp','age','lastReceived'];
export function validPosition(p){
  if(!p||typeof p!=='object'||Array.isArray(p)||p.type!=='gps'||p.version!==1||!statuses.includes(p.status)||typeof p.valid!=='boolean')return false;
  if(numeric.some(k=>p[k]!==undefined&&p[k]!==null&&!finite(p[k])))return false;
  if(p.status==='fix'&&(!p.valid||!coordinates(p.latitude,p.longitude)||!finite(p.timestamp)||!finite(p.accuracy)||p.accuracy<=0))return false;
  if(p.timestamp!==null&&p.timestamp!==undefined&&p.timestamp>Date.now()+30000)return false;
  if(p.pgns!==undefined&&(!Array.isArray(p.pgns)||p.pgns.length>4||p.pgns.some(v=>!Number.isInteger(v))))return false;
  return true;
}
export function pagePosition(p){
  if(!validPosition(p))return null;
  return Object.fromEntries(['type','version','status','valid','latitude','longitude','altitude','altitudeAccuracy','speed','course','accuracy','timestamp'].map(k=>[k,p[k]??null]));
}
