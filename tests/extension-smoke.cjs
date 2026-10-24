const {chromium}=require('playwright');
const {WebSocketServer,WebSocket}=require('ws');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const traffic=await import('./traffic.mjs');
  const {defaults}=await import('../chromium-extension/settings.js');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'marine-gps-v2-'));
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/browser.js'?'text/javascript':'text/html');
    res.end(fs.readFileSync(path.join(__dirname,req.url==='/browser.js'?'browser.js':'browser.html')));
  });
  const wsServer=new WebSocketServer({noServer:true});
  const peers=new Set();let paused=false,invalid=false,index=0,subscriptions=0,authenticated=0,context;
  server.on('upgrade',(req,socket,head)=>{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname.startsWith('/signalk')&&u.searchParams.get('token')!=='test-only-signal-k-secret'){socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return;}
    if(u.pathname.startsWith('/signalk'))authenticated++;
    wsServer.handleUpgrade(req,socket,head,ws=>{ws.path=u.pathname;peers.add(ws);ws.on('close',()=>peers.delete(ws));ws.on('message',data=>{const m=JSON.parse(data.toString());if(m.subscribe?.some(s=>s.path==='navigation.position'))subscriptions++;});});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const timer=setInterval(()=>{
    if(paused)return;index++;
    for(const ws of peers){
      if(ws.readyState!==WebSocket.OPEN)continue;
      const lat=-31.95+index*.000001;
      if(ws.path.startsWith('/signalk'))ws.send(JSON.stringify(traffic.delta({lat,quality:invalid?'No GNSS':'GNSS fix'})));
      else if(ws.path==='/nmea0183'){
        const line=traffic.rmc(lat);ws.send(line.slice(0,19));ws.send(line.slice(19)+'\r\n');
      }else for(const p of traffic.payloads({lat,valid:!invalid})){
        if(ws.path==='/n2k/seasmart')ws.send(traffic.seasmart(p));
        if(ws.path==='/n2k/actisense')ws.send(traffic.actisense(p));
        if(ws.path==='/n2k/yacht')for(const frame of traffic.frames(p.pgn,p.data))ws.send(traffic.yachtLine(frame));
      }
    }
  },200);
  try{
    context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,
      ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),ignoreDefaultArgs:['--disable-extensions'],
      args:['--enable-unsafe-extension-debugging',...(process.env.CHROMIUM_PATH?[]:[`--disable-extensions-except=${path.join(root,'chromium-extension')}`,`--load-extension=${path.join(root,'chromium-extension')}`])]});
    if(process.env.CHROMIUM_PATH){const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Extensions.loadUnpacked',{path:path.join(root,'chromium-extension')});}
    let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    let config={...defaults,enabled:true,host:'127.0.0.1',port,path:'/signalk/v1/stream',authMode:'query',token:'test-only-signal-k-secret',stale:1};
    const configure=async update=>{config={...config,...update};worker=context.serviceWorkers()[0]||worker;await worker.evaluate(c=>chrome.storage.local.set({config:c}),config);};
    await configure({});
    const page=await context.newPage();await page.goto(`http://localhost:${port}/browser.html`);
    await page.evaluate(()=>{window.messages=[];window.addEventListener('message',e=>{if(e.data?.channel?.startsWith('marine-gps'))messages.push(e.data);});
      window.fixes=[];window.errors=[];window.watch=navigator.geolocation.watchPosition(p=>fixes.push({lat:p.coords.latitude,lon:p.coords.longitude,speed:p.coords.speed,heading:p.coords.heading,timestamp:p.timestamp}),e=>errors.push(e.code));});
    try{await page.waitForFunction(()=>fixes.length>=3,null,{timeout:15000});}catch(error){
      console.error('Initial GPS state',await worker.evaluate(async()=>({latest:(await chrome.storage.session.get('latest')).latest,contexts:await chrome.runtime.getContexts({})})),await page.evaluate(()=>({errors,messages,override:navigator.geolocation.getCurrentPosition.toString()})));
      throw error;
    }
    assert(authenticated>0&&subscriptions>0);assert.equal((await page.evaluate(()=>fixes.at(-1))).speed,2.5);
    const visible=await page.evaluate(()=>JSON.stringify(messages));assert(!visible.includes('test-only-signal-k-secret'));assert(!visible.includes('disabledSites'));assert(!visible.includes('/signalk/v1/stream'));assert(!visible.includes('127.0.0.1'));
    console.log('PASS direct authenticated Signal K, subscriptions, page credential isolation and popup-closed watches');
    paused=true;await page.waitForFunction(()=>errors.includes(2),null,{timeout:5000});paused=false;
    const before=await page.evaluate(()=>fixes.length);await page.waitForFunction(n=>fixes.length>n,before);
    invalid=true;await page.waitForFunction(()=>errors.length>=2,null,{timeout:5000});invalid=false;
    for(const ws of peers)ws.terminate();await wait(2000);await page.waitForFunction(n=>fixes.length>n,before+1);
    console.log('PASS stale data, invalid GNSS fix and network reconnect');
    // Terminate the actual MV3 background service worker. The offscreen worker
    // remains responsible for the socket and wakes a new background worker.
    const cdp=await context.browser().newBrowserCDPSession();const targets=(await cdp.send('Target.getTargets')).targetInfos;
    const target=targets.find(t=>t.type==='service_worker'&&t.url.endsWith('/background.js'));
    const count=await page.evaluate(()=>fixes.length);
    if(target)await cdp.send('Target.closeTarget',{targetId:target.targetId});
    await page.waitForFunction(n=>fixes.length>n,count,{timeout:15000});
    worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    console.log('PASS service-worker suspension and recovery');
    // Removing the offscreen document mimics browser reclamation; a subscriber
    // recreates it and the saved configuration restores the direct connection.
    await worker.evaluate(()=>chrome.offscreen.closeDocument());
    const recoveryPage=await context.newPage();await recoveryPage.goto(`http://localhost:${port}/browser.html`);await wait(500);
    const after=await page.evaluate(()=>fixes.length);await page.waitForFunction(n=>fixes.length>n,after,{timeout:15000});await recoveryPage.close();
    for(const [source,format,wsPath] of [['nmea0183','seasmart','/nmea0183'],['nmea2000','seasmart','/n2k/seasmart'],['nmea2000','yacht-raw','/n2k/yacht'],['nmea2000','actisense-ngt','/n2k/actisense']]){
      await configure({source,format,path:wsPath,token:'',authMode:'none'});
      let latest;
      for(let i=0;i<60;i++){latest=await worker.evaluate(async()=> (await chrome.storage.session.get('latest')).latest);if(latest?.source===source&&latest.status==='fix'&&(source!=='nmea2000'||latest.pgns.length===4))break;await wait(100);}
      assert.equal(latest.status,'fix');assert.equal(latest.source,source);
      if(source==='nmea2000'){assert.equal(latest.sourceAddress,23);assert.deepEqual(latest.pgns,[126992,129025,129026,129029]);}
      console.log(`PASS standalone ${source} / ${format}`);
    }
    await configure({source:'signalk',path:'/signalk/v1/stream',authMode:'query',token:'test-only-signal-k-secret',disabledSites:['localhost']});
    await wait(500);assert.equal(await page.evaluate(()=>messages.at(-1).action),'native');
    await configure({disabledSites:[]});
    const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);await popup.setViewportSize({width:390,height:650});
    assert.equal(await popup.locator('#source option').count(),3);assert.equal(await popup.locator('#bridgeToken').count(),0);
    await popup.selectOption('#source','nmea2000');assert(await popup.locator('#format').isVisible());
    await popup.selectOption('#source','signalk');
    const authBeforeSave=authenticated;await popup.click('button[type=submit]');
    for(let i=0;i<50&&authenticated===authBeforeSave;i++)await wait(100);
    assert(authenticated>authBeforeSave,'Popup save must apply the connection settings');
    await popup.waitForFunction(()=>document.getElementById('status').textContent==='Connected · valid position');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await popup.screenshot({path:path.join(root,'test-results','standalone-popup.png'),fullPage:true});await popup.close();
    const cleared=await page.evaluate(()=>{navigator.geolocation.clearWatch(watch);return fixes.length;});await wait(600);assert.equal(await page.evaluate(()=>fixes.length),cleared);
    console.log('PASS offscreen recreation, per-site native mode, standalone popup and clearWatch');
  }finally{
    clearInterval(timer);for(const ws of peers)ws.terminate();
    if(context)await context.close();wsServer.close();await new Promise(r=>server.close(r));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
