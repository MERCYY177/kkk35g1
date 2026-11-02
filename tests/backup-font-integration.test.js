const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fontManager = fs.readFileSync(path.join(root, 'custom-font-manager.js'), 'utf8');
const codec = fs.readFileSync(path.join(root, 'font-backup-codec.js'), 'utf8');
const android = fs.readFileSync(path.join(root, 'android-apps/app/src/main/java/com/mercyy/transmission/MainActivity.java'), 'utf8');

function section(start, end) {
  const a = index.indexOf(start);
  const b = index.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'missing source section: ' + start);
  return index.slice(a, b);
}

test('V99 formal build captures the independent font database and preflight validates it', () => {
  assert.match(index, /payload\.fontBackup=await timeoutPromise\(global\.ChuanXunFontManager\.exportBackupSnapshot\(\)/);
  assert.match(index, /ChatBackup\.preflightBackup=async function\(data\)/);
  assert.match(index, /validateBackupSnapshot\(data\.fontBackup\)/);
  assert.match(index, /Object\.prototype\.hasOwnProperty\.call\(data,'fontBackup'\)/);
  assert.match(index, /<script src="font-backup-codec\.js"><\/script>/);
});

test('formal JSON and ZIP exporters and import parsers preserve font binaries symmetrically', () => {
  assert.match(index, /toJsonSnapshot\(payload\.fontBackup\)/);
  assert.match(index, /toZipSnapshot\(payload\.fontBackup,zip\)/);
  assert.match(index, /fromJsonSnapshot\(data\.fontBackup\)/);
  assert.match(index, /fromZipSnapshot\(data\.fontBackup,zip\)/);
  assert.match(codec, /zip\.file\(path, bytes, \{ binary: true, createFolders: false \}\)/);
  assert.match(codec, /verifyBytes\\(bytes, meta, version\\)/);
  assert.ok(codec.includes("fonts\\/font-[0-9]{5}"));
});

test('V99 restore snapshots both databases and compensates both after failure', () => {
  const apply = section('async function v99ApplyBackup(data,opt){', 'if(global.ChatBackup)global.ChatBackup.applyBackupToStorage=v99ApplyBackup;');
  const before = apply.indexOf('fontBefore=await timeoutPromise(fontManager.exportBackupSnapshot()');
  const mainWrite = apply.indexOf('lfSetStrict(k,desiredLf[k]');
  const fontWrite = apply.indexOf('fontManager.restoreBackupSnapshot(clean.fontBackup)');
  const cleanup = apply.indexOf('cleanupRetiredV99()');
  const fontRollback = apply.indexOf('fontManager.rollbackBackupRestore(fontBefore,fontRestore.addedIds)');
  const mainRollback = apply.indexOf('rollbackSnapshot(snap,ids)');
  assert.ok(before >= 0 && before < mainWrite && mainWrite < fontWrite && fontWrite < cleanup);
  assert.ok(fontRollback >= 0 && mainRollback > fontRollback);
  assert.match(apply, /字体恢复后回读校验失败/);
  assert.match(fontManager, /store\.add\(/);
  assert.match(fontManager, /拒绝回滚删除恢复前已存在的字体/);
});

test('old backups without fontBackup remain compatible while damaged new font snapshots fail preflight', () => {
  assert.match(index, /if\(data&&Object\.prototype\.hasOwnProperty\.call\(data,'fontBackup'\)\)/);
  assert.match(index, /pre\.errors\.push\('字体备份预检失败：'/);
  assert.match(fontManager, /缺少有效二进制校验值或校验失败/);
  assert.match(fontManager, /formatVersion: 2/);
  assert.match(fontManager, /MAX_TOTAL_FONT_SIZE = 200 \* 1024 \* 1024/);
  assert.match(codec, /MAX_TOTAL = 200 \* 1024 \* 1024/);
  assert.match(codec, /SHA-256/);
  assert.match(fontManager, /格式声明与文件内容不一致/);
});

test('emergency core is explicitly incomplete and full extension requires validated font data', () => {
  assert.match(index, /fontBackupStatus:'not-included-core-stage',fontBackupComplete:false,isFullBackup:false,complete:false/);
  assert.match(index, /global\.ChuanXunFontManager\.exportBackupSnapshot\(\)/);
  assert.match(index, /fontBackupStatus=parts\[1\]\?'included-and-validated':'failed-or-unavailable'/);
  assert.match(index, /full\.complete=errors\.length===0&&!missing&&!!parts\[1\]/);
  assert.match(index, /data\.fontBackupStatus==='included-and-validated'/);
  assert.match(index, /async function buildRescueLegacyV99\(data\)/);
  assert.match(index, /legacy\.fontBackup=await global\.ChuanXunFontBackupCodec\.fromJsonSnapshot\(data\.fontBackup\)/);
});

test('both rescue save buttons use the shared native save bridge and keep the main panel separate', () => {
  const panel = section('function rescuePanel(coreBlob,coreName,coreText){', 'global.xiaoshuEmergencyRescueExport=');
  assert.match(panel, /overlay\.id='v99-emergency-rescue-panel'/);
  assert.match(panel, /v99-rescue-core-save/);
  assert.match(panel, /v99-rescue-full-save/);
  assert.equal((panel.match(/global\.xiaoshuOfferBlobDownload\(/g) || []).length, 2);
  assert.doesNotMatch(panel, /href=/);
  assert.doesNotMatch(panel, /download=/);
  assert.match(index, /id=\"xiaoshu-rescue-save-link\"/);
  assert.match(android, /bridge\.requestSave/);
  assert.match(android, /bridge\.writeChunk/);
  assert.match(android, /bridge\.finishSave/);
  assert.match(android, /bridge\.cancelSave/);
  assert.match(android, /link\.dataset\.saving === '1'/);
});
