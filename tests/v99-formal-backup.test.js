const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const integritySource = fs.readFileSync(path.join(root, 'font-integrity.js'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'custom-font-manager.js'), 'utf8');
const codecSource = fs.readFileSync(path.join(root, 'font-backup-codec.js'), 'utf8');

function between(start, end, source = index) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'production source range missing: ' + start);
  return source.slice(a, b);
}
function record(id, format, seed) {
  const signatures = { ttf:[0,1,0,0], otf:[0x4f,0x54,0x54,0x4f], woff:[0x77,0x4f,0x46,0x46], woff2:[0x77,0x4f,0x46,0x32] };
  const bytes = new Uint8Array(40); bytes.set(signatures[format]);
  for (let i=4;i<bytes.length;i++) bytes[i]=(i*19+seed)&255;
  const mimeType = {ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2'}[format];
  return {id,name:id,fileName:id+'.'+format,format,mimeType,size:bytes.length,blob:new Blob([bytes],{type:mimeType}),createdAt:456};
}
function makeManager() {
  const idb = new IDBFactory();
  const document = {readyState:'loading',addEventListener(){},documentElement:{classList:{contains(){return false;}}}};
  const window = {document,indexedDB:idb,crypto:webcrypto,addEventListener(){},btoa,atob};
  const context = {window,console,Uint8Array,ArrayBuffer,Promise,Error,Math,Date,Blob,setTimeout,clearTimeout};
  vm.runInNewContext(integritySource,context,{filename:'font-integrity.js'});
  vm.runInNewContext(managerSource,context,{filename:'custom-font-manager.js'});
  vm.runInNewContext(codecSource,context,{filename:'font-backup-codec.js'});
  Object.defineProperty(window.ChuanXunFontManager,'__testIndexedDB',{value:idb});
  return window;
}
async function seed(manager, records, current) {
  const req=manager.__testIndexedDB.open('chuanxun-local-font-library',1);
  const db=await new Promise((resolve,reject)=>{
    req.onupgradeneeded=()=>{req.result.createObjectStore('fonts',{keyPath:'id'});req.result.createObjectStore('meta',{keyPath:'key'});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(['fonts','meta'],'readwrite');
    records.forEach(x=>tx.objectStore('fonts').put(x));
    tx.objectStore('meta').put({key:'currentFontId',value:current});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  db.close();
}
function makeProductionHarness({managerWindow, zipEnabled}) {
  const ChatBackup = {
    buildBackupPayload: async () => ({type:'chatapp-backup-v6',formatVersion:6,appName:'ChatApp',
      timestamp:'2026-11-02T00:00:00.000Z',sessionId:'sid',appPrefix:'app:',modules:[],
      manifest:{},diagnostics:{},localforage:{},localStorage:{},mediaStore:{}}),
    preflightBackup: data => ({ok:true,errors:[],warnings:[],data,availableCategoryIds:[],summary:{}})
  };
  const notices=[],offered=[];
  const window = Object.assign(managerWindow, {
    ChatBackup, JSZip:zipEnabled?JSZip:undefined,
    ChuanXunFontBackupCodec:managerWindow.ChuanXunFontBackupCodec,
    xiaoshuOfferBlobDownload(blob,name,opt){offered.push({blob,name,opt});},
    addEventListener(){}, crypto:webcrypto
  });
  const context = {
    global:window,window,ChatBackup,JSZip:zipEnabled?JSZip:undefined,
    ChuanXunFontBackupCodec:window.ChuanXunFontBackupCodec,
    V99:{backupTimeout:5000,zipTimeout:5000,writeTimeout:5000},
    console,Blob,Uint8Array,ArrayBuffer,Promise,Error,Math,Date,JSON,Object,String,Number,
    TextEncoder,TextDecoder,URL,setTimeout,clearTimeout,
    showNotification(message){notices.push(message);},
    ensureRegistryForKeys(){},strictFlushForBackup:async()=>{},ensureRegistryForData(){},
    timeoutPromise:p=>Promise.resolve(p),initMediaState:p=>({store:p.mediaStore||{}}),
    currentSid:()=> 'sid',currentPrefix:()=> 'app:',
    captureMain:()=>({}),captureModuleMemory:()=>({}),captureFrames:()=>({}),
    overlayLf(){},overlayLs(){},applyFlagsPost(){},collectUnownedDiagnostics:async()=>({localStorage:[],localforage:[]}),
    rebuildManifest(){},validateAppMediaReferences(){},own:(o,k)=>Object.prototype.hasOwnProperty.call(o,k),
    checksum:v=>JSON.stringify(v),errText:e=>e&&e.message||String(e),
    nowStamp:()=> '20261102_000000',humanBytes:n=>String(n)+' bytes',
    dataUrlBytes:()=>null,mediaChecksum:()=>'',fnvBytes:()=>'',binaryToDataUrl:()=>''
  };
  const build = between('ChatBackup.buildBackupPayload=async function(flags){','function validateAppMediaReferences(payload,errors){');
  const mediaValidator = between('function validateAppMediaReferences(payload,errors){','ChatBackup.preflightBackup=async function(data){');
  const preflight = between('ChatBackup.preflightBackup=async function(data){','// ---------- 正式导出：只使用v99 build').replace(/\n}\s*$/, '');
  const exporter = between('async function v99ExportBackupToFile(flags){','if(global.ChatBackup)global.ChatBackup.exportBackupToFile=v99ExportBackupToFile;')+
    '\nglobal.__v99ExportBackupToFile=v99ExportBackupToFile;';
  const zipDetector = between('function isZipArrayBuffer(ab){','async function parseZipBackup(ab){');
  const parser = zipDetector+between('async function parseZipBackup(ab){','async function loadBackupFromArrayBuffer(ab){')+
    '\n'+between('async function loadBackupFromArrayBuffer(ab){','async function loadBackupFromFile(file){')+
    '\nglobal.__v99LoadBackupFromArrayBuffer=loadBackupFromArrayBuffer;';
  vm.runInNewContext('var oldBuild=ChatBackup.buildBackupPayload,oldPreflight=ChatBackup.preflightBackup,oldLoadFile=ChatBackup.loadBackupFromFile;\n'+build+mediaValidator+preflight+exporter+parser,context,{filename:'production-v99-backup-pipeline.js'});
  return {context,ChatBackup,window,offered,notices};
}
async function roundTrip(zipEnabled) {
  const sourceWindow=makeManager();
  const source=sourceWindow.ChuanXunFontManager;
  const fonts=[record('font-ttf','ttf',1),record('font-otf','otf',2),record('font-woff','woff',3),record('font-woff2','woff2',4)];
  await seed(source,fonts,'font-woff2');
  const sourceSnapshot=await source.exportBackupSnapshot();
  const harness=makeProductionHarness({managerWindow:sourceWindow,zipEnabled});
  const exported=await harness.window.__v99ExportBackupToFile();
  assert.equal(exported.ok,true);
  assert.equal(exported.format,zipEnabled?'zip':'json');
  assert.equal(harness.offered.length,1);
  const ab=await harness.offered[0].blob.arrayBuffer();
  if(zipEnabled){
    const archive=await JSZip.loadAsync(ab);
    const paths=Object.keys(archive.files).filter(p=>/^fonts\/font-[0-9]{5}\.(?:ttf|otf|woff|woff2)$/.test(p)).sort();
    assert.equal(paths.length,4,'ZIP must contain four independent binary font files');
    for(const expected of sourceSnapshot.fonts){
      const entry=archive.file(paths.find(p=>p.endsWith('.'+expected.format)));
      assert.ok(entry,'ZIP must contain the declared '+expected.format+' binary');
      assert.deepEqual(Array.from(await entry.async('uint8array')),Array.from(new Uint8Array(await expected.blob.arrayBuffer())));
    }
  }
  const parsed=await harness.window.__v99LoadBackupFromArrayBuffer(ab);
  assert.equal(parsed.fontBackup.fonts.length,4);
  const pre=await harness.ChatBackup.preflightBackup(parsed);
  assert.equal(pre.ok,true,pre.errors&&pre.errors.join(';'));
  const targetWindow=makeManager();
  await targetWindow.ChuanXunFontManager.restoreBackupSnapshot(pre.data.fontBackup);
  const after=await targetWindow.ChuanXunFontManager.exportBackupSnapshot();
  assert.equal(after.currentFontId,'font-woff2');
  for(const expected of fonts){
    const actual=after.fonts.find(x=>x.id===expected.id);
    assert.ok(actual);
    assert.deepEqual(Array.from(new Uint8Array(await actual.blob.arrayBuffer())),
      Array.from(new Uint8Array(await expected.blob.arrayBuffer())));
  }
  for(const expected of sourceSnapshot.fonts){
    const actual=after.fonts.find(x=>x.id===expected.id);
    for(const key of ['id','name','fileName','format','mimeType','size','createdAt','checksum'])
      assert.equal(actual[key],expected[key],'restored font metadata must preserve '+key+' for '+expected.id);
  }
  return {exported,parsed,after,sourceSnapshot};
}

test('actual V99 JSON build/export/load/preflight/restore preserves all four font binaries', async()=>{
  const result=await roundTrip(false);
  assert.equal(result.exported.format,'json');
  assert.equal(result.parsed.fontBackup.formatVersion,2);
});

test('actual V99 ZIP build/export/load/preflight/restore stores real font files under safe manifest paths', async()=>{
  const result=await roundTrip(true);
  assert.equal(result.exported.format,'zip');
  assert.ok(result.parsed.fontBackup.fonts.every(x=>!x.zipPath));
  assert.equal(result.after.fonts.length,4);
});

test('actual V99 preflight rejects corrupted font bytes before any target IndexedDB write', async()=>{
  const sourceWindow=makeManager(),source=sourceWindow.ChuanXunFontManager;
  await seed(source,[record('bad-font','ttf',5)],'bad-font');
  const harness=makeProductionHarness({managerWindow:sourceWindow,zipEnabled:false});
  const exported=await harness.window.__v99ExportBackupToFile();
  const parsed=await harness.window.__v99LoadBackupFromArrayBuffer(await harness.offered[0].blob.arrayBuffer());
  const damaged=new Uint8Array(await parsed.fontBackup.fonts[0].blob.arrayBuffer());
  damaged[10]^=0xff;
  parsed.fontBackup.fonts[0].blob=new Blob([damaged],{type:'font/ttf'});
  await assert.rejects(harness.window.ChuanXunFontManager.validateBackupSnapshot(parsed.fontBackup), /校验失败/);
  let validationCalls=0;
  const validateOriginal=harness.window.ChuanXunFontManager.validateBackupSnapshot.bind(harness.window.ChuanXunFontManager);
  harness.window.ChuanXunFontManager.validateBackupSnapshot=async function(snapshot){validationCalls++;return validateOriginal(snapshot);};
  assert.match(String(harness.ChatBackup.preflightBackup), /validateBackupSnapshot/);
  const pre=await harness.ChatBackup.preflightBackup(parsed);
  assert.equal(validationCalls,1,'V99 preflight must invoke the production font validator');
  assert.equal(pre.ok,false, JSON.stringify(pre));
  assert.ok(pre.errors.some(x=>/字体备份预检失败/.test(x)));
  const target=makeManager();
  assert.equal((await target.ChuanXunFontManager.listFonts()).length,0);
});


test('actual V99 preflight rejects a mismatched font format declaration before target writes',async()=>{
  const sourceWindow=makeManager(),source=sourceWindow.ChuanXunFontManager;
  await seed(source,[record('wrong-format','ttf',7)],'wrong-format');
  const harness=makeProductionHarness({managerWindow:sourceWindow,zipEnabled:false});
  await harness.window.__v99ExportBackupToFile();
  const parsed=await harness.window.__v99LoadBackupFromArrayBuffer(await harness.offered[0].blob.arrayBuffer());
  parsed.fontBackup.fonts[0].format='woff';
  const pre=await harness.ChatBackup.preflightBackup(parsed);
  assert.equal(pre.ok,false);
  assert.ok(pre.errors.some(x=>/格式声明与文件内容不一致/.test(x)),pre.errors&&pre.errors.join(';'));
  const target=makeManager();
  assert.equal((await target.ChuanXunFontManager.listFonts()).length,0,'format preflight failure must happen before persistent font writes');
});

test('actual V99 preflight remains compatible with legacy backups that omit fontBackup', async()=>{
  const managerWindow=makeManager();
  const harness=makeProductionHarness({managerWindow,zipEnabled:false});
  const oldBackup={type:'chatapp-backup-v6',formatVersion:6,appName:'ChatApp',localforage:{},localStorage:{},manifest:{},diagnostics:{}};
  const pre=await harness.ChatBackup.preflightBackup(oldBackup);
  assert.equal(pre.ok,true);
  assert.equal(Object.prototype.hasOwnProperty.call(pre.data,'fontBackup'),false);
});
