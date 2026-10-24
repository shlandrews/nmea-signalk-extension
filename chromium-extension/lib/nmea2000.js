import {coordinates} from './model.js';
import {checkedBody,TextRecords} from './nmea0183.js';
export const PGNS=[126992,129025,129026,129029];
const supported=new Set(PGNS);
export function identifier(id){
  if(!Number.isInteger(id)||id<0||id>0x1fffffff)return null;
  let pgn=(id>>>8)&0x3ffff,destination=255;
  if(((id>>>16)&255)<240){destination=pgn&255;pgn&=~255;}
  return {pgn,source:id&255,destination};
}
export class Transport {
  constructor(){this.fast=new Map();this.tp=new Map();}
  feed(id,data,now=performance.now()){
    for(const table of [this.fast,this.tp])for(const [key,s] of table)if(now-s.time>750)table.delete(key);
    const info=identifier(id);if(!info||info.source>=254||data.length!==8)return [];
    const {pgn,source,destination}=info,key=`${source}:${destination}`;
    if(pgn===60416){
      const control=data[0];if(control===255){this.tp.delete(key);this.tp.delete(`${destination}:${source}`);return [];}
      const length=data[1]|data[2]<<8,count=data[3],target=data[5]|data[6]<<8|data[7]<<16;
      if([16,32].includes(control)&&supported.has(target)&&length>=9&&length<=1785&&count===Math.ceil(length/7)&&this.tp.size<256)
        this.tp.set(key,{time:now,pgn:target,length,index:1,bytes:[]});
      return [];
    }
    if(pgn===60160){
      const s=this.tp.get(key);if(!s)return [];
      if(data[0]!==s.index){this.tp.delete(key);return [];}
      s.time=now;s.index++;s.bytes.push(...data.slice(1));
      if(s.bytes.length>=s.length){this.tp.delete(key);return [{...info,pgn:s.pgn,data:new Uint8Array(s.bytes.slice(0,s.length))}];}
      return [];
    }
    if(!supported.has(pgn))return [];
    if(pgn!==129029)return [{...info,data}];
    const seq=data[0]>>>5,index=data[0]&31,k=`${key}:${pgn}:${seq}`;
    if(index===0){
      if(data[1]>=43&&data[1]<=223&&this.fast.size<256)this.fast.set(k,{time:now,length:data[1],index:1,bytes:[...data.slice(2)]});
      return [];
    }
    const s=this.fast.get(k);if(!s)return [];
    if(index!==s.index){this.fast.delete(k);return [];}
    s.time=now;s.index++;s.bytes.push(...data.slice(1));
    if(s.bytes.length>=s.length){this.fast.delete(k);return [{...info,data:new Uint8Array(s.bytes.slice(0,s.length))}];}
    return [];
  }
}
export function hexBytes(value){
  if(typeof value!=='string'||value.length%2||!/^[0-9a-f]*$/i.test(value))return null;
  return Uint8Array.from(value.match(/../g)??[],v=>parseInt(v,16));
}
export class YachtRaw {
  constructor(){this.buffer='';this.transport=new Transport();}
  feed(text,now){
    if(typeof text!=='string')return [];
    this.buffer+=text;const lines=this.buffer.split('\n');this.buffer=lines.pop();
    const full=/^\d{2}:\d{2}:\d{2}\.\d{3} R ([0-9a-f]{8})((?: [0-9a-f]{2}){8})\r?$/i;
    if(full.test(this.buffer)){lines.push(this.buffer);this.buffer='';}
    const result=[];
    for(const line of lines){const m=full.exec(line);if(m)result.push(...this.transport.feed(parseInt(m[1],16),hexBytes(m[2].replaceAll(' ','')),now));}
    if(this.buffer.length>8192)this.buffer='';
    return result;
  }
}
export class Actisense {
  constructor(){this.active=false;this.escape=false;this.packet=[];}
  feed(data){
    if(!(data instanceof Uint8Array))return [];
    const out=[];
    for(const byte of data){
      if(this.escape){
        this.escape=false;
        if(byte===2){this.active=true;this.packet=[];}
        else if(byte===3){
          const p=this.packet;
          if(this.active&&p.length>=14&&p[0]===0x93&&p.length===p[1]+3&&p.reduce((a,b)=>a+b,0)%256===0){
            const body=p.slice(2,-1);
            if(body[10]===body.length-11&&body[5]<254)out.push({pgn:body[1]|body[2]<<8|body[3]<<16,source:body[5],destination:body[4],data:new Uint8Array(body.slice(11))});
          }
          this.active=false;this.packet=[];
        }else if(byte===16&&this.active)this.packet.push(16);
        else{this.active=false;this.packet=[];}
      }else if(byte===16)this.escape=true;
      else if(this.active)this.packet.push(byte);
      if(this.packet.length>260){this.active=false;this.packet=[];}
    }
    return out;
  }
}
// SeaSmart PCDIN contains a complete/reassembled PGN, not individual CAN frames.
export function seaSmart(line){
  const body=checkedBody(line,true);if(body===null)return null;
  const f=body.split(',');
  if(f.length!==5||f[0]!=='PCDIN'||!/^\w{6}$/.test(f[1])||!/^\w{8}$/.test(f[2])||!/^\w{2}$/.test(f[3]))return null;
  if(!/^[0-9a-f]+$/i.test(f.slice(1).join('')))return null;
  const data=hexBytes(f[4]),pgn=parseInt(f[1],16),source=parseInt(f[3],16);
  return data&&data.length<=223&&source<254?{pgn,source,destination:255,data}:null;
}
export class SeaSmart extends TextRecords {constructor(){super(seaSmart);}}
export const FORMATS={'yacht-raw':YachtRaw,'actisense-ngt':Actisense,'seasmart':SeaSmart};

