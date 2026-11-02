/* Shared font backup integrity primitives. SHA-256 is mandatory for format v2. */
(function (global) {
  'use strict';
  function fail(message) { throw new Error(message); }
  async function sha256(bytes) {
    var source = bytes instanceof ArrayBuffer ? bytes : bytes && bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength)
      : null;
    if (!source) fail('字体二进制数据无效，无法计算 SHA-256');
    var cryptoObject = global.crypto;
    if (!cryptoObject || !cryptoObject.subtle || typeof cryptoObject.subtle.digest !== 'function') {
      fail('当前运行环境不支持 WebCrypto SHA-256，已阻止字体备份/恢复；未降级为弱校验');
    }
    var digest = await cryptoObject.subtle.digest('SHA-256', source);
    return Array.from(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function legacyFNV1a(bytes) {
    var hash = 2166136261;
    for (var i = 0; i < bytes.length; i++) { hash ^= bytes[i]; hash = Math.imul(hash, 16777619); }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }
  async function checksum(bytes, version) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (Number(version) === 1) return legacyFNV1a(view);
    if (Number(version) !== 2) fail('不支持的字体摘要算法版本');
    return sha256(view);
  }
  global.ChuanXunFontIntegrity = { sha256: sha256, legacyFNV1a: legacyFNV1a, checksum: checksum };
})(window);
