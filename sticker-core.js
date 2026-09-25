(function (root) {
  'use strict';
  if (root.XiaoshuStickerCore) return;

  var IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)(?:[?#][^\s]*)?$/i;
  function normalize(value) { return String(value == null ? '' : value).trim(); }
  function hasUnsafePath(value) {
    if (/[\u0000-\u001f\u007f\\]/.test(value)) return true;
    var path = value.split(/[?#]/, 1)[0];
    try { path = decodeURIComponent(path); } catch (_) { return true; }
    return path.split('/').some(function (part) { return part === '..' || part === '.'; });
  }
  function safeResourceUrl(value, kind) {
    var raw = normalize(value);
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    if (/^(?:https?:\/\/|blob:|file:|content:)/i.test(raw)) return raw;
    if (kind === 'image' && /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(raw)) return raw;
    if (kind === 'video' && /^data:video\//i.test(raw)) return raw;
    if (kind === 'audio' && /^data:audio\//i.test(raw)) return raw;
    if (kind === 'font' && /^data:(?:font\/|application\/(?:font-|x-font-|octet-stream))/i.test(raw)) return raw;
    if (kind === 'image' && /^(?:\.\/)?assets\/stickers\//i.test(raw) && IMAGE_EXT.test(raw) && !hasUnsafePath(raw)) return raw;
    return '';
  }
  function withRetryToken(src, attempt) {
    src = normalize(src);
    if (!src || /^(?:data:|blob:|file:|content:)/i.test(src)) return src;
    var hashIndex = src.indexOf('#'), hash = hashIndex >= 0 ? src.slice(hashIndex) : '';
    var base = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
    var separator = base.indexOf('?') >= 0 ? '&' : '?';
    return base + separator + '__xs_sticker_retry=' + encodeURIComponent(String(attempt)) + hash;
  }
  function requestUrl(src, attempt, bust) { return bust ? withRetryToken(src, attempt) : normalize(src); }
  function stickerId(src) {
    src = normalize(src); var h1 = 2166136261 >>> 0, h2 = 2246822519 >>> 0;
    for (var i = 0; i < src.length; i++) { var c = src.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0; h2 ^= c + i; h2 = Math.imul(h2, 3266489917) >>> 0; }
    return src ? 'stk_' + h1.toString(36) + '_' + h2.toString(36) + '_' + src.length.toString(36) : '';
  }
  function rebuildResourceMap(messages, existing, catalog) {
    var map = Object.create(null), byId = Object.create(null), missing = [];
    Object.keys(existing || {}).forEach(function (id) { var src = safeResourceUrl(existing[id], 'image'); if (src) map[id] = src; });
    (catalog || []).forEach(function (raw) { var src = safeResourceUrl(raw, 'image'); if (src) byId[stickerId(src)] = src; });
    (messages || []).forEach(function (m) { if (!m || !m.stickerId) return; var id = String(m.stickerId); if (!map[id] && byId[id]) map[id] = byId[id]; if (!map[id] && missing.indexOf(id) < 0) missing.push(id); });
    return { map: map, missing: missing };
  }
  function createLoadMachine(options) {
    options = options || {}; var current = 'pending-resource', id = '', src = '', generation = 0, requestActive = false, retryCount = 0, resolveAttempts = 0, resolveTimer = null, timeoutTimer = null;
    var schedule = options.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    var cancel = options.cancel || function (token) { clearTimeout(token); };
    function emit(state) { current = state; if (options.onState) options.onState(state); }
    function clearTimers() { if (resolveTimer) cancel(resolveTimer); if (timeoutTimer) cancel(timeoutTimer); resolveTimer = timeoutTimer = null; }
    function resolveAgain() {
      src = safeResourceUrl(options.resolve ? options.resolve(id) : '', 'image');
      if (src) return load(false);
      if (resolveAttempts >= (options.maxResolveAttempts == null ? 4 : options.maxResolveAttempts)) { emit('resource-missing'); return; }
      resolveAttempts += 1; emit('pending-resource'); resolveTimer = schedule(resolveAgain, options.resolveDelayMs || 500);
    }
    function load(bust) {
      if (requestActive) return;
      if (!src) { resolveAgain(); return; }
      clearTimers(); requestActive = true; emit('loading'); var mine = ++generation;
      function finish(state) { if (!requestActive || mine !== generation) return; requestActive = false; clearTimers(); emit(state); }
      options.request(requestUrl(src, retryCount, bust), { load: function () { finish('loaded'); }, error: function () { finish('load-failed'); } });
      timeoutTimer = schedule(function () { finish('timeout'); }, options.timeoutMs || 15000);
    }
    return {
      start: function (nextId) { if (requestActive && nextId === id) return; if (nextId !== id) { clearTimers(); requestActive = false; generation += 1; id = String(nextId || ''); src = ''; retryCount = 0; resolveAttempts = 0; } resolveAgain(); },
      retry: function () { clearTimers(); requestActive = false; generation += 1; resolveAttempts = 0; src = safeResourceUrl(options.resolve ? options.resolve(id) : src, 'image') || src; if (!src) return resolveAgain(); retryCount += 1; load(true); },
      refresh: function () { if ((current !== 'pending-resource' && current !== 'resource-missing') || requestActive) return; resolveAttempts = 0; src = ''; resolveAgain(); },
      state: function () { return current; },
      source: function () { return src; },
      dispose: function () { clearTimers(); requestActive = false; generation += 1; },
    };
  }
  root.XiaoshuStickerCore = { safeResourceUrl: safeResourceUrl, withRetryToken: withRetryToken, requestUrl: requestUrl, stickerId: stickerId, rebuildResourceMap: rebuildResourceMap, createLoadMachine: createLoadMachine };
})(typeof window !== 'undefined' ? window : globalThis);