function numeric(data,start,size,scale=1,signed=false){
  let raw=0n;for(let i=size-1;i>=0;i--)raw=(raw<<8n)|BigInt(data[start+i]);
  const bits=BigInt(size*8),limit=(1n<<(bits-(signed?1n:0n)))-1n;
  if(signed&&(raw&(1n<<(bits-1n))))raw-=1n<<bits;
  return raw>=limit-2n?null:Number(raw)*scale;
}
function time(data,dayStart,tickStart){
  const days=numeric(data,dayStart,2),seconds=numeric(data,tickStart,4,.0001);
  return days!==null&&seconds!==null&&seconds<86401?new Date(days*86400000+seconds*1000).toISOString():null;
}
export function decode({pgn,data:d}){
  if(pgn===129025&&d.length===8)return {latitude:numeric(d,0,4,1e-7,true),longitude:numeric(d,4,4,1e-7,true)};
  if(pgn===129026&&d.length===8){
    const cog=numeric(d,2,2,.0001);
    return {speed:numeric(d,4,2,.01),course:cog!==null&&cog<2*Math.PI&&(d[1]&3)===0?cog*180/Math.PI:null};
  }
  if(pgn===126992&&d.length===8)return {gpsTime:time(d,2,4)};
  if(pgn===129029&&d.length>=43){
    const method=d[31]>>>4,integrity=d[32]&3;
    return {latitude:numeric(d,7,8,1e-16,true),longitude:numeric(d,15,8,1e-16,true),altitude:numeric(d,23,8,1e-6,true),
      quality:method,valid:[1,2,3,4,5].includes(method)&&[0,1].includes(integrity),hdop:numeric(d,34,2,.01,true),gpsTime:time(d,1,3)};
  }
  return null;
}
export class Receiver {
  constructor(gps){this.gps=gps;this.active=null;this.lastPosition=-Infinity;this.quality=null;this.qualityTime=-Infinity;}
  feed(message){
    const c=this.gps.config,now=this.gps.time.mono();
    if(!c.pgns.includes(message.pgn)||message.source>=254||(c.sourceAddress!==null&&message.source!==c.sourceAddress))return;
    const fields=decode(message);if(!fields)return;
    const position='latitude' in fields;
    if(message.source!==this.active){
      if(!position||!coordinates(fields.latitude,fields.longitude)||(this.active!==null&&now-this.lastPosition<=c.stale*1000))return;
      this.gps.reset();this.gps.connection='connected';this.active=message.source;this.quality=null;this.qualityTime=-Infinity;
    }
    if(position)this.lastPosition=now;
    if(message.pgn===129029){this.quality=fields.valid;this.qualityTime=now;}
    else if(message.pgn===129025&&this.quality!==null)fields.valid=this.quality&&now-this.qualityTime<=c.stale*1000;
    this.gps.sourceAddress=this.active;this.gps.pgns.add(message.pgn);this.gps.update(fields);
  }
}
