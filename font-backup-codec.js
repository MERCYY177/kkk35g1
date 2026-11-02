/* Lossless font backup codecs. Version 1 uses legacy FNV-1a; version 2 requires SHA-256. */
(function (global) {
  'use strict';
  var SCHEMA = 'chuanxun-font-library-backup';
  var MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
  var MAX_BYTES = 50 * 1024 * 1024, MAX_COUNT = 100, MAX_TOTAL = 200 * 1024 * 1024;
  function fail(message) { throw new Error(message); }
  function envelope(snapshot) {
    if (!snapshot || snapshot.schema !== SCHEMA || ![1, 2].includes(Number(snapshot.formatVersion)) || !Array.isArray(snapshot.fonts)) fail('字体备份格式或版本不受支持');
    if (snapshot.fonts.length > MAX_COUNT) fail('字体记录数量超过 100 项安全上限');
    var total = snapshot.fonts.reduce(function (sum, item) { return sum + (Number(item && item.size) || 0); }, 0);
    if (!Number.isSafeInteger(total) || total > MAX_TOTAL) fail('字体备份总大小超过 200 MB 安全上限');
    var seen = Object.create(null);
    snapshot.fonts.forEach(function (item) {
      var id = String(item && item.id || '');
      if (!id || id.length > 256 || seen[id]) fail('字体备份存在无效或重复 ID：' + id);
      seen[id] = true;
    });
    var current = snapshot.currentFontId == null ? null : String(snapshot.currentFontId);
    if (current && !seen[current]) fail('字体备份的当前字体 ID 不在字体清单中');
    return snapshot;
  }
  function cleanMeta(record, version) {
    if (!record || typeof record !== 'object') fail('字体备份元数据无效');
    var format = String(record.format || '').toLowerCase();
    if (!record.id || String(record.id).length > 256 || !record.fileName || !MIME[format]) fail('字体备份元数据无效');
    var size = Number(record.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) fail('字体备份文件大小无效');
    if (String(record.mimeType || '').toLowerCase() !== MIME[format]) fail('字体备份 MIME 类型无效');
    var checksum = String(record.checksum || '').toLowerCase();
    if (Number(version) === 1 ? !/^[0-9a-f]{8}$/.test(checksum) : !/^[0-9a-f]{64}$/.test(checksum)) fail('字体备份校验值与摘要版本不匹配');
    var extension = String(record.fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!extension || extension[1] !== format) fail('字体文件名扩展名与格式声明不一致');
    return { id: String(record.id), name: String(record.name || record.fileName), fileName: String(record.fileName), format: format, mimeType: MIME[format], size: size, createdAt: Number(record.createdAt) || 0, checksum: checksum };
  }
  async function verifyBytes(bytes, meta, version) {
    var integrity = global.ChuanXunFontIntegrity;
    if (!integrity || typeof integrity.checksum !== 'function') fail('字体 SHA-256 完整性模块未加载，已阻止弱校验降级');
    var actual = await integrity.checksum(bytes, Number(version));
    if (actual !== meta.checksum) fail('字体二进制校验失败：' + meta.fileName);
    var sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    var detected = sig === 'wOFF' ? 'woff' : sig === 'wOF2' ? 'woff2' : sig === 'OTTO' ? 'otf' : (sig === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) ? 'ttf' : '';
    if (detected !== meta.format) fail('字体文件实际签名与格式声明不一致：' + meta.fileName);
  }
  function bytesToBase64(bytes) {
    var binary = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    return global.btoa(binary);
  }
  function base64ToBytes(value) {
    if (typeof value !== 'string' || !value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('字体 Base64 数据格式无效');
    var binary;
    try { binary = global.atob(value); } catch (_) { fail('字体 Base64 解码失败'); }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  async function toJsonSnapshot(snapshot) {
    envelope(snapshot);
    var version = Number(snapshot.formatVersion), seen = Object.create(null);
    var fonts = await Promise.all(snapshot.fonts.map(async function (record) {
      var meta = cleanMeta(record, version);
      if (seen[meta.id]) fail('字体备份存在重复 ID：' + meta.id);
      seen[meta.id] = true;
      var blob = record.blob;
      if (!blob || typeof blob.arrayBuffer !== 'function' || blob.size !== meta.size) fail('字体二进制与元数据大小不一致：' + meta.fileName);
      var bytes = new Uint8Array(await blob.arrayBuffer());
      await verifyBytes(bytes, meta, version);
      meta.dataBase64 = bytesToBase64(bytes);
      return meta;
    }));
    return { schema: SCHEMA, formatVersion: version, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  async function fromJsonSnapshot(snapshot) {
    envelope(snapshot);
    var version = Number(snapshot.formatVersion), fonts = await Promise.all(snapshot.fonts.map(async function (record) {
      var meta = cleanMeta(record, version), bytes = base64ToBytes(record.dataBase64);
      if (bytes.byteLength !== meta.size) fail('字体 Base64 解码后大小不一致：' + meta.fileName);
      await verifyBytes(bytes, meta, version);
      delete meta.dataBase64;
      meta.blob = new Blob([bytes], { type: meta.mimeType });
      return meta;
    }));
    return { schema: SCHEMA, formatVersion: version, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  async function toZipSnapshot(snapshot, zip) {
    envelope(snapshot);
    if (!zip || typeof zip.file !== 'function') fail('ZIP 写入器不可用');
    var version = Number(snapshot.formatVersion), fonts = [], seen = Object.create(null);
    for (var i = 0; i < snapshot.fonts.length; i++) {
      var record = snapshot.fonts[i], meta = cleanMeta(record, version), blob = record.blob;
      if (seen[meta.id]) fail('字体备份存在重复 ID：' + meta.id);
      seen[meta.id] = true;
      if (!blob || typeof blob.arrayBuffer !== 'function' || blob.size !== meta.size) fail('字体二进制与元数据大小不一致：' + meta.fileName);
      var path = 'fonts/font-' + String(i + 1).padStart(5, '0') + '.' + meta.format;
      var bytes = new Uint8Array(await blob.arrayBuffer());
      await verifyBytes(bytes, meta, version);
      zip.file(path, bytes, { binary: true, createFolders: false });
      meta.zipPath = path;
      fonts.push(meta);
    }
    return { schema: SCHEMA, formatVersion: version, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  async function fromZipSnapshot(snapshot, zip) {
    envelope(snapshot);
    if (!zip || typeof zip.file !== 'function') fail('ZIP 读取器不可用');
    var version = Number(snapshot.formatVersion), seen = Object.create(null), paths = Object.create(null), fonts = [];
    for (var i = 0; i < snapshot.fonts.length; i++) {
      var record = snapshot.fonts[i], meta = cleanMeta(record, version), path = String(record.zipPath || '');
      if (seen[meta.id]) fail('字体备份存在重复 ID：' + meta.id);
      if (!/^fonts\/font-[0-9]{5}\.(?:ttf|otf|woff|woff2)$/.test(path) || path.indexOf('..') !== -1 || path.indexOf('\\\\') !== -1 || paths[path]) fail('字体 ZIP 路径不安全或重复：' + path);
      if (path.slice(-meta.format.length - 1) !== '.' + meta.format) fail('字体 ZIP 路径扩展名与格式不一致：' + path);
      seen[meta.id] = true; paths[path] = true;
      var entry = zip.file(path);
      if (!entry || entry.dir) fail('ZIP 缺少字体二进制文件：' + path);
      var bytes = new Uint8Array(await entry.async('arraybuffer'));
      if (bytes.byteLength !== meta.size) fail('ZIP 字体大小校验失败：' + meta.fileName);
      await verifyBytes(bytes, meta, version);
      delete meta.zipPath;
      meta.blob = new Blob([bytes], { type: meta.mimeType });
      fonts.push(meta);
    }
    return { schema: SCHEMA, formatVersion: version, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  global.ChuanXunFontBackupCodec = { toJsonSnapshot: toJsonSnapshot, fromJsonSnapshot: fromJsonSnapshot, toZipSnapshot: toZipSnapshot, fromZipSnapshot: fromZipSnapshot };
})(window);
