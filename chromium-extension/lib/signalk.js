import {finite,coordinates} from './model.js';
export const PATHS=['navigation.position','navigation.speedOverGround','navigation.courseOverGroundTrue','navigation.datetime',
  'navigation.gnss.horizontalDilution','navigation.gnss.methodQuality','navigation.gnss.integrity'];
const goodMethod = value => typeof value==='string' && /^(GNSS fix|DGNSS fix|Precise GNSS|RTK Fixed Integer|RTK float|GPS fix|DGPS fix)$/i.test(value);
export class SignalK {
  constructor(gps){this.gps=gps;this.own='vessels.self';this.active=null;this.lastPosition=-Infinity;this.quality=null;this.qualityTime=-Infinity;this.integrity=null;this.integrityTime=-Infinity;}
  feed(delta){
    if(!delta||typeof delta!=='object'||Array.isArray(delta))return;
    if(typeof delta.self==='string'&&delta.self.length<256)this.own=delta.self.startsWith('vessels.')?delta.self:`vessels.${delta.self}`;
    if(![this.own,'vessels.self'].includes(delta.context??'vessels.self')||!Array.isArray(delta.updates))return;
    const now=this.gps.time.mono(),wall=this.gps.time.wall(),ttl=this.gps.config.stale*1000;
    for(const update of delta.updates){
      if(!update||!Array.isArray(update.values))continue;
      const source=typeof update.$source==='string'?update.$source:
        (update.source&&typeof update.source==='object'?JSON.stringify(update.source):'server-default');
      if(source.length>512)continue;
      const position=update.values.find(v=>v?.path==='navigation.position');
      if(source!==this.active){
        if(!position||!coordinates(position.value?.latitude,position.value?.longitude)||
          (this.active!==null&&now-this.lastPosition<=ttl))continue;
        this.gps.reset();this.gps.connection='connected';this.active=source;this.quality=null;this.qualityTime=-Infinity;this.integrity=null;this.integrityTime=-Infinity;
      }
      const stamp=typeof update.timestamp==='string'?Date.parse(update.timestamp):null;
      const old=stamp!==null&&(!finite(stamp)||wall-stamp>ttl||stamp-wall>30000);
      // Old auxiliary data cannot refresh quality or motion; an old position is
      // marked invalid so cached server fixes are never presented as fresh.
      if(old&&!position)continue;
      const fields={};
      for(const item of update.values){
        if(!item||typeof item.path!=='string')continue;
        const v=item.value;
        if(item.path==='navigation.position'){
          fields.latitude=v?.latitude;fields.longitude=v?.longitude;
          fields.altitude=v?.altitude??null;fields.valid=!old;
          if(stamp!==null&&finite(stamp))fields.gpsTime=new Date(stamp).toISOString();
          this.lastPosition=now;
        }else if(item.path==='navigation.speedOverGround')fields.speed=finite(v)&&v>=0?v:null;
        else if(item.path==='navigation.courseOverGroundTrue')fields.course=finite(v)&&v>=0&&v<2*Math.PI?v*180/Math.PI:null;
        else if(item.path==='navigation.datetime')fields.gpsTime=typeof v==='string'?v:null;
        else if(item.path==='navigation.gnss.horizontalDilution')fields.hdop=finite(v)&&v>0?v:null;
        else if(item.path==='navigation.gnss.methodQuality'){
          this.quality=goodMethod(v);this.qualityTime=now;fields.quality=v;fields.valid=this.quality;
        }else if(item.path==='navigation.gnss.integrity'){
          this.integrity=typeof v==='string'&&/^(Safe|no Integrity checking)$/i.test(v);this.integrityTime=now;
        }
      }
      if(!Object.keys(fields).length)continue;
      if(this.quality!==null)fields.valid=fields.valid!==false&&this.quality&&now-this.qualityTime<=ttl;
      if(this.integrity!==null)fields.valid=fields.valid!==false&&this.integrity&&now-this.integrityTime<=ttl;
      if(position&&old)fields.valid=false;
      if(Object.keys(fields).length)this.gps.update(fields);
    }
  }
}
