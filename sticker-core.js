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

/* Runtime guard for uploaded-sticker deletion. Keep this in sticker-core.js so the existing page loads it. */
(function (root) {
  'use strict';
  if (!root || root.__xiaoshuStickerDeleteGuardV1) return;
  root.__xiaoshuStickerDeleteGuardV1 = true;

  var STORE_KEY_PREFIX = 'xiaoshu_deleted_upload_hashes_v1_';
  var deleted = new Set();
  var loadedKey = '';
  var norm = function (value) { return String(value == null ? '' : value).trim(); };

  function sessionKey() {
    var sid = '';
    try { sid = String(root.__xiaoshuSessionDataReady || root.SESSION_ID || 'unscoped'); } catch (_) { sid = 'unscoped'; }
    sid = sid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'unscoped';
    return STORE_KEY_PREFIX + sid;
  }
  function loadDeleted() {
    var key = sessionKey();
    if (key === loadedKey) return;
    loadedKey = key;
    deleted.clear();
    try {
      var raw = root.localStorage && root.localStorage.getItem(key);
      var values = raw ? JSON.parse(raw) : [];
      if (Array.isArray(values)) values.forEach(function (value) {
        if (typeof value === 'string' && /^stk_[a-z0-9_]+$/i.test(value)) deleted.add(value);
      });
    } catch (_) {}
  }
  function hash(src) {
    try { return root.XiaoshuStickerCore && root.XiaoshuStickerCore.stickerId(norm(src)); } catch (_) { return ''; }
  }
  function isDeleted(src) {
    loadDeleted();
    var id = hash(src);
    return !!id && deleted.has(id);
  }
  function saveDeleted() {
    try { if (root.localStorage) root.localStorage.setItem(loadedKey || sessionKey(), JSON.stringify(Array.from(deleted))); } catch (error) {
      try { if (root.console && root.console.warn) root.console.warn('[表情删除保护] 删除标记保存失败，当前页面内仍会阻止恢复', error); } catch (_) {}
    }
  }
  function markDeleted(src) {
    loadDeleted();
    var id = hash(src);
    if (!id) return;
    deleted.add(id);
    saveDeleted();
  }
  function unmarkDeleted(src) {
    loadDeleted();
    var id = hash(src);
    if (id && deleted.delete(id)) saveDeleted();
  }
  function matches(list, src) {
    src = norm(src);
    return !!src && (list || []).some(function (item) { return norm(item) === src; });
  }

  function install(api) {
    if (!api) return false;
    if (api.__xsDeleteGuardPatched) return true;
    if (typeof api.getUploads !== 'function' || typeof api.getPool !== 'function') return false;
    api.__xsDeleteGuardPatched = true;
    loadDeleted();

    var rawGetUploads = api.getUploads.bind(api);
    var rawGetPool = api.getPool.bind(api);
    var rawRemoveUpload = api.removeUpload.bind(api);
    var rawClearUploads = api.clearUploads.bind(api);
    var rawHide = api.hide.bind(api);
    var rawSend = api.send.bind(api);
    var rawHydrate = api.hydrate.bind(api);
    var rawSync = api.sync.bind(api);
    var rawOpenAdmin = api.openAdmin.bind(api);
    var rawAddFiles = api.addFiles.bind(api);

    function purgeDeletedUploads() {
      loadDeleted();
      var stale = rawGetUploads().filter(function (src) { return isDeleted(src); });
      stale.forEach(function (src) { rawRemoveUpload(src, false); });
      return stale.length;
    }

    api.getUploads = function () {
      loadDeleted();
      return rawGetUploads().filter(function (src) { return !isDeleted(src); });
    };
    api.getPool = function () {
      loadDeleted();
      return rawGetPool().filter(function (src) { return !isDeleted(src); });
    };
    api.removeUpload = function (src, ask) {
      src = norm(src);
      loadDeleted();
      var exists = matches(rawGetUploads(), src);
      if (!exists) return rawRemoveUpload(src, ask);
      if (ask !== false) {
        var ok = false;
        try { ok = root.confirm('删除这张上传表情？'); } catch (_) {}
        if (!ok) return false;
      }
      markDeleted(src);
      var removed = rawRemoveUpload(src, false);
      if (!removed) unmarkDeleted(src);
      return removed;
    };
    api.clearUploads = function (ask) {
      loadDeleted();
      var list = rawGetUploads();
      if (ask !== false) {
        var ok = false;
        try { ok = root.confirm('清空全部上传表情包？内置表情不会受影响。'); } catch (_) {}
        if (!ok) return false;
      }
      list.forEach(markDeleted);
      return rawClearUploads(false);
    };
    api.hide = function (src, silent) {
      src = norm(src);
      loadDeleted();
      if (matches(rawGetUploads(), src)) return api.removeUpload(src, false);
      return rawHide(src, silent);
    };
    api.send = function (src) {
      src = norm(src);
      loadDeleted();
      if (isDeleted(src) || !matches(api.getPool(), src)) {
        try {
          if (typeof root.showNotification === 'function') root.showNotification('这张表情已删除或隐藏，请重新打开表情面板再选择', 'info', 1800);
        } catch (_) {}
        return false;
      }
      return rawSend(src);
    };
    api.sync = function () {
      purgeDeletedUploads();
      return rawSync.apply(api, arguments);
    };
    api.hydrate = function () {
      loadDeleted();
      return Promise.resolve(rawHydrate.apply(api, arguments)).then(function (result) {
        var removed = purgeDeletedUploads();
        if (removed) rawSync();
        return result;
      });
    };
    api.openAdmin = function () {
      purgeDeletedUploads();
      return rawOpenAdmin.apply(api, arguments);
    };
    api.addFiles = function () {
      purgeDeletedUploads();
      var before = new Set(rawGetUploads().map(norm));
      return Promise.resolve(rawAddFiles.apply(api, arguments)).then(function (result) {
        rawGetUploads().forEach(function (src) { if (!before.has(norm(src))) unmarkDeleted(src); });
        return result;
      });
    };

    // The picker calls api.hide for its × control. Uploaded images must be permanently deleted;
    // built-in images still use the reversible hidden list.
    try {
      if (root.document && !root.document.__xsDeleteGuardBatchBound) {
        root.document.__xsDeleteGuardBatchBound = true;
        root.document.addEventListener('click', function (event) {
          var target = event.target && event.target.closest ? event.target.closest('#xs-delete-selected-stickers') : null;
          if (!target) return;
          loadDeleted();
          var before = rawGetUploads().map(norm);
          root.setTimeout(function () {
            var after = new Set(rawGetUploads().map(norm));
            var changed = false;
            before.forEach(function (src) { if (!after.has(src)) { markDeleted(src); changed = true; } });
            if (changed) purgeDeletedUploads();
          }, 0);
        }, true);
      }
      if (root.addEventListener && !root.__xsDeleteGuardReadyBound) {
        root.__xsDeleteGuardReadyBound = true;
        root.addEventListener('xiaoshu-sticker-resources-ready', function () {
          purgeDeletedUploads();
          // The controller assigns its legacy aliases immediately after creating the store.
          root.xiaoshuGetSharedStickerPool = api.getPool;
          root.xiaoshuSendSharedSticker = api.send;
          root.xiaoshuHideStickerNow = api.hide;
        });
      }
    } catch (_) {}

    root.xiaoshuGetSharedStickerPool = api.getPool;
    root.xiaoshuSendSharedSticker = api.send;
    root.xiaoshuHideStickerNow = api.hide;
    purgeDeletedUploads();
    return true;
  }

  // Intercept the store's assignment so the guard is installed before its first session hydrate.
  var storeDescriptor = null;
  try { storeDescriptor = Object.getOwnPropertyDescriptor(root, 'xiaoshuStickerStore'); } catch (_) {}
  if (!storeDescriptor || storeDescriptor.configurable) {
    var storeValue = storeDescriptor && 'value' in storeDescriptor ? storeDescriptor.value : null;
    try {
      Object.defineProperty(root, 'xiaoshuStickerStore', {
        configurable: true,
        enumerable: true,
        get: function () { return storeValue; },
        set: function (value) {
          storeValue = value;
          if (value) install(value);
        }
      });
      if (storeValue) install(storeValue);
    } catch (_) {}
  }

  function attemptInstall() {
    var api = root.xiaoshuStickerStore;
    if (api && install(api)) {
      try { root.clearInterval(root.__xiaoshuStickerDeleteGuardTimer); } catch (_) {}
      root.__xiaoshuStickerDeleteGuardTimer = null;
      return true;
    }
    return false;
  }
  if (!attemptInstall()) {
    try {
      root.__xiaoshuStickerDeleteGuardTimer = root.setInterval(attemptInstall, 20);
      if (root.document) root.document.addEventListener('DOMContentLoaded', attemptInstall, { once: true });
      root.setTimeout(function () {
        try { if (root.__xiaoshuStickerDeleteGuardTimer) root.clearInterval(root.__xiaoshuStickerDeleteGuardTimer); } catch (_) {}
        root.__xiaoshuStickerDeleteGuardTimer = null;
      }, 15000);
    } catch (_) {}
  }
})(typeof window !== 'undefined' ? window : globalThis);
