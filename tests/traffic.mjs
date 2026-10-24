export function checksum(body){let sum=0;for(const c of body)sum^=c.charCodeAt(0);return `$${body}*${sum.toString(16).padStart(2,'0').toUpperCase()}`;}
export function rmc(lat=-31.95,lon=115.86,now=Date.now()){
  const date=new Date(now),pad=n=>String(n).padStart(2,'0');
  const coord=(v,width)=>`${String(Math.floor(Math.abs(v))).padStart(width,'0')}${((Math.abs(v)%1)*60).toFixed(4).padStart(7,'0')}`;
  return checksum(`GNRMC,${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.00,A,${coord(lat,2)},${lat<0?'S':'N'},${coord(lon,3)},${lon<0?'W':'E'},4.86,90.0,${pad(date.getUTCDate())}${pad(date.getUTCMonth()+1)}${pad(date.getUTCFullYear()%100)},,,A`);
}
export function payloads({lat=-31.95,lon=115.86,valid=true,now=Date.now()}={}){
  const gnss=new Uint8Array(43).fill(255),g=new DataView(gnss.buffer),days=Math.floor(now/86400000),ticks=Math.floor((now%86400000)*10);
  g.setUint8(0,1);g.setUint16(1,days,true);g.setUint32(3,ticks,true);g.setBigInt64(7,BigInt(Math.round(lat*1e16)),true);g.setBigInt64(15,BigInt(Math.round(lon*1e16)),true);g.setBigInt64(23,2500000n,true);
  gnss[31]=valid?0x10:0;gnss[32]=0xfd;gnss[33]=12;g.setInt16(34,90,true);g.setInt16(36,120,true);gnss[42]=0;
  const rapid=new Uint8Array(8),r=new DataView(rapid.buffer);r.setInt32(0,Math.round(lat*1e7),true);r.setInt32(4,Math.round(lon*1e7),true);
  const motion=new Uint8Array([1,252,0,0,0,0,255,255]),m=new DataView(motion.buffer);m.setUint16(2,Math.round(Math.PI/2*10000),true);m.setUint16(4,250,true);
  const system=new Uint8Array(8),s=new DataView(system.buffer);system[0]=1;system[1]=240;s.setUint16(2,days,true);s.setUint32(4,ticks,true);
  return [{pgn:129029,data:gnss},{pgn:129025,data:rapid},{pgn:129026,data:motion},{pgn:126992,data:system}];
}
export function frames(pgn,data,source=23,sequence=0){
  const id=(3<<26)|(pgn<<8)|source;if(data.length<=8)return [{id,data}];
  const out=[{id,data:new Uint8Array([sequence<<5,data.length,...data.slice(0,6)])}];
  for(let start=6,index=1;start<data.length;start+=7,index++){const d=new Uint8Array(8).fill(255);d[0]=(sequence<<5)|index;d.set(data.slice(start,start+7),1);out.push({id,data:d});}
  return out;
}
export const hex=data=>[...data].map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join('');
export const yachtLine=({id,data})=>`12:00:00.000 R ${id.toString(16).padStart(8,'0').toUpperCase()} ${[...data].map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join(' ')}\r\n`;
export const seasmart=({pgn,data},source=23)=>checksum(`PCDIN,${pgn.toString(16).padStart(6,'0').toUpperCase()},00000000,${source.toString(16).padStart(2,'0').toUpperCase()},${hex(data)}`);
export function actisense({pgn,data},source=23){
  const body=[3,pgn&255,(pgn>>>8)&255,(pgn>>>16)&255,255,source,0,0,0,0,data.length,...data];
  const packet=[147,body.length,...body];packet.push((-packet.reduce((a,b)=>a+b,0))&255);
  return new Uint8Array([16,2,...packet.flatMap(b=>b===16?[16,16]:[b]),16,3]);
}
export function delta({lat=-31.95,lon=115.86,now=Date.now(),quality='GNSS fix',source='gps.23'}={}){
  return {context:'vessels.self',updates:[{$source:source,timestamp:new Date(now).toISOString(),values:[
    {path:'navigation.position',value:{latitude:lat,longitude:lon}},
    {path:'navigation.speedOverGround',value:2.5},{path:'navigation.courseOverGroundTrue',value:Math.PI/2},
    {path:'navigation.gnss.horizontalDilution',value:.9},{path:'navigation.gnss.methodQuality',value:quality}]}]};
}
