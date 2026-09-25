(function (global) {
  'use strict';

  var USER_MESSAGES = {
    INVALID_FORMAT: '图片格式无法读取',
    IMAGE_DECODE: '图片格式无法读取',
    COMPRESS_FAILED: '图片压缩失败',
    CANVAS_FAILED: '图片压缩失败',
    DB_UNAVAILABLE: '浏览器图片数据库不可用',
    DB_BLOCKED: '浏览器图片数据库被其他页面阻塞',
    WRITE_DENIED: '浏览器拒绝写入图片',
    QUOTA_EXCEEDED: '图片存储额度不足',
    VERIFY_FAILED: '图片写入后校验失败'
  };

  function MediaError(code, stage, cause, context) {
    var source = cause instanceof Error ? cause : new Error(String(cause || code));
    var message = USER_MESSAGES[code] || source.message || '图片处理失败';
    var error = new Error(message);
    error.name = 'XiaoshuMediaError';
    error.code = code;
    error.stage = stage || 'unknown';
    error.originalName = String(source.name || 'Error');
    error.originalMessage = String(source.message || source);
    error.context = context || {};
    error.cause = source;
    return error;
  }

  function classifyMediaError(error, stage, context) {
    if (error && error.name === 'XiaoshuMediaError' && error.code) return error;
    var name = String(error && error.name || 'Error');
    var message = String(error && error.message || error || '');
    var haystack = (name + ' ' + message).toLowerCase();
    var code;
    if (stage === 'format' || /unsupported|invalid image|not an image/.test(haystack)) code = 'INVALID_FORMAT';
    else if (stage === 'decode' || /decode/.test(haystack)) code = 'IMAGE_DECODE';
    else if (stage === 'canvas') code = 'CANVAS_FAILED';
    else if (stage === 'compress') code = 'COMPRESS_FAILED';
    else if (stage === 'verify') code = 'VERIFY_FAILED';
    else if (name === 'QuotaExceededError' || /quota|storage full|disk full/.test(haystack)) code = 'QUOTA_EXCEEDED';
    else if (/blocked/.test(haystack)) code = 'DB_BLOCKED';
    else if (name === 'SecurityError' || name === 'NotAllowedError' || /denied|refused|not allowed/.test(haystack)) code = stage === 'write' ? 'WRITE_DENIED' : 'DB_UNAVAILABLE';
    else if (stage === 'write') code = 'WRITE_DENIED';
    else code = 'DB_UNAVAILABLE';
    return MediaError(code, stage, error, context);
  }

  function isDataImage(value) { return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || '')); }
  function fingerprint(value) {
    var text = String(value == null ? '' : value), h1 = 2166136261 >>> 0, h2 = 2246822519 >>> 0;
    for (var i = 0; i < text.length; i += 1) {
      var c = text.charCodeAt(i);
      h1 = Math.imul((h1 ^ c) >>> 0, 16777619) >>> 0;
      h2 = Math.imul((h2 ^ (c + i)) >>> 0, 3266489917) >>> 0;
    }
    return h1.toString(36) + '_' + h2.toString(36) + '_' + text.length.toString(36);
  }
  function leafRefForData(data) { return 'leafimg_' + fingerprint(data); }
  function sessionToken(sessionId) { return fingerprint(String(sessionId || '')).split('_').slice(0, 2).join(''); }
  function mailRefForData(sessionId, data) { return 'mailimg_' + sessionToken(sessionId) + '_' + fingerprint(data); }
  function isLeafRef(value) { return /^leafimg_[a-z0-9_]+$/i.test(String(value || '')); }
  function isMailRef(value) { return /^mailimg_[a-z0-9]+_[a-z0-9_]+$/i.test(String(value || '')); }
  function isMailRefForSession(value, sidOrToken) {
    var source = String(sidOrToken || ''), clean = source.replace(/[^a-z0-9]/gi, ''), ref = String(value || '');
    if (clean && new RegExp('^mailimg_' + clean + '_[a-z0-9_]+$', 'i').test(ref)) return true;
    var token = sessionToken(source);
    return !!source && new RegExp('^mailimg_' + token + '_[a-z0-9_]+$', 'i').test(ref);
  }

  function createMediaRepository(adapter, cache) {
    cache = cache || Object.create(null);
    function requireAdapter() {
      if (!adapter || ['setItem', 'getItem', 'removeItem', 'keys'].some(function (name) { return typeof adapter[name] !== 'function'; })) {
        throw MediaError('DB_UNAVAILABLE', 'open', new Error('strict IndexedDB adapter unavailable'));
      }
    }
    return {
      cache: cache,
      putVerified: async function (key, data, context) {
        requireAdapter();
        key = String(key || ''); data = String(data || '');
        if (!key || !isDataImage(data)) throw MediaError('INVALID_FORMAT', 'format', new Error('invalid image data'), context);
        var existed = false;
        try { existed = (await adapter.getItem(key)) != null; }
        catch (error) { throw classifyMediaError(error, 'open', context); }
        try { await adapter.setItem(key, data); }
        catch (error) { throw classifyMediaError(error, 'write', context); }
        var check;
        try { check = await adapter.getItem(key); }
        catch (error) { throw classifyMediaError(error, 'verify', context); }
        if (check !== data) {
          if (!existed) { try { await adapter.removeItem(key); } catch (_) {} }
          delete cache[key];
          throw MediaError('VERIFY_FAILED', 'verify', new Error('stored media differs from source'), context);
        }
        cache[key] = data;
        return { key: key, existed: existed, bytes: data.length };
      },
      getVerified: async function (key, context) {
        requireAdapter(); key = String(key || '');
        if (isDataImage(cache[key])) return cache[key];
        var value;
        try { value = await adapter.getItem(key); }
        catch (error) { throw classifyMediaError(error, 'read', context); }
        if (value == null) return null;
        if (!isDataImage(value)) throw MediaError('VERIFY_FAILED', 'verify', new Error('stored media is invalid'), context);
        cache[key] = value;
        return value;
      },
      remove: async function (key, context) {
        requireAdapter();
        try { await adapter.removeItem(String(key || '')); delete cache[String(key || '')]; }
        catch (error) { throw classifyMediaError(error, 'write', context); }
      },
      keys: async function (prefix, context) {
        requireAdapter(); var keys;
        try { keys = await adapter.keys(); }
        catch (error) { throw classifyMediaError(error, 'read', context); }
        prefix = String(prefix || '');
        return (Array.isArray(keys) ? keys : []).map(String).filter(function (key) { return !prefix || key.indexOf(prefix) === 0; });
      }
    };
  }

  function normalizeMailboxStateV6(value, options) {
    value = value && typeof value === 'object' ? value : {};
    options = options || {};
    var token = String(options.sessionToken || '');
    var items = Array.isArray(value.items) ? value.items : [];
    var pending = Array.isArray(value.pending) ? value.pending : [];
    return {
      version: 6,
      items: items.filter(function (item) { return item && item.id && (item.type === 'sent' || item.type === 'received'); }).map(function (item) {
        var images = (Array.isArray(item.images) ? item.images : []).map(String).filter(function (ref) { return isMailRef(ref) && (!token || isMailRefForSession(ref, token)); }).filter(function (ref, index, list) { return list.indexOf(ref) === index; }).slice(0, 4);
        return { id: String(item.id), type: item.type, title: String(item.title || ''), content: String(item.content || ''), createdAt: Number(item.createdAt) || Date.now(), read: item.type === 'sent' ? true : !!item.read, originalContent: String(item.originalContent || ''), originalImages: (Array.isArray(item.originalImages) ? item.originalImages : []).map(String).filter(function (ref) { return isMailRef(ref) && (!token || isMailRefForSession(ref, token)); }).filter(function (ref, index, list) { return list.indexOf(ref) === index; }).slice(0, 4), replyToId: String(item.replyToId || ''), cardFragments: (Array.isArray(item.cardFragments) ? item.cardFragments : []).map(function (text) { return String(text || '').trim(); }).filter(Boolean).slice(0, 10), images: images };
      }),
      pending: pending.filter(function (job) { return job && job.id && job.kind === 'reply' && job.sourceId && Number(job.dueAt) > 0; }).map(function (job) { return { id: String(job.id), kind: 'reply', sourceId: String(job.sourceId), dueAt: Number(job.dueAt) }; }),
      nextIncomingAt: Number(value.nextIncomingAt) || 0,
      recentCardKeys: (Array.isArray(value.recentCardKeys) ? value.recentCardKeys : []).map(String).filter(Boolean).slice(-24)
    };
  }

  function collectMailMediaRefs(state) {
    var refs = new Set();
    (state && Array.isArray(state.items) ? state.items : []).forEach(function (item) {
      ['images', 'originalImages'].forEach(function (field) { (Array.isArray(item && item[field]) ? item[field] : []).forEach(function (ref) { if (isMailRef(ref)) refs.add(String(ref)); }); });
    });
    return refs;
  }
  function findUnreferencedMedia(keys, prefix, referenced, pending) {
    referenced = referenced || new Set(); pending = pending || new Set(); prefix = String(prefix || '');
    return (Array.isArray(keys) ? keys : []).map(String).filter(function (key) {
      if (key.indexOf(prefix) !== 0) return false;
      var ref = key.slice(prefix.length);
      return !referenced.has(ref) && !pending.has(ref);
    });
  }

  global.XiaoshuMediaCore = {
    USER_MESSAGES: USER_MESSAGES,
    MediaError: MediaError,
    classifyMediaError: classifyMediaError,
    isDataImage: isDataImage,
    fingerprint: fingerprint,
    leafRefForData: leafRefForData,
    sessionToken: sessionToken,
    mailRefForData: mailRefForData,
    isLeafRef: isLeafRef,
    isMailRef: isMailRef,
    isMailRefForSession: isMailRefForSession,
    createMediaRepository: createMediaRepository,
    normalizeMailboxStateV6: normalizeMailboxStateV6,
    collectMailMediaRefs: collectMailMediaRefs,
    findUnreferencedMedia: findUnreferencedMedia
  };
})(typeof window !== 'undefined' ? window : globalThis);
