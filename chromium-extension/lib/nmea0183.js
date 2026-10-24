import {finite} from './model.js';
export function checkedBody(line, requireChecksum = false) {
  if (typeof line !== 'string' || line.length > 2048 || !line.startsWith('$')) return null;
  const parts = line.slice(1).split('*');
  if (parts.length > 2 || (requireChecksum && parts.length !== 2)) return null;
  if (parts.length === 2) {
    if (!/^[0-9a-f]{2}$/i.test(parts[1])) return null;
    let sum = 0; for (const char of parts[0]) sum ^= char.charCodeAt(0);
    if (sum !== parseInt(parts[1],16)) return null;
  }
  return parts[0];
}
function coord(raw, hemisphere, latitude) {
  if (!/^\d+(\.\d+)?$/.test(raw) || !(latitude ? ['N','S'] : ['E','W']).includes(hemisphere)) throw Error('coordinate');
  const value = Number(raw), degrees = Math.floor(value/100), minutes = value % 100;
  if (minutes >= 60) throw Error('minutes');
  return (degrees + minutes/60) * (['S','W'].includes(hemisphere) ? -1 : 1);
}
const opt = (raw, scale=1) => raw !== '' && finite(Number(raw)*scale) ? Number(raw)*scale : null;
export function utc(raw, date, now=Date.now()) {
  if (!/^\d{6}(\.\d+)?$/.test(raw)) return null;
  const h=+raw.slice(0,2),m=+raw.slice(2,4),s=+raw.slice(4);
  if(h>23||m>59||s>=61) return null;
  const today=new Date(now);let day=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
  if(date){
    if(!/^\d{6}$/.test(date))return null;
    const year=+date.slice(4),month=+date.slice(2,4),d=+date.slice(0,2);
    day=Date.UTC(year>=80?1900+year:2000+year,month-1,d);
    if(new Date(day).getUTCDate()!==d||new Date(day).getUTCMonth()!==month-1)return null;
  }
  let result=day+h*3600000+m*60000+s*1000;
  if(!date){if(result-now>43200000)result-=86400000;else if(now-result>43200000)result+=86400000;}
  return new Date(result).toISOString();
}
export function parseNmea(line, now=Date.now()) {
  const body=checkedBody(line.trim());if(body===null)return null;
  const f=body.split(',');if(!/^[A-Z0-9]{2}[A-Z]{3}$/.test(f[0]))return null;
  const kind=f[0].slice(2);
  try{
    if(kind==='RMC'&&f.length>=10){
      if(f[2]!=='A'||['N','E','M','S'].includes(f[12]))return {valid:false,quality:0};
      const time=utc(f[1],f[9],now);if(!time)return null;
      return {latitude:coord(f[3],f[4],true),longitude:coord(f[5],f[6],false),valid:true,
        speed:opt(f[7],1852/3600),course:opt(f[8]),quality:'RMC-valid',gpsTime:time};
    }
    if(kind==='GGA'&&f.length>=11){
      const quality=Number(f[6]);if(![1,2,3,4,5].includes(quality))return {valid:false,quality};
      const time=utc(f[1],null,now);if(!time)return null;
      return {latitude:coord(f[2],f[3],true),longitude:coord(f[4],f[5],false),valid:true,
        quality,hdop:opt(f[8]),altitude:f[10]==='M'?opt(f[9]):null,gpsTime:time};
    }
    if(kind==='GLL'&&f.length>=7){
      if(f[6]!=='A'||['N','E','M','S'].includes(f[7]))return {valid:false};
      const time=utc(f[5],null,now);if(!time)return null;
      return {latitude:coord(f[1],f[2],true),longitude:coord(f[3],f[4],false),valid:true,gpsTime:time};
    }
    if(kind==='VTG'&&f.length>=9){
      if(['N','E','M','S'].includes(f[9]))return {speed:null,course:null};
      return {course:f[2]==='T'?opt(f[1]):null,speed:f[6]==='N'?opt(f[5],1852/3600):null};
    }
  }catch{}
  return null;
}
// Each WebSocket message may carry complete records without a final newline, or
// fragments of records. Checksummed records can be completed at message boundaries.
export class TextRecords {
  constructor(parse){this.buffer='';this.parse=parse;}
  feed(text){
    if(typeof text!=='string')return [];
    this.buffer+=text;const out=[];
    const accept=line=>{const item=this.parse(line.trim());if(item!==null&&item!==undefined)out.push(item);};
    let index;
    while((index=this.buffer.indexOf('\n'))>=0){accept(this.buffer.slice(0,index));this.buffer=this.buffer.slice(index+1);}
    if(/\*[0-9A-Fa-f]{2}\r?$/.test(this.buffer)){accept(this.buffer);this.buffer='';}
    if(this.buffer.length>8192)this.buffer='';
    return out;
  }
}
