/* Lossless font backup codecs for JSON and ZIP containers. */
(function (global) {
  'use strict';
  var SCHEMA = 'chuanxun-font-library-backup';
  var VERSION = 1;
  var MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
  var MAX_BYTES = 50 * 1024 * 1024;

  function fail(message) { throw new Error(message); }
  function envelope(snapshot) {
    if (!snapshot || snapshot.schema !== SCHEMA || Number(snapshot.formatVersion) !== VERSION || !Array.isArray(snapshot.fonts)) {
      fail('字体备份格式或版本不受支持');
    }
    return snapshot;
  }
  function cleanMeta(record) {
    var format = String(record.format || '').toLowerCase();
    if (!record || typeof record !== 'object' || !record.id || !record.fileName || !MIME[format]) fail('字体备份元数据无效');
    var size = Number(record.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES) fail('字体备份文件大小无效');
    if (String(record.mimeType || '').toLowerCase() !== MIME[format]) fail('字体备份 MIME 类型无效');
    if (!/^[0-9a-f]{8}$/i.test(String(record.checksum || ''))) fail('字体备份缺少有效校验值');
    return {
      id: String(record.id), name: String(record.name || record.fileName), fileName: String(record.fileName),
      format: format, mimeType: MIME[format], size: size, createdAt: Number(record.createdAt) || 0,
      checksum: String(record.checksum).toLowerCase()
    };
  }
  function bytesToBase64(bytes) {
    var binary = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    }
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
    var fonts = await Promise.all(snapshot.fonts.map(async function (record) {
      var meta = cleanMeta(record), blob = record.blob;
      if (!blob || typeof blob.arrayBuffer !== 'function' || blob.size !== meta.size) fail('字体二进制与元数据大小不一致：' + meta.fileName);
      meta.dataBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      return meta;
    }));
    return { schema: SCHEMA, formatVersion: VERSION, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  async function fromJsonSnapshot(snapshot) {
    envelope(snapshot);
    var seen = Object.create(null);
    var fonts = await Promise.all(snapshot.fonts.map(async function (record) {
      var meta = cleanMeta(record);
      if (seen[meta.id]) fail('字体备份存在重复 ID：' + meta.id);
      seen[meta.id] = true;
      var bytes = base64ToBytes(record.dataBase64);
      if (bytes.byteLength !== meta.size) fail('字体 Base64 解码后大小不一致：' + meta.fileName);
      delete meta.dataBase64;
      meta.blob = new Blob([bytes], { type: meta.mimeType });
      return meta;
    }));
    return { schema: SCHEMA, formatVersion: VERSION, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  async function toZipSnapshot(snapshot, zip) {
    envelope(snapshot);
    if (!zip || typeof zip.file !== 'function') fail('ZIP 写入器不可用');
    var fonts = [];
    for (var i = 0; i < snapshot.fonts.length; i++) {
      var record = snapshot.fonts[i], meta = cleanMeta(record), blob = record.blob;
      if (!blob || typeof blob.arrayBuffer !== 'function' || blob.size !== meta.size) fail('字体二进制与元数据大小不一致：' + meta.fileName);
      var path = 'fonts/font-' + String(i + 1).padStart(5, '0') + '.' + meta.format;
      zip.file(path, await blob.arrayBuffer(), { binary: true, createFolders: false });
      meta.zipPath = path;
      fonts.push(meta);
    }
    return { schema: SCHEMA, formatVersion: VERSION, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  async function fromZipSnapshot(snapshot, zip) {
    envelope(snapshot);
    if (!zip || typeof zip.file !== 'function') fail('ZIP 读取器不可用');
    var seen = Object.create(null), paths = Object.create(null);
    var fonts = [];
    for (var i = 0; i < snapshot.fonts.length; i++) {
      var record = snapshot.fonts[i], meta = cleanMeta(record), path = String(record.zipPath || '');
      if (seen[meta.id]) fail('字体备份存在重复 ID：' + meta.id);
      if (!/^fonts\/font-[0-9]{5}\.(?:ttf|otf|woff|woff2)$/.test(path) || path.indexOf('..') !== -1 || path.indexOf('\\\\') !== -1 || paths[path]) fail('字体 ZIP 路径不安全或重复：' + path);
      if (path.slice(-meta.format.length - 1) !== '.' + meta.format) fail('字体 ZIP 路径扩展名与格式不一致：' + path);
      seen[meta.id] = true; paths[path] = true;
      var entry = zip.file(path);
      if (!entry || entry.dir) fail('ZIP 缺少字体二进制文件：' + path);
      var bytes = new Uint8Array(await entry.async('arraybuffer'));
      if (bytes.byteLength !== meta.size) fail('ZIP 字体大小校验失败：' + meta.fileName);
      delete meta.zipPath;
      meta.blob = new Blob([bytes], { type: meta.mimeType });
      fonts.push(meta);
    }
    return { schema: SCHEMA, formatVersion: VERSION, currentFontId: snapshot.currentFontId == null ? null : String(snapshot.currentFontId), fonts: fonts };
  }
  global.ChuanXunFontBackupCodec = {
    toJsonSnapshot: toJsonSnapshot,
    fromJsonSnapshot: fromJsonSnapshot,
    toZipSnapshot: toZipSnapshot,
    fromZipSnapshot: fromZipSnapshot
  };
})(window);
