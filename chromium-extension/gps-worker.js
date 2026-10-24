import {Connection} from './lib/connection.js';
const connection=new Connection(position=>postMessage({type:'position',position}));
self.onmessage=event=>{
  if(event.data?.type==='configure')try{connection.configure(event.data.config);}catch{postMessage({type:'position',position:{type:'gps',version:1,status:'error',valid:false,diagnostic:'Invalid GPS configuration'}});}
};
setInterval(()=>connection.tick(),500);
