const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const root=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const integritySource=fs.readFileSync(path.join(root,'font-integrity.js'),'utf8');
const managerSource=fs.readFileSync(path.join(root,'custom-font-manager.js'),'utf8');
const codecSource=fs.readFileSync(path.join(root,'font-backup-codec.js'),'utf8');
function between(start,end){const a=index.indexOf(start),b=index.indexOf(end,a);assert.ok(a>=0&&b>a,'missing production source '+start);return index.slice(a,b);}
function font(id,format,seed){const sig={ttf:[0,1,0,0],otf:[79,84,84,79],woff:[119,79,70,70],woff2:[119,79,70,50]}[format];const bytes=new Uint8Array(32);bytes.set(sig);for(let i=4;i<32;i++)bytes[i]=(i*7+seed)&255;const mime={ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2'}[format];return{id,name:id,fileName:id+'.'+format,format,mimeType:mime,size:bytes.length,blob:new Blob([bytes],{type:mime}),createdAt:1};}
function makeManager(){const idb=new IDBFactory(),document={readyState:'loading',addEventListener(){},documentElement:{classList:{contains(){return false;}}}},window={document,indexedDB:idb,crypto:webcrypto,btoa,atob,addEventListener(){}};const ctx={window,console,Uint8Array,ArrayBuffer,Promise,Error,Math,Date,Blob,setTimeout,clearTimeout};vm.runInNewContext(integritySource,ctx);vm.runInNewContext(managerSource,ctx);vm.runInNewContext(codecSource,ctx);Object.defineProperty(window.ChuanXunFontManager,'__testIndexedDB',{value:idb});return window;}
async function seed(manager,records,current){const req=manager.__testIndexedDB.open('chuanxun-local-font-library',1);const db=await new Promise((res,rej)=>{req.onupgradeneeded=()=>{req.result.createObjectStore('fonts',{keyPath:'id'});req.result.createObjectStore('meta',{keyPath:'key'});};req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});await new Promise((res,rej)=>{const tx=db.transaction(['fonts','meta'],'readwrite');records.forEach(x=>tx.objectStore('fonts').put(x));tx.objectStore('meta').put({key:'currentFontId',value:current});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);});db.close();}
function rescueHarness(managerWindow, fontRead) {
  const captured={full:null,core:null,alerts:[],notices:[]};
  const ChatBackup={preflightBackup(data){return Promise.resolve(managerWindow.ChuanXunFontManager.validateBackupSnapshot(data.fontBackup)).then(clean=>({ok:true,errors:[],warnings:[],data:Object.assign({},data,{fontBackup:clean}),availableCategoryIds:[]})).catch(e=>({ok:false,errors:[e.message],data,availableCategoryIds:[]}));},getActiveCategories(){return[];}};
  const window=Object.assign(managerWindow,{ChatBackup,ChuanXunFontBackupCodec:managerWindow.ChuanXunFontBackupCodec});
  const context={global:window,window,ChatBackup,V99:{backupTimeout:5000},console,Blob,Uint8Array,ArrayBuffer,Promise,Error,Math,Date,JSON,Object,String,Number,setTimeout,clearTimeout,
    rescueTypesOk:data=>!!data&&/^xiaoshu-emergency-rescue-v[123]$/.test(String(data.type||'')),
    clone:value=>JSON.parse(JSON.stringify(value)),currentPrefix:()=> 'app:',currentSid:()=> 'sid',
    captureMain:()=>({sessionList:[{id:'sid'}]}),
    captureFrames:()=>({moments:{},chat2:{},interaction:{},interactionMedia:{}}),
    captureModuleMemory:()=>({mailMedia:{},stickerMessageResources:{},beautify:{},callRecords:[]}),
    captureCriticalLocalStorage:()=>({}),captureSessionStorage:()=>({}),
    captureAllLf:async errors=>({}),captureAllLocalStorage:async errors=>({}),
    timeoutPromise:p=>Promise.resolve(p),errText:e=>e&&e.message||String(e),nowStamp:()=> '20261102_000000',
    rescuePanel(coreBlob,coreName,coreText){captured.core={coreBlob,coreName,coreText};return{addFull(blob,name,text,errors,complete){captured.full={blob,name,text,errors,complete};},fullError(e){captured.fullError=e;}}},
    showNotification(message){captured.notices.push(message);},alert(message){captured.alerts.push(message);}
  };
  const core=between('function rescueCorePayload(meta){','async function buildRescueLegacyV99(data){');
  const legacy=between('async function buildRescueLegacyV99(data){','function rescuePanel(coreBlob,coreName,coreText){');
  const exportRescue=between('global.xiaoshuEmergencyRescueExport=function(meta){','async function chooseCategories(cats,title,sub){');
  const verify=between('global.xiaoshuVerifyEmergencyRescueData=async function(data,file){','global.xiaoshuImportEmergencyRescueData=');
  vm.runInNewContext(core+legacy+exportRescue+verify+
    '\nglobal.__buildRescueLegacyV99=buildRescueLegacyV99;',context,{filename:'production-v99-emergency.js'});
  return {window,context,captured,ChatBackup};
}
function allBytes(blob){return blob.arrayBuffer().then(ab=>Array.from(new Uint8Array(ab)));}

test('emergency core is returned immediately without awaiting the independent font database',async()=>{
  const w=makeManager(),snapshotManager=w.ChuanXunFontManager;
  await seed(snapshotManager,[font('one','ttf',1)],'one');
  const snapshot=await snapshotManager.exportBackupSnapshot();
  let release,started=false;
  snapshotManager.exportBackupSnapshot=()=>{started=true;return new Promise(resolve=>{release=()=>resolve(snapshot);});};
  const h=rescueHarness(w);
  const result=await h.window.xiaoshuEmergencyRescueExport({reason:'test'});
  assert.equal(started,true);
  assert.equal(result.payload.fontBackupComplete,false);
  assert.equal(result.payload.complete,false);
  assert.equal(result.payload.isFullBackup,false);
  assert.equal(result.payload.fontBackupStatus,'not-included-core-stage');
  release();
  const extended=await result.extendedPromise;
  assert.equal(extended.payload.complete,true);
  assert.equal(extended.payload.fontBackupComplete,true);
  assert.equal(extended.payload.fontBackupStatus,'included-and-validated');
});

test('actual emergency full export, JSON conversion, preflight and font restore preserve all four formats',async()=>{
  const source=makeManager(),records=[font('t','ttf',1),font('o','otf',2),font('w','woff',3),font('w2','woff2',4)];
  await seed(source.ChuanXunFontManager,records,'w2');
  const h=rescueHarness(source);
  const result=await h.window.xiaoshuEmergencyRescueExport({reason:'integration'});
  const extended=await result.extendedPromise;
  assert.equal(extended.payload.complete,true);
  assert.equal(extended.payload.fontBackupComplete,true);
  const fileJson=JSON.parse(extended.payload?JSON.stringify(extended.payload):'{}');
  const legacy=await h.window.__buildRescueLegacyV99(fileJson);
  assert.equal(legacy.fontBackup.fonts.length,4);
  const verified=await h.window.xiaoshuVerifyEmergencyRescueData(fileJson,{name:'emergency-full.json'});
  assert.equal(verified.ok,true);
  assert.equal(verified.complete,true);
  const target=makeManager();
  const pre=await h.ChatBackup.preflightBackup(legacy);
  assert.equal(pre.ok,true,pre.errors&&pre.errors.join(';'));
  await target.ChuanXunFontManager.restoreBackupSnapshot(pre.data.fontBackup);
  const after=await target.ChuanXunFontManager.exportBackupSnapshot();
  assert.equal(after.currentFontId,'w2');
  for(const expected of records){const actual=after.fonts.find(x=>x.id===expected.id);assert.ok(actual);assert.deepEqual(await allBytes(actual.blob),await allBytes(expected.blob));}
});

test('emergency font read failure is explicitly partial and cannot claim full backup',async()=>{
  const w=makeManager();
  w.ChuanXunFontManager.exportBackupSnapshot=async()=>{throw new Error('injected font database unavailable');};
  const h=rescueHarness(w);
  const result=await h.window.xiaoshuEmergencyRescueExport({reason:'failure-test'});
  const extended=await result.extendedPromise;
  assert.equal(result.payload.complete,false);
  assert.equal(extended.payload.complete,false);
  assert.equal(extended.payload.isFullBackup,false);
  assert.equal(extended.payload.fontBackupComplete,false);
  assert.equal(extended.payload.fontBackupStatus,'failed-or-unavailable');
  assert.ok(extended.errors.some(x=>/字体库读取\/校验失败/.test(x)));
});
