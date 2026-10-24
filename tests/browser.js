let id;
const output=document.getElementById('output');
const success=p=>output.textContent=JSON.stringify({latitude:p.coords.latitude,longitude:p.coords.longitude,speed:p.coords.speed,course:p.coords.heading,accuracy:p.coords.accuracy,timestamp:p.timestamp},null,2);
const failure=e=>output.textContent=`Error ${e.code}: ${e.message}`;
document.getElementById('once').onclick=()=>navigator.geolocation.getCurrentPosition(success,failure,{timeout:5000});
document.getElementById('watch').onclick=()=>{if(id!==undefined)navigator.geolocation.clearWatch(id);id=navigator.geolocation.watchPosition(success,failure,{timeout:5000});};
document.getElementById('stop').onclick=()=>{navigator.geolocation.clearWatch(id);id=undefined;output.textContent='Watch cleared';};
