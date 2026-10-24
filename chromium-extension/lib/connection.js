import {GPS,clock} from './model.js';
import {SignalK,PATHS} from './signalk.js';
import {TextRecords,parseNmea} from './nmea0183.js';
import {FORMATS,Receiver} from './nmea2000.js';
import {endpoint,validateSettings} from '../settings.js';
export class Connection {
  constructor(emit,{Socket=globalThis.WebSocket,time=clock,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),random=Math.random}={}){
    Object.assign(this,{emit,Socket,time,setTimer,clearTimer,random});this.generation=0;this.attempt=0;this.socket=null;this.retry=null;
  }
  configure(raw){
    const c=validateSettings(raw);this.stop();this.config=c;this.gps=new GPS(c,this.time);this.attempt=0;this.diagnostic=null;
    if(c.enabled)this.open();else{this.gps.connection='disabled';this.publish();}
  }
  stop(){
    this.generation++;this.clearTimer(this.retry);this.retry=null;
    if(this.socket){this.socket.onclose=null;this.socket.onmessage=null;this.socket.onerror=null;this.socket.onopen=null;this.socket.close();this.socket=null;}
  }
  publish(diagnostic){
    if(diagnostic)this.diagnostic=diagnostic;
    if(this.gps){this.emit({...this.gps.snapshot(),...(this.diagnostic?{diagnostic:this.diagnostic}:{})});this.gps.dirty=false;}
  }
  open(){
    if(!this.config.enabled)return;
    const gen=++this.generation,c=this.config;this.diagnostic=null;
    // Reset fragments and receiver locks on every new connection.
    this.gps=new GPS(c,this.time);
    this.parser=c.source==='signalk'?new SignalK(this.gps):c.source==='nmea0183'?new TextRecords(s=>parseNmea(s,this.time.wall())):new FORMATS[c.format]();
    this.receiver=c.source==='nmea2000'?new Receiver(this.gps):null;
    this.gps.connection='connecting';this.openedAt=this.lastWire=this.time.mono();this.publish();
    try{
      const ws=this.socket=new this.Socket(endpoint(c,true).href);ws.binaryType='arraybuffer';
      ws.onopen=()=>{
        if(gen!==this.generation)return;
        this.openedAt=this.lastWire=this.time.mono();this.gps.connection='connected';this.diagnostic=null;
        if(c.source==='signalk')ws.send(JSON.stringify({context:'vessels.self',subscribe:PATHS.map(path=>({path,period:1000,policy:'instant'}))}));
        this.publish();
      };
      ws.onmessage=event=>{
        if(gen!==this.generation)return;
        this.lastWire=this.time.mono();
        try{
          const data=event.data;
          if(typeof data==='string'&&data.length<=262144){
            if(c.source==='signalk')this.parser.feed(JSON.parse(data));
            else if(c.source==='nmea0183')for(const fields of this.parser.feed(data))this.gps.update(fields);
            else if(c.format!=='actisense-ngt')for(const message of this.parser.feed(data,this.time.mono()))this.receiver.feed(message);
          }else if(data instanceof ArrayBuffer&&data.byteLength<=262144){
            if(c.source==='nmea2000'&&c.format==='actisense-ngt')for(const message of this.parser.feed(new Uint8Array(data)))this.receiver.feed(message);
          }
          if(this.gps.received!==null)this.attempt=0;
          if(this.gps.dirty)this.publish();
        }catch{/* Untrusted input never escapes the worker. */}
      };
      ws.onerror=()=>{if(gen===this.generation){this.gps.connection='error';this.publish('WebSocket failed. Check endpoint, authentication, TLS trust and gateway protocol.');ws.close();}};
      ws.onclose=()=>{if(gen===this.generation){this.socket=null;this.gps.connection='disconnected';this.publish();this.schedule();}};
    }catch{this.gps.connection='error';this.publish('Unable to open the configured WebSocket endpoint.');this.schedule();}
  }
  schedule(){
    this.clearTimer(this.retry);
    const delay=Math.min(30000,1000*2**Math.min(this.attempt++,5))*(.8+this.random()*.4);
    this.retry=this.setTimer(()=>{this.retry=null;this.open();},delay);
  }
  tick(){
    if(!this.gps)return;
    const now=this.time.mono();
    // Native WebSockets cannot send protocol-level pings from JavaScript.
    if(this.config.enabled&&this.socket&&((this.socket.readyState===0&&now-this.openedAt>15000)||
      (this.socket.readyState===1&&now-this.lastWire>Math.max(30000,this.config.stale*3000)))){
      this.socket.onclose=null;this.socket.close();this.socket=null;this.generation++;
      this.gps.connection='disconnected';this.schedule();
    }
    this.publish();
  }
}
