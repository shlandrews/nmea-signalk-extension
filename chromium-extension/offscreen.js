let worker,current,lastBeat=Date.now(),restart;
function launch(){
  clearTimeout(restart);if(worker)worker.terminate();
  worker=new Worker('gps-worker.js',{type:'module'});lastBeat=Date.now();
  worker.onmessage=event=>{
    if(event.data?.type!=='position')return;
    lastBeat=Date.now();
    chrome.runtime.sendMessage({type:'gps-update',position:event.data.position}).catch(()=>{});
  };
  worker.onerror=event=>{event.preventDefault();restart=setTimeout(launch,2000);};
  if(current)worker.postMessage({type:'configure',config:current});
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||
    (sender.url&&sender.url!==chrome.runtime.getURL('background.js')))return;
  if(message?.type==='offscreen-config'){current=message.config;worker.postMessage({type:'configure',config:current});}
  if(message?.type==='offscreen-health')reply({lastBeat});
});
launch();
chrome.runtime.sendMessage({type:'offscreen-settings'}).then(config=>{
  if(!current){current=config;worker.postMessage({type:'configure',config});}
});
setInterval(()=>{if(Date.now()-lastBeat>20000)launch();},5000);
